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
const domains = ["land", "naval", "air"];
const definition = (type) =>
  config.units.find(
    (unit) => unit.id === (type === "raider" ? "infantry" : type),
  );
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const allies = (battle) => battle.fighters.filter((fighter) => !fighter.enemy);
const reduced = (value, percent) =>
  Math.max(1, Math.floor((value * percent) / 100));
const kind = (fighter) =>
  config.campaign.enemies.find((enemy) => enemy.id === fighter.enemyId)?.kind;
const shieldCap = (fighter) =>
  fighter.type === "heavy_infantry"
    ? Math.floor(fighter.maxHealth / 2)
    : fighter.type === "attack_submarine"
      ? fighter.maxHealth
      : definition(fighter.type).shield;
function rules(health, attack) {
  const value = structuredClone(config);
  delete value.battle.enemyHealthAdjustments;
  delete value.battle.enemyAttackAdjustments;
  if (health === undefined) delete value.battle.bossHealthPercent;
  else value.battle.bossHealthPercent = health;
  if (attack === undefined) delete value.battle.bossAttackPercent;
  else value.battle.bossAttackPercent = attack;
  return value;
}

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
async function army(balance = rules(90, 85)) {
  const engine = await GameEngine.create({
    factory,
    config: balance,
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

function compareFresh(before, after, label) {
  const expected = structuredClone(before);
  for (const boss of enemies(expected).filter(
    (fighter) => kind(fighter) === "boss",
  )) {
    boss.health = boss.maxHealth = reduced(boss.maxHealth, 90);
    boss.damage = reduced(boss.damage, 85);
    boss.shield = shieldCap(boss);
  }
  assert.deepEqual(
    after.fighters,
    expected.fighters,
    `${label}: only boss HP, damage and derived shields change`,
  );
  assert.deepEqual(
    after.campaignArmy,
    before.campaignArmy,
    `${label}: committed allies unchanged`,
  );
}
function withoutTimestamp(game) {
  const result = structuredClone(game);
  delete result.savedAtUTC;
  return result;
}
function expectedUpgrade(game, health = true, attack = true) {
  const expected = structuredClone(game);
  expected.config.battle.bossHealthPercent = 90;
  expected.config.battle.bossAttackPercent = 85;
  for (const boss of enemies(expected.battle).filter(
    (fighter) => kind(fighter) === "boss",
  )) {
    if (health) {
      const consumed = shieldCap(boss) - boss.shield;
      boss.maxHealth = reduced(boss.maxHealth, 90);
      if (boss.health > 0) boss.health = reduced(boss.health, 90);
      boss.shield = Math.max(0, shieldCap(boss) - consumed);
      for (const hit of expected.battle.lastAttacks)
        if (hit.target === boss.id)
          hit.damage = Math.min(hit.damage, boss.maxHealth);
    }
    if (attack) boss.damage = reduced(boss.damage, 85);
  }
  return withoutTimestamp(expected);
}
function startAt(engine, id, phase = 0) {
  start(engine, config.campaign.levels[id - 1]);
  while (engine.getState().battle.phaseIndex < phase) advanceRound(engine);
}

test("Bosses alone receive 10% less HP and 15% less attack in all arenas and across campaign tiers", async () => {
  assert.equal(config.battle.bossHealthPercent, 90);
  assert.equal(config.battle.bossAttackPercent, 85);
  const previous = await army(rules());
  const current = await army();
  try {
    const templates = [previous, current].map(exactGame);
    const bosses = new Set();
    const kinds = new Set();
    const arenas = new Set();
    for (const id of [1, 5, 12, 20, 35, 55, 65, 85, 100, 125, 130, 150]) {
      for (const [index, engine] of [previous, current].entries()) {
        load(engine, structuredClone(templates[index]));
        startAt(engine, id);
      }
      for (
        let phase = 0;
        phase < config.campaign.levels[id - 1].rounds.length;
        phase++
      ) {
        const before = exactGame(previous).battle;
        const after = exactGame(current).battle;
        compareFresh(before, after, `Campaign ${id}, phase ${phase}`);
        for (const enemy of enemies(after)) {
          kinds.add(kind(enemy));
          if (kind(enemy) === "boss") {
            bosses.add(enemy.enemyId);
            arenas.add(enemy.domain);
          }
        }
        if (phase + 1 < config.campaign.levels[id - 1].rounds.length) {
          advanceRound(previous);
          advanceRound(current);
        }
      }
    }
    assert.deepEqual(kinds, new Set(["ordinary", "boss", "ai"]));
    assert.deepEqual(arenas, new Set(domains));
    assert.deepEqual(
      bosses,
      new Set(
        config.campaign.enemies
          .filter((enemy) => enemy.kind === "boss")
          .map((enemy) => enemy.id),
      ),
    );
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Boss balancing leaves expedition fighters and saved expedition progress unchanged", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    const template = exactGame(previous);
    for (const tier of [1, 6, 10]) {
      const game = structuredClone(template);
      for (const unit of game.units) {
        const replacement = config.units.find(
          (entry) =>
            entry.domain === definition(unit.type).domain &&
            entry.level === tier,
        );
        unit.type = replacement.id;
        unit.health = replacement.health;
      }
      load(previous, game);
      start(previous);
      const prior = exactGame(previous);
      load(current, prior);
      assert.deepEqual(
        withoutTimestamp(exactGame(current)),
        expectedUpgrade(prior),
        `Tier ${tier}: only configuration markers change`,
      );
      load(current, game);
      start(current);
      assert.deepEqual(
        exactGame(current).battle,
        prior.battle,
        `Tier ${tier}: fresh expeditions unchanged`,
      );
    }
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Existing boss battles migrate once while preserving wounds, spent shields, non-boss fighters and battle progress", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    const template = exactGame(previous);
    for (const [id, phase, hp] of [
      [5, 0, 101],
      [20, 2, 1],
      [35, 1, 67],
      [150, 14, 0],
    ]) {
      load(previous, structuredClone(template));
      startAt(previous, id, phase);
      const game = exactGame(previous);
      const battle = game.battle;
      battle.pendingMs = 750;
      battle.enemyTurn = true;
      battle.actions = 7;
      battle.round = 3;
      allies(battle)[0].health--;
      const boss = enemies(battle).find((fighter) => kind(fighter) === "boss");
      boss.maxHealth = 101;
      boss.health = hp;
      boss.damage = 19;
      boss.shield = hp === 0 ? 0 : Math.max(0, shieldCap(boss) - 7);
      battle.lastAttacks = [
        {
          attacker: allies(battle)[0].id,
          target: boss.id,
          damage: boss.maxHealth,
          shieldDamage: 0,
          healing: 0,
          missed: false,
        },
      ];
      load(previous, game);
      const prior = exactGame(previous);
      const expected = expectedUpgrade(prior);
      load(current, prior);
      assert.deepEqual(
        withoutTimestamp(exactGame(current)),
        expected,
        `Campaign ${id}: only boss statistics change`,
      );
      for (let reload = 0; reload < 3; reload++) {
        load(current, exactGame(current));
        assert.deepEqual(
          withoutTimestamp(exactGame(current)),
          expected,
          "Reloads never stack reductions or refill shields",
        );
      }
    }
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Completed boss victories remain valid after the health reduction", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    startAt(previous, 5);
    const game = exactGame(previous);
    const battle = game.battle;
    battle.finished = battle.victory = true;
    battle.enemyTurn = false;
    battle.pendingMs = 0;
    battle.outcomes = [1];
    for (const enemy of enemies(battle)) enemy.health = enemy.shield = 0;
    const boss = enemies(battle).find((fighter) => kind(fighter) === "boss");
    battle.lastAttacks = [
      {
        attacker: allies(battle)[0].id,
        target: boss.id,
        damage: boss.maxHealth,
        shieldDamage: 0,
        healing: 0,
        missed: false,
      },
    ];
    load(previous, game);
    const prior = exactGame(previous);
    load(current, prior);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      expectedUpgrade(prior),
    );
    assert.equal(exactGame(current).battle.victory, true);
    load(current, exactGame(current));
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Partially upgraded boss saves apply only the missing health or attack modifier", async () => {
  const current = await army();
  try {
    for (const [health, attack] of [
      [90, undefined],
      [undefined, 85],
    ]) {
      const previous = await army(rules(health, attack));
      try {
        startAt(previous, 5);
        const prior = exactGame(previous);
        load(current, prior);
        assert.deepEqual(
          withoutTimestamp(exactGame(current)),
          expectedUpgrade(prior, health === undefined, attack === undefined),
        );
        const saved = exactGame(current);
        load(current, saved);
        assert.deepEqual(
          withoutTimestamp(exactGame(current)),
          withoutTimestamp(saved),
        );
      } finally {
        previous.dispose();
      }
    }
  } finally {
    current.dispose();
  }
});

test("Invalid or unknown boss balance markers are rejected without changing the loaded game", async () => {
  const engine = await army();
  try {
    startAt(engine, 5);
    const original = exactGame(engine);
    for (const field of ["bossHealthPercent", "bossAttackPercent"]) {
      for (const value of [0, 101, 80, 100, 90.5, "85", true, null]) {
        const invalid = structuredClone(original);
        invalid.config.battle[field] = value;
        assert.equal(
          engine.load(pack(invalid)).ok,
          false,
          `${field}: reject ${value}`,
        );
        assert.deepEqual(
          withoutTimestamp(exactGame(engine)),
          withoutTimestamp(original),
        );
      }
      for (const value of [0, 101, 90.5, "85", true, null]) {
        const invalid = structuredClone(config);
        invalid.battle[field] = value;
        await assert.rejects(() =>
          GameEngine.create({ factory, config: invalid, wasmBinary }),
        );
      }
    }
  } finally {
    engine.dispose();
  }
});
