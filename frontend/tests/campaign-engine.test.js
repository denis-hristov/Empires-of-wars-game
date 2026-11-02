import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import {
  autoSelectCampaignArmy,
  campaignArmyDomains,
} from "../src/game/CampaignArmy.js";
import { ensurePopulation, loadGame } from "./helpers/population.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const armySave = await readFile(
  new URL(
    "../../tests/fixtures/empires-of-wars-145.save.json",
    import.meta.url,
  ),
  "utf8",
);

async function createArmy() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(armySave).ok);
  const game = JSON.parse(engine.save()).game;
  for (const unit of game.units)
    unit.health = config.units.find(
      (definition) => definition.id === unit.type,
    ).health;
  loadGame(engine, game);
  return engine;
}

const domainOf = (unit) =>
  config.units.find((definition) => definition.id === unit.type).domain;
const friendly = (battle) =>
  battle.fighters.filter((fighter) => !fighter.enemy);
const squad = (engine, domain = "land", count = 5) =>
  engine
    .getState()
    .units.filter(
      (unit) => domainOf(unit) === domain && !unit.carrier && !unit.reserve,
    )
    .slice(0, count)
    .map((unit) => unit.id);
const roster = (engine) =>
  ["land", "naval", "air"].flatMap((domain) => squad(engine, domain));

function setLevel(engine, level) {
  const game = JSON.parse(engine.save()).game;
  game.buildings.find((building) => building.type === "townhall").level =
    config.campaign.levels[level - 1].requiredTH;
  game.campaign = {
    currentLevel: level,
    completedLevels: Array.from({ length: level - 1 }, (_, index) => index + 1),
    completed: false,
  };
  loadGame(engine, game);
}

function runRound(engine) {
  const phase = engine.getState().battle.phaseIndex;
  for (let i = 0; i < 2000; i++) {
    const previous = engine.getState().battle;
    assert.equal(previous.awaitingSelection, false);
    if (previous.finished || previous.phaseIndex !== phase) return previous;
    assert(engine.tick(250).ok);
  }
  assert.fail("The battle round did not finish");
}

function nextRound(engine) {
  const phase = engine.getState().battle.phaseIndex;
  for (let i = 0; i < 2000; i++) {
    const previous = engine.getState().battle;
    assert.equal(previous.awaitingSelection, false);
    assert(engine.tick(250).ok);
    const battle = engine.getState().battle;
    assert.equal(battle.awaitingSelection, false);
    if (battle.finished || battle.phaseIndex !== phase)
      return { previous, battle };
  }
  assert.fail("The battle round did not change");
}

// JSON numbers cannot hold the engine's unsigned 64-bit enemy IDs exactly.
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
function loadExactGame(engine, game) {
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
  const result = engine.load(
    `{"checksum":"${checksum.toString(16)}","game":${bytes}}`,
  );
  assert(result.ok, result.message);
}
function strengthenCurrentRound(engine) {
  const game = exactGame(engine);
  for (const fighter of friendly(game.battle)) {
    fighter.damage = 100000;
    fighter.health = fighter.maxHealth = 100000;
  }
  loadExactGame(engine, game);
}

