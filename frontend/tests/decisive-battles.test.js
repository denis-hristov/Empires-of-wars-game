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
const fixture = await readFile(
  new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
  "utf8",
);
const unit = (type) =>
  config.units.find((definition) => definition.id === type);
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const allies = (battle) => battle.fighters.filter((fighter) => !fighter.enemy);

// Preserve unsigned enemy IDs and recompute the normal save checksum after fixture edits.
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
function snapshot(engine) {
  const game = exactGame(engine);
  delete game.savedAtUTC;
  return game;
}
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(fixture).ok);
  const game = exactGame(engine);
  const types = new Map([
    [45, "heavy_infantry"],
    [40, "frigate"],
    [47, "aircraft"],
  ]);
  game.units = game.units.filter((entry) => types.has(entry.id));
  for (const entry of game.units) {
    entry.type = types.get(entry.id);
    entry.health = unit(entry.type).health;
    entry.carrier = null;
    entry.reserve = false;
  }
  load(engine, game);
  return engine;
}
function start(engine, ids, campaign = false, automatic = true) {
  const result = engine.dispatch({
    type: "BATTLE_START",
    payload: {
      unitIds: ids.map(String),
      automatic,
      ...(campaign ? { campaignLevel: 1 } : {}),
    },
  });
  assert(result.ok, result.message);
}

test("Untargetable combat and round limits produce a defender victory with surviving armies and no rewards", async () => {
  const engine = await army();
  try {
    const template = exactGame(engine);
    for (const scenario of ["untargetable", "expedition cap", "campaign cap"]) {
      load(engine, structuredClone(template));
      start(
        engine,
        scenario === "untargetable"
          ? [40]
          : scenario === "campaign cap"
            ? [45]
            : [45, 40, 47],
        scenario === "campaign cap",
      );
      const game = exactGame(engine);
      const battle = game.battle;
      if (scenario === "untargetable") {
        for (const enemy of enemies(battle)) {
          enemy.type = "fighter_aircraft";
          enemy.domain = "air";
          enemy.shield = 0;
        }
        battle.enemyTurn = true;
      } else {
        battle.round = 200;
        for (const ally of allies(battle)) ally.damage = 1;
        for (const enemy of enemies(battle))
          enemy.health = enemy.maxHealth = 1000;
      }
      const health = battle.fighters.map((fighter) => fighter.health);
      load(engine, game);
      for (let step = 0; step < 4; step++) {
        const tick = engine.tick(250);
        assert(tick.ok, `${scenario}: ${tick.message}`);
      }
      const resolved = exactGame(engine);
      assert.equal(resolved.battle.finished, true, scenario);
      assert.equal(resolved.battle.victory, false, scenario);
      assert.equal(resolved.battle.draw, false, scenario);
      assert.equal(resolved.battle.retreated, true, scenario);
      assert.deepEqual(resolved.battle.outcomes, [0]);
      assert.equal(resolved.battle.phaseIndex, 0);
      for (const fighter of resolved.battle.fighters)
        assert(fighter.health > 0, "No invented casualties");
      if (scenario === "untargetable")
        assert.deepEqual(
          resolved.battle.fighters.map((fighter) => fighter.health),
          health,
        );
      const expected = snapshot(engine);
      load(engine, exactGame(engine));
      assert.deepEqual(
        snapshot(engine),
        expected,
        "The decided result resumes unchanged",
      );
      assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
      const returned = exactGame(engine);
      assert.deepEqual(returned.stock, game.stock);
      assert.equal(returned.civilian, game.civilian);
      assert.deepEqual(returned.units, game.units);
      assert.deepEqual(
        returned.campaign.completedLevels,
        game.campaign.completedLevels,
      );
      assert.equal(engine.dispatch({ type: "BATTLE_FINISH" }).ok, false);
    }
  } finally {
    engine.dispose();
  }
});

test("Valid historical draws become saveable defeats once, while inconsistent old flags and new draws are rejected", async () => {
  const engine = await army();
  try {
    start(engine, [45]);
    const old = exactGame(engine);
    Object.assign(old.battle, {
      combatVersion: 6,
      finished: true,
      victory: false,
      draw: true,
      enemyTurn: false,
      pendingMs: 0,
      outcomes: [-1],
    });
    const original = snapshot(engine);
    for (const changes of [
      { victory: true },
      { draw: false },
      { combatVersion: 7 },
      { combatVersion: 8 },
    ]) {
      const invalid = structuredClone(old);
      Object.assign(invalid.battle, changes);
      assert.equal(engine.load(pack(invalid)).ok, false);
      assert.deepEqual(snapshot(engine), original);
    }
    load(engine, old);
    const expected = structuredClone(old);
    delete expected.savedAtUTC;
    expected.battle.combatVersion = 8;
    expected.battle.draw = false;
    assert.deepEqual(snapshot(engine), expected);
    for (let reload = 0; reload < 3; reload++) {
      load(engine, exactGame(engine));
      assert.deepEqual(snapshot(engine), expected);
    }
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.deepEqual(exactGame(engine).stock, old.stock);
    assert.deepEqual(exactGame(engine).units, old.units);
    assert.equal(engine.dispatch({ type: "BATTLE_FINISH" }).ok, false);
  } finally {
    engine.dispose();
  }
});

test("Eliminating the last enemy at the round limit remains a normal victory paid exactly once", async () => {
  const engine = await army();
  try {
    start(engine, [45], false, false);
    const game = exactGame(engine);
    game.battle.round = 200;
    const foes = enemies(game.battle);
    for (const [index, enemy] of foes.entries()) {
      enemy.health = index === 0 ? 1 : 0;
      enemy.shield = enemy.defense = 0;
    }
    allies(game.battle)[0].damage = 999999;
    load(engine, game);
    const result = engine.dispatch({
      type: "BATTLE_ATTACK",
      payload: { id: "45", target: foes[0].id.replace("__id_", "") },
    });
    assert(result.ok, result.message);
    const won = exactGame(engine);
    assert.equal(won.battle.finished, true);
    assert.equal(won.battle.victory, true);
    assert.equal(won.battle.draw, false);
    assert.equal(won.battle.retreated, false);
    assert.deepEqual(won.battle.outcomes, [1]);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    const rewarded = exactGame(engine);
    const resources = ["food", "wood", "stone", "iron", "coins"];
    for (const [index, resource] of resources.entries())
      assert.equal(
        rewarded.stock[index],
        game.stock[index] + config.battle.rewards[resource],
      );
    assert.equal(engine.dispatch({ type: "BATTLE_FINISH" }).ok, false);
    assert.deepEqual(exactGame(engine).stock, rewarded.stock);
  } finally {
    engine.dispose();
  }
});
