import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { loadGame } from "./helpers/population.js";
import {
  researchedStat,
  researchBonusPercent,
  researchUnitDefinition,
} from "../src/game/BuildingProgression.js";
const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const fixture = await readFile(
  new URL(
    "../../tests/fixtures/empires-of-wars-145.save.json",
    import.meta.url,
  ),
  "utf8",
);
const expected = {
  infantry: {
    health: [
      100, 105, 110, 115, 121, 127, 134, 140, 147, 155, 162, 171, 179, 188, 197,
    ],
    damage: [34, 35, 37, 39, 41, 43, 45, 47, 50, 52, 55, 58, 61, 64, 67],
  },
  ship: {
    health: [
      180, 189, 198, 208, 218, 229, 241, 253, 265, 279, 293, 307, 323, 339, 356,
    ],
    damage: [50, 52, 55, 57, 60, 63, 67, 70, 73, 77, 81, 85, 89, 94, 98],
  },
  aircraft: {
    health: [
      120, 126, 132, 138, 145, 153, 160, 168, 177, 186, 195, 205, 215, 226, 237,
    ],
    damage: [70, 73, 77, 81, 85, 89, 93, 98, 103, 108, 114, 119, 125, 131, 138],
  },
};
async function army() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(fixture).ok);
  const game = JSON.parse(engine.save()).game;
  for (const building of game.buildings)
    if (
      ["townhall", "academy", "barracks", "harbor", "airbase"].includes(
        building.type,
      )
    )
      building.level = 10;
  game.stock = [1000000, 1000000, 1000000, 1000000, 1000000];
  game.research = [];
  loadGame(engine, game);
  return engine;
}
function advance(engine, milliseconds) {
  for (let time = 0; time < milliseconds; time += 250)
    assert(engine.tick(Math.min(250, milliseconds - time)).ok);
}
function stableGame(engine) {
  const game = JSON.parse(engine.save()).game;
  delete game.savedAtUTC;
  return game;
}

test("All fourteen compounded research levels match exact known combat totals in every domain", async () => {
  const engine = await army();
  try {
    for (let level = 0; level <= 14; level++) {
      const game = JSON.parse(engine.save()).game;
      game.researchLevels = { infantry: level, ship: level, aircraft: level };
      loadGame(engine, game);
      const state = engine.getState();
      for (const [type, totals] of Object.entries(expected)) {
        const unit = state.unitCatalog.find((unit) => unit.id === type);
        assert.equal(
          unit.effectiveHealth,
          totals.health[level],
          `${type} health at ${level}`,
        );
        assert.equal(
          unit.effectiveDamage,
          totals.damage[level],
          `${type} attack at ${level}`,
        );
        assert.equal(
          unit.researchHealthBonus,
          totals.health[level] - totals.health[0],
        );
        assert.equal(
          unit.researchDamageBonus,
          totals.damage[level] - totals.damage[0],
        );
        const definition = config.units.find((unit) => unit.id === type);
        const fallback = researchUnitDefinition(
          { researchLevels: { [type]: level } },
          definition,
        );
        assert.equal(fallback.health, totals.health[level]);
        assert.equal(fallback.damage, totals.damage[level]);
      }
      assert(engine.load(engine.save()).ok);
    }
    assert.equal(researchBonusPercent(2), 10.25);
    assert.equal(researchBonusPercent(10), 62.89);
    assert.equal(researchedStat(10000, 14), 19799);
    assert.equal(researchBonusPercent(14), 97.99);
  } finally {
    engine.dispose();
  }
});

test("Completing research preserves wounds and training creates troops with the compounded strength", async () => {
  const engine = await army();
  try {
    const game = JSON.parse(engine.save()).game;
    game.researchLevels = { infantry: 3 };
    const soldier = game.units.find((unit) => unit.type === "infantry");
    soldier.health = 108;
    game.units = [soldier];
    loadGame(engine, game);
    const state = engine.getState();
    const academy = state.buildings.find(
      (building) => building.type === "academy",
    );
    const barracks = state.buildings.find(
      (building) => building.type === "barracks",
    );
    const option = academy.researchOptions.find(
      (option) => option.type === "infantry",
    );
    assert.equal(option.bonusPercent, 15.76);
    assert.equal(option.nextBonusPercent, 21.55);
    assert.equal(option.currentHealth, 115);
    assert.equal(option.nextHealth, 121);
    assert.equal(option.currentDamage, 51);
    assert.equal(option.nextDamage, 53);
    assert(
      engine.dispatch({
        type: "RESEARCH",
        payload: { id: academy.id, unitType: "infantry" },
      }).ok,
    );
    assert.equal(engine.getState().researchLevels.infantry, 3);
    advance(engine, option.seconds * 1000);
    const improved = engine.getState();
    assert.equal(improved.researchLevels.infantry, 4);
    assert.equal(
      improved.units.find((unit) => unit.id === String(soldier.id)).health,
      114,
    );
    assert.equal(
      improved.units.find((unit) => unit.id === String(soldier.id)).damage,
      41,
    );
    assert(
      engine.dispatch({
        type: "TRAIN",
        payload: { id: barracks.id, unitType: "infantry" },
      }).ok,
    );
    advance(
      engine,
      config.units.find((unit) => unit.id === "infantry").seconds * 1000,
    );
    const recruited = engine.getState().units.at(-1);
    assert.notEqual(recruited.id, String(soldier.id));
    assert.equal(recruited.health, 121);
    assert.equal(recruited.maxHealth, 121);
    assert.equal(recruited.damage, 41);
  } finally {
    engine.dispose();
  }
});

