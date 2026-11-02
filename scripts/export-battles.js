import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import factory from "../frontend/public/wasm/empires_engine.js";
import { GameEngine } from "../frontend/src/engine/GameEngine.js";

const config = JSON.parse(
  await readFile(new URL("../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../frontend/public/wasm/empires_engine.wasm", import.meta.url),
);
const fixture = await readFile(
  new URL("../tests/fixtures/military-army.save.json", import.meta.url),
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

const output = resolve(
  process.argv[2] ??
    new URL("../Empires_of_wars_all_battles.txt", import.meta.url).pathname,
);
const labels = { land: "Сухопътен", naval: "Морски", air: "Въздушен" };
const kinds = { ordinary: "обикновен", boss: "бос", ai: "AI форма" };
const catalog = new Map(
  config.campaign.enemies.map((enemy) => [enemy.id, enemy]),
);
const levels = config.campaign.levels;
const roundCount = levels.reduce(
  (total, level) => total + level.rounds.length,
  0,
);
const enemyCount = levels.reduce(
  (total, level) =>
    total + level.rounds.reduce((sum, round) => sum + round.enemies.length, 0),
  0,
);
const distinct = new Set(
  levels.flatMap((level) => level.rounds.flatMap((round) => round.enemies)),
);
const date = new Intl.DateTimeFormat("bg-BG", {
  timeZone: "Europe/Sofia",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date());
const lines = [
  "EMPIRES OF WARS",
  "Всички битки, нива, рундове и противници",
  "",
  `Извлечено от текущите файлове и игровия двигател на ${date}`,
  `Общо нива: ${levels.length}`,
  `Общо рундове: ${roundCount}`,
  `Общо мобове във всички рундове: ${enemyCount}`,
  `Различни видове мобове: ${distinct.size}`,
  "",
  "Как да се четат стойностите",
  "Всеки моб е посочен поотделно, в реда му в рунда. Повторен код означава отделен противник.",
  "Здраве: началното и максималното здраве на моба при влизане в този рунд.",
  "Атака: стойността damage на моба при влизане в рунда. Реалната щета от удар зависи и от защитата, щита, целта и бойните способности.",
  "Стойностите са извлечени от началното състояние на всеки рунд в игровия двигател и включват всички текущи промени по баланса.",
  "Включени са увеличението според нивото, множителите за босове и AI и намалението на здравето при поне двама специални противници в един рунд.",
  "Включени са предишните намаления на здравето и атаката за всички врагове, както и отделното намаление на здравето на босовете с 10% и атаката им с 15%.",
  "Включено е и предишното намаление на атаката на всички врагове с 33%, последвано от още 25% само за босовете.",
  "Последна промяна: здравето на всички врагове, включително босовете и AI формите, е намалено с още 10%, а атаката им с още 15% спрямо предишните стойности.",
  "Процентите се прилагат последователно. След всяка процентна корекция стойността се закръгля надолу до цяло число, с минимум 1.",
  "Имената и кодовете са запазени както са в играта.",
  "",
];
const engine = await army();
let exportedRounds = 0,
  exportedEnemies = 0;
try {
  const template = exactGame(engine);
  for (const level of levels) {
    load(engine, structuredClone(template));
    start(engine, level);
    lines.push(
      `НИВО ${String(level.battleId).padStart(3, "0")}`,
      `Име: ${level.name}`,
      `Тип битка: ${level.title}`,
      `Изисквано ниво на кметството: ${level.requiredTH}`,
      `Брой рундове: ${level.rounds.length}`,
      "",
    );
    for (const [phase, round] of level.rounds.entries()) {
      const battle = engine.getState().battle;
      assert.equal(battle.phaseIndex, phase);
      assert.equal(battle.domain, round.domain);
      const fighters = enemies(battle);
      assert.deepEqual(
        fighters.map((fighter) => fighter.enemyId),
        round.enemies,
      );
      lines.push(
        `  РУНД ${phase + 1} от ${level.rounds.length}. ${labels[round.domain]}. Брой мобове: ${fighters.length}.`,
      );
      for (const [index, fighter] of fighters.entries()) {
        assert.equal(
          fighter.health,
          fighter.maxHealth,
          "Export requires fresh enemies before any attack",
        );
        const enemy = catalog.get(fighter.enemyId);
        lines.push(
          `    Моб ${index + 1}: ${enemy.id}, ${enemy.name}. Вид: ${kinds[enemy.kind]}. Здраве: ${fighter.maxHealth}. Атака: ${fighter.damage}.`,
        );
        exportedEnemies++;
      }
      exportedRounds++;
      lines.push("");
      if (phase + 1 < level.rounds.length) advanceRound(engine);
    }
    lines.push("");
  }
} finally {
  engine.dispose();
}
assert.equal(exportedRounds, roundCount);
assert.equal(exportedEnemies, enemyCount);
lines.push(
  "Източници",
  "Състав на битките, имена на противниците и базови единици: config/game.json.",
  "Начално здраве и атака от действителния игрови двигател: src/Campaign.cpp, Game::deployCampaignPhase; src/Game.cpp, Game::enemyMaxHealth, Game::adjustedEnemyHealth, Game::enemyAttackDamage и Game::adjustedEnemyAttack.",
  "Генериране: scripts/export-battles.js.",
  "",
);
await writeFile(output, lines.join("\n"));
console.log(
  `Exported ${levels.length} levels, ${exportedRounds} rounds, ${exportedEnemies} enemies and ${distinct.size} enemy types to ${output}`,
);
