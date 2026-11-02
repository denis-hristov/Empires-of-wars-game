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
const reduced = (value) => Math.max(1, Math.floor((value * 85) / 100));
const shieldCap = (fighter) =>
  fighter.type === "heavy_infantry"
    ? Math.floor(fighter.maxHealth / 2)
    : fighter.type === "attack_submarine"
      ? fighter.maxHealth
      : definition(fighter.type).shield;
function rules(adjustments) {
  const value = structuredClone(config);
  delete value.battle.enemyHealthAdjustments;
  delete value.battle.enemyAttackAdjustments;
  delete value.battle.bossHealthPercent;
  delete value.battle.bossAttackPercent;
  if (adjustments === undefined) delete value.battle.enemyStatAdjustments;
  else value.battle.enemyStatAdjustments = adjustments;
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
async function army(balance = rules([85])) {
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
function compareFresh(before, after, label) {
  assert.deepEqual(allies(after), allies(before), `${label}: allies unchanged`);
  assert.deepEqual(
    after.campaignArmy,
    before.campaignArmy,
    `${label}: committed allies unchanged`,
  );
  assert.equal(enemies(after).length, enemies(before).length);
  for (const [index, enemy] of enemies(after).entries()) {
    const prior = enemies(before)[index];
    assert.equal(
      enemy.maxHealth,
      reduced(prior.maxHealth),
      `${label}: ${enemy.type} maximum HP`,
    );
    assert.equal(enemy.health, enemy.maxHealth, `${label}: full starting HP`);
    assert.equal(
      enemy.damage,
      reduced(prior.damage),
      `${label}: ${enemy.type} attack`,
    );
    assert.equal(
      enemy.shield,
      shieldCap(enemy),
      `${label}: shield matches new HP capacity`,
    );
    const derived = {};
    if ("maxShield" in enemy) {
      assert.equal(
        enemy.maxShield,
        shieldCap(enemy),
        `${label}: displayed shield capacity`,
      );
      derived.maxShield = prior.maxShield;
    }
    if ("healing" in enemy) {
      const healing =
        enemy.type === "infantry"
          ? Math.floor(enemy.maxHealth / 2)
          : ["frigate", "strike_fighter", "armored_carrier"].includes(enemy.type)
            ? Math.floor((enemy.maxHealth * 45) / 100)
            : 0;
      assert.equal(
        enemy.healing,
        healing,
        `${label}: healing remains based on maximum HP`,
      );
      derived.healing = prior.healing;
    }
    assert.deepEqual(
      {
        ...enemy,
        ...derived,
        health: prior.health,
        maxHealth: prior.maxHealth,
        damage: prior.damage,
        shield: prior.shield,
      },
      prior,
      `${label}: other enemy statistics unchanged`,
    );
  }
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

test("Every expedition tier receives another 15% reduction from the previous enemy health and attack", async () => {
  assert.equal(config.battle.enemyStatPercent, 90);
  assert.equal(config.battle.enemyStatPasses, 2);
  assert.deepEqual(config.battle.enemyStatAdjustments, [85]);
  assert.equal(config.battle.enemyAttackPercent, 75);
  assert.equal(config.battle.enemySingleTarget, true);
  const previous = await army(rules(undefined));
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
        new Set(enemies(after).map((enemy) => enemy.phase)),
        new Set(domains),
      );
    }
    assert.equal(
      seen.size,
      config.units.length,
      "Every unit template is covered",
    );
  } finally {
    previous.dispose();
    current.dispose();
  }
});

test("The additional 15% reduction applies to ordinary enemies, bosses and AI encounters", async () => {
  const previous = await army(rules(undefined));
  const current = await army();
  try {
    const templates = [previous, current].map(exactGame);
    const kinds = new Set();
    for (const id of [1, 5, 12, 149, 150]) {
      for (const [index, engine] of [previous, current].entries()) {
        load(engine, structuredClone(templates[index]));
        start(engine, config.campaign.levels[id - 1]);
      }
      const before = previous.getState().battle;
      const after = current.getState().battle;
      compareFresh(before, after, `Campaign ${id}`);
      for (const enemy of enemies(after))
        kinds.add(
          config.campaign.enemies.find((entry) => entry.id === enemy.enemyId)
            .kind,
        );
    }
    assert.deepEqual(kinds, new Set(["ordinary", "boss", "ai"]));
  } finally {
    previous.dispose();
    current.dispose();
  }
});

