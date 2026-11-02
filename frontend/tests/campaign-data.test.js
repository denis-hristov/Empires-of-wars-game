import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import catalog from "../../config/game.json" with { type: "json" };
import {
  enemySpriteArt,
  getSpriteArt,
  spriteArt,
  spriteUrl,
} from "../src/game/SpriteAssets.js";
import { arenaSpriteLayout } from "../src/game/SpriteLayout.js";

import removedNavalRounds from "../../tests/fixtures/early-campaign-naval-rounds.json" with { type: "json" };

const campaign = catalog.campaign;
const enemies = new Map(campaign.enemies.map((enemy) => [enemy.id, enemy]));
const thRanges = [10, 20, 30, 40, 50, 65, 80, 100, 125, 150];
const enemyThRanges = [8, 17, 27, 38, 50, 64, 80, 99, 122, 150];

test("All 150 battles retain their enemy specification and follow the updated Town Hall ranges", () => {
  const normalized = campaign.levels.map(
    ({ battleId, requiredTH, enemyTH, rounds }) => {
      const originalRounds = rounds.map((round) => {
        const original = { ...round };
        if (battleId === 76 && round.domain === "land") {
          assert.deepEqual(original.enemyFinalAttackPercents, { "AI-G5": 70 });
          delete original.enemyFinalAttackPercents;
        } else if (battleId === 150 && round.domain === "land") {
          const boss = round.enemies[0];
          assert.match(boss, /^G-B[1-5]$/);
          assert.deepEqual(original.enemyFinalAttackPercents, { [boss]: 85 });
          assert.deepEqual(original.enemyFinalHealthPercents, { [boss]: 75 });
          delete original.enemyFinalAttackPercents;
          delete original.enemyFinalHealthPercents;
        } else {
          assert.equal(original.enemyFinalAttackPercents, undefined);
        }
        assert.equal(original.enemyFinalHealthPercents, undefined);
        if (battleId === 58 && round.domain === "naval") {
          assert.deepEqual(original.enemyAttackPercents, { "AI-W2": 81 });
          assert.deepEqual(original.unshieldedEnemies, ["AI-W2"]);
          delete original.enemyAttackPercents;
          delete original.unshieldedEnemies;
        } else {
          assert.equal(original.enemyAttackPercents, undefined);
          assert.equal(original.unshieldedEnemies, undefined);
        }
        return original;
      });
      if (removedNavalRounds[battleId]) {
        assert(rounds.every((round) => round.domain === "land"));
        assert.equal(rounds.length, battleId === 30 ? 2 : 1);
        originalRounds.splice(1, 0, removedNavalRounds[battleId]);
      }
      return {
        battleId,
        requiredTH: enemyTH ?? requiredTH,
        rounds: originalRounds,
      };
    },
  );
  // Independently extracted from the source specification, preserving every slot.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  assert.equal(
    fingerprint,
    "f11b47c8e36b2fca9f1f3ba95a6e7604331ea29860bf513b9f447cb2e5df9d27",
  );
  assert.equal(campaign.levels.length, 150);
  assert.equal(campaign.maxAlliesPerRound, 5);
  assert.equal(
    campaign.levels.reduce((total, level) => total + level.rounds.length, 0),
    474,
  );
  for (const [index, level] of campaign.levels.entries()) {
    assert.equal(level.battleId, index + 1);
    assert.equal(level.id, level.battleId);
    assert.equal(
      level.requiredTH,
      thRanges.findIndex((last) => level.id <= last) + 1,
    );
    const enemyTH = level.enemyTH ?? level.requiredTH;
    assert.equal(
      enemyTH,
      enemyThRanges.findIndex((last) => level.id <= last) + 1,
    );
    assert(level.rounds.length > 0);
    for (const round of level.rounds) {
      assert(round.enemies.length >= 1 && round.enemies.length <= 5);
      if (round.domain === "naval") assert(level.requiredTH >= 4);
      if (round.domain === "air") assert(level.requiredTH >= 6);
      for (const enemyId of round.enemies) {
        const enemy = enemies.get(enemyId);
        assert(enemy, enemyId);
        assert.equal(enemy.domain, round.domain, `${level.id}: ${enemyId}`);
        if (enemy.kind === "ordinary") assert(enemy.tier <= enemyTH);
      }
    }
  }
});

