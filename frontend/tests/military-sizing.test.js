import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { ensurePopulation, loadGame } from "./helpers/population.js";
import { getSpriteArt } from "../src/game/SpriteAssets.js";
import { spriteLayout } from "../src/game/SpriteLayout.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
function advance(engine, ms) {
  while (ms > 0) {
    const step = Math.min(ms, 250);
    assert(engine.tick(step).ok);
    ms -= step;
  }
}
function game(engine) {
  const saved = JSON.parse(engine.save()).game;
  delete saved.savedAtUTC;
  return saved;
}
function build(engine, type) {
  const world = engine.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!engine.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      assert(engine.dispatch({ type: "BUILD", payload }).ok);
      const id = engine.getState().buildings.at(-1).id;
      advance(engine, 6000);
      const saved = game(engine);
      saved.buildings.find((b) => String(b.id) === id).level = 10;
      loadGame(engine, saved);
      return id;
    }
  throw new Error(`No plot for ${type}`);
}
async function prepared(rules = config) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  const saved = game(engine);
  saved.stock.fill(1000000);
  saved.buildings[0].level = 10;
  loadGame(engine, saved);
  ensurePopulation(engine, 150);
  return engine;
}
const train = (engine, id, type) =>
  engine.dispatch({ type: "TRAIN", payload: { id, unitType: type } });
const cancel = (engine, id) =>
  engine.dispatch({ type: "CANCEL_TRAINING", payload: { id, index: 0 } });
function expectedFootprint(unit) {
  if (unit.domain === "naval")
    return [1, unit.level <= 2 ? 1 : unit.level <= 6 ? 2 : 3];
  if (unit.domain === "air") return [2, unit.level <= 6 ? 2 : 3];
  return [1, unit.level < 4 ? 1 : 2];
}
function occupancy(engine) {
  const state = engine.getState(),
    world = engine.getWorld(),
    occupied = new Map();
  for (const entity of [
    ...state.buildings,
    ...state.units.filter((u) => !u.carrier && !u.reserve),
  ]) {
    const [w, h] = entity.footprint;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const cx = entity.position[0] + x,
          cy = entity.position[1] + y,
          key = `${cx}:${cy}`;
        assert(cx >= 0 && cy >= 0 && cx < world.width && cy < world.height);
        assert(
          !occupied.has(key),
          `${entity.type} overlaps ${occupied.get(key)}`,
        );
        occupied.set(key, entity.id);
        if (state.units.includes(entity)) {
          const domain = state.unitCatalog.find(
            (d) => d.id === entity.type,
          ).domain;
          assert(
            (domain === "naval" ? [0] : [1, 2]).includes(
              world.tiles[cy * world.width + cx],
            ),
          );
        }
      }
  }
  return occupied;
}

test("Every military building permits one paid task and remains independent of other buildings", async () => {
  const engine = await prepared();
  try {
    for (const type of ["barracks", "harbor", "airbase"]) {
      assert.equal(
        config.buildings.find((b) => b.id === type).queueCapacity,
        1,
      );
      const first = build(engine, type),
        second = build(engine, type);
      const units = config.units.filter((u) => u.building === type);
      assert(train(engine, first, units[0].id).ok);
      const before = game(engine);
      const denied = train(engine, first, units[1].id);
      assert.equal(denied.ok, false);
      assert.match(denied.message, /training one unit/);
      assert.deepEqual(game(engine), before);
      assert(train(engine, second, units[0].id).ok);
      assert.equal(
        engine.getState().buildings.find((b) => b.id === first).queue.length,
        1,
      );
      assert.equal(
        engine.getState().buildings.find((b) => b.id === second).queue.length,
        1,
      );
      const malformed = game(engine);
      malformed.buildings
        .find((b) => String(b.id) === first)
        .queue.push({
          ...malformed.buildings.find((b) => String(b.id) === first).queue[0],
        });
      assert.throws(() => loadGame(engine, malformed));
      assert(cancel(engine, first).ok);
      assert(cancel(engine, second).ok);
      assert(train(engine, first, units[1].id).ok);
      const waiting = game(engine);
      const task = waiting.buildings.find((b) => String(b.id) === first)
        .queue[0];
      task.awaiting = true;
      task.remainingMs = 0;
      loadGame(engine, waiting);
      assert.equal(
        train(engine, first, units[0].id).ok,
        false,
        "Waiting for map space still occupies the one slot",
      );
      assert(cancel(engine, first).ok);
    }
  } finally {
    engine.dispose();
  }
});