function fillDomainSquads(engine) {
  const missing = ["land", "naval", "air"].flatMap((domain) => {
    const definition = config.units.find((unit) =>
      domain === "naval" ? unit.id === "corvette" : unit.domain === domain,
    );
    return Array.from(
      { length: Math.max(0, 5 - squad(engine, domain).length) },
      () => definition,
    );
  });
  ensurePopulation(
    engine,
    engine.getState().population.military +
      missing.reduce((total, definition) => total + definition.people, 0),
  );
  const game = JSON.parse(engine.save()).game;
  const state = engine.getState(),
    world = engine.getWorld();
  const occupied = new Set();
  for (const entity of [...state.buildings, ...state.units]) {
    if (entity.carrier || entity.reserve) continue;
    for (let dy = 0; dy < entity.footprint[1]; dy++)
      for (let dx = 0; dx < entity.footprint[0]; dx++)
        occupied.add(`${entity.position[0] + dx}:${entity.position[1] + dy}`);
  }
  for (const definition of missing) {
    const [width, height] = definition.footprint;
    let position;
    for (let y = 0; y + height <= world.height && !position; y++)
      for (let x = 0; x + width <= world.width && !position; x++) {
        const cells = Array.from({ length: width * height }, (_, index) => [
          x + (index % width),
          y + Math.floor(index / width),
        ]);
        if (
          !cells.every(
            ([cx, cy]) =>
              !occupied.has(`${cx}:${cy}`) &&
              (definition.domain === "naval" ? [0] : [1, 2]).includes(
                world.tiles[cy * world.width + cx],
              ),
          )
        )
          continue;
        position = [x, y];
        for (const [cx, cy] of cells) occupied.add(`${cx}:${cy}`);
      }
    assert(position, `Fixture plot for ${definition.id}`);
    game.units.push({
      id: game.nextId++,
      source: game.buildings.find(
        (building) => building.type === definition.building,
      ).id,
      type: definition.id,
      position,
      health: definition.health,
      carrier: null,
      reserve: false,
    });
  }
  loadGame(engine, game);
}

test("WASM campaign validates the complete roster atomically before starting", async () => {
  const engine = await createArmy();
  try {
    const initial = engine.getState();
    assert.equal(initial.campaign.currentLevel, 1);
    assert.equal(initial.campaign.maxLevel, 150);
    assert.equal(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, campaignLevel: 2 },
      }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), initial);
    const ids = squad(engine);
    for (const unitIds of [
      undefined,
      [],
      squad(engine, "naval"),
      [ids[0], ids[0]],
      squad(engine, "land", 6),
      ["99999999"],
      ids.concat("99999999"),
    ]) {
      assert.equal(
        engine.dispatch({
          type: "BATTLE_START",
          payload: { campaign: true, unitIds },
        }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), initial);
    }
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: ids },
      }).ok,
    );
    const active = engine.getState();
    assert.equal(active.battle.awaitingSelection, false);
    assert.deepEqual(active.battle.campaignArmyIds, ids);
    assert.equal(
      engine.dispatch({
        type: "BATTLE_DEPLOY",
        payload: { unitIds: ids.slice(0, 2) },
      }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), active);
    const enemy = active.battle.fighters.find((fighter) => fighter.enemy);
    assert.equal(enemy.enemyId, "G01");
    assert.equal(enemy.assetPath, "assets/enemies/land/enemy_land_01.svg");
  } finally {
    engine.dispose();
  }
});

test("WASM campaign requires every future domain and accepts five units per domain", async () => {
  const engine = await createArmy();
  const copy = await GameEngine.create({ factory, config, wasmBinary });
  try {
    setLevel(engine, 51);
    fillDomainSquads(engine);
    const before = engine.getState();
    const ids = autoSelectCampaignArmy(
      before,
      config,
      campaignArmyDomains(config.campaign.levels[50]),
    );
    assert.equal(ids.length, 15);
    for (const unitIds of [
      squad(engine),
      squad(engine).concat(squad(engine, "naval")),
      squad(engine, "naval").concat(squad(engine, "air")),
      squad(engine, "land", 6).concat(
        squad(engine, "naval"),
        squad(engine, "air"),
      ),
      ids.concat(ids[0]),
    ]) {
      assert.equal(
        engine.dispatch({
          type: "BATTLE_START",
          payload: { campaign: true, unitIds },
        }).ok,
        false,
      );
      assert.deepEqual(engine.getState(), before);
    }
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: ids, automatic: true },
      }).ok,
    );
    assert.deepEqual(engine.getState().battle.campaignArmyIds, ids);
    assert(copy.load(engine.save()).ok);
    assert.deepEqual(copy.getState().battle, engine.getState().battle);
    for (const domain of ["land", "naval", "air"]) {
      const active = copy.getState();
      assert.equal(active.battle.domain, domain);
      assert.equal(active.battle.awaitingSelection, false);
      assert.deepEqual(
        friendly(active.battle).map((fighter) => fighter.id),
        ids.filter(
          (id) =>
            domainOf(before.units.find((unit) => unit.id === id)) === domain,
        ),
      );
      assert.deepEqual(active.battle.campaignArmyIds, ids);
      strengthenCurrentRound(copy);
      const result = runRound(copy);
      assert.equal(result.finished, domain === "air");
    }
    assert(copy.getState().battle.victory);
    assert.deepEqual(copy.getState().stock, before.stock);
    assert.equal(copy.getState().campaign.currentLevel, 51);
    assert(copy.load(copy.save()).ok);
    assert(copy.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(copy.getState().campaign.currentLevel, 52);
  } finally {
    engine.dispose();
    copy.dispose();
  }
});

