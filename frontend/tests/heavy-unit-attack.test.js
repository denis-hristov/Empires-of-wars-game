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
const changes = {
  heavy_tank: { before: 130, after: 195, researched: 237, oldResearched: 158 },
  battleship: { before: 185, after: 231, researched: 280, oldResearched: 224 },
};
function priorRules() {
  const prior = structuredClone(config);
  delete prior.heavyUnitAttackVersion;
  for (const unit of prior.units)
    if (changes[unit.id]) {
      unit.damage = changes[unit.id].before;
      delete unit.enemyBaseDamage;
    }
  return prior;
}

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
async function army(rules = config, research = 0) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  const result = engine.load(fixture);
  assert(result.ok, result.message);
  const game = exactGame(engine);
  const types = new Map([
    [40, "battleship"],
    [45, "heavy_tank"],
    [47, "aircraft"],
  ]);
  game.units = game.units.filter((unit) => types.has(unit.id));
  const academy = game.buildings.find((building) => building.type === "house");
  academy.type = "academy";
  academy.level = 10;
  game.researchLevels = { heavy_tank: research, battleship: research };
  for (const unit of game.units) {
    unit.type = types.get(unit.id);
    unit.health =
      config.units.find((entry) => entry.id === unit.type).health - 7;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
function start(engine, campaign) {
  const game = exactGame(engine);
  if (campaign) {
    game.campaign = {
      currentLevel: 70,
      completedLevels: Array.from({ length: 69 }, (_, index) => index + 1),
      completed: false,
    };
    load(engine, game);
  }
  const result = engine.dispatch({
    type: "BATTLE_START",
    payload: {
      unitIds: game.units.map((unit) => String(unit.id)),
      automatic: true,
      ...(campaign ? { campaignLevel: 70 } : {}),
    },
  });
  assert(result.ok, result.message);
}

test("Heavy Tank and Battleship expose the increased base and researched attacks in unit cards and combat", async () => {
  for (const research of [0, 4]) {
    const old = await army(priorRules(), research);
    const current = await army(config, research);
    try {
      const state = current.getState();
      for (const [type, values] of Object.entries(changes)) {
        const unit = state.unitCatalog.find((entry) => entry.id === type);
        const expected = research === 0 ? values.after : values.researched;
        assert.equal(unit.damage, values.after);
        assert.equal(unit.effectiveDamage, expected);
        assert.equal(
          researchUnitDefinition(
            state,
            config.units.find((entry) => entry.id === type),
          ).damage,
          expected + (type === "heavy_tank" ? 12 : 10),
        );
      }
      start(old, false);
      start(current, false);
      const before = exactGame(old).battle;
      const after = exactGame(current).battle;
      assert.deepEqual(
        after.fighters.filter((fighter) => fighter.enemy),
        before.fighters.filter((fighter) => fighter.enemy),
        "Enemy attacks retain the previous balance",
      );
      for (const fighter of after.fighters.filter(
        (fighter) => !fighter.enemy,
      )) {
        const values = changes[fighter.type];
        const prior = before.fighters.find((entry) => entry.id === fighter.id);
        if (!values) {
          assert.deepEqual(fighter, prior);
          continue;
        }
        const bonus = fighter.type === "heavy_tank" ? 12 : 10;
        assert.equal(
          fighter.damage,
          (research ? values.researched : values.after) + bonus,
        );
        assert.deepEqual({ ...fighter, damage: prior.damage }, prior);
      }
      const attacker = after.fighters.find(
        (fighter) => !fighter.enemy && fighter.type === "heavy_tank",
      );
      const target = after.fighters.find(
        (fighter) => fighter.enemy && fighter.phase === "land",
      );
      const game = exactGame(current);
      game.battle.automatic = false;
      game.battle.enemyTurn = false;
      game.battle.pendingMs = 0;
      const enemy = game.battle.fighters.find(
        (fighter) => fighter.id === target.id,
      );
      enemy.position = [1, 0];
      enemy.health = enemy.maxHealth = 10000;
      enemy.shield = 0;
      load(current, game);
      const hit = current.dispatch({
        type: "BATTLE_ATTACK",
        payload: {
          id: String(attacker.id),
          target: current
            .getState()
            .battle.fighters.find(
              (fighter) => fighter.enemy && fighter.position[0] === 1,
            ).id,
        },
      });
      assert(hit.ok, hit.message);
      assert.equal(
        exactGame(current).battle.lastAttacks[0].damage,
        attacker.damage,
      );
    } finally {
      old.dispose();
      current.dispose();
    }
  }
});

for (const campaign of [false, true])
  test(`Existing ${campaign ? "campaign" : "expedition"} saves increase only friendly attack once and preserve battle progress`, async () => {
    const old = await army(priorRules(), 4);
    const current = await army(config, 4);
    try {
      start(old, campaign);
      const game = exactGame(old);
      game.battle.paused = true;
      game.battle.round = 3;
      game.battle.actions = 5;
      game.battle.pendingMs = 400;
      game.battle.enemyTurn = true;
      for (const fighter of [
        ...game.battle.fighters,
        ...(game.battle.campaignArmy ?? []),
      ])
        if (!fighter.enemy) {
          fighter.health -= 11;
          fighter.attacked = true;
          fighter.strikes = 2;
          fighter.readyRound = 4;
        }
      load(old, game);
      const before = exactGame(old);
      const result = current.load(old.save());
      assert(result.ok, result.message);
      const expected = structuredClone(before);
      expected.config = config;
      for (const fighter of [
        ...expected.battle.fighters,
        ...(expected.battle.campaignArmy ?? []),
      ]) {
        const values = changes[fighter.type];
        if (!fighter.enemy && values)
          fighter.damage += values.researched - values.oldResearched;
      }
      assert.deepEqual(stable(exactGame(current)), stable(expected));
      for (let reload = 0; reload < 3; reload++) {
        assert(current.load(current.save()).ok);
        assert.deepEqual(stable(exactGame(current)), stable(expected));
      }
      const invalid = structuredClone(before);
      invalid.config.units.find((unit) => unit.id === "heavy_tank").damage =
        131;
      assert.equal(current.load(pack(invalid)).ok, false);
      assert.deepEqual(stable(exactGame(current)), stable(expected));
    } finally {
      old.dispose();
      current.dispose();
    }
  });
