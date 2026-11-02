import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import {
  buildingLevelCap,
  townHallRequirements,
} from "../src/game/BuildingProgression.js";
import { loadGame } from "./helpers/population.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const types = ["house", "farm", "lumberyard", "stone", "iron"];
function snapshot(engine) {
  const game = JSON.parse(engine.save()).game;
  delete game.savedAtUTC;
  return game;
}
function setup(engine, hall) {
  const game = snapshot(engine);
  game.stock.fill(1000000);
  game.buildings[0].level = hall;
  loadGame(engine, game);
}
function completedBuilding(engine, type) {
  const world = engine.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!engine.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      assert(engine.dispatch({ type: "BUILD", payload }).ok);
      const game = snapshot(engine);
      const building = game.buildings.at(-1);
      Object.assign(building, { level: 4, state: 1, remainingMs: 0 });
      loadGame(engine, game);
      return String(building.id);
    }
  throw new Error(`No plot for ${type}`);
}
function advance(engine, milliseconds) {
  while (milliseconds > 0) {
    const step = Math.min(250, milliseconds);
    assert(engine.tick(step).ok);
    milliseconds -= step;
  }
}

test("Economic level five stays locked at Town Hall eight and is paid and completed at nine", async () => {
  for (const hall of [8, 9]) {
    const engine = await GameEngine.create({ factory, config, wasmBinary });
    try {
      setup(engine, hall);
      for (const type of types) {
        assert.equal(buildingLevelCap(config, type, 8), 4);
        assert.equal(buildingLevelCap(config, type, 9), 5);
        assert.equal(buildingLevelCap(config, type, 10), 5);
        const definition = config.buildings.find(
          (building) => building.id === type,
        );
        assert.equal(definition.levels[4].townHallRequired, 9);
        const id = completedBuilding(engine, type);
        const before = snapshot(engine);
        const result = engine.dispatch({ type: "UPGRADE", payload: { id } });
        if (hall === 8) {
          assert.equal(result.ok, false);
          assert.match(result.message, /Town Hall/);
          assert.deepEqual(snapshot(engine), before);
          continue;
        }
        assert(result.ok, result.message);
        const building = () =>
          engine.getState().buildings.find((entry) => entry.id === id);
        assert.equal(building().completedLevel, 4);
        assert.equal(building().state, 2);
        assert.deepEqual(
          engine.getState().stock,
          before.stock.map(
            (value, i) =>
              value -
              (definition.levels[4].cost[
                ["food", "wood", "stone", "iron", "coins"][i]
              ] ?? 0),
          ),
        );
        advance(engine, definition.levels[4].seconds * 1000);
        assert.equal(building().completedLevel, 5);
        if (type === "house") assert.equal(building().housing, 20);
        else assert.equal(building().production.intervalSeconds, 1);
      }
      if (hall === 9)
        assert(
          townHallRequirements(engine.getState(), config)
            .filter((entry) => ["farm", "lumberyard"].includes(entry.type))
            .every((entry) => entry.required === 5 && entry.met),
        );
      const before = snapshot(engine);
      assert(engine.load(engine.save()).ok);
      assert.deepEqual(snapshot(engine), before);
    } finally {
      engine.dispose();
    }
  }
});

test("Both previous population balances migrate to earlier economic unlocks without changing paid progress", async () => {
  const previous = structuredClone(config);
  delete previous.economicLevelFiveVersion;
  for (const type of types) {
    previous.buildingLimits[type][8] = 4;
    previous.buildings.find(
      (building) => building.id === type,
    ).levels[4].townHallRequired = 10;
  }
  const old = await GameEngine.create({
    factory,
    config: previous,
    wasmBinary,
  });
  const current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    setup(old, 8);
    completedBuilding(old, "house");
    completedBuilding(old, "farm");
    const barracks = completedBuilding(old, "barracks");
    assert(
      old.dispatch({
        type: "TRAIN",
        payload: { id: barracks, unitType: "infantry" },
      }).ok,
    );
    advance(old, 10000);
    assert(
      old.dispatch({
        type: "TRAIN",
        payload: { id: barracks, unitType: "infantry" },
      }).ok,
    );
    advance(old, 250);
    for (const olderPopulation of [false, true]) {
      const saved = snapshot(old);
      if (olderPopulation)
        saved.config.buildings
          .find((building) => building.id === "townhall")
          .levels.forEach((level, index) => {
            level.populationRequired = [
              0, 100, 200, 300, 450, 600, 750, 900, 1100, 1300,
            ][index];
          });
      loadGame(current, saved);
      saved.config = snapshot(current).config;
      assert.deepEqual(snapshot(current), saved);
      assert.equal(saved.config.economicLevelFiveVersion, 1);
      assert.equal(saved.config.buildingLimits.house[8], 5);
      const before = snapshot(current);
      assert(current.load(current.save()).ok);
      assert.deepEqual(snapshot(current), before);
    }
    const before = snapshot(current);
    const changed = snapshot(old);
    changed.config.initialResources.wood++;
    assert.throws(() => loadGame(current, changed));
    assert.deepEqual(snapshot(current), before);
  } finally {
    old.dispose();
    current.dispose();
  }
});
