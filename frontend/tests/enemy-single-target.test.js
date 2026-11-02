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
const definition = (type) => config.units.find((unit) => unit.id === type);
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const friendlies = (battle) =>
  battle.fighters.filter((fighter) => !fighter.enemy);

// Keep unsigned 64-bit enemy identities exact while editing saved battles.
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
function rules(percent = 75, singleTarget = true) {
  const value = structuredClone(config);
  delete value.battle.enemyHealthAdjustments;
  delete value.battle.enemyAttackAdjustments;
  delete value.battle.bossHealthPercent;
  delete value.battle.bossAttackPercent;
  delete value.battle.enemyStatAdjustments;
  // Keep these regressions focused on attack scaling and target selection.
  value.battle.enemyStatPercent = 100;
  value.battle.enemyStatPasses = 1;
  value.battle.enemyAttackPercent = percent;
  if (singleTarget === undefined) delete value.battle.enemySingleTarget;
  else value.battle.enemySingleTarget = singleTarget;
  return value;
}
async function army(options = {}) {
  const engine = await GameEngine.create({
    factory,
    config: options.config ?? config,
    wasmBinary,
  });
  assert(engine.load(fixture).ok);
  const game = exactGame(engine);
  const types =
    options.types ??
    new Map([
      [45, "armored_jeep"],
      [40, "corvette"],
      [47, "aircraft"],
    ]);
  game.units = game.units.filter((unit) => types.has(unit.id));
  for (const unit of game.units) {
    unit.type = types.get(unit.id);
    unit.health = definition(unit.type).health;
    unit.source = game.buildings.find(
      (building) => building.type === definition(unit.type).building,
    ).id;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
function start(engine, campaignLevel) {
  const game = exactGame(engine);
  if (campaignLevel) {
    game.campaign = {
      currentLevel: campaignLevel,
      completedLevels: Array.from(
        { length: campaignLevel - 1 },
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
            !campaignLevel ||
            config.campaign.levels
              .find((level) => level.battleId === campaignLevel)
              .rounds.some(
                (round) => round.domain === definition(unit.type).domain,
              ),
        )
        .map((unit) => String(unit.id)),
      ...(campaignLevel ? { campaignLevel } : {}),
    },
  });
  assert(result.ok, result.message);
}
function compareGeneration(base, previous, current, label) {
  assert.deepEqual(
    friendlies(current),
    friendlies(previous),
    `${label}: allies`,
  );
  assert.deepEqual(
    friendlies(current),
    friendlies(base),
    `${label}: base allies`,
  );
  assert.equal(enemies(current).length, enemies(previous).length);
  for (const [index, enemy] of enemies(current).entries()) {
    const original = enemies(base)[index];
    const old = enemies(previous)[index];
    assert.equal(old.damage, Math.max(1, Math.floor(original.damage * 0.5)));
    assert.equal(enemy.damage, Math.max(1, Math.floor(original.damage * 0.75)));
    assert.deepEqual(
      { ...enemy, damage: old.damage },
      old,
      `${label}: enemy health, shields and other statistics`,
    );
  }
}

test("Current enemy attack increases from 50% to 75% for all expedition domains and campaign ordinary, boss and AI troops", async () => {
  assert.equal(config.battle.enemyAttackPercent, 75);
  assert.equal(config.battle.enemySingleTarget, true);
  const base = await army({ config: rules(100) });
  const previous = await army({ config: rules(50) });
  const current = await army({ config: rules() });
  try {
    const templates = [base, previous, current].map(exactGame);
    for (const engine of [base, previous, current]) start(engine);
    compareGeneration(
      exactGame(base).battle,
      exactGame(previous).battle,
      exactGame(current).battle,
      "Expedition",
    );
    assert.deepEqual(
      new Set(enemies(exactGame(current).battle).map((enemy) => enemy.domain)),
      new Set(["land", "naval", "air"]),
    );
    const kinds = new Set();
    for (const level of [1, 5, 12]) {
      for (const [index, engine] of [base, previous, current].entries()) {
        load(engine, structuredClone(templates[index]));
        start(engine, level);
      }
      const battle = exactGame(current).battle;
      compareGeneration(
        exactGame(base).battle,
        exactGame(previous).battle,
        battle,
        `Campaign ${level}`,
      );
      for (const enemy of enemies(battle))
        kinds.add(
          config.campaign.enemies.find((entry) => entry.id === enemy.enemyId)
            .kind,
        );
    }
    assert.deepEqual(kinds, new Set(["ordinary", "boss", "ai"]));
  } finally {
    for (const engine of [base, previous, current]) engine.dispose();
  }
});

test("Enemy Jeep, missile splash and Phantom Bomber attacks each damage only one living ally", async () => {
  const engine = await army({
    types: new Map([
      [45, "infantry_squad"],
      [46, "infantry_squad"],
      [47, "infantry_squad"],
    ]),
  });
  try {
    start(engine);
    const template = exactGame(engine);
    for (const type of ["armored_jeep", "missile_launcher", "phantom_bomber"]) {
      const game = structuredClone(template);
      const battle = game.battle;
      battle.enemyTurn = true;
      battle.pendingMs = 0;
      for (const [index, fighter] of friendlies(battle).entries()) {
        fighter.health = fighter.maxHealth = 10000;
        fighter.shield = fighter.defense = 0;
        fighter.position = [0, index];
      }
      const actor = enemies(battle)[0];
      for (const enemy of enemies(battle))
        enemy.attacked = enemy.id !== actor.id;
      actor.type = type;
      actor.domain = definition(type).domain;
      actor.damage = 100;
      actor.shield = 0;
      load(engine, game);
      for (let turn = 0; turn < 4; turn++) {
        const next = exactGame(engine);
        next.battle.enemyTurn = true;
        next.battle.pendingMs = 0;
        enemies(next.battle).find((enemy) => enemy.id === actor.id).attacked =
          false;
        load(engine, next);
        const before = exactGame(engine).battle;
        for (let tick = 0; tick < 4; tick++) assert(engine.tick(250).ok);
        const after = exactGame(engine).battle;
        assert.equal(after.actions, before.actions + 1, `${type}: one action`);
        assert.equal(
          after.lastAttacks.length,
          1,
          `${type}: one target in the attack log`,
        );
        const damaged = friendlies(after).filter(
          (fighter, index) => fighter.health < friendlies(before)[index].health,
        );
        assert.equal(damaged.length, 1, `${type}: one damaged ally`);
        assert(damaged[0].health > 0, `${type}: the target survives`);
      }
    }
  } finally {
    engine.dispose();
  }
});

test("Friendly Jeep attacks every enemy and friendly missile and bomber splash still reach multiple targets", async () => {
  for (const type of ["armored_jeep", "missile_launcher", "phantom_bomber"]) {
    const id = type === "phantom_bomber" ? 47 : 45;
    const engine = await army({ types: new Map([[id, type]]) });
    try {
      start(engine);
      const game = exactGame(engine);
      for (const [index, enemy] of enemies(game.battle).entries()) {
        enemy.health = enemy.maxHealth = 10000;
        enemy.defense = enemy.shield = 0;
        enemy.type = type === "phantom_bomber" ? "aircraft" : "infantry_squad";
        enemy.domain = definition(enemy.type).domain;
        enemy.position = [7, index];
      }
      load(engine, game);
      const before = engine.getState().battle;
      const actor = friendlies(before)[0];
      assert(actor.validTargets.length > 1);
      const result = engine.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: String(id), target: actor.validTargets[0] },
      });
      assert(result.ok, result.message);
      const after = engine.getState().battle;
      assert.equal(after.actions, before.actions + 1);
      assert.equal(
        after.lastAttacks.length,
        enemies(before).length,
        `${type}: all nearby targets`,
      );
      assert(
        enemies(after).every(
          (enemy, index) => enemy.health < enemies(before)[index].health,
        ),
      );
    } finally {
      engine.dispose();
    }
  }
});

