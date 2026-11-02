import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import {
  previousCombatRules,
  exactCombatGame,
  loadCombatGame,
  naval81Case,
} from "./helpers/naval-case.js";
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
  const e = await GameEngine.create({ factory, config: rules, wasmBinary });
  const r = e.load(fixture);
  assert(r.ok, r.message);
  return e;
}
const tick = (e) => {
  for (let i = 0; i < 4; i++) assert(e.tick(250).ok);
};

test("Level81 three carriers with five jets regain their skipped actions and can attack W06 immediately after reload", async () => {
  const old = await army(previousCombatRules(config)),
    current = await army();
  try {
    const ids = naval81Case(old, config),
      before = old.getState().battle;
    assert.equal(
      before.fighters.find((f) => f.id === ids.submarine).health,
      1102,
    );
    assert.equal(
      before.fighters.find((f) => f.id === ids.submarine).damage,
      237,
    );
    for (const id of ids.carriers) {
      const f = before.fighters.find((f) => f.id === id);
      assert.equal(f.aircraftCount, 5);
      assert.equal(f.damageByDomain.naval, 0);
      assert.equal(f.damageByDomain.air, 4375);
      assert(f.attacked);
    }
    for (const id of ids.cruisers)
      assert(
        !before.fighters
          .find((f) => f.id === id)
          .validTargets.includes(ids.submarine),
      );
    const r = current.load(old.save());
    assert(r.ok, r.message);
    let b = current.getState().battle;
    assert.equal(b.actions, before.actions);
    assert.equal(b.round, 3);
    assert.deepEqual(b.lastAttacks, before.lastAttacks);
    for (const id of ids.carriers) {
      const f = b.fighters.find((f) => f.id === id);
      assert.equal(f.damageByDomain.naval, 4375);
      assert.equal(f.damageByDomain.air, 4375);
      assert(!f.attacked);
      assert(f.validTargets.includes(ids.submarine));
    }
    for (const id of ids.cruisers)
      assert(
        b.fighters
          .find((f) => f.id === id)
          .validTargets.includes(ids.submarine),
      );
    assert(current.load(current.save()).ok);
    assert(
      current.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids.carriers[0], target: ids.submarine },
      }).ok,
    );
    b = current.getState().battle;
    let sub = b.fighters.find((f) => f.id === ids.submarine);
    assert.equal(sub.shield, 0);
    assert.equal(sub.health, 1102);
    assert(
      current.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids.carriers[1], target: ids.submarine },
      }).ok,
    );
    sub = current
      .getState()
      .battle.fighters.find((f) => f.id === ids.submarine);
    assert.equal(sub.health, 0);
  } finally {
    old.dispose();
    current.dispose();
  }
});
test("Upgrading an old level81 battle preserves a Cruiser attack already spent and its historical stun log", async () => {
  const old = await army(previousCombatRules(config)),
    current = await army();
  try {
    const ids = naval81Case(old, config),
      a = old.getState().battle.fighters.find((f) => f.id === ids.cruisers[0]);
    assert(
      old.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: a.id, target: a.validTargets[0] },
      }).ok,
    );
    const before = exactCombatGame(old);
    assert(current.load(old.save()).ok);
    const after = exactCombatGame(current);
    assert.deepEqual(after.battle.lastAttacks, before.battle.lastAttacks);
    assert.equal(after.battle.actions, before.battle.actions);
    assert(after.battle.fighters.find((f) => f.id === Number(a.id)).attacked);
    assert(
      !current.getState().battle.fighters.find((f) => f.id === a.id)
        .validTargets.length,
    );
    assert.deepEqual(after.stock, before.stock);
    assert.deepEqual(after.campaign, before.campaign);
  } finally {
    old.dispose();
    current.dispose();
  }
});
test("Incoming hits and shield absorption stun attackers for their next turn without adding another combat action", async () => {
  for (const type of ["stealth_cruiser", "phantom_bomber"]) {
    const e = await army();
    try {
      const g = exactCombatGame(e),
        id = type === "stealth_cruiser" ? 40 : 47,
        d = config.units.find((d) => d.id === type);
      g.units = g.units.filter((u) => u.id === id);
      Object.assign(g.units[0], {
        type,
        health: d.health,
        carrier: null,
        reserve: false,
      });
      loadCombatGame(e, g);
      assert(
        e.dispatch({ type: "BATTLE_START", payload: { unitIds: [String(id)] } })
          .ok,
      );
      const b = exactCombatGame(e).battle;
      const full = exactCombatGame(e);
      full.battle.enemyTurn = true;
      full.battle.pendingMs = 0;
      const ally = full.battle.fighters.find((f) => !f.enemy);
      ally.potionShield = 1;
      ally.attacked = true;
      const enemies = full.battle.fighters.filter((f) => f.enemy);
      for (const f of enemies) f.attacked = true;
      enemies[0].attacked = false;
      loadCombatGame(e, full);
      tick(e);
      const result = e.getState().battle,
        last = result.lastAttacks[0],
        attacker = result.fighters.find((f) => f.id === last.attacker);
      assert.equal(last.damage, 0);
      assert.equal(last.stunTurns, 1);
      assert(last.attackerStunned);
      assert.equal(attacker.stunnedUntilRound, 2);
      assert(attacker.readyRound >= 3);
      assert.equal(result.actions, b.actions + 1);
      assert(
        !result.fighters.find((f) => f.id === String(id)).stunnedUntilRound,
      );
      assert(e.load(e.save()).ok);
    } finally {
      e.dispose();
    }
  }
});
