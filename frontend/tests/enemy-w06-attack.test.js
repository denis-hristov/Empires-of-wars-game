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
    [40, "battleship"],
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
  delete prior.enemySubmarineMultiplierVersion;
  delete prior.campaign.enemies.find((e) => e.id === "W06").damageMultipliers;
  return prior;
}
function stable(game) {
  delete game.savedAtUTC;
  return game;
}
function naval76(engine, armor = 0) {
  start(engine, config.campaign.levels[75]);
  assert.equal(
    enemies(engine.getState().battle).find((f) => f.enemyId === "AI-G5").damage,
    245,
  );
  advanceRound(engine);
  const game = exactGame(engine);
  assert.equal(game.battle.domain, "naval");
  const target = allies(game.battle)[0];
  assert.equal(target.type, "battleship");
  for (const f of [...game.battle.campaignArmy, ...allies(game.battle)]) {
    if (f.id !== target.id) continue;
    f.health = f.maxHealth = 10000;
    f.damage = 1;
    f.defense = armor;
    f.shield = 0;
    f.attacked = true;
  }
  for (const f of enemies(game.battle)) {
    if (f.enemyId !== "W06") f.health = f.shield = 0;
    f.attacked = false;
  }
  Object.assign(game.battle, {
    automatic: false,
    paused: false,
    enemyTurn: true,
    pendingMs: 0,
    animationMs: 0,
    lastAttacks: [],
  });
  load(engine, game);
  return target.id;
}
function hit(engine) {
  for (let i = 0; i < 4; i++) assert(engine.tick(250).ok);
}

test("Level 76 W06 retains 1045 HP and 225 Attack but no longer deals 495 damage to a large ship", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    const oldId = naval76(old);
    const id = naval76(current);
    const before = exactGame(old);
    const after = exactGame(current);
    before.config = after.config;
    assert.deepEqual(stable(after), stable(before));
    const submarine = enemies(after.battle).find((f) => f.enemyId === "W06");
    assert.equal(submarine.damage, 225);
    assert.equal(submarine.maxHealth, 1045);
    hit(old);
    hit(current);
    assert.equal(old.getState().battle.lastAttacks[0].damage, 495);
    assert.equal(current.getState().battle.lastAttacks[0].damage, 225);
    assert.equal(
      old.getState().battle.fighters.find((f) => f.id === String(oldId)).health,
      9505,
    );
    assert.equal(
      current.getState().battle.fighters.find((f) => f.id === String(id))
        .health,
      9775,
    );
    assert(current.load(current.save()).ok);
    assert.equal(current.getState().battle.lastAttacks[0].damage, 225);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("An existing W06 battle keeps wounds, shields and hit history while future hits ignore removed player Armor", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    const id = naval76(old, 50);
    const game = exactGame(old);
    const target = allies(game.battle).find((f) => f.id === id);
    const submarine = enemies(game.battle).find((f) => f.enemyId === "W06");
    target.health -= 475;
    submarine.health = 1000;
    submarine.shield = 17;
    submarine.strikes = 1;
    game.battle.actions++;
    game.battle.round = 3;
    game.battle.lastAttacks = [
      {
        attacker: submarine.id,
        target: id,
        damage: 475,
        shieldDamage: 0,
        missed: false,
        healing: 0,
      },
    ];
    load(old, game);
    const previous = exactGame(old);
    const result = current.load(old.save());
    assert(result.ok, result.message);
    const migrated = exactGame(current);
    const expected = structuredClone(previous);
    expected.config = migrated.config;
    assert.deepEqual(stable(migrated), stable(expected));
    for (let i = 0; i < 3; i++) {
      assert(current.load(current.save()).ok);
      assert.deepEqual(stable(exactGame(current)), stable(migrated));
    }
    hit(current);
    assert.equal(current.getState().battle.lastAttacks[0].damage, 225);
    assert.equal(
      current.getState().battle.fighters.find((f) => f.id === String(id))
        .health,
      9300,
    );
    const foe = current
      .getState()
      .battle.fighters.find((f) => f.enemyId === "W06");
    assert.equal(foe.damage, 225);
    assert.equal(foe.health, 1000);
    assert.equal(foe.shield, 17);
    assert(current.load(current.save()).ok);
    const unchanged = stable(exactGame(current));
    const forged = exactGame(old);
    forged.config.units.find((u) => u.id === "attack_submarine").damage++;
    assert.equal(current.load(pack(forged)).ok, false);
    assert.deepEqual(stable(exactGame(current)), unchanged);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("The correction applies to all 70 W06 slots across 58 levels without changing the submarine template", () => {
  assert.deepEqual(
    config.campaign.enemies
      .filter((e) => e.damageMultipliers === false)
      .map((e) => e.id),
    ["W06"],
  );
  const positions = config.campaign.levels.flatMap((level) =>
    level.rounds.flatMap((round) =>
      round.enemies.filter((id) => id === "W06").map(() => level.battleId),
    ),
  );
  assert.equal(positions.length, 70);
  assert.equal(new Set(positions).size, 58);
  const submarine = definition("attack_submarine");
  assert.deepEqual(submarine.damageMultipliers, { large: 220, armored: 150 });
  assert.equal(submarine.armorPenetration, 60);
  assert.equal(submarine.attackCooldown, 1);
});

test("Invalid multiplier flags and unsupported migration versions are rejected", async () => {
  for (const value of [0, 1, "false", {}]) {
    const invalid = structuredClone(config);
    invalid.campaign.enemies.find((e) => e.id === "W06").damageMultipliers =
      value;
    await assert.rejects(() => army(invalid));
  }
  const unsupported = structuredClone(config);
  unsupported.enemySubmarineMultiplierVersion = 2;
  await assert.rejects(() => army(unsupported));
});
