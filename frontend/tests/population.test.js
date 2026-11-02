import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { townHallRequirements } from "../src/game/BuildingProgression.js";
import { ensurePopulation, loadGame } from "./helpers/population.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
function advance(engine, milliseconds) {
  while (milliseconds > 0) {
    const step = Math.min(250, milliseconds);
    assert(engine.tick(step).ok);
    milliseconds -= step;
  }
}
function fund(engine) {
  const game = JSON.parse(engine.save()).game;
  game.stock.fill(1000000);
  loadGame(engine, game);
}
function build(engine, type) {
  const world = engine.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!engine.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      assert(engine.dispatch({ type: "BUILD", payload }).ok);
      const id = engine.getState().buildings.at(-1).id;
      advance(
        engine,
        config.buildings.find((b) => b.id === type).levels[0].seconds * 1000,
      );
      return id;
    }
  throw new Error(`No plot for ${type}`);
}
function snapshot(engine) {
  const game = JSON.parse(engine.save()).game;
  delete game.savedAtUTC;
  return game;
}

test("Population requirements use completed housing at every Town Hall level", async () => {
  const requirements = [0, 50, 100, 150, 200, 300, 400, 550, 700, 850];
  assert.deepEqual(
    config.buildings
      .find((b) => b.id === "townhall")
      .levels.map((l) => l.populationRequired),
    requirements,
  );
  assert.deepEqual(
    config.buildings
      .find((b) => b.id === "townhall")
      .levels.map((l) => l.housing),
    [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  );
  for (let hall = 1; hall < 10; hall++) {
    const state = {
      buildings: [{ type: "townhall", level: hall, state: 1 }],
      population: {
        capacity: requirements[hall] - 1,
        military: 99999,
        reserved: 99999,
      },
    };
    const requirement = townHallRequirements(state, config).find(
      (entry) => entry.type === "population",
    );
    assert.equal(requirement.required, requirements[hall]);
    assert.equal(requirement.met, false);
    state.population.capacity++;
    assert(
      townHallRequirements(state, config).find(
        (entry) => entry.type === "population",
      ).met,
    );
  }
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    fund(engine);
    build(engine, "farm");
    build(engine, "lumberyard");
    build(engine, "barracks");
    ensurePopulation(engine, 49);
    assert.equal(engine.getState().population.capacity, 49);
    assert.equal(engine.getState().population.current, 0);
    const hall = engine
      .getState()
      .buildings.find((b) => b.type === "townhall").id;
    const before = snapshot(engine);
    const denied = engine.dispatch({ type: "UPGRADE", payload: { id: hall } });
    assert.equal(denied.ok, false);
    assert.match(denied.message, /population capacity 50.*current 49/);
    assert.deepEqual(snapshot(engine), before);
    build(engine, "house");
    assert.equal(engine.getState().population.capacity, 51);
    assert(engine.dispatch({ type: "UPGRADE", payload: { id: hall } }).ok);
    assert.equal(engine.getState().population.capacity, 51);
    advance(engine, 12000);
    assert.equal(engine.getState().population.capacity, 56);
    assert(engine.load(engine.save()).ok);
    assert.equal(engine.getState().population.capacity, 56);
  } finally {
    engine.dispose();
  }
});

test("Every House level contributes its total capacity only after completion", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    assert.equal(engine.getState().population.capacity, 5);
    fund(engine);
    const id = build(engine, "house");
    assert.equal(engine.getState().population.capacity, 7);
    const game = JSON.parse(engine.save()).game;
    game.buildings.find((b) => b.type === "townhall").level = 10;
    loadGame(engine, game);
    const capacities = [2, 5, 10, 15, 20];
    for (let level = 2; level <= 5; level++) {
      assert(engine.dispatch({ type: "UPGRADE", payload: { id } }).ok);
      assert.equal(
        engine.getState().population.capacity,
        50 + capacities[level - 2],
      );
      assert(engine.load(engine.save()).ok);
      const duration =
        config.buildings.find((b) => b.id === "house").levels[level - 1]
          .seconds * 1000;
      advance(engine, duration - 50);
      assert.equal(
        engine.getState().population.capacity,
        50 + capacities[level - 2],
      );
      advance(engine, 50);
      assert.equal(
        engine.getState().population.capacity,
        50 + capacities[level - 1],
      );
    }
    build(engine, "house");
    assert.equal(engine.getState().population.capacity, 72);
  } finally {
    engine.dispose();
  }
});

