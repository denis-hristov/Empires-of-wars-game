import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { loadGame } from "./helpers/population.js";
import { potionSlots } from "../src/game/Magic.js";
import { exactCombatGame, loadCombatGame } from "./helpers/naval-case.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const oldSave = await readFile(
  new URL(
    "../../tests/fixtures/empires-of-wars-145.save.json",
    import.meta.url,
  ),
  "utf8",
);
async function empire() {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  assert(engine.load(oldSave).ok);
  const game = JSON.parse(engine.save()).game;
  game.stock.fill(1_000_000);
  game.buildings.find((b) => b.type === "townhall").level = 9;
  loadGame(engine, game);
  const world = engine.getWorld();
  let built = false;
  for (let y = 0; y < world.height && !built; ++y)
    for (let x = 0; x < world.width && !built; ++x) {
      const result = engine.dispatch({
        type: "BUILD",
        payload: { buildingType: "laboratory", x, y },
      });
      if (result.ok) built = true;
    }
  assert(built);
  const labId = engine
    .getState()
    .buildings.find((b) => b.type === "laboratory").id;
  const wait = () => {
    for (let i = 0; i < 300; ++i) engine.tick(250);
  };
  wait();
  for (let i = 0; i < 3; ++i) {
    assert(engine.dispatch({ type: "UPGRADE", payload: { id: labId } }).ok);
    wait();
  }
  return { engine, labId };
}
function command(engine, type, payload = {}) {
  return engine.dispatch({ type, payload });
}

test("Laboratory migrates historical saves, occupies 2x2 and caps storage at five across reloads", async () => {
  const { engine, labId } = await empire();
  try {
    const lab = engine.getState().buildings.find((b) => b.id === labId);
    assert.deepEqual(lab.footprint, [2, 2]);
    assert.equal(lab.completedLevel, 4);
    assert.equal(engine.getState().magic.level, 4);
    assert.equal(engine.getState().buildOptions.laboratory.ok, false);
    const before = engine.getState().stock[4];
    for (let i = 0; i < 5; ++i)
      assert(
        command(engine, "BREW_POTION", { id: labId, potionType: "heal" }).ok,
      );
    assert.equal(engine.getState().stock[4], before - 500);
    assert.equal(
      command(engine, "BREW_POTION", { id: labId, potionType: "revive" }).ok,
      false,
    );
    const saved = engine.save();
    assert(engine.load(saved).ok);
    assert.deepEqual(
      potionSlots(engine.getState().magic),
      Array(5).fill("heal"),
    );
    assert.equal(engine.getState().magic.options[0].brew.ok, false);
  } finally {
    engine.dispose();
  }
});

test("The engine confirmation freezes auto attack, cancels cleanly and consumes a token exactly once", async () => {
  const { engine, labId } = await empire();
  try {
    for (const potionType of ["attack", "shield", "heal", "revive"])
      assert(command(engine, "BREW_POTION", { id: labId, potionType }).ok);
    const unitIds = engine
      .getState()
      .units.filter(
        (u) => config.units.find((d) => d.id === u.type).domain === "land",
      )
      .slice(0, 3)
      .map((u) => u.id);
    assert(command(engine, "BATTLE_START", { unitIds, automatic: true }).ok);
    assert(
      command(engine, "BATTLE_POTION_SELECT", { potionType: "attack" }).ok,
    );
    let token = engine.getState().battle.potionToken;
    for (let i = 0; i < 20; ++i) engine.tick(250);
    assert.equal(engine.getState().battle.actions, 0);
    assert(command(engine, "BATTLE_POTION_CANCEL").ok);
    assert.equal(engine.getState().battle.automatic, true);
    assert.equal(
      command(engine, "BATTLE_POTION_USE", { potionType: "attack", token }).ok,
      false,
    );
    assert(
      command(engine, "BATTLE_POTION_SELECT", { potionType: "attack" }).ok,
    );
    token = engine.getState().battle.potionToken;
    assert(
      command(engine, "BATTLE_POTION_USE", { potionType: "attack", token }).ok,
    );
    assert.equal(
      command(engine, "BATTLE_POTION_USE", { potionType: "attack", token }).ok,
      false,
    );
    assert.equal(engine.getState().magic.potions[2], 0);
    assert.equal(engine.getState().battle.doubleAttack, true);
    assert(engine.load(engine.save()).ok);
    assert.equal(engine.getState().battle.doubleAttack, true);
    assert.equal(engine.getState().magic.used, 3);
    assert.equal(engine.getState().battle.potionPrompt, "");
  } finally {
    engine.dispose();
  }
});

