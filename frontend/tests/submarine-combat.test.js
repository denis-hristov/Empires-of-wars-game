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
const unit = (type) =>
  config.units.find((definition) => definition.id === type);
const enemies = (battle) => battle.fighters.filter((fighter) => fighter.enemy);
const allies = (battle) => battle.fighters.filter((fighter) => !fighter.enemy);

// Preserve unsigned enemy IDs and recompute the normal save checksum after fixture edits.
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
function snapshot(engine) {
  const game = exactGame(engine);
  delete game.savedAtUTC;
  return game;
}
async function campaign51() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(fixture).ok);
  const game = exactGame(engine);
  const harborUnit = structuredClone(
    game.units.find((entry) => entry.id === 40),
  );
  game.units = game.units.filter((entry) => [45, 47].includes(entry.id));
  for (const entry of game.units) {
    entry.type = entry.id === 45 ? "heavy_infantry" : "aircraft";
    entry.health = unit(entry.type).health;
    entry.carrier = null;
    entry.reserve = false;
  }
  const world = engine.getWorld();
  const occupied = new Set();
  const occupy = (position, footprint) => {
    for (let y = 0; y < footprint[1]; y++)
      for (let x = 0; x < footprint[0]; x++)
        occupied.add(`${position[0] + x},${position[1] + y}`);
  };
  for (const building of game.buildings)
    occupy(
      building.position,
      config.buildings.find((entry) => entry.id === building.type).footprint,
    );
  for (const entry of game.units)
    occupy(entry.position, unit(entry.type).footprint);
  for (let index = 0; index < 5; index++) {
    const entry = structuredClone(harborUnit);
    entry.id = index === 0 ? 40 : game.nextId++;
    entry.type = index < 3 ? "attack_submarine" : "frigate";
    entry.health = unit(entry.type).health;
    entry.carrier = null;
    entry.reserve = false;
    const [width, height] = unit(entry.type).footprint;
    let position;
    for (let y = 0; y <= world.height - height && !position; y++)
      for (let x = 0; x <= world.width - width && !position; x++) {
        let valid = true;
        for (let dy = 0; dy < height; dy++)
          for (let dx = 0; dx < width; dx++)
            if (
              world.tiles[(y + dy) * world.width + x + dx] !== 0 ||
              occupied.has(`${x + dx},${y + dy}`)
            )
              valid = false;
        if (valid) position = [x, y];
      }
    assert(position, "Five non-overlapping naval footprints are available");
    entry.position = position;
    occupy(position, [width, height]);
    game.units.push(entry);
  }
  game.campaign = {
    currentLevel: 51,
    completedLevels: Array.from({ length: 50 }, (_, n) => n + 1),
    completed: false,
  };
  load(engine, game);
  const start = engine.dispatch({
    type: "BATTLE_START",
    payload: {
      campaignLevel: 51,
      unitIds: game.units.map((entry) => String(entry.id)),
      automatic: true,
    },
  });
  assert(start.ok, start.message);
  const land = exactGame(engine);
  for (const fighter of allies(land.battle)) {
    fighter.damage = 999999;
    fighter.health = fighter.maxHealth = 900000;
    fighter.defense = 999999;
  }
  load(engine, land);
  for (
    let step = 0;
    step < 400 && engine.getState().battle.phaseIndex === 0;
    step++
  )
    assert(engine.tick(250).ok);
  const naval = exactGame(engine);
  assert.equal(naval.battle.phaseIndex, 1);
  assert.equal(naval.battle.domain, "naval");
  assert.deepEqual(
    enemies(naval.battle).map((entry) => entry.enemyId),
    ["W02", "W01", "W01", "W06", "W06"],
  );
  assert.deepEqual(
    allies(naval.battle).map((entry) => entry.type),
    [
      "attack_submarine",
      "attack_submarine",
      "attack_submarine",
      "frigate",
      "frigate",
    ],
  );
  for (const fighter of naval.battle.fighters) {
    if (
      (!fighter.enemy && fighter.type === "frigate") ||
      (fighter.enemy && fighter.enemyId !== "W06")
    )
      fighter.health = fighter.shield = 0;
    fighter.attacked = false;
    fighter.readyRound = 1;
  }
  naval.battle.round = 10;
  naval.battle.enemyTurn = false;
  naval.battle.pendingMs = 0;
  naval.battle.lastAttacks = [];
  load(engine, naval);
  return engine;
}
function ticks(engine, count = 4) {
  for (let step = 0; step < count; step++) {
    const result = engine.tick(250);
    assert(result.ok, result.message);
  }
}
function livingSubs(battle, enemy) {
  return battle.fighters.filter(
    (fighter) =>
      !!fighter.enemy === enemy &&
      fighter.type === "attack_submarine" &&
      fighter.health > 0,
  );
}