test("WASM campaign defeat retains the current level and permits another attempt", async () => {
  const engine = await createArmy();
  try {
    const game = JSON.parse(engine.save()).game;
    const weak = game.units.find((unit) => unit.type === "infantry");
    weak.health = 1;
    loadGame(engine, game);
    const before = engine.getState();
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: {
          campaign: true,
          unitIds: [String(weak.id)],
          automatic: true,
        },
      }).ok,
    );
    const started = exactGame(engine);
    for (const fighter of [
      ...friendly(started.battle),
      ...started.battle.campaignArmy,
    ])
      fighter.health = 1;
    loadExactGame(engine, started);
    const battle = runRound(engine);
    assert(battle.finished);
    assert.equal(battle.victory, false);
    assert.equal(engine.getState().campaign.currentLevel, 1);
    assert.deepEqual(engine.getState().stock, before.stock);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(engine.getState().campaign.currentLevel, 1);
    assert.deepEqual(engine.getState().campaign.completedLevels, []);
    assert.deepEqual(engine.getState().stock, before.stock);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: squad(engine) },
      }).ok,
    );
    assert.equal(engine.getState().battle.campaignLevel, 1);
    assert.equal(engine.getState().battle.awaitingSelection, false);
  } finally {
    engine.dispose();
  }
});

test("WASM campaign victory advances only after finishing and pays its exact rewards once", async () => {
  const engine = await createArmy();
  const copy = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const before = engine.getState();
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: squad(engine), automatic: true },
      }).ok,
    );
    const battle = runRound(engine);
    assert(battle.finished && battle.victory);
    assert.equal(engine.getState().campaign.currentLevel, 1);
    assert.deepEqual(engine.getState().stock, before.stock);
    assert(copy.load(engine.save()).ok);
    assert(copy.getState().battle.victory);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(engine.getState().campaign.currentLevel, 2);
    assert.deepEqual(engine.getState().campaign.completedLevels, [1]);
    const rewards = config.campaign.levels[0].rewards;
    assert.deepEqual(
      engine.getState().stock,
      before.stock.map(
        (value, index) =>
          value + rewards[["food", "wood", "stone", "iron", "coins"][index]],
      ),
    );
    const finished = engine.getState();
    assert.equal(engine.dispatch({ type: "BATTLE_FINISH" }).ok, false);
    assert.deepEqual(engine.getState(), finished);
    assert(copy.load(engine.save()).ok);
    assert.deepEqual(copy.getState().campaign, finished.campaign);
  } finally {
    engine.dispose();
    copy.dispose();
  }
});

