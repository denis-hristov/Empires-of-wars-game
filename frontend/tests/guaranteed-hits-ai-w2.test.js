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

function beforeThisChange() {
  const prior = structuredClone(config);
  delete prior.battle.attacksAlwaysHit;
  delete prior.campaignAttackAdjustmentsVersion;
  delete prior.campaignShieldRulesVersion;
  for (const round of prior.campaign.levels.find(
    (level) => level.battleId === 58,
  ).rounds) {
    delete round.enemyAttackPercents;
    delete round.unshieldedEnemies;
  }
  return prior;
}
function stable(game) {
  delete game.savedAtUTC;
  return game;
}

test("Level 58 AI-W2 migrates from 317 to 257 attack while retaining 3381 maximum HP, wounds and turn state and removing its shield", async () => {
  const old = await army(beforeThisChange());
  const current = await army();
  try {
    start(
      old,
      config.campaign.levels.find((level) => level.battleId === 58),
    );
    advanceRound(old);
    const game = exactGame(old);
    assert.equal(game.battle.domain, "naval");
    const boss = enemies(game.battle).find(
      (enemy) => enemy.enemyId === "AI-W2",
    );
    assert.equal(boss.damage, 317);
    assert.equal(boss.maxHealth, 3381);
    boss.health = 2000;
    boss.shield = 1;
    game.battle.paused = true;
    load(old, game);
    const previous = exactGame(old);
    assert(current.load(old.save()).ok);
    const after = exactGame(current);
    const updated = enemies(after.battle).find(
      (enemy) => enemy.enemyId === "AI-W2",
    );
    assert.equal(updated.damage, 257);
    assert.equal(updated.maxHealth, 3381);
    assert.equal(updated.health, 2000);
    assert.equal(updated.shield, 0);
    assert.equal(after.config.battle.attacksAlwaysHit, true);
    const comparable = structuredClone(after);
    comparable.config = previous.config;
    enemies(comparable.battle).find(
      (enemy) => enemy.enemyId === "AI-W2",
    ).damage = 317;
    enemies(comparable.battle).find(
      (enemy) => enemy.enemyId === "AI-W2",
    ).shield = 1;
    assert.deepEqual(stable(comparable), stable(previous));
    assert(current.load(current.save()).ok);
    assert.deepEqual(stable(exactGame(current)), stable(after));
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Player and enemy attacks never miss even when accuracy is 1 and evasion is 80", async () => {
  const template = await army();
  const rules = structuredClone(config);
  for (const unit of rules.units) {
    unit.accuracy = 1;
    unit.evasion = 80;
    unit.detection = 0;
  }
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  try {
    const game = exactGame(template);
    game.config = rules;
    load(engine, game);
    const id = engine
      .getState()
      .units.find((unit) => unit.type === "heavy_infantry").id;
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { unitIds: [id], automatic: true },
      }).ok,
    );
    const battle = exactGame(engine);
    for (const fighter of battle.battle.fighters) {
      fighter.health = fighter.maxHealth = 10000;
      fighter.damage = 10;
      fighter.defense = 0;
      fighter.shield = 0;
    }
    load(engine, battle);
    const sides = new Set();
    for (let step = 0; step < 400; step++) {
      assert(engine.tick(250).ok);
      const active = engine.getState().battle;
      for (const hit of active.lastAttacks) {
        assert.equal(hit.missed, false);
        assert(hit.damage > 0);
        sides.add(
          active.fighters.find((fighter) => fighter.id === hit.attacker).enemy,
        );
      }
      if (active.actions >= 90) break;
    }
    assert(engine.getState().battle.actions >= 90);
    assert.equal(sides.size, 2);
    assert(engine.load(engine.save()).ok);
  } finally {
    template.dispose();
    engine.dispose();
  }
});

