import { test } from "node:test";
import assert from "node:assert/strict";
import { unitArtwork } from "../src/game/UnitSpriteArt.js";
import { getSpriteArt } from "../src/game/SpriteAssets.js";
import { arenaSpriteLayout, spriteLayout } from "../src/game/SpriteLayout.js";

test("All 30 army ground planes stay centered on map tiles and arena rings", () => {
  assert.equal(Object.keys(unitArtwork).length, 30);
  for (const type of Object.keys(unitArtwork)) {
    const art = getSpriteArt(type);
    const [left, , right, bottom] = art.bounds;
    const layout = spriteLayout(type);
    const width = (right - left) * layout.scaleX;
    const groundX = layout.anchorX * art.size[0];
    const groundY = layout.anchorY * art.size[1];
    assert(Math.abs(layout.scaleX - layout.scaleY) < 1e-9, type);
    assert(Math.abs((left - groundX) * layout.scaleX + width / 2) < 1e-9, type);
    assert(
      Math.abs((right - groundX) * layout.scaleX - width / 2) < 1e-9,
      type,
    );
    assert(
      Math.abs((bottom - groundY) * layout.scaleY - width / 4) < 1e-9,
      type,
    );
    assert(Math.abs(width - art.targetWidth) < 1e-9, type);
    const doubled = spriteLayout(type, [1, 1], {
      width: art.size[0] * 2,
      height: art.size[1] * 2,
    });
    assert.equal(doubled.scaleX, layout.scaleX / 2, type);
    assert.equal(doubled.scaleY, layout.scaleY / 2, type);
    assert.equal(doubled.top, layout.top, type);
    const arena = arenaSpriteLayout(type);
    assert.equal(arena.anchorX, layout.anchorX * 100, type);
    assert.equal(arena.anchorY, layout.anchorY * 100, type);
    assert(
      Math.abs(arena.bottom + arena.height * (1 - arena.anchorY / 100)) < 1e-9,
      type,
    );
    assert(arena.baseDepth > 0, type);
  }
});