for (const campaign of [false, true])
  test(`Current 50% ${campaign ? "campaign" : "expedition"} saves gain 50% enemy attack once and preserve battle progress`, async () => {
    const previousRules = rules(50);
    delete previousRules.battle.enemySingleTarget;
    const previous = await army({
      config: previousRules,
      types: new Map([
        [45, "heavy_infantry"],
        [40, "corvette"],
        [47, "aircraft"],
      ]),
    });
    const current = await army({ config: rules() });
    try {
      start(previous, campaign ? 1 : undefined);
      const prepared = exactGame(previous);
      prepared.battle.automatic = true;
      for (const fighter of prepared.battle.fighters) {
        fighter.health = fighter.maxHealth = 10000;
        fighter.damage = 1;
        fighter.defense = 0;
      }
      load(previous, prepared);
      for (let step = 0; step < 5; step++) assert(previous.tick(250).ok);
      const before = exactGame(previous);
      assert(!before.battle.finished);
      const shielded = friendlies(before.battle).find(
        (fighter) => fighter.shield > 0,
      );
      assert(shielded);
      shielded.health--;
      shielded.shield--;
      for (const [index, enemy] of enemies(before.battle).entries())
        enemy.damage = [3, 1, 19][index % 3];
      load(previous, before);
      const prior = exactGame(previous);
      assert.equal(prior.config.battle.enemyAttackPercent, 50);
      assert.equal(prior.config.battle.enemySingleTarget, undefined);
      const result = current.load(previous.save());
      assert(result.ok, result.message);
      const migrated = exactGame(current);
      assert.equal(migrated.config.battle.enemyAttackPercent, 75);
      assert.equal(migrated.config.battle.enemySingleTarget, true);
      for (const [index, enemy] of enemies(migrated.battle).entries()) {
        const old = enemies(prior.battle)[index];
        assert.equal(enemy.damage, Math.max(1, Math.floor(old.damage * 1.5)));
      }
      const restored = structuredClone(migrated.battle);
      for (const [index, enemy] of enemies(restored).entries())
        enemy.damage = enemies(prior.battle)[index].damage;
      assert.deepEqual(restored, prior.battle);
      for (const field of [
        "elapsedMs",
        "pendingMs",
        "units",
        "stock",
        "campaign",
      ])
        assert.deepEqual(migrated[field], prior[field], field);
      const saved = exactGame(current);
      delete saved.savedAtUTC;
      for (let reload = 0; reload < 3; reload++) {
        assert(current.load(current.save()).ok);
        const restored = exactGame(current);
        delete restored.savedAtUTC;
        assert.deepEqual(
          restored,
          saved,
          "Repeated reloads never stack the increase",
        );
      }
    } finally {
      previous.dispose();
      current.dispose();
    }
  });
