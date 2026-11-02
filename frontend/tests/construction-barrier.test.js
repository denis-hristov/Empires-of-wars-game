import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { ensurePopulation } from "./helpers/population.js";
import { constructionBarrierLayout } from "../src/game/ConstructionBarrier.js";
import {
  buildingArtwork,
  completedBuildingSpriteKey,
} from "../src/game/BuildingSpriteArt.js";
import { spriteLayout } from "../src/game/SpriteLayout.js";
import { getSpriteArt, spriteUrl } from "../src/game/SpriteAssets.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
function advance(engine, seconds) {
  for (let i = 0; i < seconds * 4; i++) engine.tick(250);
}
function construct(engine, type) {
  const world = engine.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!engine.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      assert(engine.dispatch({ type: "BUILD", payload }).ok);
      advance(engine, 30);
      return engine.getState().buildings.at(-1).id;
    }
  throw new Error(`No valid plot for ${type}`);
}

test("The original transparent barrier is bundled with the game", async () => {
  const art = getSpriteArt("construction_barrier");
  const bytes = await readFile(
    new URL(`../public/assets/sprites/${art.file}`, import.meta.url),
  );
  assert.equal(bytes.readUInt32BE(16), art.size[0]);
  assert.equal(bytes.readUInt32BE(20), art.size[1]);
  assert.equal(bytes[25], 6);
  assert(
    spriteUrl("construction_barrier").endsWith(
      "/assets/sprites/construction_barrier.png",
    ),
  );
});

test("The barrier sits in front of all building sizes and follows the completed artwork", () => {
  for (const [key, art] of Object.entries(buildingArtwork)) {
    const type = key.split(":")[0];
    const building = {
      type,
      level: art.level + 1,
      completedLevel: art.level,
      state: 2,
      remainingMs: 500,
      footprint: type === "townhall" ? [3, 3] : [2, 2],
    };
    const barrier = constructionBarrierLayout(building);
    const layout = spriteLayout(
      completedBuildingSpriteKey(building),
      building.footprint,
    );
    const baseWidth = art.base[0] * layout.scaleX;
    const barrierArt = getSpriteArt("construction_barrier");
    assert(barrier.visible, key);
    assert.equal(barrier.x, 0, key);
    assert(barrier.y > (art.base[1] * layout.scaleY) / 2, key);
    assert(
      Math.abs((barrier.scale * barrierArt.visibleWidth) / baseWidth - 1.15) <
        1e-9,
      key,
    );
  }
});

test("A real paid upgrade shows its barrier across save/load and removes it when the timer finishes", async () => {
  const engine = await GameEngine.create({ factory, config, wasmBinary });
  try {
    const farmId = construct(engine, "farm");
    construct(engine, "lumberyard");
    construct(engine, "barracks");
    const farm = () => engine.getState().buildings.find((b) => b.id === farmId);
    assert.equal(constructionBarrierLayout(farm()).visible, false);
    ensurePopulation(engine, 100);
    assert(
      engine.dispatch({
        type: "UPGRADE",
        payload: { id: engine.getState().buildings[0].id },
      }).ok,
    );
    advance(engine, 30);
    assert(engine.dispatch({ type: "UPGRADE", payload: { id: farmId } }).ok);
    assert.equal(constructionBarrierLayout(farm()).visible, true);
    advance(engine, 1);
    assert(engine.load(engine.save()).ok);
    assert.equal(constructionBarrierLayout(farm()).visible, true);
    advance(engine, 20);
    assert.equal(farm().completedLevel, 2);
    assert.equal(constructionBarrierLayout(farm()).visible, false);
  } finally {
    engine.dispose();
  }
});
