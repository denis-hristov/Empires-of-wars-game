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
// Preserve unsigned 64-bit enemy identities when editing save fixtures.
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
function stable(game) {
  const copy = structuredClone(game);
  delete copy.savedAtUTC;
  return copy;
}
const ends = [10, 20, 30, 40, 50, 65, 80, 100, 125, 150];
const resources = ["food", "wood", "stone", "iron", "coins"];
const navalRounds = JSON.parse(
  await readFile(
    new URL(
      "../../tests/fixtures/early-campaign-naval-rounds.json",
      import.meta.url,
    ),
  ),
);
function priorRules() {
  const prior = structuredClone(config);
  delete prior.earlyLandCampaignVersion;
  prior.buildings.find(
    (building) => building.id === "harbor",
  ).levels[0].townHallRequired = 3;
  prior.buildingLimits.harbor[2] = 1;
  for (const level of prior.campaign.levels)
    if (navalRounds[level.battleId])
      level.rounds.splice(1, 0, structuredClone(navalRounds[level.battleId]));
  return prior;
}
async function army(rules = config) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
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
    unit.health = config.units.find((entry) => entry.id === unit.type).health;
    unit.carrier = null;
    unit.reserve = false;
  }
  load(engine, game);
  return engine;
}
function atLevel(engine, template, level, townHall) {
  const game = structuredClone(template);
  game.buildings.find((building) => building.type === "townhall").level =
    townHall;
  game.campaign = {
    currentLevel: level,
    completedLevels: Array.from({ length: level - 1 }, (_, index) => index + 1),
    completed: false,
  };
  load(engine, game);
}
function start(engine, level) {
  const definition = engine.config.campaign.levels[level - 1];
  const domains = new Set(definition.rounds.map((round) => round.domain));
  return engine.dispatch({
    type: "BATTLE_START",
    payload: {
      campaignLevel: level,
      unitIds: engine
        .getState()
        .units.filter((unit) =>
          domains.has(
            config.units.find((entry) => entry.id === unit.type).domain,
          ),
        )
        .map((unit) => unit.id),
      automatic: true,
    },
  });
}
function win(engine) {
  for (let phase = 0; phase < 15; phase++) {
    const game = exactGame(engine);
    if (game.battle.finished) {
      assert(game.battle.victory);
      return;
    }
    const currentPhase = game.battle.phaseIndex;
    for (const fighter of [
      ...game.battle.fighters,
      ...game.battle.campaignArmy,
    ]) {
      if (fighter.enemy) {
        fighter.health = 1;
        fighter.shield = 0;
      } else {
        fighter.health = fighter.maxHealth = 900000;
        fighter.damage = 100000;
        fighter.defense = 999999;
      }
    }
    load(engine, game);
    for (let tick = 0; tick < 2000; tick++) {
      assert(engine.tick(250).ok);
      const battle = engine.getState().battle;
      if (battle.finished || battle.phaseIndex !== currentPhase) break;
      assert(tick < 1999, "Campaign round must end");
    }
  }
  assert.fail("Campaign victory was not reached");
}

function advanceRound(engine) {
  const game = exactGame(engine);
  const phase = game.battle.phaseIndex;
  for (const fighter of [
    ...game.battle.fighters,
    ...game.battle.campaignArmy,
  ]) {
    if (fighter.enemy) {
      fighter.health = 1;
      fighter.shield = 0;
    } else {
      fighter.health = fighter.maxHealth = 900000;
      fighter.damage = 100000;
      fighter.defense = 999999;
    }
  }
  load(engine, game);
  for (let tick = 0; tick < 2000; tick++) {
    assert(engine.tick(250).ok);
    const battle = engine.getState().battle;
    if (battle.finished || battle.phaseIndex !== phase) return;
  }
  assert.fail("Round must advance");
}

test("Levels 28, 29 and 30 can be won and claimed with a land-only army at Town Hall three", async () => {
  const engine = await army();
  try {
    const template = exactGame(engine);
    template.units = template.units.filter(
      (unit) => unit.type === "heavy_infantry",
    );
    for (const level of [28, 29, 30]) {
      atLevel(engine, template, level, 3);
      const result = start(engine, level);
      assert(result.ok, result.message);
      assert.deepEqual(
        engine.getState().battle.phases,
        Array(level === 30 ? 2 : 1).fill("land"),
      );
      win(engine);
      const before = engine.getState().stock;
      assert(engine.dispatch({ type: "BATTLE_FINISH" }).ok);
      assert.equal(engine.getState().campaign.currentLevel, level + 1);
      assert.deepEqual(
        engine.getState().stock,
        before.map(
          (amount, index) =>
            amount +
            config.campaign.levels[level - 1].rewards[resources[index]],
        ),
      );
    }
  } finally {
    engine.dispose();
  }
});

