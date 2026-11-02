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
const adjustments = [
  { percent: 67, bossOnly: false },
  { percent: 75, bossOnly: true },
  { percent: 85, bossOnly: false },
];
const healthAdjustments = [90];
const definition = (type) =>
  config.units.find(
    (unit) => unit.id === (type === "raider" ? "infantry" : type),
  );
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const allies = (battle) => battle.fighters.filter((fighter) => !fighter.enemy);
const isBoss = (battle, fighter) =>
  Boolean(battle.campaignLevel) &&
  config.campaign.enemies.some(
    (enemy) => enemy.id === fighter.enemyId && enemy.kind === "boss",
  );
const reduced = (value, percent) =>
  Math.max(1, Math.floor((value * percent) / 100));
function rules(health, attack = adjustments.slice(0, 2)) {
  const value = structuredClone(config);
  if (health === undefined) delete value.battle.enemyHealthAdjustments;
  else value.battle.enemyHealthAdjustments = structuredClone(health);
  value.battle.enemyAttackAdjustments = structuredClone(attack);
  return value;
}
const shieldCap = (fighter) =>
  fighter.type === "heavy_infantry"
    ? Math.floor(fighter.maxHealth / 2)
    : fighter.type === "attack_submarine"
      ? fighter.maxHealth
      : definition(fighter.type).shield;

// Preserve unsigned 64-bit fighter identities while editing save fixtures.
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
function withoutTimestamp(game) {
  const value = structuredClone(game);
  delete value.savedAtUTC;
  return value;
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
  const foes = enemies(battle);
  for (const [index, enemy] of foes.entries()) {
    enemy.health = index === foes.length - 1 ? 1 : 0;
    enemy.shield = 0;
  }
  battle.enemyTurn = false;
  battle.pendingMs = 0;
  load(engine, game);
  for (let step = 0; step < 100; step++) {
    assert(engine.tick(250).ok);
    const next = engine.getState().battle;
    if (next.finished || next.phaseIndex !== phase) return;
  }
  assert.fail("The campaign round did not advance");
}
function startAt(engine, id, phase = 0) {
  start(engine, config.campaign.levels[id - 1]);
  while (engine.getState().battle.phaseIndex < phase) advanceRound(engine);
}
function applyAttack(battle, history) {
  for (const fighter of enemies(battle))
    for (const adjustment of history)
      if (!adjustment.bossOnly || isBoss(battle, fighter))
        fighter.damage = reduced(fighter.damage, adjustment.percent);
}
function applyHealth(battle, history) {
  for (const fighter of enemies(battle)) {
    const consumed = shieldCap(fighter) - fighter.shield;
    for (const percent of history) {
      fighter.maxHealth = reduced(fighter.maxHealth, percent);
      if (fighter.health > 0) fighter.health = reduced(fighter.health, percent);
    }
    fighter.shield = Math.max(0, shieldCap(fighter) - consumed);
  }
  for (const hit of battle.lastAttacks) {
    const target = enemies(battle).find((enemy) => enemy.id === hit.target);
    if (target) hit.damage = Math.min(hit.damage, target.maxHealth);
  }
}
function compareFresh(before, after, label) {
  const expected = structuredClone(before);
  applyHealth(expected, healthAdjustments);
  applyAttack(expected, adjustments.slice(2));
  assert.deepEqual(
    after,
    expected,
    `${label}: only enemy HP, derived shields and attack change`,
  );
}
function expectedUpgrade(
  game,
  health = healthAdjustments,
  attack = adjustments,
) {
  const expected = structuredClone(game);
  const savedHealth = game.config.battle.enemyHealthAdjustments ?? [];
  const savedAttack = game.config.battle.enemyAttackAdjustments ?? [];
  expected.config.battle.enemyHealthAdjustments = structuredClone(health);
  expected.config.battle.enemyAttackAdjustments = structuredClone(attack);
  if (expected.battle) {
    applyHealth(expected.battle, health.slice(savedHealth.length));
    applyAttack(expected.battle, attack.slice(savedAttack.length));
  }
  return withoutTimestamp(expected);
}
function decorateBattle(game, finished) {
  const battle = game.battle;
  battle.actions = 7;
  battle.round = 3;
  battle.enemyTurn = !finished;
  battle.pendingMs = finished ? 0 : 750;
  for (const fighter of allies(battle)) {
    fighter.health = Math.max(1, fighter.health - 1);
    fighter.shield = Math.max(0, fighter.shield - 3);
  }
  for (const [index, enemy] of enemies(battle).entries()) {
    enemy.damage = isBoss(battle, enemy) ? 4 : [1, 2, 19, 101][index % 4];
    enemy.health = finished
      ? 0
      : index === 0
        ? 0
        : index === 1
          ? 1
          : Math.max(1, enemy.maxHealth - 2);
    enemy.shield = Math.max(0, enemy.shield - 7);
    enemy.attacked = false;
  }
  if (finished) {
    battle.finished = battle.victory = true;
    battle.draw = false;
    battle.phaseIndex = battle.phases.length - 1;
    battle.domain = battle.phases[battle.phaseIndex];
    battle.outcomes = battle.phases.map(() => 1);
  }
  const target = enemies(battle).find(
    (fighter) => fighter.phase === battle.domain,
  );
  const attacker = allies(battle).find(
    (fighter) => fighter.phase === battle.domain,
  );
  battle.lastAttacks = [
    {
      attacker: attacker.id,
      target: target.id,
      damage: target.maxHealth,
      shieldDamage: 0,
      healing: 0,
      missed: false,
    },
  ];
}