test("Lower Town Hall thresholds preserve existing progress and reject unrelated configuration changes", async () => {
  const previous = structuredClone(config);
  previous.buildings
    .find((b) => b.id === "townhall")
    .levels.forEach((level, index) => {
      level.populationRequired = [
        0, 100, 200, 300, 450, 600, 750, 900, 1100, 1300,
      ][index];
    });
  const old = await GameEngine.create({
    factory,
    config: previous,
    wasmBinary,
  });
  const current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    fund(old);
    ensurePopulation(old, 15);
    build(old, "farm");
    build(old, "lumberyard");
    const barracks = build(old, "barracks");
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
    const expected = snapshot(old);
    assert(current.load(old.save()).ok);
    expected.config = snapshot(current).config;
    assert.deepEqual(snapshot(current), expected);
    assert.deepEqual(
      snapshot(current)
        .config.buildings.find((b) => b.id === "townhall")
        .levels.map((level) => level.populationRequired),
      [0, 50, 100, 150, 200, 300, 400, 550, 700, 850],
    );
    const roundTrip = snapshot(current);
    assert(current.load(current.save()).ok);
    assert.deepEqual(snapshot(current), roundTrip);
    const changed = snapshot(old);
    changed.config.initialResources.wood++;
    assert.throws(() => loadGame(current, changed));
    assert.deepEqual(snapshot(current), roundTrip);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Population migration preserves troops and paid queues without inflating housing", async () => {
  const previous = structuredClone(config);
  delete previous.populationVersion;
  delete previous.populationMigration;
  for (const building of previous.buildings)
    if (config.populationMigration[building.id])
      building.levels.forEach((level, index) =>
        Object.assign(level, config.populationMigration[building.id][index]),
      );
  const old = await GameEngine.create({
    factory,
    config: previous,
    wasmBinary,
  });
  const current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    fund(old);
    const house = build(old, "house");
    const barracks = build(old, "barracks");
    for (let squad = 0; squad < 3; squad++) {
      assert(
        old.dispatch({
          type: "TRAIN",
          payload: { id: barracks, unitType: "infantry" },
        }).ok,
      );
      advance(old, 10000);
    }
    assert(
      old.dispatch({
        type: "TRAIN",
        payload: { id: barracks, unitType: "infantry" },
      }).ok,
    );
    const paid = old.getState();
    assert(current.load(old.save()).ok);
    const migrated = current.getState();
    assert.equal(migrated.population.capacity, 7);
    assert.equal(migrated.population.free, 0);
    assert.deepEqual(migrated.units, paid.units);
    assert.deepEqual(migrated.stock, paid.stock);
    assert.deepEqual(
      migrated.buildings.find((b) => b.id === barracks).queue,
      paid.buildings.find((b) => b.id === barracks).queue,
    );
    assert.equal(migrated.buildings.find((b) => b.id === house).housing, 2);
    const before = snapshot(current);
    assert.equal(
      current.dispatch({
        type: "TRAIN",
        payload: { id: barracks, unitType: "infantry" },
      }).ok,
      false,
    );
    assert.deepEqual(snapshot(current), before);
    assert(current.load(current.save()).ok);
    advance(current, 10000);
    assert.equal(current.getState().units.length, 4);
    assert.equal(current.getState().population.capacity, 7);
    const changed = snapshot(old);
    changed.config.initialResources.wood++;
    assert.throws(() => loadGame(current, changed));
  } finally {
    old.dispose();
    current.dispose();
  }
});