test("Old saves start without potions and invalid potion types leave the live state intact", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    assert(engine.load(oldSave).ok);
    assert.equal(engine.getState().magic.level, 0);
    assert.deepEqual(engine.getState().magic.potions, [0, 0, 0, 0]);
    const before = engine.save();
    assert.equal(
      command(engine, "BREW_POTION", { id: "1", potionType: "fifth_spell" }).ok,
      false,
    );
    assert.equal(
      JSON.parse(engine.save()).game.magic.sequence,
      JSON.parse(before).game.magic.sequence,
    );
    assert.deepEqual(potionSlots(engine.getState().magic), [
      null,
      null,
      null,
      null,
      null,
    ]);
  } finally {
    engine.dispose();
  }
});

test("Removing a potion refunds 20 gold, frees one slot and rejects replay even after refill or reload", async () => {
  const { engine, labId } = await empire();
  try {
    for (const potionType of ["heal", "heal", "shield", "attack", "revive"])
      assert(command(engine, "BREW_POTION", { id: labId, potionType }).ok);
    const before = engine.getState();
    const payload = {
      id: labId,
      potionType: "heal",
      sequence: before.magic.sequence,
    };
    assert.equal(before.magic.options[0].brew.ok, false);
    assert.equal(before.magic.options[0].remove.ok, true);
    assert.equal(before.magic.options[0].remove.gold, 20);
    assert(command(engine, "REMOVE_POTION", payload).ok);
    let after = engine.getState();
    assert.deepEqual(after.magic.potions, [1, 1, 1, 1]);
    assert.equal(after.magic.used, 4);
    assert.equal(after.stock[4], before.stock[4] + 20);
    assert.deepEqual(after.stock.slice(0, 4), before.stock.slice(0, 4));
    assert.equal(after.magic.options[0].brew.ok, true);
    assert.equal(command(engine, "REMOVE_POTION", payload).ok, false);
    assert.equal(engine.getState().stock[4], after.stock[4]);
    assert(
      command(engine, "BREW_POTION", { id: labId, potionType: "heal" }).ok,
    );
    assert.equal(engine.getState().magic.potions[0], 2);
    assert.equal(command(engine, "REMOVE_POTION", payload).ok, false);
    for (const potionType of ["heal", "shield", "attack", "revive"]) {
      const state = engine.getState();
      assert(
        command(engine, "REMOVE_POTION", {
          id: labId,
          potionType,
          sequence: state.magic.sequence,
        }).ok,
      );
      assert.equal(engine.getState().stock[4], state.stock[4] + 20);
    }
    after = engine.getState();
    assert.deepEqual(after.magic.potions, [1, 0, 0, 0]);
    assert(engine.load(engine.save()).ok);
    assert.deepEqual(engine.getState().magic.potions, after.magic.potions);
    assert.deepEqual(engine.getState().stock, after.stock);
    assert.equal(command(engine, "REMOVE_POTION", payload).ok, false);
    assert.equal(engine.getState().stock[4], after.stock[4]);
  } finally {
    engine.dispose();
  }
});