test("All expedition tiers receive another 10% less enemy HP and 15% less attack with friendly statistics unchanged", async () => {
  assert.deepEqual(config.battle.enemyAttackAdjustments, adjustments);
  assert.deepEqual(config.battle.enemyHealthAdjustments, healthAdjustments);
  const previous = await army(rules());
  const current = await army();
  try {
    const templates = [previous, current].map(exactGame);
    const seen = new Set();
    for (let tier = 1; tier <= 10; tier++) {
      for (const [index, engine] of [previous, current].entries()) {
        const game = structuredClone(templates[index]);
        for (const unit of game.units) {
          const replacement = config.units.find(
            (entry) =>
              entry.domain === definition(unit.type).domain &&
              entry.level === tier,
          );
          unit.type = replacement.id;
          unit.health = replacement.health;
        }
        load(engine, game);
        start(engine);
      }
      const before = exactGame(previous).battle;
      const after = exactGame(current).battle;
      compareFresh(before, after, `Expedition tier ${tier}`);
      for (const enemy of enemies(after)) seen.add(definition(enemy.type).id);
      assert.deepEqual(
        new Set(enemies(after).map((enemy) => enemy.domain)),
        new Set(domains),
      );
    }
    assert.equal(seen.size, config.units.length, "Every unit template covered");
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Ordinary, boss and AI campaign enemies receive the new HP and attack factors across all arenas and the final level", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    const templates = [previous, current].map(exactGame);
    const kinds = new Set();
    const bossArenas = new Set();
    const bossIds = new Set();
    let finalPhase = -1;
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
          const catalog = config.campaign.enemies.find(
            (entry) => entry.id === enemy.enemyId,
          );
          kinds.add(catalog.kind);
          if (catalog.kind === "boss") {
            bossArenas.add(enemy.domain);
            bossIds.add(enemy.enemyId);
          }
        }
        if (id === 150) finalPhase = phase;
        if (phase + 1 < config.campaign.levels[id - 1].rounds.length) {
          advanceRound(previous);
          advanceRound(current);
        }
      }
    }
    assert.deepEqual(kinds, new Set(["ordinary", "boss", "ai"]));
    assert.deepEqual(bossArenas, new Set(domains));
    assert.deepEqual(
      bossIds,
      new Set(
        config.campaign.enemies
          .filter((enemy) => enemy.kind === "boss")
          .map((enemy) => enemy.id),
      ),
    );
    assert.equal(finalPhase, 14, "All fifteen final-level phases covered");
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Active and finished saves migrate wounds, dead troops, depleted shields and historical hits once while preserving all other progress", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    const template = exactGame(previous);
    load(current, template);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      expectedUpgrade(template),
    );
    for (const [level, phase, finished] of [
      [null, 0, false],
      [null, 0, true],
      [5, 0, false],
      [5, 0, true],
      [35, 1, false],
      [150, 14, false],
    ]) {
      load(previous, structuredClone(template));
      if (level) startAt(previous, level, phase);
      else start(previous);
      const game = exactGame(previous);
      decorateBattle(game, finished);
      load(previous, game);
      const prior = exactGame(previous);
      const expected = expectedUpgrade(prior);
      load(current, prior);
      assert.deepEqual(
        withoutTimestamp(exactGame(current)),
        expected,
        `${level ?? "Expedition"}, finished ${finished}: exact migration`,
      );
      for (const enemy of enemies(prior.battle)) {
        const upgraded = enemies(expected.battle).find(
          (fighter) => fighter.id === enemy.id,
        );
        assert.equal(
          upgraded.health,
          enemy.health === 0 ? 0 : reduced(enemy.health, 90),
        );
        assert.equal(upgraded.damage, reduced(enemy.damage, 85));
      }
      assert.equal(
        expected.battle.lastAttacks[0].damage,
        reduced(prior.battle.lastAttacks[0].damage, 90),
        "Historical enemy-target damage fits the new maximum HP",
      );
      for (let reload = 0; reload < 3; reload++) {
        load(current, exactGame(current));
        assert.deepEqual(withoutTimestamp(exactGame(current)), expected);
      }
    }
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Missing health or attack prefixes apply independently without repeating either reduction", async () => {
  const current = await army();
  try {
    for (const [health, attack] of [
      [[], adjustments.slice(0, 2)],
      [healthAdjustments, adjustments.slice(0, 2)],
      [undefined, adjustments],
      [[], []],
    ]) {
      const previous = await army(rules(health, attack));
      try {
        startAt(previous, 5);
        const game = exactGame(previous);
        decorateBattle(game, false);
        load(previous, game);
        const prior = exactGame(previous);
        load(current, prior);
        const expected = expectedUpgrade(prior);
        assert.deepEqual(withoutTimestamp(exactGame(current)), expected);
        load(current, exactGame(current));
        assert.deepEqual(withoutTimestamp(exactGame(current)), expected);
      } finally {
        previous.dispose();
      }
    }
  } finally {
    current.dispose();
  }
});

