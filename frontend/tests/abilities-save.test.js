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
  new URL(
    "../../tests/fixtures/empires-of-wars-145.save.json",
    import.meta.url,
  ),
  "utf8",
);

function priorConfig() {
  const prior = structuredClone(config);
  delete prior.unitAbilityVersion;
  const changes = {
    infantry: { abilities: [], role: "Cheap starting squad" },
    heavy_infantry: {
      abilities: ["anti_infantry"],
      shield: 0,
      role: "Anti-infantry fire support",
    },
    armored_jeep: {
      abilities: ["anti_infantry"],
      damage: 65,
      role: "Fast infantry raider",
    },
    frigate: {
      abilities: ["detect_submarines"],
      validTargets: ["naval", "air"],
      role: "Anti-air and anti-submarine escort",
    },
    attack_submarine: {
      abilities: ["submerged", "stealth"],
      shield: 0,
      role: "Hidden anti-ship torpedo attacks",
    },
  };
  for (const unit of prior.units) Object.assign(unit, changes[unit.id] || {});
  return prior;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      )
    : value;
}
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
async function army(rules = config) {
  const engine = await GameEngine.create({
    factory,
    config: rules,
    wasmBinary,
  });
  assert(engine.load(fixture).ok);
  const game = exactGame(engine);
  for (const building of game.buildings)
    if (
      ["townhall", "academy", "barracks", "harbor", "airbase"].includes(
        building.type,
      )
    )
      building.level = 10;
  load(engine, game);
  return engine;
}
const researched = (base, level = 0) =>
  Math.floor((base * 21 ** level) / 20 ** level);
function replaceFighter(game, fighter, type, rules, level = 0) {
  const definition = rules.units.find((unit) => unit.id === type);
  const home = game.units.find((unit) => unit.id === fighter.id);
  home.type = type;
  home.reserve = true;
  home.health = Math.min(home.health, researched(definition.health, level));
  const healthBonus = rules.technologies
    .filter(
      (technology) =>
        game.technologies.includes(technology.id) &&
        technology.domain === definition.domain,
    )
    .reduce((sum, technology) => sum + technology.healthBonus, 0);
  const damageBonus = rules.technologies
    .filter(
      (technology) =>
        game.technologies.includes(technology.id) &&
        technology.domain === definition.domain,
    )
    .reduce((sum, technology) => sum + technology.damageBonus, 0);
  Object.assign(fighter, {
    type,
    maxHealth: researched(definition.health, level) + healthBonus,
    damage: researched(definition.damage, level) + damageBonus,
    defense: definition.defense,
    range: definition.range,
    movement: definition.movement,
    shield: definition.shield,
  });
  fighter.health = fighter.maxHealth - 20;
}

