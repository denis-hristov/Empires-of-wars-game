import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { spriteArt, spriteFile } from "../src/game/SpriteAssets.js";
import { arenaSpriteLayout, spriteLayout } from "../src/game/SpriteLayout.js";
import { formationPositions } from "../src/game/BattlePresentation.js";
const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const fixturePath = fileURLToPath(
  new URL("../../tests/fixtures/military-army.save.json", import.meta.url),
);
const fixture = await readFile(fixturePath, "utf8");
async function engine() {
  const e = await GameEngine.create({ factory, config, wasmBinary });
  assert(e.load(fixture).ok);
  return e;
}
const clean = (s) => {
  const copy = structuredClone(s);
  delete copy.revision;
  return copy;
};
test("All thirty catalog entries use distinct artwork and production cards", async () => {
  const e = await engine();
  try {
    assert.equal(config.units.length, 30);
    for (const [building, domain] of [
      ["barracks", "land"],
      ["harbor", "naval"],
      ["airbase", "air"],
    ]) {
      const entries = config.units.filter((u) => u.domain === domain);
      assert.deepEqual(
        entries.map((u) => u.level),
        Array.from({ length: 10 }, (_, i) => i + 1),
      );
      for (const unit of entries) {
        const expected = `${String(unit.level).padStart(2, "0")}-${unit.name.toLowerCase().replaceAll(" ", "-")}.svg`;
        assert.equal(spriteFile(unit.id), expected);
        const art = spriteArt[unit.id];
        const svg = await readFile(
          new URL(`../public/assets/sprites/${expected}`, import.meta.url),
          "utf8",
        );
        assert(svg.includes(`viewBox="0 0 ${art.size.join(" ")}"`));
        const map = spriteLayout(unit.id);
        assert(
          Math.abs(
            (art.bounds[2] - art.bounds[0]) * map.scaleX - art.targetWidth,
          ) < 1e-9,
        );
        const arena = arenaSpriteLayout(unit.id);
        const scale = arena.height / 100 / art.size[1];
        assert((art.bounds[2] - art.bounds[0]) * scale <= 1.3 + 1e-9);
        assert((art.bounds[3] - art.bounds[1]) * scale <= 1 + 1e-9);
        assert.equal(art.facing, domain === "land" && unit.level <= 3 ? 1 : -1);
      }
      assert.equal(new Set(entries.map((u) => spriteFile(u.id))).size, 10);
      assert.equal(
        e.getState().buildings.find((b) => b.type === building).training.length,
        10,
      );
    }
    const slots = formationPositions(25);
    assert.equal(slots.length, 25);
    assert.equal(new Set(slots.map(({ x, y }) => `${x},${y}`)).size, 25);
  } finally {
    e.dispose();
  }
});
test("WASM enforces carrier tiers, unique aircraft, capacity, unloading and queue refunds", async () => {
  const e = await engine();
  try {
    const units = e.getState().units;
    const carrier = units.find((u) => u.type === "titan_carrier");
    const aircraft = units.find((u) => u.type === "fighter_aircraft");
    const jet = units.find((u) => u.type === "jet_fighter");
    const before = e.getState();
    assert(
      e.dispatch({
        type: "EMBARK_AIRCRAFT",
        payload: { id: jet.id, carrier: carrier.id },
      }).ok,
    );
    assert.equal(
      e.getState().units.find((u) => u.id === carrier.id).aircraftCount,
      2,
    );
    assert(
      e.dispatch({ type: "DISEMBARK_AIRCRAFT", payload: { id: jet.id } }).ok,
    );
    assert(
      e.dispatch({
        type: "EMBARK_AIRCRAFT",
        payload: { id: aircraft.id, carrier: carrier.id },
      }).ok,
    );
    assert.equal(
      e.getState().units.find((u) => u.id === carrier.id).aircraftCount,
      2,
    );
    assert(
      !e.dispatch({
        type: "BATTLE_START",
        payload: { unitIds: [carrier.id, aircraft.id] },
      }).ok,
    );
    assert(
      e.dispatch({ type: "DISEMBARK_AIRCRAFT", payload: { id: aircraft.id } })
        .ok,
    );
    assert.equal(
      e.getState().units.find((u) => u.id === aircraft.id).carrier,
      null,
    );
    const barracks = e.getState().buildings.find((b) => b.type === "barracks");
    const stock = e.getState().stock;
    assert(
      e.dispatch({
        type: "TRAIN",
        payload: { id: barracks.id, unitType: "titan_mech" },
      }).ok,
    );
    assert.equal(e.getState().population.reserved, 3);
    assert(
      e.dispatch({
        type: "CANCEL_TRAINING",
        payload: { id: barracks.id, index: 0 },
      }).ok,
    );
    assert.deepEqual(e.getState().stock, stock);
    assert.equal(e.getState().population.reserved, 0);
    assert(
      !e.dispatch({
        type: "CANCEL_TRAINING",
        payload: { id: barracks.id, index: 0 },
      }).ok,
    );
    assert(e.load(e.save()).ok);
  } finally {
    e.dispose();
  }
});
test("Real WASM military battle exactly matches native combat and save resume", async () => {
  const native = JSON.parse(
    execFileSync(
      fileURLToPath(
        new URL("../../build-core/parity_snapshot", import.meta.url),
      ),
      [fixturePath],
      { encoding: "utf8" },
    ),
  );
  const e = await engine(),
    resumed = await engine();
  try {
    assert(
      e.dispatch({ type: "BATTLE_START", payload: { automatic: true } }).ok,
    );
    assert(e.getState().battle.fighters.some((f) => f.shield > 0));
    for (let i = 0; i < 19; i++) e.tick(250);
    assert(resumed.load(e.save()).ok);
    for (let i = 19; i < 4000; i++) {
      e.tick(250);
      resumed.tick(250);
    }
    assert(e.getState().battle.finished);
    assert.deepEqual(clean(e.getState()), clean(resumed.getState()));
    assert.deepEqual({ world: e.getWorld(), state: e.getState() }, native);
    assert(e.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert(e.load(e.save()).ok);
  } finally {
    e.dispose();
    resumed.dispose();
  }
});
test("WASM air support appears once in the assigned surface phase", async () => {
  const e = await engine();
  try {
    const units = e.getState().units,
      tank = units.find((u) => u.type === "plasma_tank"),
      plane = units.find((u) => u.type === "attack_aircraft");
    assert(
      e.dispatch({
        type: "BATTLE_START",
        payload: {
          unitIds: [tank.id, plane.id],
          airMissions: [{ id: plane.id, phase: "land" }],
        },
      }).ok,
    );
    const b = e.getState().battle;
    assert.deepEqual(b.phases, ["land"]);
    assert.equal(b.fighters.filter((f) => f.id === plane.id).length, 1);
    assert.equal(b.fighters.find((f) => f.id === plane.id).domain, "air");
    assert(e.load(e.save()).ok);
  } finally {
    e.dispose();
  }
});
