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

function previousRules() {
  const prior = structuredClone(config);
  delete prior.eliteArmyVersion;
  delete prior.academyPricingVersion;
  delete prior.research.additionalLevelCostPercent;
  const baseline = { stealth_cruiser: 230, plasma_tank: 180, titan_mech: 225 };
  for (const u of prior.units) {
    if (baseline[u.id]) {
      u.damage = baseline[u.id];
      delete u.enemyBaseDamage;
    }
    if (u.id === "titan_mech")
      u.abilities = ["energy_shield", "periodic_burst"];
    if (u.id === "stealth_cruiser") u.abilities = ["stealth"];
    if (u.id === "phantom_bomber")
      u.abilities = ["area_attack", "stealth", "surface_strike"];
    if (u.id === "plasma_fighter") {
      u.abilities = ["energy_shield", "attack_all_air"];
      u.splashTargets = 0;
      u.splashPercent = 40;
      u.role = "Shielded fighter that attacks every opposing aircraft";
    }
  }
  return prior;
}
async function unitArmy(type, rank = 0) {
  const e = await army();
  const game = exactGame(e);
  const d = config.units.find((u) => u.id === type);
  const id = { land: 45, naval: 40, air: 47 }[d.domain];
  game.units = game.units.filter((u) => u.id === id);
  const home = game.units[0];
  home.type = type;
  home.carrier = null;
  home.reserve = false;
  home.health = Math.floor((d.health * 21 ** rank) / 20 ** rank);
  game.researchLevels = { [type]: rank };
  const academy = game.buildings.find((b) => b.type === "house");
  academy.type = "academy";
  academy.level = 10;
  load(e, game);
  return { e, id: String(id) };
}
function durable(e) {
  const game = exactGame(e);
  for (const f of game.battle.fighters)
    if (f.enemy) {
      f.health = f.maxHealth = 10000;
      f.shield = f.defense = 0;
      f.damage = 1;
    }
  load(e, game);
}

test("Elite unit cards and combat expose the increased base attacks and researched damage", async () => {
  for (const [type, base] of [
    ["stealth_cruiser", 345],
    ["plasma_tank", 360],
    ["titan_mech", 506],
  ]) {
    const { e, id } = await unitArmy(type, 2);
    try {
      const unit = e.getState().unitCatalog.find((u) => u.id === type);
      assert.equal(unit.damage, base);
      assert.equal(
        unit.effectiveDamage,
        Math.floor((base * 21 ** 2) / 20 ** 2),
      );
      send(e, "BATTLE_START", { unitIds: [id] });
      durable(e);
      const b = e.getState().battle;
      const actor = b.fighters.find((f) => f.id === id);
      const target = actor.validTargets[0];
      const next = send(e, "BATTLE_ATTACK", { id, target }).battle;
      assert.equal(next.lastAttacks[0].damage, actor.damage);
      if (type === "titan_mech")
        assert.equal(
          next.fighters.find((f) => f.id === id).attacksRemaining,
          1,
        );
    } finally {
      e.dispose();
    }
  }
});