test("Exact previous rules migrate active researched shields and Jeep damage once", async () => {
  const prior = priorConfig(),
    old = await army(prior),
    current = await army();
  try {
    const before = exactGame(old);
    before.researchLevels = { heavy_infantry: 2, armored_jeep: 2 };
    load(old, before);
    const ids = old
      .getState()
      .units.filter((unit) => unit.type === "infantry")
      .slice(0, 4)
      .map((unit) => unit.id);
    assert(
      old.dispatch({ type: "BATTLE_START", payload: { unitIds: ids } }).ok,
    );
    const game = exactGame(old),
      friends = game.battle.fighters.filter((fighter) => !fighter.enemy);
    replaceFighter(game, friends[1], "heavy_infantry", prior, 2);
    replaceFighter(game, friends[2], "armored_jeep", prior, 2);
    replaceFighter(game, friends[3], "plasma_tank", prior);
    friends[3].shield -= 11;
    load(old, game);
    assert(current.load(old.save()).ok);
    let upgraded = exactGame(current);
    const heavy = upgraded.battle.fighters.find(
      (fighter) => fighter.type === "heavy_infantry",
    );
    const jeep = upgraded.battle.fighters.find(
      (fighter) => fighter.type === "armored_jeep",
    );
    const plasma = upgraded.battle.fighters.find(
      (fighter) => fighter.type === "plasma_tank",
    );
    assert.equal(heavy.shield, Math.floor(heavy.maxHealth / 2));
    assert.equal(heavy.health, friends[1].health);
    assert.equal(
      jeep.damage,
      friends[2].damage + researched(48, 2) - researched(65, 2),
    );
    assert.equal(plasma.shield, friends[3].shield);
    assert.equal(upgraded.config.unitAbilityVersion, 1);
    assert.equal(upgraded.battle.combatVersion, 8);
    heavy.shield -= 17;
    load(current, upgraded);
    const saved = current.save();
    assert(current.load(saved).ok);
    upgraded = exactGame(current);
    assert.equal(
      upgraded.battle.fighters.find((fighter) => fighter.id === heavy.id)
        .shield,
      heavy.shield,
    );
    assert.equal(
      upgraded.battle.fighters.find((fighter) => fighter.id === jeep.id).damage,
      jeep.damage,
    );
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Old Attack Submarine gains its researched HP shield and never refills on reload", async () => {
  const prior = priorConfig(),
    old = await army(prior),
    current = await army();
  try {
    const before = exactGame(old);
    before.researchLevels = { attack_submarine: 3 };
    load(old, before);
    const id = old.getState().units.find((unit) => unit.type === "ship").id;
    assert(
      old.dispatch({ type: "BATTLE_START", payload: { unitIds: [id] } }).ok,
    );
    const game = exactGame(old),
      fighter = game.battle.fighters.find((unit) => !unit.enemy);
    replaceFighter(game, fighter, "attack_submarine", prior, 3);
    load(old, game);
    assert(current.load(old.save()).ok);
    const upgraded = exactGame(current),
      submarine = upgraded.battle.fighters.find((unit) => !unit.enemy);
    assert.equal(submarine.shield, submarine.maxHealth);
    submarine.shield -= 80;
    load(current, upgraded);
    assert(current.load(current.save()).ok);
    assert.equal(
      exactGame(current).battle.fighters.find((unit) => !unit.enemy).shield,
      submarine.shield,
    );
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Healing events persist including Recruit self healing and reject forged friendly damage", async () => {
  const engine = await army();
  try {
    const id = engine
      .getState()
      .units.find((unit) => unit.type === "infantry").id;
    assert(
      engine.dispatch({ type: "BATTLE_START", payload: { unitIds: [id] } }).ok,
    );
    const game = exactGame(engine),
      recruit = game.battle.fighters.find((unit) => !unit.enemy);
    game.battle.lastAttacks = [
      {
        attacker: recruit.id,
        target: recruit.id,
        damage: 0,
        shieldDamage: 0,
        missed: false,
        healing: 25,
      },
    ];
    load(engine, game);
    assert.equal(exactGame(engine).battle.lastAttacks[0].healing, 25);
    assert(engine.load(engine.save()).ok);
    for (const edit of [
      (event) => {
        event.damage = 1;
      },
      (event) => {
        event.healing = recruit.maxHealth;
      },
      (event) => {
        event.missed = true;
      },
      (event) => {
        event.healing = 0;
      },
      (event) => {
        event.target = game.battle.fighters.find((unit) => unit.enemy).id;
      },
    ]) {
      const bad = structuredClone(game);
      edit(bad.battle.lastAttacks[0]);
      assert.equal(engine.load(pack(bad)).ok, false);
      assert.equal(exactGame(engine).battle.lastAttacks[0].healing, 25);
    }
  } finally {
    engine.dispose();
  }
});

test("Previous balance migration rejects unrecognized numeric configuration changes", async () => {
  const old = await army(priorConfig()),
    engine = await army();
  try {
    const bad = exactGame(old);
    bad.config.units.find((unit) => unit.id === "armored_jeep").damage++;
    assert.equal(engine.load(pack(bad)).ok, false);
    assert.equal(exactGame(engine).config.unitAbilityVersion, 1);
    assert(engine.load(old.save()).ok);
  } finally {
    old.dispose();
    engine.dispose();
  }
});

test("Old Frigate turns yield to attacking aircraft when their former air targets are removed", async () => {
  const prior = priorConfig(),
    old = await army(prior),
    current = await army();
  try {
    const id = old.getState().units.find((unit) => unit.type === "ship").id;
    assert(
      old.dispatch({ type: "BATTLE_START", payload: { unitIds: [id] } }).ok,
    );
    const game = exactGame(old),
      frigate = game.battle.fighters.find((unit) => !unit.enemy);
    replaceFighter(game, frigate, "frigate", prior);
    frigate.health = frigate.maxHealth;
    for (const enemy of game.battle.fighters.filter((unit) => unit.enemy)) {
      enemy.type = "attack_aircraft";
      enemy.domain = "air";
    }
    load(old, game);
    assert.equal(old.getState().battle.enemyTurn, false);
    assert(current.load(old.save()).ok);
    const upgraded = current.getState().battle;
    assert.equal(upgraded.finished, false);
    assert.equal(upgraded.enemyTurn, true);
    assert.equal(upgraded.actions, game.battle.actions);
    for (let step = 0; step < 4; step++) assert(current.tick(250).ok);
    assert.equal(current.getState().battle.actions, upgraded.actions + 1);
    assert(current.load(current.save()).ok);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Old committed campaign shields migrate alongside the active squad", async () => {
  const prior = priorConfig(),
    old = await army(prior),
    current = await army();
  try {
    const before = exactGame(old);
    before.researchLevels = { heavy_infantry: 2 };
    load(old, before);
    const id = old.getState().units.find((unit) => unit.type === "infantry").id;
    assert(
      old.dispatch({
        type: "BATTLE_START",
        payload: { campaignLevel: 1, unitIds: [id] },
      }).ok,
    );
    const game = exactGame(old),
      heavy = game.battle.fighters.find((unit) => !unit.enemy);
    replaceFighter(game, heavy, "heavy_infantry", prior, 2);
    game.units.find((unit) => unit.id === heavy.id).reserve = false;
    game.battle.campaignArmy[0] = structuredClone(heavy);
    load(old, game);
    assert(current.load(old.save()).ok);
    const upgraded = exactGame(current),
      active = upgraded.battle.fighters.find((unit) => !unit.enemy);
    assert.equal(active.shield, Math.floor(active.maxHealth / 2));
    assert.equal(upgraded.battle.campaignArmy[0].shield, active.shield);
    active.shield -= 31;
    upgraded.battle.campaignArmy[0] = structuredClone(active);
    load(current, upgraded);
    assert(current.load(current.save()).ok);
    assert.equal(
      exactGame(current).battle.campaignArmy[0].shield,
      active.shield,
    );
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Frigate friendly healing logs survive saving with their researched healing cap", async () => {
  const engine = await army();
  try {
    const before = exactGame(engine);
    before.researchLevels = { frigate: 2 };
    load(engine, before);
    const ids = engine
      .getState()
      .units.filter((unit) => unit.type === "ship")
      .map((unit) => unit.id);
    assert(
      engine.dispatch({ type: "BATTLE_START", payload: { unitIds: ids } }).ok,
    );
    const game = exactGame(engine),
      friends = game.battle.fighters.filter((unit) => !unit.enemy);
    replaceFighter(game, friends[0], "frigate", config, 2);
    const healing = Math.floor(friends[0].maxHealth * 0.45);
    friends[1].maxHealth = friends[1].health = Math.max(
      healing + 1,
      friends[1].maxHealth,
    );
    game.battle.lastAttacks = [
      {
        attacker: friends[0].id,
        target: friends[1].id,
        damage: 0,
        shieldDamage: 0,
        missed: false,
        healing,
      },
    ];
    load(engine, game);
    assert(engine.load(engine.save()).ok);
    assert.equal(exactGame(engine).battle.lastAttacks[0].healing, healing);
  } finally {
    engine.dispose();
  }
});

test("Aircraft balance upgrades old wounded aircraft once and preserves strict save validation", async () => {
  const prior = structuredClone(config);
  for (const unit of prior.units) {
    const old = config.aircraftBalanceMigration.units.find(
      (entry) => entry.id === unit.id,
    );
    if (old) Object.assign(unit, structuredClone(old));
  }
  // Historical aircraft had neither allied healing nor all-aircraft attacks.
  prior.units.find((unit) => unit.id === "strike_fighter").abilities = [
    "surface_strike",
  ];
  prior.units.find((unit) => unit.id === "plasma_fighter").abilities = [
    "energy_shield",
  ];
  delete prior.aircraftBalanceVersion;
  delete prior.aircraftBalanceMigration;
  const old = await GameEngine.create({ factory, config: prior, wasmBinary });
  const current = await GameEngine.create({ factory, config, wasmBinary });
  try {
    assert(old.load(fixture).ok);
    const saved = exactGame(old);
    const plane = saved.units.find((unit) => unit.type === "aircraft");
    assert(plane);
    plane.health = 45;
    load(old, saved);
    assert(current.load(old.save()).ok);
    const upgraded = current
      .getState()
      .units.find((unit) => unit.id === String(plane.id));
    assert.equal(upgraded.maxHealth, 120);
    assert.equal(upgraded.health, 60);
    assert.equal(upgraded.damage, 70);
    const once = current.save();
    assert(current.load(once).ok);
    assert.equal(
      current.getState().units.find((unit) => unit.id === String(plane.id))
        .health,
      60,
    );
    const forged = exactGame(old);
    forged.config.units.find((unit) => unit.id === "aircraft").damage++;
    assert.equal(current.load(pack(forged)).ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Armored Carrier healing upgrades existing battles without changing their paid progress or combat stats", async () => {
  const prior = structuredClone(config);
  delete prior.armoredCarrierHealingVersion;
  Object.assign(
    prior.units.find((unit) => unit.id === "armored_carrier"),
    {
      abilities: [],
      role: "Balanced armored support",
    },
  );
  const old = await army(prior);
  const current = await army();
  try {
    const before = exactGame(old);
    before.researchLevels.armored_carrier = 2;
    load(old, before);
    const ids = old
      .getState()
      .units.filter((unit) => unit.type === "infantry")
      .slice(0, 3)
      .map((unit) => unit.id);
    assert(
      old.dispatch({ type: "BATTLE_START", payload: { unitIds: ids } }).ok,
    );
    const battle = exactGame(old);
    const friends = battle.battle.fighters.filter((unit) => !unit.enemy);
    replaceFighter(battle, friends[0], "armored_carrier", prior, 2);
    friends[1].health = 1;
    load(old, battle);
    const oldState = exactGame(old);
    assert(current.load(old.save()).ok);
    const upgraded = exactGame(current);
    const comparable = structuredClone(upgraded);
    comparable.config = oldState.config;
    assert.deepEqual(comparable, oldState);
    const healer = current
      .getState()
      .battle.fighters.find((unit) => unit.type === "armored_carrier");
    assert.equal(healer.healing, Math.floor(healer.maxHealth * 0.45));
    assert(healer.validHealTargets.includes(String(friends[1].id)));
    const target = current
      .getState()
      .battle.fighters.find((unit) => unit.id === String(friends[1].id));
    const restored = Math.min(target.maxHealth - target.health, healer.healing);
    assert(
      current.dispatch({
        type: "BATTLE_HEAL",
        payload: { id: healer.id, target: target.id },
      }).ok,
    );
    assert(current.load(current.save()).ok);
    assert.equal(current.getState().battle.lastAttacks[0].healing, restored);
    const academy = current
      .getState()
      .buildings.find((building) => building.type === "academy");
    const option = academy.researchOptions.find(
      (option) => option.type === "armored_carrier",
    );
    assert.equal(option.currentHealing, 118);
    assert.equal(option.nextHealing, Math.floor(researched(240, 3) * 0.45));
    const bad = exactGame(old);
    bad.config.units.find((unit) => unit.id === "armored_carrier").damage++;
    assert.equal(current.load(pack(bad)).ok, false);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("One remaining shield point protects health through the breaking hit and stays broken after reload", async () => {
  for (const explicit of [false, true]) {
    const prior = structuredClone(config);
    if (explicit) prior.battle.shieldBreakStopsDamage = false;
    else delete prior.battle.shieldBreakStopsDamage;
    const old = await army(prior);
    const current = await army();
    try {
      const id = old
        .getState()
        .units.find((unit) => unit.type === "infantry").id;
      assert(
        old.dispatch({ type: "BATTLE_START", payload: { unitIds: [id] } }).ok,
      );
      const game = exactGame(old);
      const target = game.battle.fighters.find((unit) => !unit.enemy);
      replaceFighter(game, target, "heavy_infantry", prior);
      target.shield = 1;
      for (const foe of game.battle.fighters.filter((unit) => unit.enemy))
        foe.damage = 1000;
      game.battle.enemyTurn = true;
      game.battle.pendingMs = 0;
      load(old, game);
      const before = exactGame(old);
      assert(current.load(old.save()).ok);
      const migrated = exactGame(current);
      migrated.config = before.config;
      delete before.savedAtUTC;
      delete migrated.savedAtUTC;
      assert.deepEqual(migrated, before);
      for (let step = 0; step < 4; step++) assert(current.tick(250).ok);
      let state = current.getState();
      let protectedUnit = state.battle.fighters.find((unit) => unit.id === id);
      assert.equal(protectedUnit.shield, 0);
      assert.equal(protectedUnit.health, target.health);
      assert.equal(state.battle.lastAttacks[0].damage, 0);
      assert.equal(state.battle.lastAttacks[0].shieldDamage, 1);
      assert(current.load(current.save()).ok);
      assert.equal(
        current.getState().battle.fighters.find((unit) => unit.id === id)
          .shield,
        0,
      );
      for (let step = 0; step < 4; step++) assert(current.tick(250).ok);
      state = current.getState();
      protectedUnit = state.battle.fighters.find((unit) => unit.id === id);
      assert.equal(protectedUnit.health, 0);
      assert(state.battle.lastAttacks[0].damage > 0);
      assert.equal(state.battle.lastAttacks[0].shieldDamage, 0);
      assert(current.load(current.save()).ok);
      const forged = exactGame(old);
      forged.config.battle.shieldBreakStopsDamage = "yes";
      assert.equal(current.load(pack(forged)).ok, false);
    } finally {
      old.dispose();
      current.dispose();
    }
  }
});