test("Invalid potion removal cannot award gold, remove queued items or overflow the stockpile", async () => {
  const { engine, labId } = await empire();
  try {
    const before = engine.getState();
    for (const payload of [
      { id: labId, potionType: "heal", sequence: before.magic.sequence },
      { id: labId, potionType: "unknown", sequence: before.magic.sequence },
      { id: labId, potionType: "heal", sequence: -1 },
      { id: labId, potionType: "heal", sequence: 0.5 },
      { id: labId, potionType: "heal", sequence: "0" },
      { id: labId, potionType: "heal" },
    ])
      assert.equal(command(engine, "REMOVE_POTION", payload).ok, false);
    assert.deepEqual(engine.getState().stock, before.stock);
    assert.deepEqual(engine.getState().magic.potions, before.magic.potions);
    assert(
      command(engine, "BREW_POTION", { id: labId, potionType: "heal" }).ok,
    );
    const ready = engine.getState();
    const hall = ready.buildings.find((b) => b.type === "townhall");
    for (const id of [hall.id, "999999"])
      assert.equal(
        command(engine, "REMOVE_POTION", {
          id,
          potionType: "heal",
          sequence: ready.magic.sequence,
        }).ok,
        false,
      );
    assert.deepEqual(engine.getState().stock, ready.stock);
    assert.equal(engine.getState().magic.potions[0], 1);
    let game = JSON.parse(engine.save()).game;
    game.stock[4] = 1_000_000_000_000 - 20;
    loadGame(engine, game);
    assert.equal(engine.getState().magic.options[0].remove.ok, false);
    assert.equal(
      command(engine, "REMOVE_POTION", {
        id: labId,
        potionType: "heal",
        sequence: game.magic.sequence,
      }).ok,
      false,
    );
    assert.equal(engine.getState().magic.potions[0], 1);
    game = JSON.parse(engine.save()).game;
    game.stock[4]--;
    loadGame(engine, game);
    assert(
      command(engine, "REMOVE_POTION", {
        id: labId,
        potionType: "heal",
        sequence: game.magic.sequence,
      }).ok,
    );
    assert.equal(engine.getState().stock[4], 999_999_999_999);
    assert.equal(engine.getState().magic.potions[0], 0);
  } finally {
    engine.dispose();
  }
});

test("Potion removal is unavailable during battle and leaves combat and inventory unchanged", async () => {
  const { engine, labId } = await empire();
  try {
    assert(
      command(engine, "BREW_POTION", { id: labId, potionType: "heal" }).ok,
    );
    const unitIds = engine
      .getState()
      .units.filter(
        (u) => config.units.find((d) => d.id === u.type).domain === "land",
      )
      .slice(0, 3)
      .map((u) => u.id);
    assert(command(engine, "BATTLE_START", { unitIds }).ok);
    const before = engine.getState();
    assert.equal(
      command(engine, "REMOVE_POTION", {
        id: labId,
        potionType: "heal",
        sequence: before.magic.sequence,
      }).ok,
      false,
    );
    assert.deepEqual(engine.getState(), before);
  } finally {
    engine.dispose();
  }
});

