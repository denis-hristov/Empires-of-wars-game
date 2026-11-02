import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { loadGame } from "./helpers/population.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const fixture = await readFile(
  new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
  "utf8",
);
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  const result = engine.load(fixture);
  assert(result.ok, result.message);
  return engine;
}
function snapshot(engine) {
  const game = JSON.parse(engine.save()).game;
  delete game.savedAtUTC;
  return game;
}
function plot(engine, definition) {
  const world = engine.getWorld();
  const occupied = new Set();
  for (const building of engine.getState().buildings)
    for (let dy = 0; dy < building.footprint[1]; dy++)
      for (let dx = 0; dx < building.footprint[0]; dx++)
        occupied.add(
          `${building.position[0] + dx}:${building.position[1] + dy}`,
        );
  const [width, height] = definition.footprint;
  for (let y = 0; y + height <= world.height; y++)
    for (let x = 0; x + width <= world.width; x++) {
      let legal = true;
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < width; dx++)
          if (
            occupied.has(`${x + dx}:${y + dy}`) ||
            !(definition.domain === "naval" ? [0] : [1, 2]).includes(
              world.tiles[(y + dy) * world.width + x + dx],
            )
          )
            legal = false;
      if (legal) return [x, y];
    }
  throw new Error(`No plot for ${definition.id}`);
}

test("All thirty land, naval and air unit types dismiss once for twenty gold and release their population", async () => {
  const engine = await army();
  try {
    const base = snapshot(engine);
    base.units = [];
    base.battle = null;
    loadGame(engine, base);
    for (const definition of config.units) {
      const game = snapshot(engine);
      const id = String(game.nextId++);
      const source = game.buildings.find(
        (building) => building.type === definition.building,
      ).id;
      const catalog = engine
        .getState()
        .unitCatalog.find((unit) => unit.id === definition.id);
      game.units.push({
        id: Number(id),
        source,
        type: definition.id,
        position: plot(engine, definition),
        health: catalog.effectiveHealth,
      });
      loadGame(engine, game);
      const before = engine.getState();
      const result = engine.dispatch({ type: "DISMISS_UNIT", payload: { id } });
      assert(result.ok, `${definition.id}: ${result.message}`);
      const after = engine.getState();
      assert.equal(after.units.length, 0);
      assert.deepEqual(
        after.stock,
        before.stock.map((amount, index) => amount + (index === 4 ? 20 : 0)),
      );
      assert.equal(
        after.population.military,
        before.population.military - catalog.people,
      );
      assert.equal(after.population.capacity, before.population.capacity);
      assert.equal(after.population.reserved, before.population.reserved);
      assert.equal(after.revision, before.revision + 1);
      assert.equal(
        engine.dispatch({ type: "DISMISS_UNIT", payload: { id } }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), after);
    }
    const before = snapshot(engine);
    assert(engine.load(engine.save()).ok);
    assert.deepEqual(snapshot(engine), before);
  } finally {
    engine.dispose();
  }
});

test("Dismissal preserves carrier cargo, releases embarked and reserved units, and rejects invalid or battle commands atomically", async () => {
  const engine = await army();
  try {
    let state = engine.getState();
    const carrier = state.units.find(
      (unit) => unit.carrierSlots > 0 && unit.aircraftCount > 0,
    );
    assert(carrier);
    const plane = state.units.find((unit) => unit.carrier === carrier.id);
    assert.equal(
      engine.dispatch({ type: "DISMISS_UNIT", payload: { id: carrier.id } }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), state);
    const gold = state.stock[4];
    assert(
      engine.dispatch({ type: "DISMISS_UNIT", payload: { id: plane.id } }).ok,
    );
    state = engine.getState();
    assert.equal(
      state.units.find((unit) => unit.id === carrier.id).aircraftCount,
      carrier.aircraftCount - 1,
    );
    assert.equal(state.stock[4], gold + 20);
    const game = snapshot(engine);
    const reserve = game.units.find((unit) => unit.type === "jet_fighter");
    reserve.reserve = true;
    loadGame(engine, game);
    state = engine.getState();
    assert(
      engine.dispatch({
        type: "DISMISS_UNIT",
        payload: { id: String(reserve.id) },
      }).ok,
    );
    assert.equal(engine.getState().stock[4], state.stock[4] + 20);
    for (const id of [
      1,
      "0",
      "missing",
      "999999999999999999999999999999",
      "999999",
    ]) {
      const before = engine.getState();
      assert.equal(
        engine.dispatch({ type: "DISMISS_UNIT", payload: { id } }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), before);
    }
    const full = snapshot(engine);
    full.stock[4] = 1_000_000_000_000 - 20;
    loadGame(engine, full);
    const unit = engine
      .getState()
      .units.find((entry) => !entry.carrier && !entry.reserve);
    state = engine.getState();
    assert.equal(
      engine.dispatch({ type: "DISMISS_UNIT", payload: { id: unit.id } }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), state);
    assert(
      engine.dispatch({ type: "BATTLE_START", payload: { unitIds: [unit.id] } })
        .ok,
    );
    state = engine.getState();
    assert.equal(
      engine.dispatch({ type: "DISMISS_UNIT", payload: { id: unit.id } }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), state);
  } finally {
    engine.dispose();
  }
});