for (const campaign of [false, true])
  test(`Previous ${campaign ? "campaign" : "expedition"} saves receive the additional 15% reduction once and preserve spent shields and battle progress`, async () => {
    const previous = await army(rules(undefined));
    const current = await army();
    try {
      start(previous, campaign ? config.campaign.levels[4] : undefined);
      const game = exactGame(previous);
      const battle = game.battle;
      battle.pendingMs = 750;
      battle.enemyTurn = true;
      battle.actions = 7;
      battle.round = 3;
      allies(battle)[0].health--;
      allies(battle)[0].shield--;
      for (const [index, enemy] of enemies(battle).entries()) {
        if (!campaign)
          enemy.type = {
            land: "heavy_infantry",
            naval: "attack_submarine",
            air: "plasma_fighter",
          }[enemy.domain];
        enemy.maxHealth = index % 2 === 0 ? 101 : 19;
        enemy.health = index === 0 ? 0 : index % 2 === 0 ? 101 : 1;
        enemy.damage = [11, 1, 19][index % 3];
        enemy.shield =
          enemy.health === 0 ? 0 : Math.max(0, shieldCap(enemy) - 7);
        enemy.attacked = false;
      }
      const killed = enemies(battle)[0];
      battle.lastAttacks = [
        {
          attacker: allies(battle)[0].id,
          target: killed.id,
          damage: killed.maxHealth,
          shieldDamage: 0,
          healing: 0,
          missed: false,
        },
      ];
      load(previous, game);
      const prior = exactGame(previous);
      assert.equal(prior.config.battle.enemyStatPercent, 90);
      assert.equal(prior.config.battle.enemyStatPasses, 2);
      assert.equal(prior.config.battle.enemyStatAdjustments, undefined);
      const expected = structuredClone(prior);
      expected.config.battle.enemyStatAdjustments = [85];
      for (const enemy of enemies(expected.battle)) {
        const consumedShield = shieldCap(enemy) - enemy.shield;
        enemy.maxHealth = reduced(enemy.maxHealth);
        if (enemy.health > 0) enemy.health = reduced(enemy.health);
        enemy.damage = reduced(enemy.damage);
        enemy.shield = Math.max(0, shieldCap(enemy) - consumedShield);
      }
      expected.battle.lastAttacks[0].damage = reduced(killed.maxHealth);
      const result = current.load(previous.save());
      assert(result.ok, result.message);
      const migrated = exactGame(current);
      delete migrated.savedAtUTC;
      delete expected.savedAtUTC;
      assert.deepEqual(
        migrated,
        expected,
        "Only enemy statistics and bounded historical damage change",
      );
      assert.equal(
        enemies(migrated.battle)[0].health,
        0,
        "Dead enemies stay dead",
      );
      assert.equal(
        enemies(migrated.battle)[1].health,
        1,
        "Living enemies keep at least one HP",
      );
      for (let reload = 0; reload < 3; reload++) {
        assert(current.load(current.save()).ok);
        const restored = exactGame(current);
        delete restored.savedAtUTC;
        assert.deepEqual(
          restored,
          expected,
          "Repeated loads do not stack reductions or refill shields",
        );
      }
      for (const field of [
        "enemyStatPercent",
        "enemyHealth",
        "enemyDamage",
        "enemyStatPasses",
        "enemyStatAdjustments",
      ]) {
        const invalid = structuredClone(prior);
        invalid.config.battle[field] =
          field === "enemyStatAdjustments"
            ? [80]
            : field === "enemyStatPasses"
              ? 3
              : field === "enemyStatPercent"
                ? 80
                : invalid.config.battle[field] + 1;
        const unchanged = exactGame(current);
        delete unchanged.savedAtUTC;
        assert.equal(
          current.load(pack(invalid)).ok,
          false,
          `${field}: unknown rules are rejected`,
        );
        const retained = exactGame(current);
        delete retained.savedAtUTC;
        assert.deepEqual(
          retained,
          unchanged,
          `${field}: rejected saves leave state intact`,
        );
      }
    } finally {
      previous.dispose();
      current.dispose();
    }
  });

for (const campaign of [false, true])
  test(`Completed previous ${campaign ? "campaign" : "expedition"} saves retain victory and valid damage history after another reduction`, async () => {
    const previous = await army(rules(undefined));
    const current = await army();
    try {
      start(previous, campaign ? config.campaign.levels[0] : undefined);
      const game = exactGame(previous);
      const battle = game.battle;
      battle.finished = battle.victory = true;
      battle.draw = false;
      battle.enemyTurn = false;
      battle.pendingMs = 0;
      battle.phaseIndex = battle.phases.length - 1;
      battle.domain = battle.phases[battle.phaseIndex];
      battle.outcomes = battle.phases.map(() => 1);
      for (const enemy of enemies(battle)) enemy.health = enemy.shield = 0;
      const target = enemies(battle).find(
        (enemy) => enemy.phase === battle.domain,
      );
      const attacker = allies(battle).find(
        (ally) => ally.phase === battle.domain,
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
      load(previous, game);
      const result = current.load(previous.save());
      assert(result.ok, result.message);
      const migrated = exactGame(current);
      assert.equal(migrated.battle.finished, true);
      assert.equal(migrated.battle.victory, true);
      assert.deepEqual(migrated.battle.outcomes, battle.outcomes);
      assert.deepEqual(migrated.stock, game.stock);
      assert.deepEqual(migrated.appliedRewards, game.appliedRewards);
      assert.equal(
        migrated.battle.lastAttacks[0].damage,
        reduced(target.maxHealth),
      );
      assert(enemies(migrated.battle).every((enemy) => enemy.health === 0));
      assert(current.load(current.save()).ok);
    } finally {
      previous.dispose();
      current.dispose();
    }
  });
