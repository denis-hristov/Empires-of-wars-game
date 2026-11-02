import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { toScreen } from "../src/game/Coordinates.js";
import {
  footprintCenter,
  mapFootprint,
  mapUnitAtTile,
  occupiesTile,
} from "../src/game/UnitFootprint.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server;
let Inspector;
let TrainingRoster;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  ({ Inspector, TrainingRoster } = await server.ssrLoadModule(
    "/src/components/GamePanels.jsx",
  ));
});
after(async () => server?.close());

test("Training menus describe the correct footprint ranges for their own domain", () => {
  for (const [type, expected] of [
    [
      "barracks",
      ["Types 1 to 3 occupy 1×1 tiles.", "Types 4 to 10 occupy 1×2 tiles."],
    ],
    [
      "harbor",
      [
        "Types 1 to 2 occupy 1×1 tiles.",
        "Types 3 to 6 occupy 1×2 tiles.",
        "Types 7 to 10 occupy 1×3 tiles.",
      ],
    ],
    [
      "airbase",
      ["Types 1 to 6 occupy 2×2 tiles.", "Types 7 to 10 occupy 2×3 tiles."],
    ],
  ]) {
    const building = {
      id: type,
      type,
      state: 1,
      level: 10,
      queue: [],
      training: config.units
        .filter((unit) => unit.building === type)
        .map((unit) => ({ type: unit.id, requirements: [] })),
    };
    const text = renderToStaticMarkup(
      createElement(TrainingRoster, {
        building,
        state: { buildings: [building], units: [], researchLevels: {} },
        config,
        dispatch() {},
      }),
    ).replace(/<[^>]+>/g, "");
    for (const description of expected)
      assert(text.includes(description), `${type}: ${description}`);
  }
});

test("All army types occupy their unlock tier's full map area", () => {
  for (const definition of config.units) {
    const unit = {
      id: definition.id,
      position: [7, 11],
      footprint: definition.footprint,
    };
    const expected =
      definition.domain === "naval"
        ? [1, definition.level <= 2 ? 1 : definition.level <= 6 ? 2 : 3]
        : definition.domain === "air"
          ? [2, definition.level <= 6 ? 2 : 3]
          : [1, definition.level >= 4 ? 2 : 1];
    assert.deepEqual(mapFootprint(unit), expected, definition.id);
    for (let y = 0; y < expected[1]; y++)
      for (let x = 0; x < expected[0]; x++) {
        const tile = { x: 7 + x, y: 11 + y };
        assert(occupiesTile(unit, tile), `${definition.id} cell ${x},${y}`);
        assert.equal(mapUnitAtTile([unit], tile), unit);
      }
    for (const tile of [
      { x: 6, y: 11 },
      { x: 7 + expected[0], y: 11 },
      { x: 7, y: 10 },
      { x: 7, y: 11 + expected[1] },
    ]) {
      assert.equal(mapUnitAtTile([unit], tile), undefined, definition.id);
    }
  }
});

test("Army artwork is anchored at the center of its entire footprint", () => {
  for (const definition of config.units) {
    const unit = { position: [3, 9], footprint: definition.footprint };
    const center = toScreen(...footprintCenter(unit));
    const first = toScreen(3, 9);
    const last = toScreen(
      3 + definition.footprint[0] - 1,
      9 + definition.footprint[1] - 1,
    );
    assert.deepEqual(
      center,
      { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
      definition.id,
    );
  }
});

test("Embarked and reserve aircraft do not intercept either cell of deployed units", () => {
  const unit = { id: "active", position: [3, 9], footprint: [1, 2] };
  const aboard = { ...unit, id: "aboard", carrier: "carrier" };
  const reserve = { ...unit, id: "reserve", reserve: true };
  for (const y of [9, 10]) {
    assert.equal(mapUnitAtTile([aboard, reserve, unit], { x: 3, y }), unit);
    assert.equal(mapUnitAtTile([aboard, reserve], { x: 3, y }), undefined);
  }
});

test("Unit inspector explains map area independently from research level", () => {
  for (const domain of ["land", "naval", "air"])
    for (const level of [3, 4, 10]) {
      const definition = config.units.find(
        (unit) => unit.domain === domain && unit.level === level,
      );
      const unit = {
        id: "unit",
        type: definition.id,
        footprint: definition.footprint,
        health: definition.health,
        maxHealth: definition.health,
      };
      const html = renderToStaticMarkup(
        createElement(Inspector, {
          state: {
            buildings: [],
            units: [unit],
            researchLevels: { [definition.id]: 10 },
          },
          config,
          selected: unit.id,
          dispatch() {},
        }),
      );
      assert(html.includes("Map footprint"));
      assert(html.includes(`${definition.footprint.join("×")} tiles`));
    }
});
