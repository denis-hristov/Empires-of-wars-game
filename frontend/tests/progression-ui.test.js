import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  buildingLevelCap,
  completedBuildingLevel,
  completedLevelForType,
  productionIntervalSeconds,
  researchAcademy,
  researchUnitDefinition,
  researchUnitCap,
  townHallRequirements,
  upgradeGoldShortage,
} from "../src/game/BuildingProgression.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server;
let panels;
let actions;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  panels = await server.ssrLoadModule("/src/components/GamePanels.jsx");
  actions = await server.ssrLoadModule("/src/components/ObjectActions.jsx");
});
after(async () => server?.close());

const building = (type, level, extra = {}) => ({
  type,
  level,
  state: 1,
  completedLevel: level,
  ...extra,
});

test("Town Hall caps show delayed unlocks and the five-level economic progression", () => {
  assert.equal(buildingLevelCap(config, "academy", 1), 0);
  assert.equal(buildingLevelCap(config, "academy", 2), 1);
  assert.equal(buildingLevelCap(config, "academy", 3), 3);
  assert.equal(buildingLevelCap(config, "harbor", 2), 0);
  assert.equal(buildingLevelCap(config, "harbor", 3), 0);
  assert.equal(buildingLevelCap(config, "harbor", 4), 4);
  assert.equal(buildingLevelCap(config, "airbase", 5), 0);
  assert.equal(buildingLevelCap(config, "airbase", 6), 6);
  for (const type of ["house", "farm", "lumberyard", "stone", "iron"]) {
    assert.equal(buildingLevelCap(config, type, 8), 4);
    assert.equal(buildingLevelCap(config, type, 9), 5);
    assert.equal(buildingLevelCap(config, type, 10), 5);
  }
});

test("Town Hall requirements distinguish finished levels from work in progress", () => {
  const state = {
    buildings: [
      building("townhall", 3),
      building("barracks", 3),
      building("farm", 2),
      building("lumberyard", 2),
      building("stone", 1, { state: 2 }),
    ],
  };
  const requirements = townHallRequirements(state, config);
  assert.deepEqual(
    requirements.map((entry) => entry.type),
    ["barracks", "farm", "lumberyard", "stone", "population"],
  );
  assert(requirements.slice(0, 3).every((entry) => entry.met));
  assert.equal(requirements.at(-2).required, 2);
  assert.equal(requirements.at(-2).met, false);
  assert.equal(
    completedBuildingLevel(
      building("iron", 1, { state: 0, completedLevel: 0 }),
    ),
    0,
  );
  assert.deepEqual(
    townHallRequirements({ buildings: [building("townhall", 10)] }, config),
    [],
  );
});

test("Town Hall 6 includes Iron Mine 2 and does not require optional buildings", () => {
  const requirements = townHallRequirements(
    { buildings: [building("townhall", 5)] },
    config,
  );
  assert.deepEqual(
    requirements.map(({ type, required }) => [type, required]),
    [
      ["barracks", 5],
      ["farm", 3],
      ["lumberyard", 3],
      ["iron", 2],
      ["population", 300],
    ],
  );
});

test("Migrated duplicate buildings use their highest completed level", () => {
  const state = {
    buildings: [
      building("townhall", 3),
      building("barracks", 1),
      building("barracks", 3),
      building("farm", 1, { state: 0, completedLevel: 0 }),
      building("farm", 2),
      building("lumberyard", 2),
      building("stone", 2),
    ],
  };
  assert.equal(completedLevelForType(state, "barracks"), 3);
  assert(
    townHallRequirements(state, config)
      .filter((entry) => entry.type !== "population")
      .every((entry) => entry.met),
  );
  assert.equal(completedLevelForType(state, "iron"), 0);
});

test("Main research menu chooses the highest available migrated Academy", () => {
  const first = building("academy", 1, { id: "2" });
  const second = building("academy", 3, { id: "3" });
  const upgrading = building("academy", 4, { id: "4", state: 2 });
  assert.equal(
    researchAcademy({ buildings: [first, second, upgrading] }).id,
    "3",
  );
  const constructing = building("academy", 1, {
    id: "5",
    state: 0,
    completedLevel: 0,
  });
  assert.equal(researchAcademy({ buildings: [constructing] }).id, "5");
});

