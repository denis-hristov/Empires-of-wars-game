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
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
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

test("WASM exposes carrier capacity and damage from cargo, with no duplicate aircraft actions", async () => {
  const e = await army();
  try {
    const units = e.getState().units;
    const carrier = units.find((u) => u.type === "titan_carrier");
    const jet = units.find((u) => u.type === "jet_fighter");
    send(e, "EMBARK_AIRCRAFT", { id: jet.id, carrier: carrier.id });
    const loaded = e.getState().units.find((u) => u.id === carrier.id);
    assert.equal(loaded.carrierSlots, 5);
    assert.equal(loaded.damageByDomain.air, loaded.damageByDomain.naval);
    const b = send(e, "BATTLE_START", { unitIds: [carrier.id] }).battle;
    const actor = b.fighters.find((u) => u.id === carrier.id);
    assert.equal(actor.damage, loaded.damage);
    assert.equal(actor.aircraftCount, 2);
    assert(
      b.fighters
        .filter((f) => f.carrier)
        .every((f) => f.validTargets.length === 0),
    );
    const target = b.fighters.find((f) => f.enemy && f.domain === "naval");
    const next = send(e, "BATTLE_ATTACK", {
      id: carrier.id,
      target: target.id,
    }).battle;
    assert.equal(next.lastAttacks.length, 1);
    assert.equal(
      next.lastAttacks[0].damage + next.lastAttacks[0].shieldDamage,
      target.shield > 0
        ? Math.min(actor.damageByDomain.naval, target.shield)
        : Math.min(actor.damageByDomain.naval, target.health),
    );
    assert(next.enemyTurn || next.finished);
    const saved = e.save();
    assert(e.load(saved).ok);
    assert.deepEqual(
      e.getState().battle.fighters.find((u) => u.id === carrier.id)
        .damageByDomain,
      actor.damageByDomain,
    );
  } finally {
    e.dispose();
  }
});

test("WASM Drone keeps its second attack after save and reload, then changes turns", async () => {
  const e = await army();
  try {
    const game = exactGame(e);
    const home = game.units.find((u) => u.type === "phantom_bomber");
    home.type = "combat_drone";
    home.health = config.units.find((u) => u.id === "combat_drone").health;
    load(e, game);
    send(e, "BATTLE_START", { unitIds: [String(home.id)] });
    const combat = exactGame(e);
    for (const f of combat.battle.fighters)
      if (f.enemy) {
        f.health = f.maxHealth = 10000;
        f.shield = f.defense = 0;
      }
    load(e, combat);
    const actor = e.getState().battle.fighters.find((f) => !f.enemy);
    assert.equal(actor.attacksRemaining, 2);
    const after = send(e, "BATTLE_ATTACK", {
      id: actor.id,
      target: actor.validTargets[0],
    }).battle;
    assert.equal(
      after.fighters.find((f) => f.id === actor.id).attacksRemaining,
      1,
    );
    assert.equal(after.enemyTurn, false);
    assert(e.load(e.save()).ok);
    const ready = e.getState().battle.fighters.find((f) => f.id === actor.id);
    assert.equal(ready.attacksRemaining, 1);
    const done = send(e, "BATTLE_ATTACK", {
      id: actor.id,
      target: ready.validTargets.at(-1),
    }).battle;
    assert.equal(
      done.fighters.find((f) => f.id === actor.id).attacksRemaining,
      0,
    );
    assert(done.enemyTurn);
    assert.equal(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: actor.id, target: ready.validTargets[0] },
      }).ok,
      false,
    );
  } finally {
    e.dispose();
  }
});

test("WASM missile hits every enemy at full or half damage despite distance", async () => {
  const rules = structuredClone(config);
  rules.battle.enemies = 5;
  const e = await GameEngine.create({ factory, config: rules, wasmBinary });
  try {
    // Start with the standard fixture, then retain its exact map while selecting five targets.
    const source = await army();
    const game = exactGame(source);
    source.dispose();
    game.config = rules;
    load(e, game);
    const missile = e
      .getState()
      .units.find((u) => u.type === "missile_launcher");
    send(e, "BATTLE_START", { unitIds: [missile.id] });
    const combat = exactGame(e);
    let index = 0;
    for (const f of combat.battle.fighters)
      if (f.enemy) {
        f.health = f.maxHealth = 10000;
        f.shield = f.defense = 0;
        f.position = [7, index++];
      }
    load(e, combat);
    const actor = e.getState().battle.fighters.find((f) => !f.enemy);
    const b = send(e, "BATTLE_ATTACK", {
      id: actor.id,
      target: actor.validTargets[0],
    }).battle;
    assert.equal(b.lastAttacks.length, 5);
    assert.equal(b.lastAttacks[0].damage, actor.damage);
    assert(
      b.lastAttacks
        .slice(1)
        .every((hit) => hit.damage === Math.floor(actor.damage / 2)),
    );
  } finally {
    e.dispose();
  }
});