test("WASM stuns the enemy that hits a retaliating unit and preserves its skipped next turn", async () => {
  for (const type of ["stealth_cruiser", "phantom_bomber"]) {
    const { e, id } = await unitArmy(type);
    try {
      send(e, "BATTLE_START", { unitIds: [id] });
      durable(e);
      const before = e.getState().battle,
        actor = before.fighters.find((f) => f.id === id);
      const outgoing = send(e, "BATTLE_ATTACK", {
        id,
        target: actor.validTargets[0],
      }).battle;
      assert(outgoing.lastAttacks.every((h) => !h.stunTurns));
      for (let i = 0; i < 8; i++) assert(e.tick(250).ok);
      const reflected = e.getState().battle;
      assert.equal(reflected.round, 2);
      assert(reflected.lastAttacks[0].attackerStunned);
      assert.equal(reflected.lastAttacks[0].stunTurns, 1);
      assert(
        reflected.fighters
          .filter((f) => f.enemy)
          .every(
            (f) =>
              f.stunnedUntilRound === 2 &&
              f.readyRound === 3 &&
              f.strikes === 1,
          ),
      );
      assert(e.load(e.save()).ok);
      const ready = e.getState().battle.fighters.find((f) => f.id === id);
      const skipped = send(e, "BATTLE_ATTACK", {
        id,
        target: ready.validTargets[0],
      }).battle;
      assert.equal(skipped.round, 3);
      assert(
        skipped.fighters.filter((f) => f.enemy).every((f) => f.strikes === 1),
      );
    } finally {
      e.dispose();
    }
  }
});
test("Academy9 quotes comparable late-game prices and charges exactly the new Plasma Tank cost", async () => {
  const { e } = await unitArmy("plasma_tank");
  try {
    const game = exactGame(e);
    const a = game.buildings.find((b) => b.type === "academy");
    a.level = 9;
    game.researchLevels = { infantry_squad: 10 };
    load(e, game);
    const academy = e.getState().buildings.find((b) => b.type === "academy");
    const plasma = academy.researchOptions.find(
      (o) => o.type === "plasma_tank",
    );
    const infantry = academy.researchOptions.find(
      (o) => o.type === "infantry_squad",
    );
    assert.deepEqual(plasma.cost, {
      food: 3120,
      wood: 10400,
      stone: 4160,
      iron: 1690,
    });
    assert.deepEqual(infantry.cost, {
      food: 3600,
      wood: 12000,
      stone: 4800,
      iron: 1950,
    });
    const stock = e.getState().stock;
    send(e, "RESEARCH", { id: academy.id, unitType: "plasma_tank" });
    assert.deepEqual(
      e.getState().stock,
      stock.map(
        (value, i) =>
          value -
          (plasma.cost[["food", "wood", "stone", "iron", "coins"][i]] ?? 0),
      ),
    );
    const paid = e.getState().stock;
    assert(e.load(e.save()).ok);
    assert.deepEqual(e.getState().stock, paid);
  } finally {
    e.dispose();
  }
});

test("New elite rules migrate old active battles once without changing wounds, shields, history or paid research", async () => {
  const old = await army(previousRules());
  const current = await army();
  try {
    const game = exactGame(old);
    const home = game.units.find((u) => u.id === 45);
    home.type = "titan_mech";
    home.health = 850;
    const a = game.buildings.find((b) => b.type === "house");
    a.type = "academy";
    a.level = 10;
    load(old, game);
    send(old, "RESEARCH", { id: String(a.id), unitType: "infantry_squad" });
    send(old, "BATTLE_START", { unitIds: ["45", "46"] });
    durable(old);
    send(old, "BATTLE_ATTACK", {
      id: "45",
      target: old.getState().battle.fighters.find((f) => f.id === "45")
        .validTargets[0],
    });
    const wounded = exactGame(old);
    const f = wounded.battle.fighters.find((f) => f.id === 45);
    f.health -= 17;
    f.shield -= 11;
    load(old, wounded);
    const before = exactGame(old);
    assert(current.load(old.save()).ok);
    const migrated = exactGame(current);
    const titan = migrated.battle.fighters.find((f) => f.id === 45);
    assert.equal(titan.damage, f.damage + 506 - 225);
    assert.equal(titan.health, f.health);
    assert.equal(titan.shield, f.shield);
    assert(titan.attacked);
    assert.deepEqual(migrated.stock, before.stock);
    assert.deepEqual(migrated.research, before.research);
    assert.deepEqual(migrated.battle.lastAttacks, before.battle.lastAttacks);
    assert.deepEqual(
      migrated.battle.fighters.filter((f) => f.enemy),
      before.battle.fighters.filter((f) => f.enemy),
    );
    assert(current.load(current.save()).ok);
    assert.equal(
      exactGame(current).battle.fighters.find((f) => f.id === 45).damage,
      titan.damage,
    );
    const forged = exactGame(old);
    forged.config.units.find((u) => u.id === "titan_mech").damage = 226;
    assert.equal(current.load(pack(forged)).ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});