test("Unit stat presentation keeps unlock type independent from researched level", () => {
  const definition = config.units.find(
    (unit) => unit.level === 3 && unit.domain === "land",
  );
  const state = {
    researchLevels: { [definition.id]: 1 },
    unitCatalog: [
      { id: definition.id, effectiveHealth: 321, effectiveDamage: 23 },
    ],
  };
  const displayed = researchUnitDefinition(state, definition);
  assert.equal(displayed.level, 3);
  assert.equal(displayed.researchLevel, 1);
  assert.equal(displayed.health, 321);
  assert.equal(displayed.damage, 23);
  assert.equal(
    researchUnitDefinition({ researchLevels: {} }, definition).researchLevel,
    0,
  );
  const fallback = researchUnitDefinition(
    { researchLevels: { [definition.id]: 3 } },
    { ...definition, health: 100, damage: 100 },
  );
  assert.equal(fallback.health, 115);
  assert.equal(fallback.damage, 115);
});

test("Construction menu shows unlock reasons and current Town Hall caps", () => {
  const state = {
    townHallLevel: 1,
    buildings: [building("townhall", 1)],
    buildOptions: {
      harbor: {
        cap: 0,
        ok: false,
        reason: "Requires Town Hall level 4.",
        cost: { food: 40, wood: 120 },
      },
    },
  };
  const html = renderToStaticMarkup(
    createElement(panels.BuildMenu, {
      state,
      config,
      filter: "All",
      setFilter() {},
      onBuild() {},
    }),
  );
  assert(html.includes("Requires Town Hall level 4."));
  assert(html.includes("Town Hall level cap 0"));
  assert(html.includes("Town Hall level cap 1"));
  assert(html.includes('aria-label="Build Harbor" disabled=""'));
});