function beforeShieldRemoval() {
  const prior = structuredClone(config);
  delete prior.campaignShieldRulesVersion;
  for (const level of prior.campaign.levels)
    for (const round of level.rounds) delete round.unshieldedEnemies;
  return prior;
}

test("Only level 58 AI-W2 starts without a shield; other enemies and player shield capacities stay unchanged", async () => {
  const old = await army(beforeShieldRemoval());
  const current = await army();
  try {
    const oldTemplate = exactGame(old);
    const currentTemplate = exactGame(current);
    for (const engine of [old, current]) {
      start(
        engine,
        config.campaign.levels.find((level) => level.battleId === 58),
      );
      advanceRound(engine);
    }
    const before = old.getState().battle;
    const after = current.getState().battle;
    const previousBoss = enemies(before).find((f) => f.enemyId === "AI-W2");
    const boss = enemies(after).find((f) => f.enemyId === "AI-W2");
    assert.equal(previousBoss.shield, 3381);
    assert.equal(previousBoss.maxShield, 3381);
    assert.equal(boss.shield, 0);
    assert.equal(boss.maxShield, 0);
    assert.equal(boss.maxHealth, 3381);
    assert.equal(boss.damage, 257);
    const expected = structuredClone(before);
    const expectedBoss = enemies(expected).find((f) => f.enemyId === "AI-W2");
    expectedBoss.shield = expectedBoss.maxShield = 0;
    assert.deepEqual(after, expected);
    assert(engineShield(current, "attack_submarine") > 0);
    load(old, oldTemplate);
    load(current, currentTemplate);
    for (const engine of [old, current]) {
      start(
        engine,
        config.campaign.levels.find((level) => level.battleId === 59),
      );
      advanceRound(engine);
    }
    assert.deepEqual(current.getState().battle, old.getState().battle);
    assert(
      enemies(current.getState().battle)
        .filter((f) => f.enemyId === "W06")
        .every((f) => f.shield > 0 && f.maxShield > 0),
    );
  } finally {
    old.dispose();
    current.dispose();
  }
});
function engineShield(engine, type) {
  return engine.getState().unitCatalog.find((unit) => unit.id === type)
    .effectiveShield;
}

test("Loading an existing level 58 battle removes only AI-W2 shield and cannot restore it on another reload", async () => {
  const old = await army(beforeShieldRemoval());
  const current = await army();
  try {
    start(
      old,
      config.campaign.levels.find((level) => level.battleId === 58),
    );
    advanceRound(old);
    const game = exactGame(old);
    const boss = enemies(game.battle).find((f) => f.enemyId === "AI-W2");
    boss.health = 2000;
    boss.shield = 1234;
    boss.attacked = true;
    boss.strikes = 3;
    boss.readyRound = game.battle.round + 1;
    game.battle.paused = true;
    load(old, game);
    const before = exactGame(old);
    const result = current.load(old.save());
    assert(result.ok, result.message);
    const after = exactGame(current);
    const updated = enemies(after.battle).find((f) => f.enemyId === "AI-W2");
    assert.equal(updated.shield, 0);
    assert.equal(updated.health, 2000);
    assert.equal(updated.maxHealth, 3381);
    assert.equal(updated.damage, 257);
    assert.equal(
      current.getState().battle.fighters.find((f) => f.enemyId === "AI-W2")
        .maxShield,
      0,
    );
    const comparable = structuredClone(after);
    comparable.config = before.config;
    enemies(comparable.battle).find((f) => f.enemyId === "AI-W2").shield = 1234;
    assert.deepEqual(stable(comparable), stable(before));
    assert(current.load(current.save()).ok);
    assert.deepEqual(stable(exactGame(current)), stable(after));
    const forged = exactGame(current);
    enemies(forged.battle).find((f) => f.enemyId === "AI-W2").shield = 1;
    assert.equal(current.load(pack(forged)).ok, false);
    assert.deepEqual(stable(exactGame(current)), stable(after));
  } finally {
    old.dispose();
    current.dispose();
  }
});
