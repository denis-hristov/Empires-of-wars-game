import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { loadGame } from "./helpers/population.js";

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

// Keep unsigned 64-bit enemy identities exact while editing a saved battle.
function editBattle(engine, edit) {
  const game = JSON.parse(
    engine
      .save()
      .replace(/("(?:id|attacker|target)"\s*:\s*)(\d{16,})/g, '$1"__id_$2"'),
  ).game;
  edit(game.battle);
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
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const result = engine.load(
    `{"checksum":"${hash.toString(16)}","game":${bytes}}`,
  );
  assert(result.ok, result.message);
}

const stableState = (engine) => {
  const state = engine.getState();
  delete state.revision;
  return state;
};

test("WASM campaign enemies independently retarget each attack and preserve the sequence after reload", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  const resumed = await GameEngine.create({ factory, config, wasmBinary });
  try {
    assert(engine.load(fixture).ok);
    const game = JSON.parse(engine.save()).game;
    game.campaign = {
      currentLevel: 5,
      completedLevels: [1, 2, 3, 4],
      completed: false,
    };
    loadGame(engine, game);
    const unitIds = engine
      .getState()
      .units.filter((unit) => unit.type === "infantry")
      .slice(0, 5)
      .map((unit) => unit.id);
    assert.equal(unitIds.length, 5);
    assert(
      engine.dispatch({
        type: "BATTLE_START",
        payload: { campaign: true, automatic: true, unitIds },
      }).ok,
    );
    editBattle(engine, (battle) => {
      for (const fighter of battle.fighters) {
        fighter.health = fighter.maxHealth = 100000;
        fighter.damage = 1;
        fighter.defense = fighter.shield = 0;
      }
      battle.fighters.find((fighter) => !fighter.enemy).health = 70000;
    });
    for (let i = 0; i < 3; i++) assert(engine.tick(250).ok);
    assert(resumed.load(engine.save()).ok);
    const targets = new Map();
    const counts = new Map();
    let actions = engine.getState().battle.actions;
    for (let step = 0; step < 1000; step++) {
      assert(engine.tick(250).ok);
      assert(resumed.tick(250).ok);
      assert.deepEqual(stableState(engine), stableState(resumed));
      const battle = engine.getState().battle;
      assert(!battle.finished);
      if (battle.actions === actions) continue;
      actions = battle.actions;
      for (const hit of battle.lastAttacks) {
        const attacker = battle.fighters.find(
          (fighter) => fighter.id === hit.attacker,
        );
        if (!attacker.enemy) continue;
        assert(
          unitIds.includes(hit.target),
          "Enemy targets belong to the committed army",
        );
        const target = battle.fighters.find(
          (fighter) => fighter.id === hit.target,
        );
        assert(target.health > 0 && !target.enemy);
        if (!targets.has(attacker.id)) targets.set(attacker.id, new Set());
        targets.get(attacker.id).add(hit.target);
        counts.set(attacker.id, (counts.get(attacker.id) ?? 0) + 1);
      }
    }
    assert.equal(
      targets.size,
      2,
      "Both campaign opponents attack independently",
    );
    for (const [attacker, selected] of targets) {
      assert(counts.get(attacker) >= 30);
      assert.equal(
        selected.size,
        5,
        "Each enemy can select every living target, including stronger troops",
      );
    }
  } finally {
    engine.dispose();
    resumed.dispose();
  }
});
