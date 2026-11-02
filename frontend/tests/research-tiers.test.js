import { before, test } from "node:test";
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
const engine = () => GameEngine.create({ factory, config, wasmBinary });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function pack(game) {
  const text = JSON.stringify(canonical(game));
  let hash = 14695981039346656037n;
  for (const b of new TextEncoder().encode(text))
    hash = BigInt.asUintN(64, (hash ^ BigInt(b)) * 1099511628211n);
  return JSON.stringify({
    checksum: hash.toString(16),
    game: JSON.parse(text),
  });
}
function change(e, edit) {
  const game = JSON.parse(e.save()).game;
  edit(game);
  const result = e.load(pack(game));
  assert(result.ok, result.message);
}
function advance(e, ms) {
  for (let n = 0; n < ms; n += 250) assert(e.tick(Math.min(250, ms - n)).ok);
}
function construct(e, type) {
  const world = e.getWorld();
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const payload = { buildingType: type, x, y };
      if (!e.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
      assert(e.dispatch({ type: "BUILD", payload }).ok);
      advance(
        e,
        config.buildings.find((b) => b.id === type).levels[0].seconds * 1000,
      );
      return e.getState().buildings.at(-1).id;
    }
  throw new Error(`No plot for ${type}`);
}
let base, academyId;
before(async () => {
  const e = await engine();
  try {
    change(e, (g) => {
      g.stock = [1000000, 1000000, 1000000, 1000000, 1000000];
      g.buildings[0].level = 10;
    });
    for (const type of ["academy", "barracks", "harbor", "airbase"])
      construct(e, type);
    change(e, (g) => {
      for (const b of g.buildings) b.level = 10;
    });
    academyId = e.getState().buildings.find((b) => b.type === "academy").id;
    base = JSON.parse(e.save()).game;
  } finally {
    e.dispose();
  }
});

test("All thirty research options follow the staircase at every Academy level", async () => {
  const e = await engine();
  try {
    for (let level = 1; level <= 10; level++) {
      const g = structuredClone(base);
      g.buildings.find((b) => String(b.id) === academyId).level = level;
      assert(e.load(pack(g)).ok);
      const state = e.getState(),
        options = state.buildings.find(
          (b) => b.id === academyId,
        ).researchOptions;
      for (const unit of config.units) {
        const option = options.find((o) => o.type === unit.id),
          cap =
            Math.max(0, level - unit.level + 1) +
            Math.max(0, level - Math.max(7, unit.level) + 1);
        assert.equal(option.academyLimit, cap, `${unit.id} Academy ${level}`);
        assert.equal(
          option.maxLevel,
          11 - unit.level + 11 - Math.max(7, unit.level),
        );
        assert.equal(option.requiredAcademyLevel, unit.level);
        assert.equal(option.ok, cap > 0);
        const catalog = state.unitCatalog.find((u) => u.id === unit.id);
        assert.equal(
          catalog.researchMaxLevel,
          11 - unit.level + 11 - Math.max(7, unit.level),
        );
        assert.equal(catalog.academyResearchLimit, cap);
      }
    }
  } finally {
    e.dispose();
  }
});

test("Each land, sea and air type can buy its exact cap and cannot buy one extra level", async () => {
  const e = await engine();
  try {
    for (const unit of config.units) {
      const g = structuredClone(base),
        cap = 11 - unit.level + 11 - Math.max(7, unit.level);
      g.researchLevels[unit.id] = cap - 1;
      assert(e.load(pack(g)).ok);
      const before = e.getState(),
        option = before.buildings
          .find((b) => b.id === academyId)
          .researchOptions.find((o) => o.type === unit.id);
      assert(
        e.dispatch({
          type: "RESEARCH",
          payload: { id: academyId, unitType: unit.id },
        }).ok,
      );
      const price = ["food", "wood", "stone", "iron", "coins"].map(
        (r) => option.cost[r] || 0,
      );
      assert.deepEqual(
        e.getState().stock,
        before.stock.map((x, i) => x - price[i]),
      );
      assert.equal(e.getState().researchLevels[unit.id], cap - 1);
      advance(e, option.seconds * 1000);
      assert.equal(e.getState().researchLevels[unit.id], cap);
      const saved = e.save();
      assert(e.load(saved).ok);
      const stock = e.getState().stock;
      assert.equal(
        e.dispatch({
          type: "RESEARCH",
          payload: { id: academyId, unitType: unit.id },
        }).ok,
        false,
      );
      assert.deepEqual(e.getState().stock, stock);
      assert(e.load(e.save()).ok);
    }
  } finally {
    e.dispose();
  }
});

test("An Academy cap never unlocks a troop before its own military building", async () => {
  const e = await engine();
  try {
    for (const unit of config.units) {
      const g = structuredClone(base),
        military = g.buildings.find((b) => b.type === unit.building);
      military.level = Math.max(1, unit.level - 1);
      if (unit.level === 1) {
        military.state = 0;
        military.remainingMs = 1000;
      }
      assert(e.load(pack(g)).ok);
      const stock = e.getState().stock;
      const result = e.dispatch({
        type: "RESEARCH",
        payload: { id: academyId, unitType: unit.id },
      });
      assert.equal(result.ok, false);
      assert.match(result.message, /Unlock/);
      assert.deepEqual(e.getState().stock, stock);
    }
  } finally {
    e.dispose();
  }
});