test("The new 85% attack factor is applied after the existing 67% and boss-only 75% factors with separate flooring", async () => {
  const previous = await army(rules(healthAdjustments, []));
  const current = await army();
  try {
    startAt(previous, 5);
    const game = exactGame(previous);
    for (const enemy of enemies(game.battle))
      enemy.damage = isBoss(game.battle, enemy) ? 5 : 2;
    load(previous, game);
    const prior = exactGame(previous);
    load(current, prior);
    const actual = exactGame(current);
    assert.deepEqual(withoutTimestamp(actual), expectedUpgrade(prior));
    const bosses = enemies(actual.battle).filter((enemy) =>
      isBoss(actual.battle, enemy),
    );
    assert(bosses.length > 0);
    for (const boss of bosses) {
      assert.equal(boss.damage, 1, "5 floors to 3, then 2, then 1");
      assert.equal(
        Math.floor((5 * 67 * 75 * 85) / 1000000),
        2,
        "Collapsing the three percentages would produce a different result",
      );
    }
    for (const enemy of enemies(actual.battle)) assert(enemy.damage >= 1);
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("Future appended health factors preserve existing damage and consume no additional shield capacity", async () => {
  const futureHealth = [90, 90];
  const current = await army();
  const future = await army(rules(futureHealth, adjustments));
  try {
    startAt(current, 5);
    const game = exactGame(current);
    decorateBattle(game, false);
    load(current, game);
    const prior = exactGame(current);
    load(future, prior);
    const expected = expectedUpgrade(prior, futureHealth);
    assert.deepEqual(withoutTimestamp(exactGame(future)), expected);
    assert.deepEqual(
      enemies(exactGame(future).battle).map((enemy) => enemy.damage),
      enemies(prior.battle).map((enemy) => enemy.damage),
    );
    load(future, exactGame(future));
    assert.deepEqual(withoutTimestamp(exactGame(future)), expected);
  } finally {
    current.dispose();
    future.dispose();
  }
});

test("Earlier global and boss migrations complete before the new health and attack tail factors", async () => {
  const historicalRules = rules(undefined, []);
  delete historicalRules.battle.enemyAttackAdjustments;
  for (const key of [
    "enemyStatPercent",
    "enemyStatPasses",
    "enemyStatAdjustments",
    "bossHealthPercent",
    "bossAttackPercent",
  ])
    delete historicalRules.battle[key];
  const historical = await army(historicalRules);
  const previous = await army(rules());
  const current = await army();
  try {
    startAt(historical, 5);
    const prior = exactGame(historical);
    load(previous, prior);
    const intermediate = exactGame(previous);
    load(current, prior);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      expectedUpgrade(intermediate),
    );
  } finally {
    historical.dispose();
    previous.dispose();
    current.dispose();
  }
});

test("Malformed health configurations and unknown health or attack histories are rejected without altering the current game", async () => {
  const current = await army();
  try {
    startAt(current, 5);
    const original = exactGame(current);
    const malformed = [
      null,
      {},
      [null],
      ["90"],
      [true],
      [0],
      [101],
      [90.5],
      Array.from({ length: 21 }, () => 90),
    ];
    for (const history of [...malformed, [89], [90, 90]]) {
      const invalid = structuredClone(original);
      invalid.config.battle.enemyHealthAdjustments = history;
      assert.equal(
        current.load(pack(invalid)).ok,
        false,
        JSON.stringify(history),
      );
      assert.deepEqual(
        withoutTimestamp(exactGame(current)),
        withoutTimestamp(original),
      );
    }
    for (const history of malformed)
      await assert.rejects(() =>
        GameEngine.create({
          factory,
          config: rules(history, adjustments),
          wasmBinary,
        }),
      );
    for (const history of [
      [...adjustments.slice(0, 2), { percent: 84, bossOnly: false }],
      [...adjustments.slice(0, 2), { percent: 85, bossOnly: true }],
      [...adjustments, { percent: 90, bossOnly: false }],
    ]) {
      const invalid = structuredClone(original);
      invalid.config.battle.enemyAttackAdjustments = history;
      assert.equal(current.load(pack(invalid)).ok, false);
      assert.deepEqual(
        withoutTimestamp(exactGame(current)),
        withoutTimestamp(original),
      );
    }
    const invalid = structuredClone(original);
    delete invalid.config.battle.enemyHealthAdjustments;
    invalid.config.battle.enemyDamage++;
    assert.equal(current.load(pack(invalid)).ok, false);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      withoutTimestamp(original),
    );
  } finally {
    current.dispose();
  }
});
