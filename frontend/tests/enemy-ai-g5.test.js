import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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
const definition = (type) =>
  config.units.find(
    (unit) => unit.id === (type === "raider" ? "infantry" : type),
  );
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const allies = (battle) => battle.fighters.filter((fighter) => !fighter.enemy);
// Preserve the unsigned 64-bit identities used by enemy fighters and attack logs.
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
async function army(balance = config) {
  const engine = await GameEngine.create({
    factory,
    config: balance,
    wasmBinary,
  });
  const result = engine.load(fixture);
  assert(result.ok, result.message);
  const game = exactGame(engine);
  const types = new Map([
    [45, "light_tank"],
    [40, "corvette"],
    [47, "aircraft"],
  ]);
  game.units = game.units.filter((unit) => types.has(unit.id));
  for (const unit of game.units) {
    unit.type = types.get(unit.id);
    unit.health = definition(unit.type).health;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
function start(engine, level) {
  const game = exactGame(engine);
  if (level) {
    game.campaign = {
      currentLevel: level.battleId,
      completedLevels: Array.from(
        { length: level.battleId - 1 },
        (_, n) => n + 1,
      ),
      completed: false,
    };
    load(engine, game);
  }
  const result = engine.dispatch({
    type: "BATTLE_START",
    payload: {
      unitIds: game.units
        .filter(
          (unit) =>
            !level ||
            level.rounds.some(
              (round) => round.domain === definition(unit.type).domain,
            ),
        )
        .map((unit) => String(unit.id)),
      ...(level ? { campaignLevel: level.battleId } : {}),
      automatic: true,
    },
  });
  assert(result.ok, result.message);
}
function advanceRound(engine) {
  const game = exactGame(engine);
  const battle = game.battle;
  const phase = battle.phaseIndex;
  for (const fighter of [...battle.campaignArmy, ...allies(battle)]) {
    fighter.damage = 999999;
    fighter.health = fighter.maxHealth = 900000;
    fighter.defense = 999999;
    fighter.shield = 0;
    fighter.attacked = false;
  }
  for (const [index, enemy] of enemies(battle).entries()) {
    enemy.health = index === enemies(battle).length - 1 ? 1 : 0;
    enemy.shield = 0;
  }
  battle.enemyTurn = false;
  battle.pendingMs = 0;
  load(engine, game);
  for (let step = 0; step < 100; step++) {
    assert(engine.tick(250).ok);
    const next = engine.getState().battle;
    if (next.finished || next.phaseIndex !== phase) return next;
  }
  assert.fail("The campaign round did not advance");
}

function priorRules() {
  const prior = structuredClone(config);
  delete prior.campaignFinalAttackVersion;
  for (const level of prior.campaign.levels)
    for (const round of level.rounds) delete round.enemyFinalAttackPercents;
  return prior;
}
function stable(game) {
  delete game.savedAtUTC;
  return game;
}

test("Only level 76 land AI-G5 loses thirty percent attack, from 351 to 245, and keeps 6134 HP", async () => {
  for (const id of [75, 76, 77]) {
    const old = await army(priorRules());
    const current = await army();
    try {
      const level = config.campaign.levels.find((l) => l.battleId === id);
      start(old, level);
      start(current, level);
      for (let phase = 0; phase < level.rounds.length; phase++) {
        const before = enemies(exactGame(old).battle);
        const after = enemies(exactGame(current).battle);
        const expected = structuredClone(before);
        for (const foe of expected) {
          if (
            id === 76 &&
            level.rounds[phase].domain === "land" &&
            foe.enemyId === "AI-G5"
          ) {
            assert.equal(foe.damage, 351);
            assert.equal(foe.maxHealth, 6134);
            foe.damage = 245;
          }
        }
        assert.deepEqual(after, expected);
        if (phase + 1 < level.rounds.length) {
          advanceRound(old);
          advanceRound(current);
        }
      }
    } finally {
      old.dispose();
      current.dispose();
    }
  }
});

test("Loading an existing level 76 land battle lowers only AI-G5 attack exactly once", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    start(
      old,
      config.campaign.levels.find((level) => level.battleId === 76),
    );
    const game = exactGame(old);
    const foe = enemies(game.battle).find((f) => f.enemyId === "AI-G5");
    assert.equal(foe.damage, 351);
    foe.health -= 17;
    foe.strikes = 2;
    game.battle.paused = true;
    game.battle.actions = 1;
    game.battle.lastAttacks = [
      {
        attacker: allies(game.battle)[0].id,
        target: foe.id,
        damage: 17,
        shieldDamage: 0,
        missed: false,
        healing: 0,
      },
    ];
    load(old, game);
    const previous = exactGame(old);
    const loaded = current.load(old.save());
    assert(loaded.ok, loaded.message);
    const after = exactGame(current);
    const target = enemies(after.battle).find((f) => f.enemyId === "AI-G5");
    assert.equal(target.damage, 245);
    assert.equal(target.maxHealth, 6134);
    assert.equal(target.health, 6117);
    const expected = structuredClone(previous);
    expected.config = after.config;
    enemies(expected.battle).find((f) => f.enemyId === "AI-G5").damage = 245;
    assert.deepEqual(stable(after), stable(expected));
    for (let i = 0; i < 3; i++) {
      assert(current.load(current.save()).ok);
      assert.deepEqual(stable(exactGame(current)), stable(after));
    }
    const forged = exactGame(old);
    forged.config.units.find((u) => u.id === "light_tank").damage++;
    const rejected = current.load(pack(forged));
    assert.equal(rejected.ok, false);
    assert.deepEqual(stable(exactGame(current)), stable(after));
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Final campaign attack adjustments reject invalid percentages, unknown targets and unsupported versions", async () => {
  for (const value of [0, 101, 70.5, "70"]) {
    const invalid = structuredClone(config);
    invalid.campaign.levels[75].rounds[0].enemyFinalAttackPercents["AI-G5"] =
      value;
    await assert.rejects(() => army(invalid));
  }
  const unknown = structuredClone(config);
  unknown.campaign.levels[75].rounds[0].enemyFinalAttackPercents = {
    "AI-G4": 70,
  };
  await assert.rejects(() => army(unknown));
  const unsupported = structuredClone(config);
  unsupported.campaignFinalAttackVersion = 2;
  await assert.rejects(() => army(unsupported));
});
