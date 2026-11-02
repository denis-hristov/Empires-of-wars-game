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
const rules = (percent) => {
  const value = structuredClone(config);
  // Isolate the earlier global factors from later per-enemy adjustments.
  delete value.campaignFinalAttackVersion;
  for (const level of value.campaign.levels)
    for (const round of level.rounds) delete round.enemyFinalAttackPercents;
  delete value.battle.enemyHealthAdjustments;
  delete value.battle.enemyAttackAdjustments;
  delete value.battle.bossHealthPercent;
  delete value.battle.bossAttackPercent;
  delete value.battle.enemyStatAdjustments;
  // Isolate the historical attack policy from the later 10% balance change.
  value.battle.enemyStatPercent = 100;
  value.battle.enemyStatPasses = 1;
  if (percent === undefined) {
    delete value.battle.enemyAttackPercent;
    delete value.battle.enemySingleTarget;
  } else value.battle.enemyAttackPercent = percent;
  return value;
};

// Preserve the engine's unsigned 64-bit enemy IDs while editing save fixtures.
function exactGame(engine) {
  return JSON.parse(
    engine
      .save()
      .replace(
        /("(?:id|attacker|target)"\s*:\s*)(\d{16,})/g,
        '$1"__exactid_$2"',
      ),
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
  const bytes = JSON.stringify(canonical(game)).replace(
    /"__exactid_(\d+)"/g,
    "$1",
  );
  let checksum = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    checksum = BigInt.asUintN(64, (checksum ^ BigInt(byte)) * 1099511628211n);
  return `{"checksum":"${checksum.toString(16)}","game":${bytes}}`;
}
function load(engine, game) {
  const result = engine.load(pack(game));
  assert(result.ok, result.message);
}
async function army(percent) {
  const engine = await GameEngine.create({
    factory,
    config: rules(percent),
    wasmBinary,
  });
  const loaded = engine.load(fixture);
  assert(loaded.ok, loaded.message);
  const game = exactGame(engine);
  const types = new Map([
    [45, "armored_jeep"],
    [40, "corvette"],
    [47, "aircraft"],
  ]);
  game.units = game.units.filter((unit) => types.has(unit.id));
  for (const unit of game.units) {
    unit.type = types.get(unit.id);
    unit.health = config.units.find(
      (definition) => definition.id === unit.type,
    ).health;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
const friendlies = (battle) =>
  battle.fighters.filter((fighter) => !fighter.enemy);
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const idsFor = (game, required = domains) =>
  game.units
    .filter((unit) =>
      required.includes(
        config.units.find((definition) => definition.id === unit.type).domain,
      ),
    )
    .map((unit) => String(unit.id));
function start(engine, payload) {
  const result = engine.dispatch({ type: "BATTLE_START", payload });
  assert(result.ok, result.message);
}
function compareArmies(full, half, label) {
  assert.deepEqual(
    friendlies(half),
    friendlies(full),
    `${label}: friendly statistics`,
  );
  const reduced = enemies(half),
    original = enemies(full);
  assert.equal(reduced.length, original.length, `${label}: enemy count`);
  for (let index = 0; index < original.length; index++) {
    const before = original[index],
      after = reduced[index];
    assert.equal(
      after.damage,
      Math.max(1, Math.floor(before.damage / 2)),
      `${label}: ${before.enemyId || before.type} attack`,
    );
    assert.deepEqual(
      { ...after, damage: before.damage },
      before,
      `${label}: other enemy statistics`,
    );
  }
}
function advanceRound(engine) {
  const game = exactGame(engine),
    battle = game.battle,
    phase = battle.phaseIndex;
  for (const fighter of [...battle.campaignArmy, ...friendlies(battle)]) {
    fighter.damage = 999999;
    fighter.health = fighter.maxHealth = 900000;
    fighter.defense = 999999;
    fighter.shield = 0;
    fighter.attacked = false;
  }
  const foes = enemies(battle);
  for (const [index, fighter] of foes.entries()) {
    fighter.health = index === foes.length - 1 ? 1 : 0;
    fighter.shield = 0;
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

test("Enemy attack is halved for every expedition tier and all three domains, with friendly stats unchanged", async () => {
  assert.equal(config.battle.enemyAttackPercent, 75);
  assert.equal(config.battle.enemySingleTarget, true);
  const full = await army(100),
    half = await army(50);
  try {
    const templates = [exactGame(full), exactGame(half)];
    const seen = new Set();
    for (let tier = 1; tier <= 10; tier++) {
      for (const [index, engine] of [full, half].entries()) {
        const game = structuredClone(templates[index]);
        for (const unit of game.units) {
          const domain = config.units.find(
            (definition) => definition.id === unit.type,
          ).domain;
          const definition = config.units.find(
            (candidate) =>
              candidate.domain === domain && candidate.level === tier,
          );
          unit.type = definition.id;
          unit.health = definition.health;
        }
        load(engine, game);
        start(engine, { unitIds: idsFor(game) });
      }
      const before = exactGame(full).battle,
        after = exactGame(half).battle;
      compareArmies(before, after, `Expedition tier ${tier}`);
      for (const enemy of enemies(before))
        seen.add(enemy.type === "raider" ? "infantry" : enemy.type);
      assert.deepEqual(
        new Set(enemies(before).map((enemy) => enemy.domain)),
        new Set(domains),
      );
    }
    assert.equal(seen.size, config.units.length);
  } finally {
    full.dispose();
    half.dispose();
  }
});

test("Every enemy in all 150 campaign levels and 474 rounds receives exactly half attack", async () => {
  const full = await army(100),
    half = await army(50);
  try {
    const templates = [exactGame(full), exactGame(half)];
    const seenKinds = new Set(),
      seenDomains = new Set(),
      seenEnemies = new Set();
    let rounds = 0;
    for (const level of config.campaign.levels) {
      for (const [index, engine] of [full, half].entries()) {
        const game = structuredClone(templates[index]);
        game.campaign = {
          currentLevel: level.battleId,
          completedLevels: Array.from(
            { length: level.battleId - 1 },
            (_, completed) => completed + 1,
          ),
          completed: false,
        };
        load(engine, game);
        start(engine, {
          campaignLevel: level.battleId,
          unitIds: idsFor(game, [
            ...new Set(level.rounds.map((round) => round.domain)),
          ]),
          automatic: true,
        });
      }
      for (let phase = 0; phase < level.rounds.length; phase++) {
        const before = full.getState().battle,
          after = half.getState().battle;
        assert.equal(before.phaseIndex, phase);
        assert.equal(after.phaseIndex, phase);
        compareArmies(
          before,
          after,
          `Campaign ${level.battleId}, round ${phase + 1}`,
        );
        for (const enemy of enemies(before)) {
          const definition = config.campaign.enemies.find(
            (candidate) => candidate.id === enemy.enemyId,
          );
          seenKinds.add(definition.kind);
          seenDomains.add(enemy.domain);
          seenEnemies.add(enemy.enemyId);
        }
        rounds++;
        if (phase + 1 < level.rounds.length) {
          assert.equal(advanceRound(full).finished, false);
          assert.equal(advanceRound(half).finished, false);
        }
      }
    }
    assert.equal(rounds, 474);
    assert.equal(seenEnemies.size, config.campaign.enemies.length);
    assert.deepEqual(seenKinds, new Set(["ordinary", "boss", "ai"]));
    assert.deepEqual(seenDomains, new Set(domains));
  } finally {
    full.dispose();
    half.dispose();
  }
});

for (const campaign of [false, true])
  test(`Existing active ${campaign ? "campaign" : "expedition"} saves halve enemy attacks once and preserve combat progress`, async () => {
    const old = await army(undefined),
      current = await army(50);
    try {
      const game = exactGame(old);
      const heavy = game.units.find((unit) => unit.type === "armored_jeep");
      heavy.type = "heavy_infantry";
      heavy.health = config.units.find((unit) => unit.id === heavy.type).health;
      load(old, game);
      start(old, {
        ...(campaign
          ? { campaignLevel: 1, unitIds: idsFor(game, ["land"]) }
          : { unitIds: idsFor(game) }),
        automatic: true,
      });
      for (let step = 0; step < 5; step++) assert(old.tick(250).ok);
      const before = exactGame(old);
      assert.equal(before.config.battle.enemyAttackPercent, undefined);
      const friend = friendlies(before.battle)[0];
      friend.health--;
      const shielded = before.battle.fighters.find(
        (fighter) => fighter.shield > 0,
      );
      assert(shielded, "The fixture has a partially consumed shield");
      shielded.shield--;
      for (const [index, enemy] of enemies(before.battle).entries())
        enemy.damage = [3, 1, 19][index % 3];
      load(old, before);
      const prior = exactGame(old);
      const invalid = structuredClone(prior);
      invalid.config.battle.enemyDamage++;
      const unchanged = exactGame(current);
      delete unchanged.savedAtUTC;
      assert.equal(current.load(pack(invalid)).ok, false);
      const afterRejectedLoad = exactGame(current);
      delete afterRejectedLoad.savedAtUTC;
      assert.deepEqual(afterRejectedLoad, unchanged);
      assert(current.load(old.save()).ok);
      const migrated = exactGame(current);
      assert.equal(migrated.config.battle.enemyAttackPercent, 50);
      compareArmies(prior.battle, migrated.battle, "Migrated save");
      const restored = structuredClone(migrated.battle);
      for (const enemy of enemies(restored))
        enemy.damage = enemies(prior.battle).find(
          (fighter) => fighter.id === enemy.id,
        ).damage;
      assert.deepEqual(restored, prior.battle);
      assert.equal(migrated.elapsedMs, prior.elapsedMs);
      assert.equal(migrated.pendingMs, prior.pendingMs);
      assert.deepEqual(migrated.units, prior.units);
      assert.deepEqual(migrated.stock, prior.stock);
      const saved = exactGame(current);
      delete saved.savedAtUTC;
      for (let reload = 0; reload < 3; reload++) {
        assert(current.load(current.save()).ok);
        const restored = exactGame(current);
        delete restored.savedAtUTC;
        assert.deepEqual(restored, saved);
      }
    } finally {
      old.dispose();
      current.dispose();
    }
  });
