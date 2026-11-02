import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server, ShopPanel, Dialog;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  ({ ShopPanel } = await server.ssrLoadModule("/src/components/ShopPanel.jsx"));
  ({ Dialog } = await server.ssrLoadModule("/src/components/Dialog.jsx"));
});
after(async () => server?.close());
function state(stock = [10000, 10000, 10000, 10000, 10000]) {
  return {
    stock,
    shop: {
      sequence: 7,
      available: true,
      quantities: [1, 5, 10],
      offers: config.shop.offers.map((offer) => {
        const resource = ["food", "wood", "stone", "iron"].indexOf(
          offer.resource,
        );
        return {
          ...offer,
          choices: [1, 5, 10].map((quantity) => {
            const buy = offer.direction === "buy";
            const pay = {
              resource: buy ? "coins" : offer.resource,
              amount: (buy ? offer.gold : offer.amount) * quantity,
            };
            const receive = {
              resource: buy ? offer.resource : "coins",
              amount: (buy ? offer.amount : offer.gold) * quantity,
            };
            const ok = stock[buy ? 4 : resource] >= pay.amount;
            return {
              quantity,
              pay,
              receive,
              ok,
              reason: ok ? "" : `Not enough ${buy ? "gold" : offer.resource}`,
            };
          }),
        };
      }),
    },
  };
}
function render(props = {}) {
  return renderToStaticMarkup(
    createElement(ShopPanel, { state: state(), dispatch() {}, ...props }),
  );
}

test("The shop clearly shows all four approved purchase offers, balances and direction tabs", () => {
  const html = render();
  for (const button of [
    "Buy 1,000 Food",
    "Buy 1,000 Wood",
    "Buy 500 Stone",
    "Buy 250 Metal",
  ])
    assert(html.includes(button));
  assert(html.includes('aria-label="Gold balance 10000"'));
  assert(html.includes('role="tablist"'));
  assert(html.includes("Buy resources") && html.includes("Sell resources"));
  assert.equal(html.match(/class="shop-offer /g).length, 4);
  assert(html.includes("You give") && html.includes("You receive"));
});

test("The sell tab shows the reverse offers with 50 gold received for each resource pack", () => {
  const html = render({ initialDirection: "sell" });
  for (const label of [
    "Sell 1,000 Food",
    "Sell 1,000 Wood",
    "Sell 500 Stone",
    "Sell 250 Metal",
  ])
    assert(html.includes(label));
  assert.equal(html.match(/Receive 50 Gold immediately/g).length, 4);
  assert(html.includes('aria-labelledby="shop-sell-tab"'));
});

test("Insufficient balances disable an exchange and explain why", () => {
  const html = render({ state: state([0, 0, 0, 0, 0]) });
  assert.equal(html.match(/disabled=""/g).length, 4);
  assert.equal(html.match(/Not enough gold/g).length, 8);
});

test("Bulk selection displays the authoritative engine quote instead of recalculating prices", () => {
  const game = state();
  const offer = game.shop.offers.find((o) => o.id === "buy_food");
  offer.choices[1].pay.amount = 777;
  offer.choices[1].receive.amount = 1234;
  const html = render({ state: game, initialQuantity: 5 });
  assert(html.includes("Buy 1,234 Food"));
  assert(html.includes("777"));
  assert(html.includes('aria-label="5 offers" aria-pressed="true"'));
});

test("Shop works inside the accessible dialog and provides a friendly unavailable state", () => {
  const html = renderToStaticMarkup(
    createElement(
      Dialog,
      { title: "Shop", className: "shop-dialog", onClose() {} },
      createElement(ShopPanel, { state: state(), dispatch() {} }),
    ),
  );
  assert(html.includes('role="dialog" aria-modal="true" aria-label="Shop"'));
  assert(html.includes('aria-label="Close menu"'));
  assert(
    render({ state: { stock: [0, 0, 0, 0, 0] } }).includes(
      "The shop is currently unavailable",
    ),
  );
});
