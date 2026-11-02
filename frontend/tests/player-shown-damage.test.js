import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { researchUnitDefinition } from "../src/game/BuildingProgression.js";
import { unitAbilityDetails } from "../src/game/BattlePresentation.js";

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
const navalEnemies = (battle) =>
  enemies(battle).filter(
    (fighter) => fighter.domain === "naval" && fighter.phase === "naval",
  );
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
  const academy = game.buildings.find((building) => building.type === "house");
  academy.type = "academy";
  academy.level = 10;
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
      currentLevel: level,
      completedLevels: Array.from(
        { length: level - 1 },
        (_, index) => index + 1,
      ),
      completed: false,
    };
    load(engine, game);
  }
  const result = engine.dispatch({
    type: "BATTLE_START",
    payload: {
      unitIds: game.units
        .filter((unit) => level || unit.id === 40)
        .map((unit) => String(unit.id)),
      ...(level ? { campaignLevel: level } : {}),
      automatic: false,
    },
  });
  assert(result.ok, result.message);
}
function attack(engine, id, target) {
  const result = engine.dispatch({
    type: "BATTLE_ATTACK",
    payload: { id, target },
  });
  assert(result.ok, result.message);
}
function stable(game) {
  delete game.config;
  delete game.savedAtUTC;
  return game;
}

test("The real G04 and G05 at level 59 take the researched Attack shown in Barracks and Academy", async () => {
  const engine = await army();
  try {
    const game = exactGame(engine);
    game.researchLevels.light_tank = 3;
    load(engine, game);
    start(engine, 59);
    const before = engine.save();
    const state = engine.getState();
    const actor = allies(state.battle)[0];
    const card = researchUnitDefinition(state, definition(actor.type));
    assert.equal(card.damage, actor.damage);
    assert.equal(actor.damage, 127);
    const option = state.buildings
      .find((building) => building.type === "academy")
      .researchOptions.find((option) => option.type === actor.type);
    assert.equal(option.currentDamage, actor.damage);
    assert.equal(option.nextDamage, 133);
    assert.equal(card.damageMatchesAttack, true);
    assert.match(
      unitAbilityDetails(card).join(" "),
      /direct hit deals the shown Attack/,
    );
    for (const [enemyId, health, damage] of [
      ["G04", 426, 57],
      ["G05", 621, 95],
    ]) {
      assert(engine.load(before).ok);
      const target = enemies(engine.getState().battle).find(
        (foe) => foe.enemyId === enemyId,
      );
      assert.equal(target.health, health);
      assert.equal(target.damage, damage);
      attack(engine, actor.id, target.id);
      const after = engine.getState().battle;
      assert.equal(after.lastAttacks[0].damage, actor.damage);
      assert.equal(
        after.fighters.find((foe) => foe.id === target.id).health,
        health - actor.damage,
      );
    }
  } finally {
    engine.dispose();
  }
});

test("Every researched ship deals its displayed Attack through enemy armor, with shields and remaining HP respected", async () => {
  for (const ship of config.units.filter(
    (unit) => unit.domain === "naval" && !unit.carrierSlots,
  )) {
    const engine = await army();
    try {
      const game = exactGame(engine);
      game.units.find((unit) => unit.id === 40).type = ship.id;
      game.units.find((unit) => unit.id === 40).health = ship.health;
      game.researchLevels[ship.id] = Math.min(3, 11 - ship.level);
      load(engine, game);
      start(engine);
      const prepared = exactGame(engine);
      for (const target of navalEnemies(prepared.battle)) {
        target.type = "ship";
        target.health = target.maxHealth = 5000;
        target.defense = 9999;
        target.shield = 0;
      }
      load(engine, prepared);
      const snapshot = engine.save();
      const state = engine.getState();
      const actor = allies(state.battle)[0];
      const card = researchUnitDefinition(state, ship);
      assert.equal(actor.damage, card.damage, ship.id);
      const target = navalEnemies(state.battle)[0];
      attack(engine, actor.id, target.id);
      assert.equal(
        engine.getState().battle.lastAttacks[0].damage,
        card.damage,
        ship.id,
      );
      assert(engine.load(snapshot).ok);
      const shielded = exactGame(engine);
      navalEnemies(shielded.battle)[0].type = "titan_carrier";
      navalEnemies(shielded.battle)[0].shield = 1;
      load(engine, shielded);
      attack(engine, actor.id, target.id);
      let hit = engine.getState().battle.lastAttacks[0];
      assert.equal(hit.damage, 0, ship.id);
      assert.equal(hit.shieldDamage, 1, ship.id);
      assert(engine.load(snapshot).ok);
      const wounded = exactGame(engine);
      navalEnemies(wounded.battle)[0].health = 3;
      load(engine, wounded);
      attack(engine, actor.id, target.id);
      hit = engine.getState().battle.lastAttacks[0];
      assert.equal(hit.damage, 3, ship.id);
      assert.equal(
        engine.getState().battle.fighters.find((foe) => foe.id === target.id)
          .health,
        0,
      );
    } finally {
      engine.dispose();
    }
  }
});

test("Old player damage rules migrate without changing wounds, shields, prior hits, turns or campaign progress", async () => {
  for (const previous of [undefined, false]) {
    const prior = structuredClone(config);
    if (previous === undefined) delete prior.battle.playerDamageMatchesAttack;
    else prior.battle.playerDamageMatchesAttack = previous;
    const old = await army(prior),
      current = await army();
    try {
      start(old, 59);
      const before = old.getState().battle;
      const actor = allies(before)[0];
      const target = enemies(before).find((foe) => foe.enemyId === "G04");
      attack(old, actor.id, target.id);
      const wounded = exactGame(old);
      allies(wounded.battle)[0].health -= 17;
      wounded.battle.paused = true;
      load(old, wounded);
      const historical = exactGame(old);
      const loaded = current.load(old.save());
      assert(loaded.ok, loaded.message);
      assert.equal(
        exactGame(current).config.battle.playerDamageMatchesAttack,
        true,
      );
      assert.deepEqual(
        stable(exactGame(current)),
        stable(structuredClone(historical)),
      );
      const saved = current.save();
      assert(current.load(saved).ok);
      assert.deepEqual(
        stable(exactGame(current)),
        stable(structuredClone(historical)),
      );
      const next = exactGame(current);
      const nextActor = allies(next.battle)[0];
      nextActor.attacked = false;
      nextActor.readyRound = next.battle.round;
      next.battle.enemyTurn = false;
      next.battle.paused = false;
      load(current, next);
      const other = enemies(current.getState().battle).find(
        (foe) => foe.enemyId === "G05",
      );
      attack(current, String(nextActor.id), other.id);
      assert.equal(
        current.getState().battle.lastAttacks[0].damage,
        nextActor.damage,
      );
      const unchanged = stable(exactGame(current));
      const malformed = exactGame(old);
      malformed.config.battle.playerDamageMatchesAttack = "yes";
      assert.equal(current.load(pack(malformed)).ok, false);
      assert.deepEqual(stable(exactGame(current)), unchanged);
      const forged = exactGame(old);
      forged.config.units[0].damage++;
      assert.equal(current.load(pack(forged)).ok, false);
      assert.deepEqual(stable(exactGame(current)), unchanged);
    } finally {
      old.dispose();
      current.dispose();
    }
  }
});