test("WASM repeated-domain rounds retain the chosen survivors and health across save/load", async () => {
  const engine = await createArmy();
  const copy = await GameEngine.create({ factory, config, wasmBinary });
  try {
    setLevel(engine, 6);
    const game = JSON.parse(engine.save()).game;
    const ids = squad(engine);
    game.units.find((unit) => String(unit.id) === ids[0]).health = 1;
    loadGame(engine, game);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: ids, automatic: true },
      }).ok,
    );
    const first = exactGame(engine);
    // Seed a casualty and a wounded survivor independently of random enemy targeting.
    friendly(first.battle).find(
      (fighter) => String(fighter.id) === ids[0],
    ).health = 0;
    friendly(first.battle).find(
      (fighter) => String(fighter.id) === ids[1],
    ).health = 73;
    first.battle.enemyTurn = true;
    first.battle.pendingMs = 0;
    for (const fighter of first.battle.fighters) {
      fighter.attacked = !fighter.enemy;
      if (fighter.enemy) fighter.position = [1, 0];
    }
    loadExactGame(engine, first);
    const { previous, battle: second } = nextRound(engine);
    assert.equal(second.finished, false);
    assert.equal(second.phaseIndex, 1);
    assert.equal(second.domain, "land");
    assert.deepEqual(second.outcomes, [1]);
    assert.equal(engine.getState().campaign.currentLevel, 6);
    const survivors = friendly(previous).filter(
      (fighter) => fighter.health > 0,
    );
    assert(
      survivors.length < ids.length,
      "A chosen casualty must not be replaced",
    );
    assert.deepEqual(
      friendly(second)
        .filter((fighter) => fighter.health > 0)
        .map((fighter) => fighter.id),
      survivors.map((fighter) => fighter.id),
    );
    assert.equal(
      friendly(second).find((fighter) => fighter.id === ids[0]).health,
      0,
    );
    for (const survivor of survivors) {
      const next = friendly(second).find(
        (fighter) => fighter.id === survivor.id,
      );
      assert.equal(next.health, survivor.health);
      assert.equal(next.shield, survivor.shield);
    }
    assert.deepEqual(second.campaignArmyIds, ids);
    assert(copy.load(engine.save()).ok);
    assert.deepEqual(copy.getState().battle, second);
    assert.equal(
      copy.dispatch({
        type: "BATTLE_DEPLOY",
        payload: { unitIds: squad(copy) },
      }).ok,
      false,
    );
    assert.deepEqual(copy.getState().battle, second);
    const won = runRound(copy);
    assert(won.finished && won.victory);
    assert.deepEqual(won.outcomes, [1, 1]);
    assert(copy.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(copy.getState().campaign.currentLevel, 7);
    assert.equal(engine.getState().campaign.currentLevel, 6);
    assert(copy.load(copy.save()).ok);
  } finally {
    engine.dispose();
    copy.dispose();
  }
});

test("WASM campaign blocks the current level until its Town Hall requirement is met", async () => {
  const engine = await createArmy();
  try {
    const locked = config.campaign.levels.find(
      (level) => level.requiredTH > engine.getState().townHallLevel,
    );
    const game = JSON.parse(engine.save()).game;
    game.campaign = {
      currentLevel: locked.battleId,
      completedLevels: Array.from(
        { length: locked.battleId - 1 },
        (_, index) => index + 1,
      ),
      completed: false,
    };
    loadGame(engine, game);
    const before = engine.getState();
    const result = engine.dispatch({
      type: "BATTLE_START",
      payload: { campaign: true, unitIds: squad(engine) },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /Town Hall/i);
    assert.deepEqual(engine.getState(), before);
  } finally {
    engine.dispose();
  }
});

test("WASM later-round defeat loses the level without rewards and active retreat remains available", async () => {
  const engine = await createArmy();
  try {
    setLevel(engine, 6);
    const before = engine.getState();
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: squad(engine), automatic: true },
      }).ok,
    );
    const second = runRound(engine);
    assert.equal(second.phaseIndex, 1);
    assert.equal(second.awaitingSelection, false);
    const game = exactGame(engine);
    for (const fighter of friendly(game.battle)) fighter.health = 1;
    for (const fighter of game.battle.fighters.filter(
      (fighter) => fighter.enemy,
    )) {
      fighter.health = fighter.maxHealth = 100000;
      fighter.damage = 100000;
    }
    loadExactGame(engine, game);
    const lost = runRound(engine);
    assert(lost.finished && !lost.victory);
    assert.deepEqual(lost.outcomes, [1, 0]);
    assert.deepEqual(engine.getState().stock, before.stock);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(engine.getState().campaign.currentLevel, 6);
    assert.deepEqual(
      engine.getState().campaign.completedLevels,
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(engine.getState().stock, before.stock);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: squad(engine) },
      }).ok,
    );
    assert(engine.dispatch({ type: "BATTLE_RETREAT" }).ok);
    assert(engine.load(engine.save()).ok);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(engine.getState().campaign.currentLevel, 6);
  } finally {
    engine.dispose();
  }
});