test("Campaign 51 submarine survivors can attack both W06 enemies after both Frigates die, exchange torpedoes and advance normally", async () => {
  const engine = await campaign51();
  try {
    const initial = exactGame(engine);
    assert.equal(livingSubs(initial.battle, false).length, 3);
    assert.equal(livingSubs(initial.battle, true).length, 2);
    ticks(engine);
    let game = exactGame(engine);
    assert.equal(
      game.battle.finished,
      false,
      `The fleet must continue fighting: ${JSON.stringify({ finished: game.battle.finished, retreated: game.battle.retreated, survivingSubmarines: livingSubs(game.battle, false).length, outcomes: game.battle.outcomes })}`,
    );
    assert(
      game.battle.lastAttacks.some(
        (hit) =>
          livingSubs(initial.battle, false).some(
            (fighter) => fighter.id === hit.attacker,
          ) &&
          livingSubs(initial.battle, true).some(
            (fighter) => fighter.id === hit.target,
          ),
      ),
      "A player submarine fires at an enemy submarine",
    );
    assert(engine.dispatch({ type: "BATTLE_AUTO" }).ok);
    const state = engine.getState().battle;
    const enemyIds = state.fighters
      .filter((fighter) => fighter.enemy && fighter.health > 0)
      .map((fighter) => fighter.id);
    for (const submarine of state.fighters.filter(
      (fighter) => !fighter.enemy && fighter.health > 0 && !fighter.attacked,
    ))
      assert.deepEqual(
        new Set(submarine.validTargets),
        new Set(enemyIds),
        "Every ready submarine can target both submerged enemies without an escort",
      );

    game = exactGame(engine);
    game.battle.enemyTurn = true;
    game.battle.pendingMs = 0;
    game.battle.lastAttacks = [];
    for (const fighter of game.battle.fighters)
      fighter.attacked = !fighter.enemy;
    load(engine, game);
    ticks(engine);
    const counterattack = exactGame(engine);
    assert.equal(counterattack.battle.finished, false);
    assert(
      counterattack.battle.lastAttacks.some(
        (hit) =>
          livingSubs(game.battle, true).some(
            (fighter) => fighter.id === hit.attacker,
          ) &&
          livingSubs(game.battle, false).some(
            (fighter) => fighter.id === hit.target,
          ),
      ),
      "The same underwater targeting rule lets enemy submarines fire back",
    );
    const active = snapshot(engine);
    load(engine, exactGame(engine));
    assert.deepEqual(
      snapshot(engine),
      active,
      "An active submarine-only fight resumes unchanged",
    );

    // Accelerate damage only after proving both sides can fight with their normal statistics.
    game = exactGame(engine);
    game.battle.automatic = true;
    game.battle.enemyTurn = false;
    game.battle.pendingMs = 0;
    for (const fighter of livingSubs(game.battle, false)) {
      fighter.damage = 999999;
      fighter.attacked = false;
      fighter.readyRound = 1;
    }
    load(engine, game);
    for (
      let step = 0;
      step < 400 &&
      !engine.getState().battle.finished &&
      engine.getState().battle.phaseIndex === 1;
      step++
    )
      ticks(engine, 1);
    const next = exactGame(engine);
    assert.equal(next.battle.finished, false);
    assert.equal(next.battle.phaseIndex, 2);
    assert.equal(next.battle.domain, "air");
    assert.deepEqual(next.battle.outcomes, [1, 1]);
    assert.deepEqual(next.stock, initial.stock);
    assert.deepEqual(
      next.campaign.completedLevels,
      initial.campaign.completedLevels,
    );
  } finally {
    engine.dispose();
  }
});