// Active battle IDs exceed JavaScript's safe integer range.
function shieldGame(engine) {
  return JSON.parse(
    engine
      .save()
      .replace(
        /("(?:id|attacker|target)"\s*:\s*)(\d{16,})/g,
        '$1"__exactid_$2"',
      ),
  ).game;
}
function loadShieldGame(engine, game) {
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

test("Shield blocks an entire enemy hit, preserves native shields and stays consumed after reload", async () => {
  for (const nativeShield of [false, true]) {
    const { engine, labId } = await empire();
    try {
      for (let i = 0; i < 2; i++)
        assert(
          command(engine, "BREW_POTION", { id: labId, potionType: "shield" })
            .ok,
        );
      const unit = engine.getState().units.find((u) => u.type === "infantry");
      assert(unit);
      assert(command(engine, "BATTLE_START", { unitIds: [unit.id] }).ok);
      const game = shieldGame(engine);
      const ally = game.battle.fighters.find((f) => !f.enemy);
      const definition = config.units.find((u) => u.id === "heavy_infantry");
      ally.type = definition.id;
      game.units.find((u) => u.id === ally.id).type = definition.id;
      ally.defense = 0;
      ally.shield = nativeShield ? 1 : 0;
      for (const foe of game.battle.fighters.filter((f) => f.enemy)) {
        foe.damage = 10;
        foe.health = foe.maxHealth = 1000;
      }
      loadShieldGame(engine, game);
      const health = ally.health,
        shield = ally.shield;
      assert(
        command(engine, "BATTLE_POTION_SELECT", { potionType: "shield" }).ok,
      );
      assert(
        command(engine, "BATTLE_POTION_USE", {
          potionType: "shield",
          token: engine.getState().battle.potionToken,
        }).ok,
      );
      assert.equal(engine.getState().magic.potions[1], 1);
      assert(engine.load(engine.save()).ok);
      assert.equal(
        engine.getState().battle.fighters.find((f) => f.id === unit.id)
          .potionShield,
        1,
      );
      const armed = shieldGame(engine);
      armed.battle.enemyTurn = true;
      armed.battle.pendingMs = 0;
      loadShieldGame(engine, armed);
      const hit = () => {
        for (let i = 0; i < 4; i++) assert(engine.tick(250).ok);
      };
      const target = () =>
        engine.getState().battle.fighters.find((f) => f.id === unit.id);
      hit();
      assert.equal(target().health, health);
      assert.equal(target().shield, shield);
      assert.equal(target().potionShield ?? 0, 0);
      assert.equal(engine.getState().battle.lastAttacks[0].damage, 0);
      assert.equal(engine.getState().battle.lastAttacks[0].shieldDamage, 1);
      assert(engine.load(engine.save()).ok);
      assert.equal(target().potionShield ?? 0, 0);
      hit();
      if (nativeShield) {
        assert.equal(target().health, health);
        assert.equal(target().shield, 0);
        assert.equal(engine.getState().battle.lastAttacks[0].shieldDamage, 1);
        hit();
        const foe = engine.getState().battle.fighters.find((f) => f.enemy);
        assert(
          command(engine, "BATTLE_ATTACK", { id: unit.id, target: foe.id }).ok,
        );
        hit();
      }
      assert(target().health < health);
      assert(engine.getState().battle.lastAttacks[0].damage > 0);
      assert.equal(engine.getState().battle.lastAttacks[0].shieldDamage, 0);
      assert.equal(engine.getState().magic.potions[1], 1);
    } finally {
      engine.dispose();
    }
  }
});

for (const campaignLevel of [0, 1]) {
  test(`Revival restores all four casualties after reload with a missing defeat marker (${campaignLevel ? "campaign" : "expedition"})`, async () => {
    const { engine, labId } = await empire();
    try {
      assert(
        command(engine, "BREW_POTION", { id: labId, potionType: "revive" }).ok,
      );
      const unitIds = engine
        .getState()
        .units.filter(
          (u) =>
            !u.carrier &&
            !u.reserve &&
            config.units.find((d) => d.id === u.type).domain === "land",
        )
        .slice(0, 5)
        .map((u) => u.id);
      assert.equal(unitIds.length, 5);
      assert(
        command(engine, "BATTLE_START", {
          unitIds,
          ...(campaignLevel ? { campaignLevel } : {}),
        }).ok,
      );
      const game = exactCombatGame(engine);
      const allies = game.battle.fighters.filter((f) => !f.enemy);
      const casualties = allies.slice(1);
      for (const [index, fighter] of casualties.entries()) {
        fighter.health = fighter.shield = 0;
        if (index < 3) fighter.defeatedPhase = game.battle.phaseIndex;
        else delete fighter.defeatedPhase;
      }
      loadCombatGame(engine, game);
      const before = engine.getState().battle;
      assert(
        command(engine, "BATTLE_POTION_SELECT", { potionType: "revive" }).ok,
      );
      const token = engine.getState().battle.potionToken;
      const result = command(engine, "BATTLE_POTION_USE", {
        potionType: "revive",
        token,
      });
      assert(result.ok, result.message);
      const after = engine.getState();
      assert.deepEqual(
        after.battle.potionTargets,
        casualties.map((f) => String(f.id)),
      );
      assert.equal(after.magic.potions[3], 0);
      assert.equal(after.battle.actions, before.actions);
      for (const casualty of casualties) {
        const revived = after.battle.fighters.find(
          (f) => f.id === String(casualty.id),
        );
        assert.equal(revived.health, Math.ceil(casualty.maxHealth / 2));
        assert.deepEqual(revived.position, casualty.position);
        assert.equal(revived.shield, 0);
        assert.equal(revived.potionShield ?? 0, 0);
        assert.equal(revived.attacked, true);
        assert.equal(revived.readyRound, before.round + 1);
      }
      assert.equal(
        after.battle.fighters.find((f) => f.id === String(allies[0].id)).health,
        allies[0].health,
      );
      assert.equal(
        after.battle.fighters.filter((f) => !f.enemy && f.health > 0).length,
        5,
      );
      assert(engine.load(engine.save()).ok);
      assert.equal(
        engine
          .getState()
          .battle.fighters.filter((f) => !f.enemy && f.health > 0).length,
        5,
      );
      assert.equal(
        command(engine, "BATTLE_POTION_USE", { potionType: "revive", token })
          .ok,
        false,
      );
    } finally {
      engine.dispose();
    }
  });
}
