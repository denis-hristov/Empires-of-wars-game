import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { ensurePopulation, loadGame } from "./helpers/population.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const caps = {
  barracks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  academy: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10],
  harbor: [0, 0, 0, 4, 5, 6, 7, 8, 9, 10],
  airbase: [0, 0, 0, 0, 0, 6, 7, 8, 9, 10],
  house: [1, 2, 2, 3, 3, 3, 3, 4, 5, 5],
  farm: [1, 2, 2, 3, 3, 3, 3, 4, 5, 5],
  lumberyard: [1, 2, 2, 3, 3, 3, 3, 4, 5, 5],
  stone: [0, 0, 2, 3, 3, 3, 3, 4, 5, 5],
  iron: [0, 0, 0, 0, 2, 2, 3, 4, 5, 5],
};
function advance(engine, milliseconds) {
  for (let ms = 0; ms < milliseconds; ms += 250)
    assert(engine.tick(Math.min(250, milliseconds - ms)).ok);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function funded(engine) {
  const game = JSON.parse(engine.save()).game;
  game.stock = [1000000, 1000000, 1000000, 1000000, 1000000];
  const bytes = JSON.stringify(canonical(game));
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const result = engine.load(
    JSON.stringify({ checksum: hash.toString(16), game: JSON.parse(bytes) }),
  );
  assert(result.ok, result.message);
}
function building(engine, type) {
  return engine.getState().buildings.find((b) => b.type === type);
}
function construct(engine, type) {
  const world = engine.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!engine.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      const result = engine.dispatch({ type: "BUILD", payload });
      assert(result.ok, result.message);
      advance(
        engine,
        config.buildings.find((b) => b.id === type).levels[0].seconds * 1000,
      );
      return engine.getState().buildings.at(-1);
    }
  throw new Error(`No plot for ${type}`);
}
function upgrade(engine, type) {
  const current = building(engine, type);
  if (type === "townhall")
    ensurePopulation(
      engine,
      config.buildings.find((b) => b.id === type).levels[current.level]
        .populationRequired,
    );
  const result = engine.dispatch({
    type: "UPGRADE",
    payload: { id: current.id },
  });
  assert(result.ok, `${type} ${current.level + 1}: ${result.message}`);
  advance(
    engine,
    config.buildings.find((b) => b.id === type).levels[current.level].seconds *
      1000,
  );
  return building(engine, type);
}