test("Research menu renders per-unit prices and the shared city research queue", () => {
  const unit = config.units.find(
    (definition) => definition.domain === "land" && definition.level === 3,
  );
  const state = {
    research: [{ type: unit.id, academy: "9", level: 3, remainingMs: 12000 }],
    buildings: [
      {
        ...building("academy", 5),
        id: "9",
        researchOptions: [
          {
            type: unit.id,
            level: 2,
            nextLevel: 3,
            maxLevel: 12,
            academyLimit: 3,
            cost: { food: 56, wood: 175 },
            seconds: 12,
            bonusPercent: 10,
            nextBonusPercent: 15,
            ok: false,
            reason: "Research queue is occupied.",
          },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(panels.ResearchPanel, {
      state,
      config,
      dispatch() {},
    }),
  );
  assert(html.includes("Unit type 3 · Research 2 / 12"));
  assert(html.includes("Research queue occupied"));
  assert(html.includes("Research level 3 · 12s remaining"));
  assert(html.includes('title="56 food"'));
  assert(html.includes('title="175 wood"'));
  assert(html.includes("+10% attack and health"));
  assert(html.includes('disabled=""'));
});

test("Migrated pending technologies retain names and every queue item is visible", () => {
  const technologies = config.technologies.slice(0, 2);
  assert.equal(technologies.length, 2);
  const state = {
    research: technologies.map((technology, index) => ({
      type: technology.id,
      academy: String(index + 1),
      level: 0,
      remainingMs: 4000,
    })),
    buildings: [building("academy", 2, { id: "1", researchOptions: [] })],
  };
  const html = renderToStaticMarkup(
    createElement(panels.ResearchPanel, { state, config, dispatch() {} }),
  );
  for (const technology of technologies) assert(html.includes(technology.name));
  assert.equal(html.match(/Legacy technology research/g)?.length, 2);
  assert(!html.includes("Research level 0"));
  const activity = renderToStaticMarkup(
    createElement(panels.ActivityPanel, {
      state: { ...state, buildings: [] },
      config,
      onSelect() {},
    }),
  );
  for (const technology of technologies)
    assert(activity.includes(technology.name));
});

test("Maximum research never offers or prices level 15", () => {
  const unit = config.units.find((definition) => definition.domain === "land");
  const state = {
    research: [],
    buildings: [
      building("academy", 10, {
        id: "1",
        researchOptions: [
          {
            type: unit.id,
            level: 14,
            nextLevel: 15,
            maxLevel: 14,
            academyLimit: 14,
            cost: {},
            seconds: 12,
            bonusPercent: 50,
            nextBonusPercent: 50,
            ok: false,
            reason: "Maximum research level reached",
          },
        ],
      }),
    ],
  };
  const html = renderToStaticMarkup(
    createElement(panels.ResearchPanel, { state, config, dispatch() {} }),
  );
  assert(html.includes("Research complete"));
  assert(html.includes("+50% attack and health"));
  assert(!html.includes("Research level 15"));
});

test("Resource costs support state Stock arrays and omit unused resources", () => {
  const html = renderToStaticMarkup(
    createElement(panels.Cost, { cost: [10, 30, 0, 0, 0] }),
  );
  assert(html.includes('title="10 food"'));
  assert(html.includes('title="30 wood"'));
  assert(!html.includes('title="0 stone"'));
});

test("Production intervals remain whole seconds for current and upcoming levels", () => {
  assert.deepEqual(
    [600, 900, 1200, 1800, 3600].map((ratePerHour) =>
      productionIntervalSeconds({ ratePerHour }),
    ),
    [6, 4, 3, 2, 1],
  );
  assert.equal(productionIntervalSeconds({ intervalSeconds: 6, rate: 1 }), 6);
  assert.equal(productionIntervalSeconds({ ratePerSecond: 1 / 3 }), 3);
  assert.equal(productionIntervalSeconds({ ratePerHour: 0 }), 0);
});

function farmInspector({ gold = 0, goldCost = 0, ready = false } = {}) {
  const farm = building("farm", 1, {
    id: "2",
    stored: 2,
    production: { resource: 0, intervalSeconds: 6, capacity: 30, full: false },
    queue: [],
    training: [],
    upgrade: { ok: ready, reason: ready ? "" : "Requires Town Hall level 2." },
  });
  const previewConfig = {
    ...config,
    buildings: config.buildings.map((definition) =>
      definition.id === "farm"
        ? {
            ...definition,
            levels: definition.levels.map((level, index) =>
              index === 1
                ? {
                    ...level,
                    ratePerHour: 900,
                    cost: { food: 40, coins: goldCost },
                  }
                : level,
            ),
          }
        : definition,
    ),
  };
  return renderToStaticMarkup(
    createElement(panels.Inspector, {
      state: {
        townHallLevel: 1,
        stock: [0, 0, 0, 0, gold],
        buildings: [farm],
        units: [],
        research: [],
      },
      config: previewConfig,
      selected: farm.id,
      dispatch() {},
      setMode() {},
      onOpenAttack() {},
    }),
  );
}

test("Building inspector describes current and next resource production intervals", () => {
  const html = farmInspector();
  assert(html.includes("+1 every 6s"));
  assert(html.includes("Next production: 1 food every 4 seconds."));
});

test("Upgrade gold advice remains visible alongside other unmet requirements", () => {
  const html = farmInspector({ gold: 7, goldCost: 20 });
  assert(html.includes("Requires Town Hall level 2."));
  assert(html.includes("Fight a battle to collect gold."));
  assert(html.includes("You need 13 more gold for this upgrade."));
  assert(html.includes("Open attack menu"));
});

test("Upgrade gold advice appears only for a real shortage", () => {
  assert(!farmInspector().includes("Fight a battle to collect gold."));
  assert(
    !farmInspector({ gold: 20, goldCost: 20 }).includes("Open attack menu"),
  );
  assert.equal(
    upgradeGoldShortage({ stock: [0, 0, 0, 0, 7] }, [0, 0, 0, 0, 20]),
    13,
  );
  assert.equal(upgradeGoldShortage({ stock: { coins: 30 } }, { coins: 20 }), 0);
});

test("Construction menu keeps repeated unlocked buildings available and shows their count", () => {
  const html = renderToStaticMarkup(
    createElement(panels.BuildMenu, {
      state: {
        townHallLevel: 1,
        buildings: [building("farm", 1), building("farm", 1, { state: 0 })],
        buildOptions: { farm: { cap: 1, ok: true, cost: { wood: 80 } } },
      },
      config,
      filter: "Economy",
      setFilter() {},
      onBuild() {},
    }),
  );
  assert(html.includes('aria-label="Build Farm" title=""'));
  assert(!html.includes('aria-label="Build Farm" disabled'));
  assert(html.includes("Built 2"));
  assert(html.includes("Town Hall level cap 1"));
  assert(!html.includes("One building of each type"));
});

test("All land, sea and air unit research caps follow the Academy staircase", () => {
  for (const unit of config.units) {
    assert.equal(
      researchUnitCap(unit, 10),
      11 - unit.level + 11 - Math.max(7, unit.level),
    );
    for (let academy = 0; academy <= 10; academy++)
      assert.equal(
        researchUnitCap(unit, academy),
        Math.max(0, academy - unit.level + 1) +
          Math.max(0, academy - Math.max(7, unit.level) + 1),
      );
  }
});

test("Research cards show per-type caps and explain retained paid improvements", () => {
  const unit = config.units.find((u) => u.domain === "land" && u.level === 3);
  const html = renderToStaticMarkup(
    createElement(panels.ResearchPanel, {
      state: {
        research: [],
        buildings: [
          {
            ...building("academy", 3),
            id: "9",
            researchOptions: [
              {
                type: unit.id,
                level: 3,
                nextLevel: 4,
                maxLevel: 12,
                academyLimit: 1,
                preservedLevel: 3,
                bonusPercent: 15,
                nextBonusPercent: 20,
                seconds: 12,
                cost: { food: 10 },
                ok: false,
                reason: "Requires an active Academy at level 6",
              },
            ],
          },
        ],
      },
      config,
      dispatch() {},
    }),
  );
  assert(html.includes("Current Academy limit 1 · Maximum 12"));
  assert(html.includes("Previously paid research is retained"));
  assert(html.includes("Requires an active Academy at level 6"));
});

test("Research menus explain the double unlocks and the first troop reaches level fourteen", () => {
  for (const [level, cap] of [
    [6, 6],
    [7, 8],
    [8, 10],
    [9, 12],
    [10, 14],
  ]) {
    const html = renderToStaticMarkup(
      createElement(panels.ResearchPanel, {
        state: {
          research: [],
          buildings: [building("academy", level, { researchOptions: [] })],
        },
        config,
        dispatch() {},
      }),
    );
    assert(html.includes("Academy levels 7 through 10 unlock two each"));
    assert(html.includes(`allows type 1 up to research ${cap}`));
  }
});

test("Academy upgrade previews show the doubled research cap from level seven onward", () => {
  const definition = config.buildings.find((b) => b.id === "academy");
  for (const [level, before, after] of [
    [5, 5, 6],
    [6, 6, 8],
    [7, 8, 10],
    [8, 10, 12],
    [9, 12, 14],
  ]) {
    const entity = building("academy", level, {
      id: "9",
      production: { resource: -1 },
      upgrade: { ok: true },
    });
    const html = renderToStaticMarkup(
      createElement(actions.UpgradeContent, {
        object: { entity, definition },
        state: {
          buildings: [entity],
          research: [],
          stock: [1000000, 1000000, 1000000, 1000000, 1000000],
        },
        config,
        dispatch() {},
        onClose() {},
      }),
    );
    assert(html.includes(`${before} → ${after}`));
    assert(html.includes(`${level >= 6 ? "Two" : "One"} more research levels`));
  }
});