test("Every ship and aircraft occupies and visually fits its new whole footprint", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    for (const definition of engine.getState().unitCatalog) {
      const expected = expectedFootprint(definition);
      assert.deepEqual(definition.footprint, expected, definition.id);
      const art = getSpriteArt(definition.id),
        layout = spriteLayout(definition.id, expected);
      const ratio =
        definition.domain === "land" ? 1 : (expected[0] + expected[1]) / 2;
      assert(
        Math.abs(art.visibleWidth * layout.scaleX - art.targetWidth * ratio) <
          1e-9,
        definition.id,
      );
      assert(Math.abs(layout.scaleX - layout.scaleY) < 1e-12);
      assert.equal(layout.anchorX, art.ground[0] / art.size[0]);
      assert.equal(layout.anchorY, art.ground[1] / art.size[1]);
    }
  } finally {
    engine.dispose();
  }
});

test("Old queues refund only surplus tasks once while existing army footprints migrate intact", async () => {
  const previous = structuredClone(config);
  previous.unitFootprintVersion = 1;
  delete previous.unitFootprintMigration;
  delete previous.trainingVersion;
  delete previous.trainingMigration;
  for (const unit of previous.units)
    unit.footprint = config.unitFootprintMigration[unit.id];
  for (const building of previous.buildings)
    if (config.trainingMigration[building.id])
      building.queueCapacity = config.trainingMigration[building.id];
  const old = await prepared(previous),
    current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const producers = {};
    for (const type of ["barracks", "harbor", "airbase"])
      producers[type] = build(old, type);
    const saved = game(old),
      world = old.getWorld();
    const occupied = occupancy(old);
    for (const type of [
      "corvette",
      "battleship",
      "aircraft",
      "phantom_bomber",
    ]) {
      const definition = previous.units.find((u) => u.id === type),
        [w, h] = definition.footprint;
      let position;
      for (let y = 0; y + h <= world.height && !position; y++)
        for (let x = 0; x + w <= world.width && !position; x++) {
          const cells = Array.from({ length: w * h }, (_, i) => [
            x + (i % w),
            y + Math.floor(i / w),
          ]);
          if (
            !cells.every(
              ([cx, cy]) =>
                !occupied.has(`${cx}:${cy}`) &&
                (definition.domain === "naval" ? [0] : [1, 2]).includes(
                  world.tiles[cy * world.width + cx],
                ),
            )
          )
            continue;
          position = [x, y];
          for (const [cx, cy] of cells) occupied.set(`${cx}:${cy}`, type);
        }
      assert(position, `Fixture plot for ${type}`);
      saved.units.push({
        id: saved.nextId++,
        source: Number(producers[definition.building]),
        type,
        position,
        health: definition.health - 1,
        carrier: null,
        reserve: false,
      });
    }
    loadGame(old, saved);
    for (const type of ["barracks", "harbor", "airbase"]) {
      const units = previous.units.filter((u) => u.building === type);
      for (let index = 0; index < 3; index++)
        assert(train(old, producers[type], units[index].id).ok);
    }
    const before = game(old),
      stock = [...before.stock];
    for (const building of before.buildings)
      for (const task of building.queue.slice(1))
        for (let i = 0; i < 5; i++) stock[i] += task.paidCost[i];
    assert(current.load(old.save()).ok);
    const after = game(current);
    assert.deepEqual(after.stock, stock);
    for (const building of before.buildings) {
      const migrated = after.buildings.find((b) => b.id === building.id);
      assert.deepEqual(migrated.queue, building.queue.slice(0, 1));
    }
    assert.deepEqual(
      after.units.map(({ position, reserve, ...u }) => u),
      before.units.map(({ position, reserve, ...u }) => u),
    );
    occupancy(current);
    assert(current.load(current.save()).ok);
    assert.deepEqual(game(current), after);
    const corrupt = structuredClone(before);
    corrupt.config.units[0].cost.food++;
    assert.throws(() => loadGame(current, corrupt));
    assert.deepEqual(game(current), after);
  } finally {
    old.dispose();
    current.dispose();
  }
});