test("WASM migrates a legacy active campaign into a fixed roster", async () => {
  const engine = await createArmy();
  try {
    setLevel(engine, 51);
    const ids = roster(engine);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: ids, automatic: true },
      }).ok,
    );
    const legacy = exactGame(engine);
    legacy.battle.combatVersion = 4;
    delete legacy.battle.campaignArmy;
    delete legacy.battle.campaignArmyIds;
    loadExactGame(engine, legacy);
    const migrated = engine.getState().battle;
    assert.equal(migrated.awaitingSelection, false);
    assert.deepEqual(migrated.campaignArmyIds, ids);
    assert.deepEqual(
      friendly(migrated).map((fighter) => fighter.id),
      squad(engine),
    );
    assert(engine.load(engine.save()).ok);
    const active = engine.getState();
    assert.equal(
      engine.dispatch({
        type: "BATTLE_DEPLOY",
        payload: { unitIds: squad(engine) },
      }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), active);
    strengthenCurrentRound(engine);
    const naval = runRound(engine);
    assert.equal(naval.phaseIndex, 1);
    assert.equal(naval.domain, "naval");
    assert.equal(naval.awaitingSelection, false);
    assert.deepEqual(
      friendly(naval).map((fighter) => fighter.id),
      squad(engine, "naval"),
    );
    assert.deepEqual(naval.campaignArmyIds, ids);
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});

test("WASM final automatically plays all 15 exact rounds and rewards only full victory", async () => {
  const engine = await createArmy();
  try {
    setLevel(engine, 150);
    const before = engine.getState(),
      ids = roster(engine);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, unitIds: ids, automatic: true },
      }).ok,
    );
    for (let index = 0; index < 15; index++) {
      const active = engine.getState();
      const expected = config.campaign.levels[149].rounds[index];
      assert.equal(active.battle.phaseIndex, index);
      assert.equal(active.battle.domain, expected.domain);
      assert.equal(active.battle.awaitingSelection, false);
      assert.deepEqual(active.battle.campaignArmyIds, ids);
      assert.deepEqual(
        friendly(active.battle).map((fighter) => fighter.id),
        squad(engine, expected.domain),
      );
      assert.deepEqual(
        active.battle.fighters
          .filter((fighter) => fighter.enemy)
          .map((fighter) => fighter.enemyId),
        expected.enemies,
      );
      strengthenCurrentRound(engine);
      const result = runRound(engine);
      assert.equal(result.finished, index === 14);
      assert.equal(result.outcomes.length, index + 1);
      assert(result.outcomes.every((outcome) => outcome === 1));
      assert.equal(engine.getState().campaign.completed, false);
      assert.deepEqual(engine.getState().stock, before.stock);
    }
    assert(engine.getState().battle.victory);
    assert(engine.load(engine.save()).ok);
    assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert(engine.getState().campaign.completed);
    assert.equal(engine.getState().campaign.completedLevels.length, 150);
    const rewards = config.campaign.levels[149].rewards;
    assert.deepEqual(
      engine.getState().stock,
      before.stock.map(
        (value, index) =>
          value + rewards[["food", "wood", "stone", "iron", "coins"][index]],
      ),
    );
    assert(engine.load(engine.save()).ok);
    assert.equal(engine.dispatch({ type: "BATTLE_FINISH" }).ok, false);
  } finally {
    engine.dispose();
  }
});
