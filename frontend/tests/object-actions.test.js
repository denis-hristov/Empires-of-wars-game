import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  actionMenuPosition,
  mapObject,
  mapObjectActions,
} from "../src/game/MapObjectActions.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server, components;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  components = await server.ssrLoadModule("/src/components/ObjectActions.jsx");
});
after(async () => server?.close());
function building(type, level = 1, extra = {}) {
  const definition = config.buildings.find((item) => item.id === type);
  const resource = ["food", "wood", "stone", "iron", "coins"].indexOf(
    definition.resource,
  );
  return {
    id: type,
    type,
    level,
    completedLevel: level,
    state: 1,
    position: [5, 5],
    footprint: definition.footprint,
    stored: 12,
    production: { resource, intervalSeconds: 6, capacity: 120 },
    training: config.units
      .filter((unit) => unit.building === type)
      .map((unit) => ({ type: unit.id, requirements: [] })),
    queue: [],
    upgrade: { ok: true, reason: "" },
    ...extra,
  };
}
function state(buildings = [], units = []) {
  return {
    buildings,
    units,
    stock: [600, 1000, 0, 0, 0],
    research: [],
    researchLevels: {},
    population: { capacity: 20, military: 0, reserved: 0, free: 20 },
    townHallLevel: 2,
  };
}
const objectFor = (entity, game = state([entity])) =>
  mapObject(game, entity.id, config);

test("Every building exposes only actions supported by its real capabilities", () => {
  for (const definition of config.buildings) {
    const entity = building(definition.id),
      game = state([entity]);
    const actions = mapObjectActions(objectFor(entity, game), game);
    const ids = actions.map((action) => action.id);
    assert(ids.includes("info"));
    assert(ids.includes("upgrade"));
    assert(ids.includes("move"));
    assert.equal(ids.includes("collect"), definition.resource !== null);
    assert.equal(
      ids.includes("train"),
      ["barracks", "harbor", "airbase"].includes(definition.id),
    );
    assert.equal(ids.includes("research"), definition.id === "academy");
  }
});

test("Upgrade preview stays available when unaffordable; max level and construction are explicit", () => {
  const house = building("house", 1, {
      upgrade: { ok: false, reason: "Not enough resources" },
    }),
    game = state([house]);
  assert.equal(
    mapObjectActions(objectFor(house, game), game).find(
      (action) => action.id === "upgrade",
    ).disabled,
    false,
  );
  house.completedLevel = 5;
  assert.equal(
    mapObjectActions(objectFor(house, game), game).find(
      (action) => action.id === "upgrade",
    ).disabled,
    true,
  );
  house.completedLevel = 0;
  house.state = 0;
  assert.equal(
    mapObjectActions(objectFor(house, game), game).find(
      (action) => action.id === "upgrade",
    ).reason,
    "Finish construction first",
  );
});

test("Collect and relocation availability reflect stored resources and active tasks", () => {
  const farm = building("farm", 1, { stored: 0 }),
    game = state([farm]);
  assert(
    mapObjectActions(objectFor(farm, game), game).find(
      (action) => action.id === "collect",
    ).disabled,
  );
  farm.stored = 7;
  assert.equal(
    mapObjectActions(objectFor(farm, game), game).find(
      (action) => action.id === "collect",
    ).value,
    7,
  );
  farm.state = 2;
  assert(
    mapObjectActions(objectFor(farm, game), game).find(
      (action) => action.id === "move",
    ).disabled,
  );
  const academy = building("academy");
  game.buildings.push(academy);
  game.research.push({ academy: academy.id });
  assert(
    mapObjectActions(objectFor(academy, game), game).find(
      (action) => action.id === "move",
    ).disabled,
  );
});

test("All thirty army objects have information and movement, with carrier and reserve constraints", () => {
  for (const definition of config.units) {
    const unit = { id: definition.id, type: definition.id, position: [3, 3] },
      game = state([], [unit]);
    const object = mapObject(game, unit.id, config);
    assert.equal(object.kind, "unit");
    const actions = mapObjectActions(object, game);
    assert(actions.some((action) => action.id === "info"));
    const dismissal = actions.find((action) => action.id === "dismiss");
    assert(dismissal && !dismissal.disabled);
    assert.equal(dismissal.value, 20);
    assert.equal(
      !!actions.find((action) => action.id === "move").disabled,
      false,
    );
    assert.equal(
      actions.some((action) => action.id === "carrier"),
      definition.carrierSlots > 0,
    );
    unit.reserve = true;
    assert(
      mapObjectActions(object, game).find((action) => action.id === "move")
        .disabled,
    );
    assert.equal(
      mapObjectActions(object, game).find((action) => action.id === "dismiss")
        .disabled,
      false,
    );
  }
});

test("Dismissal previews the selected unit, twenty gold and freed population; information includes reserve and embarked units", () => {
  for (const definition of config.units) {
    const unit = {
      id: "10",
      type: definition.id,
      position: [3, 3],
      footprint: definition.footprint,
      health: definition.health,
      reserve: true,
    };
    const game = state([], [unit]);
    const object = mapObject(game, unit.id, config);
    const html = renderToStaticMarkup(
      createElement(components.ObjectActionDialog, {
        object,
        state: game,
        config,
        action: "dismiss",
        dispatch() {},
        onClose() {},
      }),
    );
    assert(html.includes(`Dismiss ${definition.name}`));
    assert(html.includes("20 gold"));
    assert(html.includes("Population freed"));
    assert(html.includes("Keep unit"));
    assert(html.includes("Dismiss for 20 gold"));
    assert(!html.includes("disabled"));
  }
  const unit = {
    id: "10",
    type: "infantry",
    position: [3, 3],
    footprint: [1, 1],
    health: 100,
    reserve: true,
  };
  const game = state([], [unit]);
  const html = renderToStaticMarkup(
    createElement(components.ObjectActionDialog, {
      object: mapObject(game, unit.id, config),
      state: game,
      config,
      action: "info",
      dispatch() {},
      onClose() {},
    }),
  );
  assert(html.includes("Dismiss for 20 gold"));
});

