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
const create = (rules = config) =>
  GameEngine.create({ factory, config: rules, wasmBinary });
async function funded() {
  const engine = await create();
  const game = JSON.parse(engine.save()).game;
  game.stock.fill(1_000_000);
  loadGame(engine, game);
  return engine;
}
const options = (engine) => {
  const result = engine.dispatch({ type: "SHOP_OPTIONS" });
  assert(result.ok);
  return result.shop;
};
const trade = (
  engine,
  offerId,
  quantity = 1,
  sequence = engine.getState().shop.sequence,
) =>
  engine.dispatch({
    type: "SHOP_TRADE",
    payload: { offerId, quantity, sequence },
  });
const stable = (engine) => {
  const g = JSON.parse(engine.save()).game;
  delete g.savedAtUTC;
  return g;
};

test("All eight shop offers exchange the approved amounts in both directions and in bulk", async () => {
  const engine = await funded();
  try {
    for (const offer of config.shop.offers) {
      const before = engine.getState();
      assert(trade(engine, offer.id, 5).ok);
      const index = ["food", "wood", "stone", "iron"].indexOf(offer.resource);
      const expected = [...before.stock];
      const sign = offer.direction === "buy" ? 1 : -1;
      expected[index] += sign * offer.amount * 5;
      expected[4] -= sign * offer.gold * 5;
      assert.deepEqual(engine.getState().stock, expected);
      assert.equal(engine.getState().shop.sequence, before.shop.sequence + 1);
      assert(engine.load(engine.save()).ok);
      assert.deepEqual(engine.getState().stock, expected);
    }
  } finally {
    engine.dispose();
  }
});

test("Prices come from the engine, and a stale or repeated trade cannot spend or award twice", async () => {
  const engine = await funded();
  try {
    const before = engine.getState().stock;
    const payload = {
      offerId: "buy_food",
      quantity: 1,
      sequence: 0,
      gold: 0,
      amount: 999999,
    };
    assert(engine.dispatch({ type: "SHOP_TRADE", payload }).ok);
    const expected = [...before];
    expected[0] += 1000;
    expected[4] -= 100;
    assert.deepEqual(engine.getState().stock, expected);
    const once = stable(engine);
    assert.equal(engine.dispatch({ type: "SHOP_TRADE", payload }).ok, false);
    assert.deepEqual(stable(engine), once);
    assert(engine.load(engine.save()).ok);
    assert.equal(engine.dispatch({ type: "SHOP_TRADE", payload }).ok, false);
    assert.deepEqual(stable(engine), once);
  } finally {
    engine.dispose();
  }
});

test("Malformed, unknown, unaffordable and oversized exchanges leave all inventory untouched", async () => {
  const engine = await create();
  try {
    const before = stable(engine);
    for (const quantity of [0, -1, 101, 1.5, "1", null]) {
      assert.equal(trade(engine, "buy_food", quantity, 0).ok, false);
      assert.deepEqual(stable(engine), before);
    }
    for (const sequence of [-1, 0.5, "0", null, 9007199254740991])
      assert.equal(trade(engine, "buy_food", 1, sequence).ok, false);
    for (const offer of ["buy_food", "sell_food", "free_gold", "buy_coins"])
      assert.equal(trade(engine, offer, 1, 0).ok, false);
    assert.deepEqual(stable(engine), before);
  } finally {
    engine.dispose();
  }
});

test("Both buying and selling reject capacity overflow before spending and accept the exact safe limit", async () => {
  const engine = await funded();
  try {
    for (const [offer, index, received] of [
      ["buy_food", 0, 1000],
      ["sell_food", 4, 50],
    ]) {
      const game = JSON.parse(engine.save()).game;
      game.stock.fill(1_000_000);
      game.stock[index] = 1_000_000_000_000 - received;
      loadGame(engine, game);
      const before = stable(engine);
      assert.equal(trade(engine, offer).ok, false);
      assert.deepEqual(stable(engine), before);
      game.stock[index]--;
      loadGame(engine, game);
      assert(trade(engine, offer).ok);
      assert.equal(engine.getState().stock[index], 999_999_999_999);
    }
  } finally {
    engine.dispose();
  }
});