test("WASM follows every Town Hall cap and paid prerequisite through level ten", async () => {
  const spacious = structuredClone(config);
  spacious.world.width = spacious.world.height = 72;
  const engine = await GameEngine.create({
    factory,
    config: spacious,
    wasmBinary,
  });
  try {
    assert.deepEqual(engine.getState().stock.slice(0, 4), [600, 1000, 0, 0]);
    funded(engine);
    for (let hall = 1; hall <= 10; hall++) {
      for (const [type, levels] of Object.entries(caps)) {
        const cap = levels[hall - 1];
        const option = engine.getState().buildOptions[type];
        assert.equal(option.cap, cap, `${type} at Town Hall ${hall}`);
        if (!cap) {
          assert.equal(option.ok, false);
          continue;
        }
        let current = building(engine, type) || construct(engine, type);
        while (current.level < cap) current = upgrade(engine, type);
        const before = canonical(JSON.parse(engine.save()).game);
        delete before.savedAtUTC;
        assert.equal(
          engine.dispatch({ type: "UPGRADE", payload: { id: current.id } }).ok,
          false,
        );
        const after = canonical(JSON.parse(engine.save()).game);
        delete after.savedAtUTC;
        assert.deepEqual(after, before);
        assert.equal(
          engine.getState().buildOptions[type].ok,
          type !== "academy",
          "Only the unique Academy blocks another unlocked copy",
        );
      }
      if (hall < 10) {
        ensurePopulation(
          engine,
          config.buildings.find((b) => b.id === "townhall").levels[hall]
            .populationRequired,
        );
        const before = engine
          .getState()
          .buildings.map((b) => [b.id, b.type, b.level]);
        upgrade(engine, "townhall");
        for (const [id, type, level] of before.filter(
          ([id, type]) => type !== "townhall",
        ))
          assert.equal(
            engine.getState().buildings.find((b) => b.id === id).level,
            level,
            "Town Hall never upgrades another building for free",
          );
      }
    }
    assert.equal(building(engine, "house").housing, 20);
    assert.equal(engine.getState().townHallLevel, 10);
    assert.equal(engine.getState().researchLevels.infantry, 0);
    const academy = building(engine, "academy");
    const first = config.units.find((unit) => unit.id === "infantry");
    const second = config.units.find(
      (unit) => unit.building === "barracks" && unit.level === 2,
    );
    for (let level = 1; level <= 14; level++) {
      const state = engine.getState();
      const option = building(engine, "academy").researchOptions.find(
        (option) => option.type === first.id,
      );
      const cost = Array.isArray(option.cost)
        ? option.cost
        : ["food", "wood", "stone", "iron", "coins"].map(
            (resource) => option.cost[resource] || 0,
          );
      assert(
        engine.dispatch({
          type: "RESEARCH",
          payload: { id: academy.id, unitType: first.id },
        }).ok,
      );
      assert.deepEqual(
        engine.getState().stock,
        state.stock.map((value, i) => value - cost[i]),
      );
      assert.equal(engine.getState().researchLevels[first.id], level - 1);
      assert.equal(
        engine.dispatch({
          type: "RESEARCH",
          payload: { id: academy.id, unitType: second.id },
        }).ok,
        false,
      );
      advance(engine, option.seconds * 1000);
      assert.equal(engine.getState().researchLevels[first.id], level);
      assert.equal(engine.getState().researchLevels[second.id], 0);
    }
    const researched = engine
      .getState()
      .unitCatalog.find((unit) => unit.id === first.id);
    assert.equal(researched.effectiveHealth, 197);
    assert.equal(researched.effectiveDamage, 67);
    assert.equal(
      engine.dispatch({
        type: "RESEARCH",
        payload: { id: academy.id, unitType: first.id },
      }).ok,
      false,
    );
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});

test("WASM produces one resource every six seconds with battle-only gold", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const farm = construct(engine, "farm");
    const stock = engine.getState().stock;
    assert.equal(building(engine, "farm").production.intervalSeconds, 6);
    advance(engine, 5750);
    assert.equal(building(engine, "farm").stored, 0);
    advance(engine, 250);
    assert.equal(building(engine, "farm").stored, 1);
    advance(engine, 54000);
    assert.equal(building(engine, "farm").stored, 10);
    assert(engine.dispatch({ type: "COLLECT", payload: { id: farm.id } }).ok);
    for (let minute = 1; minute < 60; minute++) {
      advance(engine, 60000);
      assert.equal(building(engine, "farm").stored, 10);
      assert(engine.dispatch({ type: "COLLECT", payload: { id: farm.id } }).ok);
    }
    assert.equal(engine.getState().stock[0], stock[0] + 600);
    assert.equal(engine.getState().stock[4], 0);
    assert.equal(engine.getState().population.current, 0);
  } finally {
    engine.dispose();
  }
});

