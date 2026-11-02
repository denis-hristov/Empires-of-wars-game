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
  delete prior.finalLandBossBalanceVersion;
  for (const round of prior.campaign.levels.at(-1).rounds) {
    delete round.enemyFinalHealthPercents;
    delete round.enemyFinalAttackPercents;
  }
  return prior;
}
function stable(game) {
  delete game.savedAtUTC;
  return game;
}
function reduced(battle) {
  const result = structuredClone(battle);
  if (battle.campaignLevel !== 150 || battle.domain !== "land") return result;
  for (const foe of enemies(result)) {
    if (!/^G-B[1-5]$/.test(foe.enemyId)) continue;
    assert.equal(foe.maxHealth, 20136);
    assert.equal(foe.damage, 813);
    foe.maxHealth = 15102;
    if (foe.health > 0)
      foe.health = Math.max(1, Math.floor((foe.health * 75) / 100));
    foe.damage = 691;
    for (const hit of result.lastAttacks)
      if (hit.target === foe.id)
        hit.damage = Math.min(hit.damage, foe.maxHealth);
  }
  return result;
}

test("Final land bosses have 15102 HP and 691 attack; every other final enemy and all level 149 enemies retain their stats", async () => {
  for (const id of [149, 150]) {
    const old = await army(priorRules()),
      current = await army();
    try {
      const level = config.campaign.levels[id - 1];
      start(old, level);
      start(current, level);
      for (let phase = 0; phase < level.rounds.length; phase++) {
        const before = exactGame(old).battle;
        const after = exactGame(current).battle;
        assert.deepEqual(
          after,
          reduced(before),
          `Level ${id}, round ${phase + 1}`,
        );
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

test("Old final rounds migrate once, preserving partial health, dead bosses, shields, turn state and progress", async () => {
  const old = await army(priorRules()),
    current = await army();
  try {
    const template = exactGame(old);
    for (const id of [149, 150]) {
      load(old, structuredClone(template));
      const level = config.campaign.levels[id - 1];
      start(old, level);
      for (let phase = 0; phase < level.rounds.length; phase++) {
        const game = exactGame(old);
        const boss = enemies(game.battle)[0];
        boss.health = [
          boss.maxHealth,
          0,
          1,
          101,
          Math.floor(boss.maxHealth / 2),
        ][phase % 5];
        boss.shield = Math.max(0, boss.shield - 19);
        boss.strikes = 2;
        game.battle.paused = true;
        game.battle.actions = 1;
        game.battle.lastAttacks = [
          {
            attacker: allies(game.battle)[0].id,
            target: boss.id,
            damage: boss.health === 0 ? boss.maxHealth : 17,
            shieldDamage: 0,
            missed: false,
            healing: 0,
          },
        ];
        load(old, game);
        const before = exactGame(old);
        const loaded = current.load(old.save());
        assert(loaded.ok, loaded.message);
        const after = exactGame(current);
        const expected = structuredClone(before);
        expected.config = after.config;
        expected.battle = reduced(before.battle);
        assert.deepEqual(
          stable(after),
          stable(expected),
          `Level ${id}, round ${phase + 1}`,
        );
        for (let repeat = 0; repeat < 2; repeat++) {
          assert(current.load(current.save()).ok);
          assert.deepEqual(stable(exactGame(current)), stable(after));
        }
        if (phase + 1 < level.rounds.length) {
          const resume = exactGame(old);
          resume.battle.paused = false;
          load(old, resume);
          advanceRound(old);
        }
      }
    }
    const forged = exactGame(old);
    forged.config.units.find((u) => u.id === "light_tank").damage++;
    const before = stable(exactGame(current));
    assert.equal(current.load(pack(forged)).ok, false);
    assert.deepEqual(stable(exactGame(current)), before);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Final health reductions reject invalid percentages, missing targets and unsupported versions", async () => {
  for (const value of [0, 101, 75.5, "75"]) {
    const invalid = structuredClone(config);
    invalid.campaign.levels[149].rounds[0].enemyFinalHealthPercents["G-B1"] =
      value;
    await assert.rejects(() => army(invalid));
  }
  const unknown = structuredClone(config);
  unknown.campaign.levels[149].rounds[0].enemyFinalHealthPercents = {
    "G-B2": 75,
  };
  await assert.rejects(() => army(unknown));
  const unsupported = structuredClone(config);
  unsupported.finalLandBossBalanceVersion = 2;
  await assert.rejects(() => army(unsupported));
  const missingVersion = structuredClone(config);
  delete missingVersion.finalLandBossBalanceVersion;
  await assert.rejects(() => army(missingVersion));
});
