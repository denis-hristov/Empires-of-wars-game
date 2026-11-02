import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildingArtwork,
  buildingSpriteKey,
  completedBuildingSpriteKey,
  buildingVisualScale,
} from "../src/game/BuildingSpriteArt.js";
import {
  getSpriteArt,
  spriteFile,
  spriteUrl,
} from "../src/game/SpriteAssets.js";
import { spriteLayout } from "../src/game/SpriteLayout.js";

const levels = {
  townhall: 10,
  house: 5,
  farm: 5,
  lumberyard: 5,
  stone: 5,
  iron: 5,
  barracks: 10,
  academy: 10,
  harbor: 10,
  airbase: 10,
  laboratory: 4,
};
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

test("Every completed building level has distinct, bundled original artwork", async () => {
  assert.equal(Object.keys(buildingArtwork).length, 79);
  const paths = new Set();
  for (const [type, max] of Object.entries(levels))
    for (let level = 1; level <= max; level++) {
      const key = buildingSpriteKey(type, level);
      const art = getSpriteArt(type, level);
      assert.equal(key, `${type}:${level}`);
      assert.equal(getSpriteArt(key), art);
      assert.equal(spriteFile(type, level), art.file);
      assert(spriteUrl(type, level).endsWith(`/${art.path}`));
      const png = await readFile(
        new URL(`../public/${art.path}`, import.meta.url),
      );
      assert(png.subarray(0, 8).equals(pngSignature), key);
      assert.equal(png.readUInt32BE(16), art.size[0], key);
      assert.equal(png.readUInt32BE(20), art.size[1], key);
      assert.equal(png[25], 6, `${key} preserves the RGBA transparency`);
      paths.add(art.path);
    }
  assert.equal(paths.size, 79);
});

test("Building art starts at half size and grows 5% per completed level", () => {
  for (const key of Object.keys(buildingArtwork)) {
    const art = getSpriteArt(key);
    const footprint = [3, 3];
    const layout = spriteLayout(key, footprint);
    const factor = 0.5 * 1.05 ** (art.level - 1);
    assert.equal(layout.scaleX, layout.scaleY, key);
    assert.equal(buildingVisualScale(key), factor, key);
    assert(Math.abs(art.base[0] * layout.scaleX - 216 * factor) < 1e-9, key);
    assert(Math.abs(art.base[1] * layout.scaleY - 108 * factor) < 1e-9, key);
    assert(Math.abs(layout.anchorX * art.size[0] - art.ground[0]) < 1e-9, key);
    assert(Math.abs(layout.anchorY * art.size[1] - art.ground[1]) < 1e-9, key);
    assert(layout.top < 0, key);
    const larger = spriteLayout(key, footprint, { width: 2508, height: 2508 });
    assert(
      Math.abs(larger.scaleX - (layout.scaleX * art.size[0]) / 2508) < 1e-12,
      key,
    );
    assert(Math.abs(larger.top - layout.top) < 1e-9, key);
    const [left, , right, bottom] = art.bounds;
    assert(Math.abs((left + right) / 2 - art.ground[0]) < 1e-9, key);
    assert(Math.abs(bottom - art.ground[1] - art.base[1] / 2) < 1e-9, key);
    if (art.level > 1) {
      const type = key.split(":")[0];
      const previous = getSpriteArt(type, art.level - 1);
      const previousLayout = spriteLayout(type, footprint, null, art.level - 1);
      assert(
        Math.abs(
          (art.base[0] * layout.scaleX) /
            (previous.base[0] * previousLayout.scaleX) -
            1.05,
        ) < 1e-9,
        key,
      );
    }
  }
});

test("Construction and upgrades select the last completed building level", () => {
  assert.equal(
    completedBuildingSpriteKey({
      type: "townhall",
      level: 1,
      completedLevel: 0,
    }),
    "townhall:1",
  );
  assert.equal(
    completedBuildingSpriteKey({
      type: "townhall",
      level: 6,
      completedLevel: 5,
    }),
    "townhall:5",
  );
  assert.equal(
    completedBuildingSpriteKey({
      type: "townhall",
      level: 6,
      completedLevel: 6,
    }),
    "townhall:6",
  );
  assert.equal(
    completedBuildingSpriteKey({ type: "house", level: 3 }),
    "house:3",
  );
  assert.equal(buildingSpriteKey("house", 10), "house:5");
  assert.equal(buildingSpriteKey("farm", 0), "farm:1");
  assert.equal(buildingSpriteKey("academy", NaN), "academy:1");
  assert.equal(buildingSpriteKey("infantry", 10), "infantry");
  assert.equal(spriteFile("infantry"), "01-recruit-squad.svg");
  assert.equal(
    buildingVisualScale("house", 10),
    buildingVisualScale("house:5"),
  );
  assert.equal(buildingVisualScale("infantry"), 1);
  const upgradeKey = completedBuildingSpriteKey({
    type: "townhall",
    level: 6,
    completedLevel: 5,
  });
  assert.equal(buildingVisualScale(upgradeKey), 0.5 * 1.05 ** 4);
});