test("Repeated buildings pay separately, keep independent progress and survive a current save", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    funded(engine);
    const farms = [construct(engine, "farm"), construct(engine, "farm")];
    const houses = [construct(engine, "house"), construct(engine, "house")];
    const barracks = [
      construct(engine, "barracks"),
      construct(engine, "barracks"),
    ];
    construct(engine, "lumberyard");
    const byId = (id) => engine.getState().buildings.find((b) => b.id === id);
    assert.notEqual(farms[0].id, farms[1].id);
    assert.equal(engine.getState().population.capacity, 9);
    assert.equal(engine.getState().buildOptions.farm.ok, true);
    assert.equal(engine.getState().buildOptions.academy.ok, false);
    assert.equal(
      engine.dispatch({ type: "UPGRADE", payload: { id: farms[1].id } }).ok,
      false,
    );
    const stock = engine.getState().stock;
    const thirdFarm = construct(engine, "farm");
    const cost = config.buildings.find((b) => b.id === "farm").levels[0].cost;
    assert.deepEqual(
      engine.getState().stock,
      stock.map(
        (value, i) =>
          value - (cost[["food", "wood", "stone", "iron", "coins"][i]] || 0),
      ),
    );
    assert(
      engine.dispatch({
        type: "TRAIN",
        payload: { id: barracks[0].id, unitType: "infantry" },
      }).ok,
    );
    assert(
      engine.dispatch({
        type: "TRAIN",
        payload: { id: barracks[1].id, unitType: "infantry" },
      }).ok,
    );
    assert.equal(byId(barracks[0].id).queue.length, 1);
    assert.equal(byId(barracks[1].id).queue.length, 1);
    advance(engine, 10000);
    upgrade(engine, "townhall");
    assert(
      engine.dispatch({ type: "UPGRADE", payload: { id: farms[1].id } }).ok,
    );
    assert.equal(byId(farms[1].id).state, 2);
    assert.equal(byId(farms[0].id).state, 1);
    assert.equal(byId(farms[0].id).completedLevel, 1);
    const saved = engine.save();
    assert.equal(JSON.parse(saved).game.legacyProgression ?? false, false);
    assert(engine.load(saved).ok);
    assert.equal(byId(farms[1].id).state, 2);
    advance(engine, 12000);
    assert.equal(byId(farms[1].id).completedLevel, 2);
    assert.equal(byId(farms[0].id).completedLevel, 1);
    assert.equal(byId(thirdFarm.id).completedLevel, 1);
    assert.equal(byId(houses[1].id).housing, 2);
    const first = byId(farms[0].id),
      second = byId(farms[1].id);
    const before = engine.getState().stock[0];
    assert(engine.dispatch({ type: "COLLECT", payload: { id: first.id } }).ok);
    assert.equal(byId(first.id).stored, 0);
    assert.equal(byId(second.id).stored, second.stored);
    assert.equal(engine.getState().stock[0], before + first.stored);
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});

test("Academy construction is unique during construction, upgrades and after reload", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    funded(engine);
    const game = JSON.parse(engine.save()).game;
    game.buildings.find((b) => b.type === "townhall").level = 3;
    loadGame(engine, game);
    const world = engine.getWorld();
    const plots = [];
    for (let y = 0; y < world.height && plots.length < 2; ++y)
      for (let x = 0; x < world.width && plots.length < 2; ++x) {
        if (plots.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2))
          continue;
        const payload = { buildingType: "academy", x, y };
        if (engine.dispatch({ type: "CAN_BUILD", payload }).ok)
          plots.push(payload);
      }
    assert.equal(plots.length, 2);
    assert(engine.dispatch({ type: "BUILD", payload: plots[0] }).ok);
    const academy = building(engine, "academy");
    assert.equal(academy.state, 0);
    function rejectDuplicate() {
      const before = JSON.parse(engine.save()).game;
      delete before.savedAtUTC;
      const option = engine.getState().buildOptions.academy;
      assert.equal(option.ok, false);
      assert.equal(option.reason, "You can build only one Academy");
      assert.equal(
        engine.dispatch({ type: "CAN_BUILD", payload: plots[1] }).ok,
        false,
      );
      const result = engine.dispatch({ type: "BUILD", payload: plots[1] });
      assert.equal(result.ok, false);
      assert.equal(result.message, "You can build only one Academy");
      const after = JSON.parse(engine.save()).game;
      delete after.savedAtUTC;
      assert.deepEqual(after, before);
      assert.equal(
        engine.getState().buildings.filter((b) => b.type === "academy").length,
        1,
      );
    }
    rejectDuplicate();
    advance(
      engine,
      config.buildings.find((b) => b.id === "academy").levels[0].seconds * 1000,
    );
    assert.equal(building(engine, "academy").state, 1);
    rejectDuplicate();
    assert(
      engine.dispatch({ type: "UPGRADE", payload: { id: academy.id } }).ok,
    );
    assert.equal(building(engine, "academy").state, 2);
    rejectDuplicate();
    assert(engine.load(engine.save()).ok);
    rejectDuplicate();
    advance(
      engine,
      config.buildings.find((b) => b.id === "academy").levels[1].seconds * 1000,
    );
    assert.equal(building(engine, "academy").completedLevel, 2);
    rejectDuplicate();
  } finally {
    engine.dispose();
  }
});
