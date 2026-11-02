import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const reference = JSON.parse(
  await readFile(
    new URL(
      "../../tests/fixtures/campaign-enemy-stats-reference.json",
      import.meta.url,
    ),
  ),
);
const run = promisify(execFile);
const stable = (game) => {
  const value = structuredClone(game);
  delete value.savedAtUTC;
  return value;
};
function priorRules() {
  const prior = structuredClone(config);
  delete prior.enemyAirBalanceVersion;
  for (const unit of prior.units) {
    if (unit.domain !== "air") continue;
    delete unit.enemyBaseHealth;
    delete unit.enemyBaseDamage;
  }
  return prior;
}

test(
  "Campaign enemies match the supplied list except the requested AI and final land boss reductions",
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "empires-air-reference-"));
    try {
      const output = join(directory, "battles.txt");
      await run(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../scripts/export-battles.js", import.meta.url),
          ),
          output,
        ],
        { timeout: 170000 },
      );
      const rows = [];
      let level, round, domain;
      for (const line of (await readFile(output, "utf8")).split("\n")) {
        let match = line.match(/^НИВО (\d+)/);
        if (match) {
          level = Number(match[1]);
          continue;
        }
        match = line.match(/^  РУНД (\d+) от \d+\. (\S+)\./);
        if (match) {
          round = Number(match[1]);
          domain = match[2];
          continue;
        }
        match = line.match(
          /^    Моб \d+: ([^,]+), .* Здраве: (\d+)\. Атака: (\d+)\./,
        );
        if (match)
          rows.push([
            level,
            round,
            domain,
            match[1],
            Number(match[2]),
            Number(match[3]),
          ]);
      }
      assert.equal(rows.length, 2127);
      assert.equal(rows.filter((row) => row[2] === "Въздушен").length, 560);
      const expected = reference
        .filter((row) => !([28, 29, 30].includes(row[0]) && row[1] === 2))
        .map((row) => {
          const current = [...row];
          if (row[0] === 30 && row[1] === 3) current[1] = 2;
          if (row[0] === 58 && row[3] === "AI-W2") current[5] = 257;
          if (row[0] === 76 && row[2] === "Сухопътен" && row[3] === "AI-G5") {
            assert.equal(row[4], 6134);
            assert.equal(row[5], 351);
            current[5] = 245;
          }
          if (
            row[0] === 150 &&
            row[2] === "Сухопътен" &&
            /^G-B[1-5]$/.test(row[3])
          ) {
            assert.equal(row[4], 20136);
            assert.equal(row[5], 813);
            current[4] = 15102;
            current[5] = 691;
          }
          return current;
        });
      assert.deepEqual(rows, expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("Existing ordinary, boss and AI air battles regain their documented stats once while preserving wounds and progress", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    const template = exactGame(old);
    for (const number of [51, 65, 100, 150]) {
      load(old, structuredClone(template));
      const level = config.campaign.levels.find(
        (level) => level.battleId === number,
      );
      start(old, level);
      while (old.getState().battle.domain !== "air") advanceRound(old);
      const before = exactGame(old);
      const foes = enemies(before.battle);
      foes[0].health = Math.max(1, Math.floor(foes[0].maxHealth / 2));
      foes[1].health = 0;
      before.battle.paused = true;
      load(old, before);
      const previous = exactGame(old);
      assert(current.load(old.save()).ok);
      const migrated = exactGame(current);
      for (const key of [
        "stock",
        "units",
        "buildings",
        "campaign",
        "researchLevels",
        "appliedRewards",
      ])
        assert.deepEqual(migrated[key], previous[key], key);
      assert.deepEqual(
        migrated.battle.campaignArmy,
        previous.battle.campaignArmy,
      );
      assert.deepEqual(allies(migrated.battle), allies(previous.battle));
      for (const [index, foe] of enemies(migrated.battle).entries()) {
        const row = reference.find(
          (row) =>
            row[0] === number &&
            row[1] === migrated.battle.phaseIndex + 1 &&
            row[3] === foe.enemyId,
        );
        assert(row, foe.enemyId);
        assert.equal(foe.maxHealth, row[4]);
        assert.equal(foe.damage, row[5]);
        const oldFoe = enemies(previous.battle)[index];
        assert.equal(
          foe.health,
          oldFoe.health === 0
            ? 0
            : Math.max(
                1,
                Math.round((oldFoe.health * foe.maxHealth) / oldFoe.maxHealth),
              ),
        );
        assert.deepEqual(
          {
            ...foe,
            health: oldFoe.health,
            maxHealth: oldFoe.maxHealth,
            damage: oldFoe.damage,
          },
          oldFoe,
        );
      }
      assert.equal(migrated.battle.round, previous.battle.round);
      assert.equal(migrated.battle.actions, previous.battle.actions);
      assert.equal(migrated.battle.paused, true);
      assert(current.load(current.save()).ok);
      assert.deepEqual(stable(exactGame(current)), stable(migrated));
    }
    const bad = exactGame(old);
    bad.config.units.find((unit) => unit.id === "aircraft").cost.wood++;
    assert.equal(current.load(pack(bad)).ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Player aircraft improvements no longer increase campaign enemy health or attack", async () => {
  const stronger = structuredClone(config);
  for (const unit of stronger.units.filter((unit) => unit.domain === "air")) {
    unit.health *= 2;
    unit.damage *= 2;
  }
  const normal = await army();
  const improved = await army(stronger);
  try {
    for (const engine of [normal, improved]) {
      const level = config.campaign.levels.find(
        (level) => level.battleId === 65,
      );
      start(engine, level);
      while (engine.getState().battle.domain !== "air") advanceRound(engine);
    }
    assert.deepEqual(
      enemies(improved.getState().battle),
      enemies(normal.getState().battle),
    );
    const standard = normal
      .getState()
      .unitCatalog.find((unit) => unit.id === "jet_fighter");
    const upgraded = improved
      .getState()
      .unitCatalog.find((unit) => unit.id === "jet_fighter");
    assert.equal(upgraded.effectiveHealth, standard.effectiveHealth * 2);
    assert.equal(upgraded.effectiveDamage, standard.effectiveDamage * 2);
  } finally {
    normal.dispose();
    improved.dispose();
  }
});