test("Old paid research and its queue migrate once; new saves enforce the tier caps", async () => {
  const e = await engine();
  try {
    const g = structuredClone(base);
    delete g.researchRulesVersion;
    g.buildings.find((b) => String(b.id) === academyId).level = 3;
    g.researchLevels = { heavy_infantry: 3, infantry_squad: 2 };
    g.research = [
      {
        type: "infantry_squad",
        academy: Number(academyId),
        remainingMs: 1000,
        level: 3,
      },
    ];
    assert(e.load(pack(g)).ok);
    assert.deepEqual(e.getState().stock, g.stock);
    assert.equal(e.getState().researchLevels.heavy_infantry, 3);
    const saved = JSON.parse(e.save()).game;
    assert.equal(saved.researchRulesVersion, 2);
    assert.deepEqual(saved.preservedResearchLevels, {
      heavy_infantry: 3,
      infantry_squad: 3,
    });
    assert(e.load(e.save()).ok);
    advance(e, 1000);
    assert.equal(e.getState().researchLevels.infantry_squad, 3);
    assert.equal(
      e.dispatch({
        type: "RESEARCH",
        payload: { id: academyId, unitType: "infantry_squad" },
      }).ok,
      false,
    );
    const invalid = structuredClone(g);
    invalid.researchRulesVersion = 2;
    const stock = e.getState().stock;
    assert.equal(e.load(pack(invalid)).ok, false);
    assert.deepEqual(e.getState().stock, stock);
    assert(e.load(e.save()).ok);
  } finally {
    e.dispose();
  }
});

test("Academy levels seven through ten each allow two separately paid improvements in all three domains", async () => {
  const e = await engine();
  try {
    for (const unit of config.units.filter((u) => u.level === 1)) {
      for (const [academyLevel, previousCap, cap] of [
        [7, 6, 8],
        [8, 8, 10],
        [9, 10, 12],
        [10, 12, 14],
      ]) {
        const game = structuredClone(base);
        game.buildings.find((b) => String(b.id) === academyId).level =
          academyLevel;
        game.researchLevels[unit.id] = previousCap;
        assert(e.load(pack(game)).ok);
        for (let target = previousCap + 1; target <= cap; target++) {
          const option = e
            .getState()
            .buildings.find((b) => b.id === academyId)
            .researchOptions.find((o) => o.type === unit.id);
          assert.equal(option.academyLimit, cap);
          assert.equal(option.requiredAcademyLevel, academyLevel);
          const stock = e.getState().stock;
          assert(
            e.dispatch({
              type: "RESEARCH",
              payload: { id: academyId, unitType: unit.id },
            }).ok,
          );
          assert.deepEqual(
            e.getState().stock,
            stock.map(
              (amount, i) =>
                amount -
                (option.cost[["food", "wood", "stone", "iron", "coins"][i]] ??
                  0),
            ),
          );
          assert(e.load(e.save()).ok);
          assert.equal(e.getState().researchLevels[unit.id], target - 1);
          advance(e, option.seconds * 1000);
          assert.equal(e.getState().researchLevels[unit.id], target);
        }
        const option = e
          .getState()
          .buildings.find((b) => b.id === academyId)
          .researchOptions.find((o) => o.type === unit.id);
        assert.equal(option.ok, false);
        if (academyLevel < 10) {
          assert.equal(option.requiredAcademyLevel, academyLevel + 1);
          assert.match(
            option.reason,
            new RegExp(`Academy at level ${academyLevel + 1}`),
          );
        }
        assert(e.load(e.save()).ok);
      }
    }
  } finally {
    e.dispose();
  }
});

test("The previous Academy rules migrate once without granting free research or changing a paid queue", async () => {
  const e = await engine();
  try {
    const game = structuredClone(base);
    delete game.config.academyResearchVersion;
    game.config.research.maxLevel = 10;
    game.config.research.baseCosts.length = 10;
    game.researchLevels = { infantry: 9 };
    game.research = [
      {
        type: "infantry",
        academy: Number(academyId),
        level: 10,
        remainingMs: 1000,
      },
    ];
    const invalid = structuredClone(game);
    invalid.config.research.baseCosts[0].wood++;
    assert.equal(e.load(pack(invalid)).ok, false);
    assert(e.load(pack(game)).ok);
    const migrated = JSON.parse(e.save()).game;
    assert.equal(migrated.config.academyResearchVersion, 1);
    assert.deepEqual(migrated.researchLevels, game.researchLevels);
    assert.deepEqual(migrated.research, game.research);
    assert.deepEqual(migrated.stock, game.stock);
    assert.deepEqual(migrated.units, game.units);
    assert(e.load(e.save()).ok);
    advance(e, 1000);
    assert.equal(e.getState().researchLevels.infantry, 10);
    const option = e
      .getState()
      .buildings.find((b) => b.id === academyId)
      .researchOptions.find((o) => o.type === "infantry");
    assert.equal(option.nextLevel, 11);
    assert.equal(option.requiredAcademyLevel, 9);
    assert.equal(option.ok, true);
    const invalidLevel = JSON.parse(e.save()).game;
    invalidLevel.researchLevels.infantry = 15;
    assert.equal(e.load(pack(invalidLevel)).ok, false);
  } finally {
    e.dispose();
  }
});
