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
let server, panels;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  panels = await server.ssrLoadModule("/src/components/GamePanels.jsx");
});
after(async () => server?.close());

function fixture({ researchLevel = 2, catalog = true, definition } = {}) {
  const unit =
    definition ?? config.units.find((unit) => unit.id === "infantry");
  const building = {
    id: "2",
    type: unit.building,
    level: 1,
    completedLevel: 1,
    state: 1,
    queue: [],
    training: [{ type: unit.id, requirements: [] }],
  };
  const state = {
    buildings: [building],
    units: [],
    researchLevels: { [unit.id]: researchLevel },
    ...(catalog
      ? {
          unitCatalog: [
            {
              id: unit.id,
              baseHealth: 100,
              baseDamage: 34,
              effectiveHealth: 110,
              effectiveDamage: 37,
              researchHealthBonus: 10,
              researchDamageBonus: 3,
              researchBonusPercent: 10.25,
              researchLevel,
            },
          ],
        }
      : {}),
  };
  return {
    unit,
    building,
    state,
    config: { ...config, units: [unit] },
    dispatch() {},
  };
}
const renderTraining = (props) =>
  renderToStaticMarkup(createElement(panels.TrainingRoster, props));

test("Training cards show base stats plus actual improvements and effective totals", () => {
  const html = renderTraining(fixture());
  assert.match(html, /HP: 100 base \+ 10 improvements = 110 total/);
  assert.match(html, /Attack: 34 base \+ 3 improvements = 37 total/);
  assert.match(html, /Research 2 \/ 14 · \+10\.25% attack and health/);
  assert.match(html, />Train Recruit Squad<\/button>/);
  assert.doesNotMatch(html, /\+10% attack and health|NaN|undefined/);
});

test("Unresearched training cards remain compact without a catalog", () => {
  const html = renderTraining(fixture({ researchLevel: 0, catalog: false }));
  assert.match(html, /HP <strong>100<\/strong>/);
  assert.match(html, /Attack <strong>34<\/strong>/);
  assert.match(html, /Research 0 \/ 14 · \+0% attack and health/);
  assert.doesNotMatch(
    html,
    /unit-stat-researched|unit-stat-bonus|NaN|undefined/,
  );
});

test("Training cards do not exaggerate improvements rounded down by combat", () => {
  const definition = {
    ...config.units.find((unit) => unit.id === "infantry"),
    health: 50,
    damage: 1,
  };
  const html = renderTraining(
    fixture({ researchLevel: 1, catalog: false, definition }),
  );
  assert.match(html, /HP: 50 base \+ 2 improvements = 52 total/);
  assert.match(html, /Attack <strong>1<\/strong>/);
  assert.doesNotMatch(html, /Attack: 1 base \+ 1|NaN|undefined/);
});

test("Unit inspector keeps wounded health separate from improved maximum stats", () => {
  const props = fixture();
  props.state.units.push({
    id: "7",
    type: props.unit.id,
    source: props.building.id,
    health: 71,
    maxHealth: 110,
  });
  const html = renderToStaticMarkup(
    createElement(panels.Inspector, { ...props, selected: "7" }),
  );
  assert.match(html, /71 \/ 110/);
  assert.match(html, /HP: 100 base \+ 10 improvements = 110 total/);
  assert.match(html, /Attack: 34 base \+ 3 improvements = 37 total/);
  assert.match(html, /Research bonus: \+10\.25% attack and health/);
  assert.doesNotMatch(html, /\+10% base attack and health|NaN|undefined/);
});