test("Old attempts migrate before, inside and after removed sea rounds without replaying land combat or paying twice", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    const template = exactGame(old);
    for (const level of [28, 29, 30]) {
      for (const phase of level === 30 ? [0, 1, 2] : [0, 1]) {
        atLevel(old, template, level, 3);
        assert(start(old, level).ok);
        for (let round = 0; round < phase; round++) advanceRound(old);
        const game = exactGame(old);
        game.battle.paused = true;
        const land = game.battle.campaignArmy.find(
          (fighter) => fighter.domain === "land",
        );
        land.health -= 7;
        if (game.battle.domain === "land")
          game.battle.fighters.find((fighter) => !fighter.enemy).health -= 7;
        const ship = game.battle.campaignArmy.find(
          (fighter) => fighter.domain === "naval",
        );
        if (phase === 1)
          game.battle.fighters.find((fighter) => !fighter.enemy).health -= 9;
        load(old, game);
        const before = exactGame(old);
        const result = current.load(old.save());
        assert(result.ok, `Level ${level}, phase ${phase}: ${result.message}`);
        const after = exactGame(current);
        assert.deepEqual(after.stock, before.stock);
        assert.deepEqual(after.campaign, before.campaign);
        assert(after.battle.phases.every((domain) => domain === "land"));
        assert(
          after.battle.campaignArmy.every(
            (fighter) => fighter.domain === "land",
          ),
        );
        assert(
          after.battle.fighters.every((fighter) => fighter.domain === "land"),
        );
        assert.equal(
          after.battle.campaignArmy[0].health,
          before.battle.campaignArmy.find(
            (fighter) => fighter.domain === "land",
          ).health,
        );
        if (phase === 0 || phase === 2) {
          assert.deepEqual(after.battle.fighters, before.battle.fighters);
          assert.equal(after.battle.phaseIndex, phase === 2 ? 1 : 0);
        } else {
          assert.equal(after.battle.finished, level !== 30);
          assert.equal(after.battle.victory, level !== 30);
          assert.equal(after.battle.phaseIndex, level === 30 ? 1 : 0);
          const previousShip = before.battle.fighters.find(
            (fighter) => !fighter.enemy,
          );
          const health = current
            .getState()
            .unitCatalog.find(
              (unit) => unit.id === previousShip.type,
            ).effectiveHealth;
          assert.equal(
            after.units.find((unit) => unit.id === ship.id).health,
            Math.max(
              1,
              previousShip.health - (previousShip.maxHealth - health),
            ),
          );
        }
        assert(current.load(current.save()).ok);
        assert.deepEqual(stable(exactGame(current)), stable(after));
        if (phase === 1 && level !== 30) {
          assert(current.dispatch({ type: "BATTLE_FINISH" }).ok);
          const paid = current.getState().stock;
          assert.equal(current.dispatch({ type: "BATTLE_FINISH" }).ok, false);
          assert.deepEqual(current.getState().stock, paid);
        }
      }
    }
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("A completed old sea defeat remains a defeat and does not revive destroyed ships", async () => {
  const old = await army(priorRules());
  const current = await army();
  try {
    atLevel(old, exactGame(old), 28, 3);
    assert(start(old, 28).ok);
    advanceRound(old);
    const game = exactGame(old);
    const ship = game.battle.fighters.find((fighter) => !fighter.enemy);
    ship.health = ship.shield = ship.potionShield = 0;
    ship.defeatedPhase = 1;
    game.battle.finished = true;
    game.battle.victory = game.battle.enemyTurn = false;
    game.battle.pendingMs = 0;
    game.battle.outcomes = [1, 0];
    load(old, game);
    const result = current.load(old.save());
    assert(result.ok, result.message);
    assert.equal(current.getState().battle.victory, false);
    assert.equal(current.getState().battle.retreated, true);
    assert(
      !current.getState().units.some((unit) => unit.id === String(ship.id)),
    );
    assert(current.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.deepEqual(current.getState().stock, game.stock);
    assert.equal(current.getState().campaign.currentLevel, 28);
    assert(start(current, 28).ok);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("A previously paid Harbor at Town Hall three remains loadable while new construction requires four", async () => {
  const old = await GameEngine.create({
    factory,
    config: priorRules(),
    wasmBinary,
  });
  const current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const game = exactGame(old);
    game.stock.fill(1000000);
    game.buildings[0].level = 3;
    load(old, game);
    const world = old.getWorld();
    let position;
    for (let y = 0; y < world.height && !position; y++)
      for (let x = 0; x < world.width && !position; x++) {
        const payload = { buildingType: "harbor", x, y };
        if (old.dispatch({ type: "CAN_BUILD", payload }).ok) position = payload;
      }
    assert(position);
    assert(old.dispatch({ type: "BUILD", payload: position }).ok);
    const before = exactGame(old);
    const result = current.load(old.save());
    assert(result.ok, result.message);
    assert.deepEqual(exactGame(current).buildings, before.buildings);
    assert.deepEqual(current.getState().stock, before.stock);
    assert.equal(current.getState().buildOptions.harbor.ok, false);
    for (let tick = 0; tick < 24; tick++) assert(current.tick(250).ok);
    assert.equal(
      current
        .getState()
        .buildings.find((building) => building.type === "harbor").state,
      1,
    );
    assert(current.load(current.save()).ok);
    assert.equal(current.getState().buildOptions.harbor.ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});