test("Shop quotes provide authoritative totals and eligibility without mutating the game", async () => {
  const engine = await create();
  try {
    const before = stable(engine);
    const shop = options(engine);
    assert.deepEqual(shop.quantities, [1, 5, 10]);
    const food = shop.offers.find((o) => o.id === "buy_food");
    assert.deepEqual(food.choices[1].pay, { resource: "coins", amount: 500 });
    assert.deepEqual(food.choices[1].receive, {
      resource: "food",
      amount: 5000,
    });
    assert.equal(food.choices[1].ok, false);
    const wood = shop.offers.find((o) => o.id === "sell_wood");
    assert.equal(wood.choices[0].ok, true);
    assert.equal(wood.choices[1].ok, false);
    for (let i = 0; i < 3; i++) engine.getState();
    assert.deepEqual(stable(engine), before);
  } finally {
    engine.dispose();
  }
});

test("Buying and selling back loses the approved spread and cannot create free gold", async () => {
  const engine = await funded();
  try {
    const before = engine.getState().stock;
    for (const resource of ["food", "wood", "stone", "iron"]) {
      assert(trade(engine, `buy_${resource}`).ok);
      assert(trade(engine, `sell_${resource}`).ok);
    }
    assert.deepEqual(engine.getState().stock.slice(0, 4), before.slice(0, 4));
    assert.equal(engine.getState().stock[4], before[4] - 200);
  } finally {
    engine.dispose();
  }
});

test("Existing saves gain the shop with their resources and progress preserved", async () => {
  const prior = structuredClone(config);
  delete prior.shop;
  const old = await create(prior);
  const current = await create();
  try {
    const previous = stable(old);
    assert(current.load(old.save()).ok);
    const after = stable(current);
    const expected = structuredClone(previous);
    expected.config = after.config;
    assert.deepEqual(after, expected);
    assert.equal(current.getState().shop.sequence, 0);
    assert.deepEqual(current.getState().stock, previous.stock);
    assert(trade(current, "sell_wood").ok);
    const saved = stable(current);
    assert(current.load(current.save()).ok);
    assert.deepEqual(stable(current), saved);
    assert.equal(trade(current, "sell_wood", 1, 0).ok, false);
    assert(current.dispatch({ type: "NEW_GAME", payload: { seed: 7319 } }).ok);
    assert.equal(current.getState().shop.sequence, 0);
    assert.deepEqual(current.getState().stock, previous.stock);
  } finally {
    old.dispose();
    current.dispose();
  }
});

test("Trades are unavailable during battle and never change combat or resources", async () => {
  const engine = await create();
  try {
    const bytes = await readFile(
      new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
      "utf8",
    );
    assert(engine.load(bytes).ok);
    const unit = engine
      .getState()
      .units.find(
        (u) => config.units.find((d) => d.id === u.type).domain === "land",
      );
    assert(
      engine.dispatch({ type: "BATTLE_START", payload: { unitIds: [unit.id] } })
        .ok,
    );
    const before = engine.getState();
    assert(options(engine).offers.every((o) => o.choices.every((c) => !c.ok)));
    assert.equal(trade(engine, "sell_wood").ok, false);
    assert.deepEqual(engine.getState(), before);
  } finally {
    engine.dispose();
  }
});

test("Invalid shop prices, duplicate IDs and profitable exchange loops are rejected", async () => {
  for (const change of [
    (c) => {
      c.shop.version = 2;
    },
    (c) => {
      c.shop.offers[0].gold = 0;
    },
    (c) => {
      c.shop.offers[0].amount = -1;
    },
    (c) => {
      c.shop.offers[1].id = c.shop.offers[0].id;
    },
    (c) => {
      c.shop.offers[0].resource = "coins";
    },
    (c) => {
      c.shop.offers[4].gold = 101;
    },
  ]) {
    const invalid = structuredClone(config);
    change(invalid);
    await assert.rejects(() => create(invalid));
  }
});