test("Loaded carriers, battles and full gold stockpiles explain unavailable dismissal", () => {
  const carrier = { id: "10", type: "titan_carrier", position: [3, 3] };
  const game = state(
    [],
    [carrier, { id: "11", type: "aircraft", carrier: "10" }],
  );
  const object = mapObject(game, carrier.id, config);
  let dismissal = mapObjectActions(object, game).find(
    (action) => action.id === "dismiss",
  );
  assert(dismissal.disabled);
  assert.match(dismissal.reason, /Unload/);
  game.units.pop();
  assert.equal(
    mapObjectActions(object, game).find((action) => action.id === "dismiss")
      .disabled,
    false,
  );
  game.battle = {};
  dismissal = mapObjectActions(object, game).find(
    (action) => action.id === "dismiss",
  );
  assert(dismissal.disabled);
  assert.match(dismissal.reason, /battle/);
  game.battle = null;
  game.stock[4] = 1_000_000_000_000 - 20;
  dismissal = mapObjectActions(object, game).find(
    (action) => action.id === "dismiss",
  );
  assert(dismissal.disabled);
  assert.match(dismissal.reason, /stockpile/);
});

test("Trees and rocks get clear, supported object actions", () => {
  for (const kind of ["tree", "rock"]) {
    const object = mapObject(state(), { kind, position: [3, 8] }, config);
    assert.equal(object.key, `${kind}:3:8`);
    assert.deepEqual(
      mapObjectActions(object, state()).map((action) => action.id),
      kind === "tree" ? ["info", "remove"] : ["info"],
    );
  }
  assert.equal(mapObject(state(), "missing", config), null);
});

test("Context buttons stay at the bottom center after selection and camera movement", () => {
  for (const width of [320, 600, 800, 1280])
    for (const actionCount of [1, 2, 3, 4]) {
      const anchor = {
        x: width / 2,
        top: 250,
        bottom: 300,
        width,
        height: 720,
      };
      const dock = actionMenuPosition(anchor, actionCount);
      assert.equal(dock.left, width / 2);
      assert.equal(dock.bottom, width < 760 ? 130 : 20);
      assert(dock.left - dock.width / 2 >= 11.99);
      assert(dock.left + dock.width / 2 <= width - 11.99);
      assert.equal(dock.top, undefined);
      for (const x of [-1000, 0, width, width + 1000])
        for (const top of [-1000, 0, 650, 2000])
          assert.deepEqual(
            actionMenuPosition(
              { ...anchor, x, top, bottom: top + 200 },
              actionCount,
            ),
            dock,
          );
    }
});

test("Upgrade modal shows both exact level illustrations, target cost and disabled prerequisites", () => {
  const hall = building("townhall", 1, {
      upgrade: { ok: false, reason: "Requires Barracks level 1" },
    }),
    game = state([hall]);
  const html = renderToStaticMarkup(
    createElement(components.ObjectActionDialog, {
      object: objectFor(hall, game),
      action: "upgrade",
      state: game,
      config,
      dispatch() {},
      onClose() {},
    }),
  );
  assert(html.includes('role="dialog"'));
  assert(html.includes('aria-modal="true"'));
  assert(html.includes("town_hall_01.png"));
  assert(html.includes("town_hall_02.png"));
  assert(html.includes("360"));
  assert(html.includes("120"));
  assert(html.includes("Upgrade requirements"));
  assert(html.includes("Requires Barracks level 1"));
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Upgrade to level 2/);
});

test("Production upgrade explains exact intervals and storage; training opens a live queue and roster", () => {
  const farm = building("farm"),
    game = state([farm]);
  const html = renderToStaticMarkup(
    createElement(components.UpgradeContent, {
      object: objectFor(farm, game),
      state: game,
      config,
      dispatch() {},
      onClose() {},
    }),
  );
  assert(html.includes("6s → 4s"));
  assert(html.includes("120 → 240"));
  assert(html.includes("farm_02.png"));
  const barracks = building("barracks", 1, {
    queue: [{ type: "infantry", remainingMs: 4000 }],
  });
  game.buildings = [barracks];
  const training = renderToStaticMarkup(
    createElement(components.ObjectActionDialog, {
      object: objectFor(barracks, game),
      action: "train",
      state: game,
      config,
      dispatch() {},
      onClose() {},
    }),
  );
  assert(training.includes("Training queue"));
  assert(training.includes("4s"));
  assert(training.includes("Confirm") === false);
  assert(training.includes("Train Recruit Squad"));
  assert(training.includes("Next unlocks"));
});

test("Quick actions are tied to the matching map anchor and remain accessible by name", () => {
  const farm = building("farm"),
    game = state([farm]),
    object = objectFor(farm, game);
  const props = {
    object,
    state: game,
    anchor: {
      key: object.key,
      x: 400,
      top: 250,
      bottom: 300,
      width: 800,
      height: 600,
    },
    onAction() {},
    onClose() {},
  };
  const html = renderToStaticMarkup(
    createElement(components.ObjectQuickActions, props),
  );
  assert(html.includes('aria-label="Farm actions"'));
  assert(html.includes('aria-label="Collect Farm"'));
  assert(html.includes('aria-label="Upgrade Farm"'));
  assert.equal(
    renderToStaticMarkup(
      createElement(components.ObjectQuickActions, {
        ...props,
        anchor: { ...props.anchor, key: "another" },
      }),
    ),
    "",
  );
});
