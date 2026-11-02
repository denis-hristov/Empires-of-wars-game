import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url), "utf8"),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const fixture = await readFile(
  new URL("../../tests/fixtures/empires-of-wars-145.save.json", import.meta.url),
  "utf8",
);

function stableSave(engine) {
  const game = JSON.parse(engine.save()).game;
  delete game.savedAtUTC;
  return game;
}

test("state polling stays compact and preserves campaign saves and availability", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    assert(engine.load(fixture).ok);
    const before = stableSave(engine);
    const initial = engine.getState();
    assert.equal(initial.campaign.maxLevel, 150);
    assert.equal(initial.campaign.currentLevel, 1);
    assert.deepEqual(initial.campaign.completedLevels, []);
    assert(!("levels" in initial.campaign));
    assert(!("enemies" in initial.campaign));
    assert(Buffer.byteLength(JSON.stringify(initial)) < 60_000);
    for (let i = 0; i < 10; i++)
      assert.deepEqual(engine.getState(), initial);
    assert.deepEqual(stableSave(engine), before);
    assert.deepEqual(before.config.campaign, config.campaign);
    assert("appliedRewards" in before);
    assert("nextId" in before);
    assert("nextBattleId" in before);

    const saved = engine.save();
    assert(engine.load(saved).ok);
    const restored = engine.getState();
    assert.deepEqual(restored.campaign, initial.campaign);
    assert.deepEqual(restored.buildings, initial.buildings);
    assert.deepEqual(stableSave(engine), before);
  } finally {
    engine.dispose();
  }
});
