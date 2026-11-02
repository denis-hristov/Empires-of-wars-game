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
delete config.battle.enemyHealthAdjustments;
config.battle.enemyAttackAdjustments =
  config.battle.enemyAttackAdjustments.slice(0, 2);
const domains = ["land", "naval", "air"];
const adjustments = [
  { percent: 67, bossOnly: false },
  { percent: 75, bossOnly: true },
];
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
function rules(history) {
  const value = structuredClone(config);
  if (history === undefined) delete value.battle.enemyAttackAdjustments;
  else value.battle.enemyAttackAdjustments = structuredClone(history);
  return value;
}

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
function compareFresh(before, after, label, history = adjustments) {
  const expected = structuredClone(before);
  applyAttack(expected, history);
  assert.deepEqual(after, expected, `${label}: only enemy attack changes`);
}
function expectedUpgrade(game, history = adjustments) {
  const expected = structuredClone(game);
  const saved = game.config.battle.enemyAttackAdjustments ?? [];
  expected.config.battle.enemyAttackAdjustments = structuredClone(history);
  if (expected.battle)
    applyAttack(expected.battle, history.slice(saved.length));
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

test("All expedition tiers and unit templates receive 33% less enemy attack with HP, shields and allies unchanged", async () => {
  assert.deepEqual(config.battle.enemyAttackAdjustments, adjustments);
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

test("Campaign ordinary and AI enemies lose 33% attack, and bosses lose another 25% across all arenas and the final level", async () => {
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

test("Existing active and finished saves change only enemy attack, preserving wounded and dead units, shields, logs and progress on every reload", async () => {
  const previous = await army(rules());
  const current = await army();
  try {
    const template = exactGame(previous);
    load(current, template);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      expectedUpgrade(template),
      "A save without a battle only gains the adjustment marker",
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
        `${level ?? "Expedition"}, finished ${finished}: only attack changes`,
      );
      for (const boss of enemies(prior.battle).filter((fighter) =>
        isBoss(prior.battle, fighter),
      )) {
        const upgraded = enemies(expected.battle).find(
          (enemy) => enemy.id === boss.id,
        );
        assert.equal(boss.damage, 4);
        assert.equal(upgraded.damage, 1, "Each percentage floors separately");
        assert.equal(Math.floor((boss.damage * 67 * 75) / 10000), 2);
      }
      for (const enemy of enemies(prior.battle).filter(
        (fighter) => fighter.damage === 1,
      ))
        assert.equal(
          enemies(expected.battle).find((fighter) => fighter.id === enemy.id)
            .damage,
          1,
          "Enemy attack never falls below one",
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

test("Empty and partial adjustment histories apply only their missing ordered suffix", async () => {
  const current = await army();
  try {
    for (const history of [[], adjustments.slice(0, 1)]) {
      const previous = await army(rules(history));
      try {
        startAt(previous, 5);
        const prior = exactGame(previous);
        load(current, prior);
        assert.deepEqual(
          withoutTimestamp(exactGame(current)),
          expectedUpgrade(prior),
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

test("Historical health and boss migrations finish before the new attack-only adjustments", async () => {
  const historicalRules = rules();
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
    const game = exactGame(historical);
    decorateBattle(game, false);
    load(historical, game);
    const prior = exactGame(historical);
    load(previous, prior);
    const intermediate = exactGame(previous);
    load(current, prior);
    assert.deepEqual(
      withoutTimestamp(exactGame(current)),
      expectedUpgrade(intermediate),
      "The new migration wraps the complete historical migration chain",
    );
  } finally {
    historical.dispose();
    previous.dispose();
    current.dispose();
  }
});

test("Future appended global factors retain their order after existing boss-only factors", async () => {
  const futureHistory = [...adjustments, { percent: 67, bossOnly: false }];
  const current = await army();
  const future = await army(rules(futureHistory));
  try {
    startAt(current, 5);
    startAt(future, 5);
    const prior = exactGame(current);
    compareFresh(
      prior.battle,
      exactGame(future).battle,
      "Future ordered history",
      futureHistory.slice(2),
    );
    load(future, prior);
    assert.deepEqual(
      withoutTimestamp(exactGame(future)),
      expectedUpgrade(prior, futureHistory),
    );
    const saved = exactGame(future);
    load(future, saved);
    assert.deepEqual(
      withoutTimestamp(exactGame(future)),
      withoutTimestamp(saved),
    );
  } finally {
    current.dispose();
    future.dispose();
  }
});

test("Malformed adjustment configurations and unknown save histories are rejected without changing the loaded game", async () => {
  const engine = await army();
  try {
    startAt(engine, 5);
    const original = exactGame(engine);
    const malformed = [
      null,
      {},
      [67],
      [null],
      [{ percent: 0, bossOnly: false }],
      [{ percent: 101, bossOnly: false }],
      [{ percent: 67.5, bossOnly: false }],
      [{ percent: "67", bossOnly: false }],
      [{ percent: true, bossOnly: false }],
      [{ percent: 67, bossOnly: "false" }],
      [{ percent: 67 }],
      [{ bossOnly: false }],
      [{ percent: 67, bossOnly: false, unknown: true }],
      Array.from({ length: 21 }, () => ({ percent: 67, bossOnly: false })),
    ];
    const unknown = [
      [{ percent: 66, bossOnly: false }],
      [{ percent: 67, bossOnly: true }],
      [...adjustments].reverse(),
      [adjustments[0], { percent: 74, bossOnly: true }],
      [...adjustments, { percent: 99, bossOnly: false }],
    ];
    for (const history of [...malformed, ...unknown]) {
      const invalid = structuredClone(original);
      invalid.config.battle.enemyAttackAdjustments = history;
      assert.equal(
        engine.load(pack(invalid)).ok,
        false,
        JSON.stringify(history),
      );
      assert.deepEqual(
        withoutTimestamp(exactGame(engine)),
        withoutTimestamp(original),
      );
    }
    for (const history of malformed) {
      const invalid = rules(history);
      await assert.rejects(() =>
        GameEngine.create({ factory, config: invalid, wasmBinary }),
      );
    }
    const invalid = structuredClone(original);
    delete invalid.config.battle.enemyAttackAdjustments;
    invalid.config.battle.enemyDamage++;
    assert.equal(
      engine.load(pack(invalid)).ok,
      false,
      "Historical migration still validates every gameplay field",
    );
    assert.deepEqual(
      withoutTimestamp(exactGame(engine)),
      withoutTimestamp(original),
    );
  } finally {
    engine.dispose();
  }
});