test("All 15 AI forms occur once and the final has exactly 15 different bosses", () => {
  const appearances = new Map();
  for (const level of campaign.levels) {
    for (const enemyId of level.rounds.flatMap((round) => round.enemies)) {
      if (!enemyId.startsWith("AI-")) continue;
      assert(!appearances.has(enemyId), `Repeated story AI form: ${enemyId}`);
      appearances.set(enemyId, level.id);
    }
  }
  assert.equal(appearances.size, 15);
  assert.equal(appearances.get("AI-A5"), 150);
  const final = campaign.levels.at(-1);
  assert.equal(final.type, "final");
  assert.equal(final.rounds.length, 15);
  for (const domain of ["land", "naval", "air"]) {
    const rounds = final.rounds.filter((round) => round.domain === domain);
    assert.equal(rounds.length, 5);
    const bosses = rounds.flatMap((round) =>
      round.enemies.filter((id) => enemies.get(id).kind === "boss"),
    );
    assert.equal(bosses.length, 5);
    assert.equal(new Set(bosses).size, 5);
  }
  assert.deepEqual(
    final.rounds
      .flatMap((round) => round.enemies)
      .filter((id) => id.startsWith("AI-")),
    ["AI-A5"],
  );
  assert.equal(final.rounds.at(-1).enemies.at(-1), "AI-A5");
});

test("Enemy definitions resolve all 60 supplied local SVGs and combat unit types", async () => {
  assert.equal(campaign.enemies.length, 60);
  assert.equal(enemies.size, 60);
  assert.equal(
    new Set(campaign.enemies.map((enemy) => enemy.assetPath)).size,
    60,
  );
  for (const [kind, expected] of [
    ["ordinary", 30],
    ["boss", 15],
    ["ai", 15],
  ]) {
    assert.equal(
      campaign.enemies.filter((enemy) => enemy.kind === kind).length,
      expected,
    );
  }
  await Promise.all(
    campaign.enemies.map(async (enemy) => {
      const unit = catalog.units.find(
        (candidate) => candidate.id === enemy.unitType,
      );
      assert(unit, enemy.id);
      assert.equal(unit.domain, enemy.domain);
      assert.equal(unit.level, enemy.tier);
      assert(enemy.name && !enemy.name.includes("[BOSS]"));
      const file = new URL(`../public/${enemy.assetPath}`, import.meta.url);
      assert((await stat(file)).size > 1000, enemy.assetPath);
      const handle = await open(file);
      try {
        const { buffer, bytesRead } = await handle.read(
          Buffer.alloc(512),
          0,
          512,
          0,
        );
        const header = buffer.subarray(0, bytesRead).toString("utf8");
        assert(header.includes("<svg "), enemy.assetPath);
        assert(
          header.includes(`width="${enemy.art.size[0]}"`),
          enemy.assetPath,
        );
        assert(
          header.includes(`height="${enemy.art.size[1]}"`),
          enemy.assetPath,
        );
      } finally {
        await handle.close();
      }
    }),
  );
});

test("Enemy sprites have valid arena placement and stay outside island preload", () => {
  assert.equal(Object.keys(enemySpriteArt).length, 60);
  for (const enemy of campaign.enemies) {
    assert(!Object.hasOwn(spriteArt, enemy.id));
    const art = getSpriteArt(enemy.id);
    assert.equal(art.path, enemy.assetPath);
    assert(spriteUrl(enemy.id).endsWith(enemy.assetPath));
    const layout = arenaSpriteLayout(enemy.id);
    for (const value of Object.values(layout))
      assert(Number.isFinite(value), enemy.id);
    assert(layout.anchorX > 0 && layout.anchorX < 100, enemy.id);
    assert(layout.anchorY > 0 && layout.anchorY < 100, enemy.id);
    assert(layout.height > 0, enemy.id);
  }
});
