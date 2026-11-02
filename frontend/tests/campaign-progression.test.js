import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { researchUnitDefinition } from "../src/game/BuildingProgression.js";

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
// Preserve unsigned 64-bit enemy identities when editing save fixtures.
function exactGame(engine) {
  return JSON.parse(
    engine
      .save()
      .replace(/("(?:id|attacker|target)"\s*:\s*)(\d{16,})/g, '$1"__id_$2"'),
  ).game;
}
function pack(game) {
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  const bytes = JSON.stringify(canonical(game)).replace(/"__id_(\d+)"/g, "$1");
  let checksum = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    checksum = BigInt.asUintN(64, (checksum ^ BigInt(byte)) * 1099511628211n);
  return `{"checksum":"${checksum.toString(16)}","game":${bytes}}`;
}
function load(engine, game) {
  const result = engine.load(pack(game));
  assert(result.ok, result.message);
}
function stable(game) {
  const copy = structuredClone(game);
  delete copy.savedAtUTC;
  return copy;
}
const ends = [10, 20, 30, 40, 50, 65, 80, 100, 125, 150];
const resources = ["food", "wood", "stone", "iron", "coins"];
function priorRules() {
  const prior = structuredClone(config);
  delete prior.campaignProgressionVersion;
  for (const level of prior.campaign.levels) {
    if (level.enemyTH !== undefined) {
      level.requiredTH = level.enemyTH;
      delete level.enemyTH;
    }
    if (level.battleId <= 20) level.rewards.stone = level.rewards.food;
    if (level.battleId <= 50) level.rewards.iron = level.rewards.food;
  }
  prior.buildings.find(
    (building) => building.id === "harbor",
  ).levels[0].townHallRequired = 4;
  prior.buildingLimits.harbor[2] = 0;
  return prior;
}
async function army(rules = config) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  const result = engine.load(fixture);
  assert(result.ok, result.message);
  const game = exactGame(engine);
  const types = new Map([
    [45, "heavy_infantry"],
    [40, "corvette"],
    [47, "aircraft"],
  ]);
  game.units = game.units.filter((unit) => types.has(unit.id));
  for (const unit of game.units) {
    unit.type = types.get(unit.id);
    unit.health = config.units.find((entry) => entry.id === unit.type).health;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
function atLevel(engine, template, level, townHall) {
  const game = structuredClone(template);
  game.buildings.find((building) => building.type === "townhall").level =
    townHall;
  game.campaign = {
    currentLevel: level,
    completedLevels: Array.from({ length: level - 1 }, (_, index) => index + 1),
    completed: false,
  };
  load(engine, game);
}
function start(engine, level) {
  const definition = config.campaign.levels[level - 1];
  const domains = new Set(definition.rounds.map((round) => round.domain));
  return engine.dispatch({
    type: "BATTLE_START",
    payload: {
      campaignLevel: level,
      unitIds: engine
        .getState()
        .units.filter((unit) =>
          domains.has(
            config.units.find((entry) => entry.id === unit.type).domain,
          ),
        )
        .map((unit) => unit.id),
      automatic: true,
    },
  });
}
function win(engine) {
  for (let phase = 0; phase < 15; phase++) {
    const game = exactGame(engine);
    if (game.battle.finished) {
      assert(game.battle.victory);
      return;
    }
    const currentPhase = game.battle.phaseIndex;
    for (const fighter of [
      ...game.battle.fighters,
      ...game.battle.campaignArmy,
    ]) {
      if (fighter.enemy) {
        fighter.health = 1;
        fighter.shield = 0;
      } else {
        fighter.health = fighter.maxHealth = 900000;
        fighter.damage = 100000;
        fighter.defense = 999999;
      }
    }
    load(engine, game);
    for (let tick = 0; tick < 2000; tick++) {
      assert(engine.tick(250).ok);
      const battle = engine.getState().battle;
      if (battle.finished || battle.phaseIndex !== currentPhase) break;
      assert(tick < 1999, "Campaign round must end");
    }
  }
  assert.fail("Campaign victory was not reached");
}

test("Every Town Hall unlocks the first and last assigned campaign level and rejects the next range", async () => {
  const engine = await army();
  try {
    const template = exactGame(engine);
    for (const [index, last] of ends.entries()) {
      const townHall = index + 1;
      const first = index ? ends[index - 1] + 1 : 1;
      for (const level of [first, last]) {
        atLevel(engine, template, level, townHall);
        const result = start(engine, level);
        assert(result.ok, `TH${townHall}, level ${level}: ${result.message}`);
        assert.equal(engine.getState().battle.campaignLevel, level);
      }
      if (last < 150) {
        atLevel(engine, template, last + 1, townHall);
        const before = stable(exactGame(engine));
        const result = start(engine, last + 1);
        assert.equal(result.ok, false);
        assert.match(result.message, new RegExp(`Town Hall ${townHall + 1}`));
        assert.deepEqual(stable(exactGame(engine)), before);
      }
    }
  } finally {
    engine.dispose();
  }
});

test("Campaign rewards exclude stone through 20 and iron through 50, with other configured amounts preserved", () => {
  for (const level of config.campaign.levels) {
    const amount = level.rewards.food;
    assert.equal(level.rewards.wood, amount);
    assert.equal(level.rewards.stone, level.battleId <= 20 ? 0 : amount);
    assert.equal(level.rewards.iron, level.battleId <= 50 ? 0 : amount);
    assert(level.rewards.coins > 0);
  }
});

test("Older active campaigns preserve progress and combat state at the changed Town Hall boundaries", async () => {
  const rules = priorRules();
  const old = await army(rules);
  const current = await army();
  try {
    const oldTemplate = exactGame(old);
    const currentTemplate = exactGame(current);
    for (const level of [10, 20, 28, 65, 100, 125]) {
      const hall = rules.campaign.levels[level - 1].requiredTH;
      atLevel(old, oldTemplate, level, hall);
      atLevel(current, currentTemplate, level, hall);
      assert(start(old, level).ok);
      assert(start(current, level).ok);
      assert.deepEqual(
        exactGame(current).battle,
        exactGame(old).battle,
        "Unlock changes retain the previous combat difficulty",
      );
      const before = exactGame(old);
      before.battle.paused = true;
      before.battle.pendingMs = 400;
      before.battle.fighters.find((fighter) => !fighter.enemy).health--;
      load(old, before);
      const saved = exactGame(old);
      const result = current.load(old.save());
      assert(result.ok, result.message);
      const expected = structuredClone(saved);
      expected.config = config;
      assert.deepEqual(stable(exactGame(current)), stable(expected));
      assert(current.load(current.save()).ok);
      assert.deepEqual(stable(exactGame(current)), stable(expected));
    }
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Unclaimed victories from previous saves pay the new rewards exactly once at levels 20, 21, 50 and 51", async () => {
  const rules = priorRules();
  const old = await army(rules);
  const current = await army();
  try {
    const template = exactGame(old);
    for (const level of [20, 21, 50, 51]) {
      atLevel(
        old,
        template,
        level,
        rules.campaign.levels[level - 1].requiredTH,
      );
      assert(start(old, level).ok);
      win(old);
      const before = exactGame(old);
      const result = current.load(old.save());
      assert(result.ok, result.message);
      assert.deepEqual(
        current.getState().stock,
        before.stock,
        "Loading never removes already earned resources",
      );
      assert.deepEqual(
        current.getState().battle.rewards,
        config.campaign.levels[level - 1].rewards,
      );
      const finish = current.dispatch({ type: "BATTLE_FINISH" });
      assert(finish.ok, finish.message);
      const expected = before.stock.map(
        (amount, index) =>
          amount + config.campaign.levels[level - 1].rewards[resources[index]],
      );
      assert.deepEqual(current.getState().stock, expected);
      assert.equal(current.getState().campaign.currentLevel, level + 1);
      assert.equal(current.dispatch({ type: "BATTLE_FINISH" }).ok, false);
      assert(current.load(current.save()).ok);
      assert.deepEqual(current.getState().stock, expected);
    }
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Harbor stays locked at Town Hall three and unlocks at Town Hall four", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const game = exactGame(engine);
    game.stock.fill(1000000);
    game.buildings[0].level = 3;
    load(engine, game);
    assert.equal(engine.getState().buildOptions.harbor.ok, false);
    game.buildings[0].level = 4;
    load(engine, game);
    assert.equal(engine.getState().buildOptions.harbor.ok, true);
    const world = engine.getWorld();
    let position;
    for (let y = 0; y < world.height && !position; y++)
      for (let x = 0; x < world.width && !position; x++) {
        const payload = { buildingType: "harbor", x, y };
        if (engine.dispatch({ type: "CAN_BUILD", payload }).ok)
          position = payload;
      }
    assert(position, "A valid Harbor plot exists");
    assert(engine.dispatch({ type: "BUILD", payload: position }).ok);
    for (let tick = 0; tick < 24; tick++) assert(engine.tick(250).ok);
    const harbor = engine
      .getState()
      .buildings.find((building) => building.type === "harbor");
    assert.equal(harbor.level, 1);
    assert.equal(harbor.state, 1);
    assert.equal(harbor.townHallCap, 4);
    const train = engine.dispatch({
      type: "TRAIN",
      payload: { id: harbor.id, unitType: "ship" },
    });
    assert(train.ok, train.message);
    const seconds = config.units.find((unit) => unit.id === "ship").seconds;
    for (let tick = 0; tick < seconds * 4; tick++) assert(engine.tick(250).ok);
    assert(engine.getState().units.some((unit) => unit.type === "ship"));
  } finally {
    engine.dispose();
  }
});