test("Linear saves gain compounded research once without losing wounds, resources or paid research", async () => {
  const engine = await army();
  try {
    const game = JSON.parse(engine.save()).game;
    delete game.researchBonusVersion;
    game.researchLevels = { infantry: 10, ship: 10, aircraft: 10 };
    const missing = { infantry: 13, ship: 21, aircraft: 3 };
    for (const unit of game.units) {
      const definition = config.units.find(
        (definition) => definition.id === unit.type,
      );
      if (missing[unit.type])
        unit.health = Math.floor(definition.health * 1.5) - missing[unit.type];
    }
    const academy = game.buildings.find(
      (building) => building.type === "academy",
    );
    game.research = [
      {
        type: "infantry_squad",
        academy: academy.id,
        level: 1,
        remainingMs: 1000,
      },
    ];
    loadGame(engine, game);
    assert.deepEqual(engine.getState().stock, game.stock);
    assert.deepEqual(
      JSON.parse(engine.save()).game.researchLevels,
      game.researchLevels,
    );
    assert.deepEqual(JSON.parse(engine.save()).game.research, game.research);
    for (const unit of engine.getState().units)
      if (missing[unit.type]) {
        assert.equal(unit.maxHealth, expected[unit.type].health[10]);
        assert.equal(unit.health, unit.maxHealth - missing[unit.type]);
      }
    const converted = stableGame(engine);
    assert.equal(converted.researchBonusVersion, 2);
    assert.equal(converted.researchRulesVersion, 2);
    assert(engine.load(engine.save()).ok);
    assert.deepEqual(stableGame(engine), converted);
    advance(engine, 1000);
    assert.equal(engine.getState().researchLevels.infantry_squad, 1);
  } finally {
    engine.dispose();
  }
});

test("Higher research previews scale every shield and healing ability with the same exact five percent factor", async () => {
  const engine = await army();
  try {
    const ranks = {
      infantry: 14,
      heavy_infantry: 12,
      armored_carrier: 10,
      frigate: 11,
      attack_submarine: 9,
      strike_fighter: 10,
      plasma_tank: 4,
      titan_mech: 2,
      titan_carrier: 2,
      plasma_fighter: 4,
    };
    const exact = (base, level) =>
      Number((BigInt(base) * 21n ** BigInt(level)) / 20n ** BigInt(level));
    const game = JSON.parse(engine.save()).game;
    game.researchLevels = Object.fromEntries(
      Object.entries(ranks).map(([type, level]) => [type, level - 1]),
    );
    loadGame(engine, game);
    const state = engine.getState();
    const academy = state.buildings.find((b) => b.type === "academy");
    for (const [type, rank] of Object.entries(ranks)) {
      const definition = config.units.find((u) => u.id === type);
      const option = academy.researchOptions.find((o) => o.type === type);
      assert.equal(option.currentHealth, exact(definition.health, rank - 1));
      assert.equal(option.nextHealth, exact(definition.health, rank));
      const damageBonus =
        option.currentDamage - exact(definition.damage, rank - 1);
      assert.equal(
        option.nextDamage,
        exact(definition.damage, rank) + damageBonus,
      );
      const shield = (level) =>
        type === "heavy_infantry"
          ? Math.floor(exact(definition.health, level) / 2)
          : type === "attack_submarine"
            ? exact(definition.health, level)
            : exact(definition.shield, level);
      if (definition.shield > 0) {
        assert.equal(option.currentShield, shield(rank - 1), type);
        assert.equal(option.nextShield, shield(rank), type);
        assert.equal(
          researchUnitDefinition(
            { researchLevels: { [type]: rank } },
            definition,
          ).shield,
          shield(rank),
        );
      }
      const healingPercent =
        type === "infantry"
          ? 50
          : definition.abilities.includes("repair_allies")
            ? 45
            : 0;
      if (healingPercent) {
        assert.equal(
          option.currentHealing,
          Math.floor(
            (exact(definition.health, rank - 1) * healingPercent) / 100,
          ),
          type,
        );
        assert.equal(
          option.nextHealing,
          Math.floor((exact(definition.health, rank) * healingPercent) / 100),
          type,
        );
      }
    }
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});
