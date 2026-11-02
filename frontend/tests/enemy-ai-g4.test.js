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

test("Level 54 AI-G4 loses its attack bonuses in an existing save without changing the battle state", async () => {
  const prior = structuredClone(config);
  delete prior.enemyAttackBonusesVersion;
  delete prior.campaign.enemies.find((enemy) => enemy.id === "AI-G4")
    .attackBonuses;
  const old = await army(prior);
  const current = await army();
  try {
    start(
      old,
      config.campaign.levels.find((level) => level.battleId === 54),
    );
    const game = exactGame(old);
    const target = allies(game.battle)[0];
    const definition = config.units.find((unit) => unit.id === "light_tank");
    const home = game.units.find((unit) => unit.id === target.id);
    Object.assign(home, {
      type: definition.id,
      health: definition.health,
      reserve: false,
    });
    for (const fighter of [
      target,
      game.battle.campaignArmy.find((fighter) => fighter.id === target.id),
    ]) {
      Object.assign(fighter, {
        type: definition.id,
        health: definition.health,
        maxHealth: definition.health,
        damage: definition.damage,
        defense: definition.defense,
        range: definition.range,
        movement: definition.movement,
        shield: 0,
      });
    }
    for (const foe of enemies(game.battle)) {
      if (foe.enemyId !== "AI-G4") foe.health = 0;
      foe.attacked = false;
    }
    game.battle.enemyTurn = true;
    game.battle.round = 2;
    game.battle.pendingMs = 0;
    game.battle.lastAttacks = [];
    load(old, game);
    assert(current.load(old.save()).ok);
    const before = exactGame(old);
    const after = exactGame(current);
    after.config = before.config;
    delete before.savedAtUTC;
    delete after.savedAtUTC;
    assert.deepEqual(after, before);
    const boss = enemies(current.getState().battle).find(
      (fighter) => fighter.enemyId === "AI-G4",
    );
    assert.equal(boss.damage, 199);
    assert.equal(boss.maxHealth, 3007);
    for (let step = 0; step < 4; step++) {
      const oldTurn = old.tick(250);
      assert(oldTurn.ok, oldTurn.message);
      const currentTurn = current.tick(250);
      assert(currentTurn.ok, currentTurn.message);
    }
    assert.equal(old.getState().battle.lastAttacks[0].damage, 288);
    assert.equal(current.getState().battle.lastAttacks[0].damage, 199);
    assert(current.load(current.save()).ok);
    assert.equal(current.getState().battle.lastAttacks[0].damage, 199);
    const forged = exactGame(old);
    forged.config.units.find((unit) => unit.id === "light_tank").damage++;
    assert.equal(current.load(pack(forged)).ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});