test("A saved version-seven false submarine retreat reopens once without changing health, shields, rewards or progress", async () => {
  const engine = await campaign51();
  try {
    const old = exactGame(engine);
    Object.assign(old.battle, {
      combatVersion: 7,
      finished: true,
      retreated: true,
      victory: false,
      draw: false,
      enemyTurn: false,
      pendingMs: 0,
      outcomes: [1, 0],
    });
    load(engine, old);
    const restored = exactGame(engine);
    assert.equal(restored.battle.finished, false);
    assert.equal(restored.battle.retreated, false);
    assert.equal(restored.battle.victory, false);
    assert.equal(restored.battle.draw, false);
    assert.equal(restored.battle.phaseIndex, 1);
    assert.deepEqual(restored.battle.outcomes, [1]);
    assert.deepEqual(
      restored.battle.fighters.map((fighter) => [
        fighter.id,
        fighter.health,
        fighter.shield,
      ]),
      old.battle.fighters.map((fighter) => [
        fighter.id,
        fighter.health,
        fighter.shield,
      ]),
    );
    for (const key of [
      "stock",
      "civilian",
      "units",
      "campaign",
      "appliedRewards",
    ])
      assert.deepEqual(restored[key], old[key], key);
    const expected = snapshot(engine);
    for (let reload = 0; reload < 3; reload++) {
      load(engine, exactGame(engine));
      assert.deepEqual(snapshot(engine), expected);
    }
    ticks(engine);
    assert.equal(engine.getState().battle.finished, false);
  } finally {
    engine.dispose();
  }
});

test("Legitimate manual retreats and the 200-round limit remain final defeats", async () => {
  const engine = await campaign51();
  try {
    const original = exactGame(engine);
    for (const reason of ["manual", "round limit"]) {
      const old = structuredClone(original);
      Object.assign(old.battle, {
        combatVersion: 7,
        finished: true,
        retreated: true,
        victory: false,
        draw: false,
        enemyTurn: false,
        pendingMs: 0,
        outcomes: [1, 0],
      });
      if (reason === "round limit") old.battle.round = 200;
      else {
        const frigate = old.battle.fighters.find(
          (fighter) => !fighter.enemy && fighter.type === "frigate",
        );
        frigate.health = frigate.maxHealth;
      }
      load(engine, old);
      const restored = exactGame(engine);
      assert.equal(restored.battle.finished, true, reason);
      assert.equal(restored.battle.retreated, true, reason);
      assert.equal(restored.battle.victory, false, reason);
      assert.deepEqual(restored.battle.outcomes, [1, 0], reason);
      load(engine, exactGame(engine));
      assert.equal(engine.getState().battle.finished, true, reason);
    }
  } finally {
    engine.dispose();
  }
});

test("Restoring a submarine deadlock preserves enemy attacks already spent in the interrupted turn", async () => {
  const engine = await campaign51();
  try {
    const old = exactGame(engine);
    Object.assign(old.battle, {
      combatVersion: 7,
      finished: true,
      retreated: true,
      victory: false,
      draw: false,
      enemyTurn: false,
      pendingMs: 0,
      outcomes: [1, 0],
    });
    const enemySubs = livingSubs(old.battle, true);
    const fallenFrigate = old.battle.fighters.find(
      (f) => !f.enemy && f.type === "frigate",
    );
    for (const fighter of old.battle.fighters) fighter.attacked = true;
    enemySubs[1].attacked = false;
    old.battle.lastAttacks = [
      {
        attacker: enemySubs[0].id,
        target: fallenFrigate.id,
        damage: 1,
        shieldDamage: 0,
        healing: 0,
        missed: false,
      },
    ];
    load(engine, old);
    const restored = exactGame(engine);
    assert.equal(restored.battle.enemyTurn, true);
    assert.equal(restored.battle.round, old.battle.round);
    assert.deepEqual(
      restored.battle.fighters.map((f) => [
        f.id,
        f.health,
        f.shield,
        f.attacked,
      ]),
      old.battle.fighters.map((f) => [f.id, f.health, f.shield, f.attacked]),
    );
    ticks(engine);
    const next = exactGame(engine);
    assert.equal(next.battle.actions, old.battle.actions + 1);
    assert.equal(
      next.battle.lastAttacks[0].attacker,
      enemySubs[1].id,
      "The surviving enemy with an unused action continues; the previous attacker does not strike twice",
    );
    assert.equal(next.battle.round, old.battle.round + 1);
  } finally {
    engine.dispose();
  }
});
