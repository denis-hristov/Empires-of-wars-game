import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { loadGame } from "./helpers/population.js";
import {
  researchedStat,
  researchUnitDefinition,
} from "../src/game/BuildingProgression.js";

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
async function army(type, level = 0, wounds = 0) {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(fixture).ok);
  const game = JSON.parse(engine.save()).game;
  const definition = config.units.find((unit) => unit.id === type);
  const troop = game.units.find(
    (unit) =>
      unit.type ===
      (definition.domain === "naval" ? "titan_carrier" : "plasma_tank"),
  );
  troop.type = type;
  troop.health = researchedStat(definition.health, level) - wounds;
  troop.carrier = null;
  game.units = [troop];
  const academy = game.buildings.find((building) => building.type === "house");
  academy.type = "academy";
  academy.level = 10;
  game.researchLevels = { [type]: level };
  game.research = [];
  loadGame(engine, game);
  return { engine, id: String(troop.id) };
}
const start = (engine, id) =>
  assert(
    engine.dispatch({ type: "BATTLE_START", payload: { unitIds: [id] } }).ok,
  );
const advance = (engine, ms) => {
  for (let time = 0; time < ms; time += 250)
    assert(engine.tick(Math.min(250, ms - time)).ok);
};

test("Researched shields and healing match unit cards and Academy stat formulas", async () => {
  for (const [type, level, percent, kind] of [
    ["infantry", 4, 50, "Healing"],
    ["frigate", 3, 45, "Healing"],
    ["heavy_infantry", 3, 50, "Shield"],
    ["attack_submarine", 3, 100, "Shield"],
  ]) {
    const { engine, id } = await army(type, level);
    try {
      const state = engine.getState();
      const unit = state.unitCatalog.find((unit) => unit.id === type);
      const expected = Math.floor((unit.effectiveHealth * percent) / 100);
      assert.equal(unit[`effective${kind}`], expected);
      const shown = researchUnitDefinition(
        state,
        config.units.find((unit) => unit.id === type),
      );
      assert.equal(shown[kind.toLowerCase()], expected);
      const fallback = researchUnitDefinition(
        { researchLevels: { [type]: level } },
        config.units.find((unit) => unit.id === type),
      );
      assert.equal(fallback[kind.toLowerCase()], expected);
      start(engine, id);
      const fighter = engine
        .getState()
        .battle.fighters.find((f) => f.id === id);
      assert.equal(
        fighter[kind === "Shield" ? "shield" : "healing"],
        Math.floor((fighter.maxHealth * percent) / 100),
      );
      assert(engine.load(engine.save()).ok);
    } finally {
      engine.dispose();
    }
  }
});

test("Frigate exposes friendly heal targets and spends its action healing instead of attacking", async () => {
  const { engine, id } = await army("frigate", 3, 80);
  try {
    start(engine, id);
    const before = engine.getState().battle;
    const healer = before.fighters.find((f) => f.id === id);
    assert.deepEqual(healer.validHealTargets, [id]);
    const options = engine.dispatch({
      type: "BATTLE_OPTIONS",
      payload: { id },
    });
    assert.deepEqual(options.healTargets, [id]);
    const enemy = before.fighters.find((f) => f.enemy);
    // Save timestamps can advance while a rejected command leaves the game unchanged.
    const unchanged = engine.getState();
    assert(
      !engine.dispatch({
        type: "BATTLE_HEAL",
        payload: { id, target: enemy.id },
      }).ok,
    );
    assert.deepEqual(engine.getState(), unchanged);
    assert(
      engine.dispatch({ type: "BATTLE_HEAL", payload: { id, target: id } }).ok,
    );
    const after = engine.getState().battle;
    assert.equal(
      after.fighters.find((f) => f.id === id).health,
      healer.maxHealth,
    );
    assert(after.fighters.find((f) => f.id === id).attacked);
    assert.equal(
      after.fighters.find((f) => f.id === enemy.id).health,
      enemy.health,
    );
    assert.equal(after.lastAttacks[0].healing, 80);
    assert.equal(after.lastAttacks[0].damage, 0);
    assert.equal(after.actions, before.actions + 1);
    assert(
      !engine.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id, target: enemy.id },
      }).ok,
    );
    assert(engine.load(engine.save()).ok);
    advance(engine, 2000);
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});

test("Armored Jeep reduces base attack and damages every valid enemy in one action", async () => {
  const { engine, id } = await army("armored_jeep");
  try {
    assert.equal(
      engine.getState().unitCatalog.find((unit) => unit.id === "armored_jeep")
        .baseDamage,
      48,
    );
    start(engine, id);
    const before = engine.getState().battle;
    const actor = before.fighters.find((f) => f.id === id);
    assert(actor.validTargets.length > 1);
    assert(
      engine.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id, target: actor.validTargets[0] },
      }).ok,
    );
    const after = engine.getState().battle;
    assert.deepEqual(
      new Set(after.lastAttacks.map((hit) => hit.target)),
      new Set(actor.validTargets),
    );
    assert.equal(after.actions, before.actions + 1);
    for (const hit of after.lastAttacks)
      assert(hit.damage + hit.shieldDamage > 0 || hit.missed);
    assert(engine.load(engine.save()).ok);
  } finally {
    engine.dispose();
  }
});
