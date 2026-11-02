import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { placementPreview } from "../src/game/MapPlacement.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const savedArmy = await readFile(
  new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
  "utf8",
);
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  const result = engine.load(savedArmy);
  assert(result.ok, result.message);
  return engine;
}
const mode = (unit) => ({ type: "move-unit", id: unit.id });
const tile = (unit) => ({ x: unit.position[0], y: unit.position[1] });

test("Real unit previews validate each footprint without moving troops, changing occupancy or advancing revision", async () => {
  const engine = await army();
  try {
    const before = engine.getState(),
      world = engine.getWorld();
    const footprints = new Set();
    for (const unit of before.units) {
      const current = tile(unit),
        moving = mode(unit);
      const result = placementPreview(engine, before, moving, current);
      if (unit.carrier || unit.reserve) assert.equal(result.ok, false);
      else {
        assert.equal(result.ok, true, unit.type);
        footprints.add(unit.footprint.join("×"));
      }
      assert.equal(result.stateRevision, before.revision);
      const building = before.buildings[0];
      assert.equal(
        placementPreview(engine, before, moving, {
          x: building.position[0],
          y: building.position[1],
        }).ok,
        false,
      );
      assert.equal(
        placementPreview(engine, before, moving, {
          x: world.width,
          y: world.height,
        }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), before);
      assert.deepEqual(engine.getWorld(), world);
    }
    assert.deepEqual([...footprints].sort(), ["1×2", "1×3", "2×2", "2×3"]);
    for (const payload of [
      { id: "999999", x: 0, y: 0 },
      { id: 1, x: 0, y: 0 },
      { id: before.units[0].id, x: 1.5, y: 0 },
    ]) {
      assert.equal(
        engine.dispatch({ type: "CAN_MOVE_UNIT", payload }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), before);
    }
  } finally {
    engine.dispose();
  }
});

test("Green movement previews agree with real moves and remain non-mutating through repeated hovering", async () => {
  const engine = await army();
  try {
    const before = engine.getState();
    let destination;
    for (const unit of before.units.filter(
      (unit) => !unit.carrier && !unit.reserve,
    )) {
      const start = tile(unit);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const target = { x: start.x + dx, y: start.y + dy };
        if (placementPreview(engine, before, mode(unit), target).ok) {
          destination = { unit, target, start };
          break;
        }
      }
      if (destination) break;
    }
    assert(
      destination,
      "The migrated army has a reachable neighboring destination",
    );
    const { unit, target, start } = destination;
    for (let hover = 0; hover < 100; hover++) {
      assert.equal(
        placementPreview(engine, before, mode(unit), target).ok,
        true,
      );
      assert.equal(
        placementPreview(engine, before, mode(unit), { x: -1, y: -1 }).ok,
        false,
      );
    }
    assert.deepEqual(engine.getState(), before);
    assert(
      engine.dispatch({
        type: "MOVE_UNIT",
        payload: { id: unit.id, ...target },
      }).ok,
    );
    assert.deepEqual(
      engine.getState().units.find((entry) => entry.id === unit.id).position,
      [target.x, target.y],
    );
    assert(placementPreview(engine, engine.getState(), mode(unit), start).ok);
    assert(
      engine.dispatch({ type: "MOVE_UNIT", payload: { id: unit.id, ...start } })
        .ok,
    );
    assert.deepEqual(engine.getState().units, before.units);
  } finally {
    engine.dispose();
  }
});

test("Building previews keep using their original checks and missing hover clears the preview", async () => {
  const engine = await army();
  try {
    const state = engine.getState(),
      building = state.buildings[0],
      target = tile(building);
    assert.deepEqual(
      placementPreview(
        engine,
        state,
        { type: "move", id: building.id },
        target,
      ),
      engine.dispatch({
        type: "CAN_BUILD",
        payload: { id: building.id, buildingType: building.type, ...target },
      }),
    );
    assert.deepEqual(
      placementPreview(
        engine,
        state,
        { type: "build", buildingType: "house" },
        target,
      ),
      engine.dispatch({
        type: "CAN_BUILD",
        payload: { buildingType: "house", ...target },
      }),
    );
    assert.equal(
      placementPreview(engine, state, mode(state.units[0]), null),
      null,
    );
    assert.equal(placementPreview(engine, state, null, target), null);
    assert.equal(
      placementPreview(null, state, mode(state.units[0]), target),
      null,
    );
    assert.deepEqual(engine.getState(), state);
  } finally {
    engine.dispose();
  }
});
