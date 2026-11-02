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
async function army(rules = config) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  const result = engine.load(fixture);
  assert(result.ok, result.message);
  return engine;
}
function exactGame(engine) {
  return JSON.parse(
    engine
      .save()
      .replace(
        /("(?:id|attacker|target|carrier)"\s*:\s*)(\d{16,})/g,
        '$1"__id_$2"',
      ),
  ).game;
}
function pack(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  const bytes = JSON.stringify(canonical(value)).replace(/"__id_(\d+)"/g, "$1");
  let checksum = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    checksum = BigInt.asUintN(64, (checksum ^ BigInt(byte)) * 1099511628211n);
  return `{"checksum":"${checksum.toString(16)}","game":${bytes}}`;
}
function load(engine, game) {
  const result = engine.load(pack(game));
  assert(result.ok, result.message);
}
const send = (engine, type, payload = {}) => {
  const result = engine.dispatch({ type, payload });
  assert(result.ok, result.message);
  return engine.getState();
};

async function readyArmy(type, rules = config) {
  const e = await army(rules),
    game = exactGame(e),
    d = config.units.find((u) => u.id === type);
  const id = { land: 45, naval: 40, air: 47 }[d.domain];
  game.units = game.units.filter((u) => u.id === id);
  Object.assign(game.units[0], {
    type,
    health: d.health,
    carrier: null,
    reserve: false,
  });
  load(e, game);
  send(e, "BATTLE_START", { unitIds: [String(id)] });
  const combat = exactGame(e);
  combat.battle.enemyTurn = true;
  combat.battle.pendingMs = 0;
  const victim = combat.battle.fighters.find((f) => !f.enemy);
  Object.assign(victim, {
    health: 10000,
    maxHealth: 10000,
    shield: 0,
    potionShield: 0,
    defense: 80,
    attacked: true,
  });
  const enemies = combat.battle.fighters.filter((f) => f.enemy);
  for (const f of enemies) f.attacked = true;
  const attacker = enemies[0];
  Object.assign(attacker, {
    type: { land: "infantry_squad", naval: "ship", air: "aircraft" }[d.domain],
    domain: d.domain,
    damage: 200,
    shield: 0,
    attacked: false,
  });
  load(e, combat);
  return { e, id: String(id), attacker: attacker.id };
}
function enemyHit(e) {
  for (let i = 0; i < 4; ++i) assert(e.tick(250).ok);
  return e.getState().battle;
}
function nextEnemy(e) {
  const g = exactGame(e);
  g.battle.enemyTurn = true;
  g.battle.pendingMs = 0;
  let first = true;
  for (const f of g.battle.fighters) {
    f.attacked = true;
    if (f.enemy && first) {
      f.attacked = false;
      f.readyRound = g.battle.round;
      first = false;
    }
  }
  load(e, g);
}
test("Player troops take enemy damage without an Armor reduction in all three arenas", async () => {
  for (const type of ["plasma_tank", "stealth_cruiser", "combat_drone"]) {
    const { e, id } = await readyArmy(type);
    try {
      const b = enemyHit(e);
      assert.equal(b.lastAttacks[0].damage, 200);
      assert.equal(b.fighters.find((f) => f.id === id).health, 9800);
    } finally {
      e.dispose();
    }
  }
});
test("Removing Armor preserves the complete protection of natural and potion shields", async () => {
  const { e, id } = await readyArmy("plasma_tank");
  try {
    const g = exactGame(e);
    const victim = g.battle.fighters.find((f) => f.id === Number(id));
    victim.shield = 1;
    victim.potionShield = 1;
    load(e, g);
    const potion = enemyHit(e);
    assert.equal(potion.lastAttacks[0].damage, 0);
    assert.equal(potion.fighters.find((f) => f.id === id).shield, 1);
    nextEnemy(e);
    const shield = enemyHit(e);
    assert.equal(shield.lastAttacks[0].damage, 0);
    assert.equal(shield.lastAttacks[0].shieldDamage, 1);
    nextEnemy(e);
    const unshielded = enemyHit(e);
    assert.equal(unshielded.lastAttacks[0].damage, 200);
    assert.equal(unshielded.fighters.find((f) => f.id === id).health, 9800);
  } finally {
    e.dispose();
  }
});
test("Old active Armor saves keep wounds and hit history, while future hits follow the new rules", async () => {
  for (const explicit of [false, true]) {
    const prior = structuredClone(config);
    if (explicit) prior.battle.playerArmorEnabled = true;
    else delete prior.battle.playerArmorEnabled;
    const { e: old, id } = await readyArmy("plasma_tank", prior);
    const current = await army();
    try {
      const historicalHit = enemyHit(old);
      assert.equal(historicalHit.lastAttacks[0].damage, 120);
      const historical = exactGame(old);
      const r = current.load(old.save());
      assert(r.ok, r.message);
      const migrated = exactGame(current);
      for (const key of [
        "battle",
        "stock",
        "research",
        "researchLevels",
        "campaign",
      ])
        assert.deepEqual(migrated[key], historical[key]);
      assert.equal(migrated.config.battle.playerArmorEnabled, false);
      assert(current.load(current.save()).ok);
      nextEnemy(current);
      const next = enemyHit(current);
      assert.equal(next.lastAttacks[0].damage, 200);
      assert.equal(next.fighters.find((f) => f.id === id).health, 9680);
      const stable = current.getState(),
        invalid = exactGame(old);
      invalid.config.battle.playerArmorEnabled = "false";
      assert.equal(current.load(pack(invalid)).ok, false);
      assert.deepEqual(current.getState(), stable);
    } finally {
      old.dispose();
      current.dispose();
    }
  }
});
