import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const previousArmy = await readFile(
  new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
  "utf8",
);
const clean = (state) => {
  const copy = structuredClone(state);
  delete copy.revision;
  return copy;
};
const cells = (entity) => {
  const [w, h] = entity.footprint;
  return Array.from({ length: w * h }, (_, i) => [
    entity.position[0] + (i % w),
    entity.position[1] + Math.floor(i / w),
  ]);
};
function assertOccupancy(engine) {
  const state = engine.getState();
  const world = engine.getWorld();
  const occupied = new Map();
  for (const entity of [
    ...state.buildings,
    ...state.units.filter((unit) => !unit.carrier && !unit.reserve),
  ])
    for (const [x, y] of cells(entity)) {
      assert(
        x >= 0 && x < world.width && y >= 0 && y < world.height,
        `${entity.type} stays inside map`,
      );
      assert(
        !occupied.has(`${x},${y}`),
        `${entity.type} overlaps ${occupied.get(`${x},${y}`)}`,
      );
      occupied.set(`${x},${y}`, entity.id);
      if (state.units.some((unit) => unit.id === entity.id)) {
        const definition = state.unitCatalog.find(
          (unit) => unit.id === entity.type,
        );
        assert(
          (definition.domain === "naval" ? [0] : [1, 2]).includes(
            world.tiles[y * world.width + x],
          ),
          `${entity.type} has valid terrain in every cell`,
        );
      }
    }
  return occupied;
}
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  const result = engine.load(previousArmy);
  assert(result.ok, result.message);
  return engine;
}

test("Real WASM exposes thirty unit footprints and migrates the existing army intact", async () => {
  const engine = await army();
  try {
    const state = engine.getState();
    const original = JSON.parse(previousArmy).game;
    assert.equal(state.units.length, original.units.length);
    for (const definition of state.unitCatalog) {
      const expected =
        definition.domain === "naval"
          ? [1, definition.level <= 2 ? 1 : definition.level <= 6 ? 2 : 3]
          : definition.domain === "air"
            ? [2, definition.level <= 6 ? 2 : 3]
            : [1, definition.level >= 4 ? 2 : 1];
      assert.deepEqual(definition.footprint, expected, definition.id);
      for (const unit of state.units.filter(
        (unit) => unit.type === definition.id,
      )) {
        assert.deepEqual(unit.footprint, expected);
        const previous = original.units.find(
          (old) => String(old.id) === unit.id,
        );
        assert(previous);
        const oldDefinition = original.config.units.find((entry) => entry.id === unit.type);
        const expectedHealth = definition.domain === "air"
          ? Math.round(previous.health * definition.health / oldDefinition.health)
          : previous.health;
        assert.equal(unit.health, expectedHealth);
        assert.equal(unit.source, String(previous.source));
      }
    }
    assertOccupancy(engine);
    assert(engine.load(engine.save()).ok);
    assert.deepEqual(clean(engine.getState()), clean(state));
    assertOccupancy(engine);
  } finally {
    engine.dispose();
  }
});

test("Real WASM blocks the second occupied cell and rejects map-edge movement atomically", async () => {
  const engine = await army();
  try {
    for (const domain of ["land", "naval", "air"]) {
      const initial = engine.getState();
      if (
        !initial.units.some(
          (unit) =>
            !unit.carrier &&
            !unit.reserve &&
            initial.unitCatalog.some(
              (definition) =>
                definition.id === unit.type &&
                definition.domain === domain &&
                definition.level <= 3,
            ),
        )
      ) {
        const definition = initial.unitCatalog.find(
          (definition) =>
            definition.domain === domain && definition.level === 1,
        );
        const source = initial.buildings.find(
          (building) => building.type === definition.building,
        );
        const result = engine.dispatch({
          type: "TRAIN",
          payload: { id: source.id, unitType: definition.id },
        });
        assert(result.ok, result.message);
        for (let ms = 0; ms < definition.seconds * 1000; ms += 250)
          engine.tick(250);
      }
      const state = engine.getState();
      const definitions = state.unitCatalog.filter(
        (definition) => definition.domain === domain,
      );
      const larger = state.units.find(
        (unit) =>
          !unit.carrier &&
          !unit.reserve &&
          definitions.some(
            (definition) =>
              definition.id === unit.type && definition.level >= 4,
          ),
      );
      const smaller = state.units.find(
        (unit) =>
          !unit.carrier &&
          !unit.reserve &&
          definitions.some(
            (definition) =>
              definition.id === unit.type && definition.level <= 3,
          ),
      );
      assert(larger && smaller, domain);
      const before = clean(state);
      assert.equal(
        engine.dispatch({
          type: "MOVE_UNIT",
          payload: {
            id: smaller.id,
            x: larger.position[0],
            y: larger.position[1] + 1,
          },
        }).ok,
        false,
      );
      assert.deepEqual(clean(engine.getState()), before);
      assert.equal(
        engine.dispatch({
          type: "MOVE_UNIT",
          payload: { id: larger.id, x: 0, y: engine.getWorld().height - 1 },
        }).ok,
        false,
      );
      assert.deepEqual(clean(engine.getState()), before);
    }
    assertOccupancy(engine);
  } finally {
    engine.dispose();
  }
});

test("Real WASM moves a two-cell unit through its own vacated cells", async () => {
  const engine = await army();
  try {
    const state = engine.getState(),
      world = engine.getWorld();
    const occupied = assertOccupancy(engine);
    let moved = false;
    for (const unit of state.units.filter(
      (unit) => !unit.carrier && !unit.reserve && unit.footprint[1] === 2,
    )) {
      const definition = state.unitCatalog.find(
        (definition) => definition.id === unit.type,
      );
      for (const dy of [1, -1]) {
        const target = {
          ...unit,
          position: [unit.position[0], unit.position[1] + dy],
        };
        if (
          !cells(target).every(
            ([x, y]) =>
              x >= 0 &&
              x < world.width &&
              y >= 0 &&
              y < world.height &&
              (!occupied.has(`${x},${y}`) ||
                occupied.get(`${x},${y}`) === unit.id) &&
              (definition.domain === "naval" ? [0] : [1, 2]).includes(
                world.tiles[y * world.width + x],
              ),
          )
        )
          continue;
        const result = engine.dispatch({
          type: "MOVE_UNIT",
          payload: {
            id: unit.id,
            x: target.position[0],
            y: target.position[1],
          },
        });
        assert(result.ok, result.message);
        assert.deepEqual(
          engine.getState().units.find((current) => current.id === unit.id)
            .position,
          target.position,
        );
        assertOccupancy(engine);
        assert(engine.load(engine.save()).ok);
        moved = true;
        break;
      }
      if (moved) break;
    }
    assert(
      moved,
      "At least one migrated unit has an adjacent free two-cell destination",
    );
  } finally {
    engine.dispose();
  }
});
