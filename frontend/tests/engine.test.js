import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import factory from "../public/wasm/empires_engine.js";
import { GameEngine } from "../src/engine/GameEngine.js";
import { restore } from "../src/storage/index.js";
import { pickTile, toScreen } from "../src/game/Coordinates.js";
import { spriteLayout } from "../src/game/SpriteLayout.js";
import { spriteArt, spriteFile } from "../src/game/SpriteAssets.js";
const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
const wasmBinary = await readFile(
  new URL("../public/wasm/empires_engine.wasm", import.meta.url),
);
const legacy = await readFile(
  new URL("../../tests/fixtures/legacy-native.save.json", import.meta.url),
  "utf8",
);
async function engine() {
  return GameEngine.create({ factory, config, wasmBinary });
}
function construct(e, buildingType) {
  const world = e.getWorld();
  const occupied = new Set();
  for (const b of e.getState().buildings)
    for (let dy = 0; dy < b.footprint[1]; dy++)
      for (let dx = 0; dx < b.footprint[0]; dx++)
        occupied.add(`${b.position[0] + dx},${b.position[1] + dy}`);
  const candidates = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) candidates.push({ x, y });
  const distance = ({ x, y }) =>
    Math.abs(x - world.width / 2) + Math.abs(y - world.height / 2);
  candidates.sort((a, b) => distance(a) - distance(b));
  for (const { x, y } of candidates) {
    if (
      buildingType === "barracks" &&
      ![
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].every(([dx, dy]) => {
        const nx = x + dx,
          ny = y + dy;
        return (
          nx >= 0 &&
          ny >= 0 &&
          nx < world.width &&
          ny < world.height &&
          [1, 2].includes(world.tiles[ny * world.width + nx]) &&
          !occupied.has(`${nx},${ny}`)
        );
      })
    )
      continue;
    const payload = { buildingType, x, y };
    if (!e.dispatch({ type: "CAN_BUILD", payload }).ok) continue;
    assert(e.dispatch({ type: "BUILD", payload }).ok);
    for (let i = 0; i < 24; i++) e.tick(250);
    return e.getState().buildings.at(-1);
  }
  throw new Error(`No place to build ${buildingType}`);
}
function ensureSquadPersonnel(e, count = 3) {
  const required = count * config.units.find((u) => u.id === "infantry").people;
  while (e.getState().population.capacity < required) construct(e, "house");
  assert(e.getState().population.capacity >= required);
}
function clean(state) {
  const result = structuredClone(state);
  delete result.revision;
  return result;
}
test("A new settlement starts with a Town Hall and House provides troop capacity", async () => {
  const e = await engine();
  try {
    const state = e.getState();
    assert.equal(state.buildings.length, 1);
    assert.equal(state.buildings[0].type, "townhall");
    assert.equal(state.buildings[0].housing, 5);
    assert.deepEqual(state.buildings[0].footprint, [3, 3]);
    assert.equal(state.population.current, 0);
    assert.equal(state.stock[4], 0);
    assert.equal(state.population.capacity, 5);
    const house = construct(e, "house");
    assert.equal(house.housing, 2);
    assert.deepEqual(house.footprint, [2, 2]);
    assert.equal(e.getState().population.capacity, 7);
    for (let i = 0; i < 200; i++) e.tick(250);
    assert.equal(e.getState().population.current, 0);
    assert(e.load(e.save()).ok);
    assert.equal(e.getState().population.capacity, 7);
    assert(e.load(legacy).ok);
    assert(e.getState().population.capacity > 0);
    assert(e.dispatch({ type: "NEW_GAME", payload: { seed: 7319 } }).ok);
    assert.equal(e.getState().buildings.length, 1);
    assert.equal(e.getState().population.capacity, 5);
    assert.equal(e.getState().population.current, 0);
  } finally {
    e.dispose();
  }
});
test("WASM rejects invalid commands without mutating the game", async () => {
  const e = await engine();
  try {
    const before = e.getState();
    for (const action of [
      { type: "UNKNOWN" },
      { type: "BUILD", payload: { buildingType: "house", x: 1.25, y: 2 } },
      { type: "COLLECT", payload: { id: 1 } },
      { type: "COLLECT", payload: { id: "18446744073709551616" } },
      { type: "NEW_GAME", payload: { seed: -1 } },
    ])
      assert.equal(e.dispatch(action).ok, false);
    assert.equal(e.tick(-1).ok, false);
    assert.equal(e.tick(251).ok, false);
    assert.deepEqual(e.getState(), before);
  } finally {
    e.dispose();
  }
});
test("WASM preserves the real classic save, exact 64-bit battle IDs and round trip", async () => {
  const a = await engine(),
    b = await engine();
  try {
    assert.equal(a.load(legacy).ok, true);
    const state = a.getState();
    assert(state.battle);
    const enemy = state.battle.fighters.find((f) => f.enemy);
    assert.equal(typeof enemy.id, "string");
    assert(BigInt(enemy.id) > BigInt(Number.MAX_SAFE_INTEGER));
    const bytes = a.save();
    assert.equal(b.load(bytes).ok, true);
    assert.deepEqual(clean(a.getState()), clean(b.getState()));
    const corrupt = bytes.replace(/"checksum":\s*"/, '"checksum":"0');
    assert.equal(b.load(corrupt).ok, false);
    assert.deepEqual(clean(b.getState()), clean(state));
  } finally {
    a.dispose();
    b.dispose();
  }
});
test("New terrain keeps its center and survives saves across multiple seeds", async () => {
  const e = await engine();
  try {
    for (const seed of [0, 1, 2, 3, 145, 7319, 4294967295]) {
      assert(e.dispatch({ type: "NEW_GAME", payload: { seed } }).ok);
      const world = e.getWorld();
      assert.equal(world.generatorVersion, 2);
      for (
        let y = Math.floor(world.height / 2) - 2;
        y <= Math.floor(world.height / 2) + 2;
        y++
      )
        for (
          let x = Math.floor(world.width / 2) - 2;
          x <= Math.floor(world.width / 2) + 2;
          x++
        )
          assert.equal(world.tiles[y * world.width + x], 2);
      assert(e.load(e.save()).ok);
      assert.deepEqual(e.getWorld(), world);
    }
    assert(e.load(legacy).ok);
    assert.equal(e.getWorld().generatorVersion, 1);
    assert(e.dispatch({ type: "NEW_GAME", payload: { seed: 145 } }).ok);
    assert.equal(e.getWorld().generatorVersion, 2);
  } finally {
    e.dispose();
  }
});
test("Tree removal spends gold earned from a battle and persists cleared terrain", async () => {
  const e = await engine();
  try {
    assert.equal(e.getState().stock[4], 0);
    const barracks = construct(e, "barracks");
    ensureSquadPersonnel(e);
    for (let i = 0; i < 3; i++) {
      assert(
        e.dispatch({
          type: "TRAIN",
          payload: { id: barracks.id, unitType: "infantry" },
        }).ok,
      );
      advance(
        e,
        config.units.find((unit) => unit.id === "infantry").seconds * 1000,
      );
    }
    advance(e, 50000);
    assert.equal(e.getState().stock[4], 0);
    assert(
      e.dispatch({ type: "BATTLE_START", payload: { automatic: true } }).ok,
    );
    for (let i = 0; i < 2000 && !e.getState().battle.finished; i++) e.tick(250);
    assert(e.getState().battle.victory);
    assert.equal(e.getState().stock[4], 0);
    assert(e.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(e.getState().stock[4], config.battle.rewards.coins);
    const world = e.getWorld();
    let plot;
    const occupied = new Set();
    for (const b of e.getState().buildings)
      for (let dy = 0; dy < b.footprint[1]; dy++)
        for (let dx = 0; dx < b.footprint[0]; dx++)
          occupied.add(`${b.position[0] + dx},${b.position[1] + dy}`);
    for (let y = 0; y < world.height - 1 && !plot; y++)
      for (let x = 0; x < world.width - 1 && !plot; x++) {
        const cells = [
          [x, y],
          [x + 1, y],
          [x, y + 1],
          [x + 1, y + 1],
        ];
        if (
          cells.every(
            ([cx, cy]) =>
              [1, 2, 3].includes(world.tiles[cy * world.width + cx]) &&
              !occupied.has(`${cx},${cy}`),
          ) &&
          cells.some(([cx, cy]) => world.tiles[cy * world.width + cx] === 3)
        )
          plot = { x, y, cells };
      }
    assert(plot);
    const [tx, ty] = plot.cells.find(
      ([x, y]) => world.tiles[y * world.width + x] === 3,
    );
    const tile = { x: tx, y: ty };
    const index = ty * world.width + tx;
    const before = e.getState();
    assert(e.dispatch({ type: "CLEAR_TREE", payload: tile }).ok);
    assert.equal(e.getState().stock[4], before.stock[4] - 20);
    assert.equal(e.getState().stock[1], before.stock[1] + 20);
    assert.equal(e.getWorld().tiles[index], 2);
    const after = e.getState();
    for (const payload of [
      tile,
      { x: -1, y: 0 },
      { x: tile.x + 0.5, y: tile.y },
    ]) {
      assert.equal(e.dispatch({ type: "CLEAR_TREE", payload }).ok, false);
      assert.deepEqual(e.getState(), after);
    }
    for (const [x, y] of plot.cells)
      if (e.getWorld().tiles[y * world.width + x] === 3)
        assert(e.dispatch({ type: "CLEAR_TREE", payload: { x, y } }).ok);
    assert(
      e.dispatch({
        type: "BUILD",
        payload: { buildingType: "farm", x: plot.x, y: plot.y },
      }).ok,
    );
    const savedWorld = e.getWorld();
    const savedState = clean(e.getState());
    assert(e.load(e.save()).ok);
    assert.deepEqual(e.getWorld(), savedWorld);
    assert.deepEqual(clean(e.getState()), savedState);
    assert(e.dispatch({ type: "NEW_GAME", payload: { seed: world.seed } }).ok);
    assert.deepEqual(e.getWorld(), world);
  } finally {
    e.dispose();
  }
});
test("Fixed-step outcomes are independent of render cadence", async () => {
  const a = await engine(),
    b = await engine();
  try {
    for (let i = 0; i < 400; i++) a.tick(50);
    for (let i = 0; i < 100; i++) {
      b.tick(17);
      b.tick(83);
      b.tick(100);
    }
    assert.deepEqual(clean(a.getState()), clean(b.getState()));
  } finally {
    a.dispose();
    b.dispose();
  }
});
test("Construction, production, collect, training and battlefield commands run through WASM", async () => {
  const e = await engine();
  try {
    const world = e.getWorld();
    let tile;
    for (let y = 0; y < world.height && !tile; y++)
      for (let x = 0; x < world.width; x++) {
        if (
          e.dispatch({
            type: "CAN_BUILD",
            payload: { buildingType: "house", x, y },
          }).ok
        ) {
          tile = { x, y };
          break;
        }
      }
    assert(tile);
    assert(
      e.dispatch({ type: "BUILD", payload: { buildingType: "house", ...tile } })
        .ok,
    );
    for (let i = 0; i < 100; i++) e.tick(250);
    assert.equal(e.getState().buildings.at(-1).state, 1);
    construct(e, "farm");
    construct(e, "barracks");
    advance(e, 60000);
    const farm = e.getState().buildings.find((b) => b.type === "farm"),
      food = e.getState().stock[0];
    assert(e.dispatch({ type: "COLLECT", payload: { id: farm.id } }).ok);
    assert(e.getState().stock[0] > food);
    const barracks =
      e.getState().buildings.find((b) => b.type === "barracks") ||
      construct(e, "barracks");
    ensureSquadPersonnel(e);
    for (let i = 0; i < 3; i++) {
      assert(
        e.dispatch({
          type: "TRAIN",
          payload: { id: barracks.id, unitType: "infantry" },
        }).ok,
      );
      advance(
        e,
        config.units.find((unit) => unit.id === "infantry").seconds * 1000,
      );
    }
    for (let i = 0; i < 200; i++) e.tick(250);
    assert.equal(e.getState().units.length, 3);
    assert(e.dispatch({ type: "BATTLE_START" }).ok);
    const ally = e.getState().battle.fighters.find((f) => !f.enemy),
      options = e.dispatch({
        type: "BATTLE_OPTIONS",
        payload: { id: ally.id },
      });
    assert.deepEqual(options.moves, []);
    assert.equal(options.targets.length, 2);
    assert.equal(
      e.dispatch({ type: "BATTLE_MOVE", payload: { id: ally.id, x: 2, y: 0 } })
        .ok,
      false,
    );
    assert(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ally.id, target: options.targets[0] },
      }).ok,
    );
    assert.equal(e.dispatch({ type: "BATTLE_END_TURN" }).ok, false);
  } finally {
    e.dispose();
  }
});
test("Backup recovery handles a damaged or missing primary and keeps failed loads atomic", async () => {
  const e = await engine();
  try {
    const original = e.save();
    assert.match(
      (
        await restore(e, {
          read: async (key) => (key === "backup" ? original : "broken"),
        })
      ).message,
      /backup/,
    );
    assert.match(
      (
        await restore(e, {
          read: async (key) => (key === "backup" ? original : null),
        })
      ).message,
      /backup/,
    );
    const state = e.getState();
    await assert.rejects(restore(e, { read: async () => "{broken" }), /kept/);
    assert.deepEqual(e.getState(), state);
    assert.equal((await restore(e, { read: async () => null })).empty, true);
  } finally {
    e.dispose();
  }
});
test("Engine lifecycle releases Embind objects and rejects use after disposal", async () => {
  const e = await engine();
  assert(e.validateSave(e.save()));
  assert(!e.validateSave("invalid"));
  e.dispose();
  e.dispose();
  assert.throws(() => e.getState(), /disposed/);
});
test("Sprite ground centers and foundations align with their occupied cells", async () => {
  for (const definition of config.buildings) {
    const [w, h] = definition.footprint;
    const art = spriteArt[definition.id];
    const layout = spriteLayout(definition.id, definition.footprint);
    const center = toScreen((w - 1) / 2, (h - 1) / 2);
    assert(Math.abs(art.ground[0] - layout.anchorX * art.size[0]) < 1e-9);
    assert(Math.abs(art.ground[1] - layout.anchorY * art.size[1]) < 1e-9);
    assert(
      Math.abs((art.base[1] / 2) * layout.scaleY - (center.y + 18) * 0.5) <
        1e-9,
    );
    assert(Math.abs(art.base[0] * layout.scaleX - (w + h) * 18) < 1e-9);
    const doubled = spriteLayout(definition.id, definition.footprint, {
      width: art.size[0] * 2,
      height: art.size[1] * 2,
    });
    assert.equal(doubled.scaleX, layout.scaleX / 2);
    assert.equal(doubled.scaleY, layout.scaleY / 2);
  }
  for (const type of Object.keys(spriteArt)) {
    const art = spriteArt[type];
    const path = art.path || `assets/sprites/${spriteFile(type)}`;
    const data = await readFile(new URL(`../public/${path}`, import.meta.url));
    if (path.endsWith(".png"))
      assert.equal(
        data.subarray(1, 4).toString(),
        "PNG",
        `${type} artwork exists`,
      );
    else assert(data.toString().includes("<svg"), `${type} artwork exists`);
    assert(Number.isFinite(spriteLayout(type).top));
  }
});
test("Isometric picking round-trips every tile and rejects outside map", () => {
  for (let x = 0; x < 36; x++)
    for (let y = 0; y < 36; y++)
      assert.deepEqual(pickTile(toScreen(x, y), 36, 36), { x, y });
  assert.equal(pickTile({ x: 100000, y: 100000 }, 36, 36), null);
});
test("Native and WASM produce identical world, state and commands", async () => {
  const native = JSON.parse(
    execFileSync(
      fileURLToPath(
        new URL("../../build-core/parity_snapshot", import.meta.url),
      ),
      { encoding: "utf8" },
    ),
  );
  const e = await engine();
  try {
    for (let i = 0; i < 40; i++) e.tick(250);
    const town = e.getState().buildings.find((b) => b.type === "townhall");
    assert.equal(
      e.dispatch({ type: "COLLECT", payload: { id: town.id } }).ok,
      false,
    );
    assert.deepEqual({ world: e.getWorld(), state: e.getState() }, native);
  } finally {
    e.dispose();
  }
});

test("A complete WASM battle pays rewards exactly once and resumes island time", async () => {
  const e = await engine();
  try {
    const barracks =
      e.getState().buildings.find((b) => b.type === "barracks") ||
      construct(e, "barracks");
    ensureSquadPersonnel(e);
    for (let i = 0; i < 3; i++) {
      assert(
        e.dispatch({
          type: "TRAIN",
          payload: { id: barracks.id, unitType: "infantry" },
        }).ok,
      );
      advance(
        e,
        config.units.find((unit) => unit.id === "infantry").seconds * 1000,
      );
    }
    for (let i = 0; i < 200; i++) e.tick(250);
    assert(e.dispatch({ type: "BATTLE_START" }).ok);
    const elapsed = e.getState().elapsedMs;
    e.tick(250);
    assert.equal(e.getState().elapsedMs, elapsed);
    for (let turn = 0; turn < 40 && !e.getState().battle.finished; turn++) {
      const ids = e
        .getState()
        .battle.fighters.filter((f) => !f.enemy && f.health > 0 && !f.attacked)
        .map((f) => f.id);
      for (const id of ids) {
        if (e.getState().battle.finished || e.getState().battle.enemyTurn)
          break;
        const target = e.dispatch({ type: "BATTLE_OPTIONS", payload: { id } })
          .targets[0];
        assert(
          e.dispatch({ type: "BATTLE_ATTACK", payload: { id, target } }).ok,
        );
      }
      advance(e, 2000);
    }
    assert(e.getState().battle.victory);
    const before = e.getState().stock[4];
    assert(e.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(e.getState().stock[4], before + config.battle.rewards.coins);
    assert.equal(e.dispatch({ type: "BATTLE_FINISH" }).ok, false);
    e.tick(250);
    assert(e.getState().elapsedMs > elapsed);
  } finally {
    e.dispose();
  }
});
test("Expeditions deploy only the chosen soldiers and reject invalid squads atomically", async () => {
  const e = await engine();
  try {
    const barracks =
      e.getState().buildings.find((b) => b.type === "barracks") ||
      construct(e, "barracks");
    ensureSquadPersonnel(e);
    for (let i = 0; i < 3; i++) {
      assert(
        e.dispatch({
          type: "TRAIN",
          payload: { id: barracks.id, unitType: "infantry" },
        }).ok,
      );
      advance(
        e,
        config.units.find((unit) => unit.id === "infantry").seconds * 1000,
      );
    }
    for (let i = 0; i < 200; i++) e.tick(250);
    const before = e.getState(),
      units = before.units;
    assert.equal(units.length, 3);
    for (const unitIds of [
      [],
      [units[0].id, units[0].id],
      ["999999"],
      [Number(units[0].id)],
      "invalid",
      Array(config.battle.maxArmy + 1).fill(units[0].id),
    ]) {
      assert.equal(
        e.dispatch({ type: "BATTLE_START", payload: { unitIds } }).ok,
        false,
      );
      assert.deepEqual(e.getState(), before);
    }
    assert(
      e.dispatch({ type: "BATTLE_START", payload: { unitIds: [units[1].id] } })
        .ok,
    );
    assert.deepEqual(
      e
        .getState()
        .battle.fighters.filter((f) => !f.enemy)
        .map((f) => f.id),
      [units[1].id],
    );
    const copy = await engine();
    try {
      assert(copy.load(e.save()).ok);
      assert.deepEqual(clean(copy.getState()), clean(e.getState()));
    } finally {
      copy.dispose();
    }
    assert(e.dispatch({ type: "BATTLE_AUTO" }).ok);
    for (let i = 0; i < 60 && !e.getState().battle.finished; i++)
      advance(e, 1000);
    assert(e.getState().battle.finished);
    assert(e.dispatch({ type: "BATTLE_FINISH" }).ok);
    for (const unit of [units[0], units[2]])
      assert.deepEqual(
        e.getState().units.find((u) => u.id === unit.id),
        unit,
      );
  } finally {
    e.dispose();
  }
});

const mixedSave = await readFile(
  new URL(
    "../../tests/fixtures/empires-of-wars-145.save.json",
    import.meta.url,
  ),
  "utf8",
);
const unitDomain = (u) => config.units.find((d) => d.id === u.type).domain;
function advance(e, ms) {
  for (let t = 0; t < ms; t += 250) assert(e.tick(Math.min(250, ms - t)).ok);
}
test("WASM deploys ordered domain rounds, skips missing squads and caps each at five", async () => {
  const e = await engine();
  try {
    for (const domains of [
      ["land"],
      ["naval"],
      ["air"],
      ["land", "air"],
      ["land", "naval", "air"],
    ]) {
      assert(e.load(mixedSave).ok);
      const units = e.getState().units;
      const chosen = domains
        .flatMap((d) => units.filter((u) => unitDomain(u) === d).slice(0, 5))
        .reverse();
      assert(
        e.dispatch({
          type: "BATTLE_START",
          payload: { unitIds: chosen.map((u) => u.id) },
        }).ok,
      );
      const b = e.getState().battle;
      assert.deepEqual(b.phases, domains);
      assert.equal(b.domain, domains[0]);
      assert(b.fighters.every((f) => f.domain === domains[0]));
      assert.equal(b.automatic, false);
    }
    assert(e.load(mixedSave).ok);
    const before = e.getState();
    const six = before.units
      .filter((u) => unitDomain(u) === "land")
      .slice(0, 6)
      .map((u) => u.id);
    assert.equal(
      e.dispatch({ type: "BATTLE_START", payload: { unitIds: six } }).ok,
      false,
    );
    assert.deepEqual(e.getState(), before);
  } finally {
    e.dispose();
  }
});
test("WASM auto attack alternates sides, pauses, switches to manual and resumes exact saves", async () => {
  const e = await engine(),
    copy = await engine();
  try {
    assert(e.load(mixedSave).ok);
    const original = e.getState(),
      chosen = ["land", "naval", "air"].flatMap((d) =>
        original.units.filter((u) => unitDomain(u) === d).slice(0, 5),
      );
    assert(
      e.dispatch({
        type: "BATTLE_START",
        payload: { unitIds: chosen.map((u) => u.id) },
      }).ok,
    );
    const seen = new Set([e.getState().battle.domain]);
    assert(e.dispatch({ type: "BATTLE_AUTO" }).ok);
    advance(e, 750);
    assert(copy.load(e.save()).ok);
    advance(e, 250);
    advance(copy, 250);
    assert.deepEqual(clean(copy.getState()), clean(e.getState()));
    assert.equal(e.getState().battle.actions, 1);
    assert.equal(e.getState().battle.enemyTurn, false);
    assert(e.dispatch({ type: "BATTLE_PAUSE" }).ok);
    const paused = e.getState();
    advance(e, 4000);
    assert.deepEqual(e.getState(), paused);
    assert(copy.load(e.save()).ok);
    assert(e.dispatch({ type: "BATTLE_PAUSE" }).ok);
    assert(copy.dispatch({ type: "BATTLE_PAUSE" }).ok);
    advance(e, 1000);
    advance(copy, 1000);
    assert.deepEqual(clean(e.getState()), clean(copy.getState()));
    assert.equal(e.getState().battle.actions, 2);
    assert.equal(e.getState().battle.enemyTurn, false);
    assert(e.dispatch({ type: "BATTLE_AUTO" }).ok);
    assert.equal(e.getState().battle.automatic, false);
    const ally = e
      .getState()
      .battle.fighters.find((f) => !f.enemy && f.health > 0 && !f.attacked);
    assert(
      e.dispatch({ type: "BATTLE_OPTIONS", payload: { id: ally.id } }).targets
        .length > 0,
    );
    assert(e.dispatch({ type: "BATTLE_AUTO" }).ok);
    for (let i = 0; i < 400 && !e.getState().battle.finished; i++) {
      seen.add(e.getState().battle.domain);
      advance(e, 1000);
      const state = e.getState();
      for (const hit of state.battle.lastAttacks) {
        assert.equal(typeof hit.attacker, "string");
        assert.equal(typeof hit.target, "string");
      }
    }
    assert.deepEqual([...seen], ["land", "naval", "air"]);
    const done = e.getState();
    assert(done.battle.finished);
    assert.equal(done.battle.outcomes.length, 3);
    assert.equal(done.elapsedMs, original.elapsedMs);
    assert.deepEqual(done.stock, original.stock);
    assert(copy.load(e.save()).ok);
    assert.deepEqual(clean(copy.getState()), clean(done));
    assert(e.dispatch({ type: "BATTLE_FINISH" }).ok);
    assert.equal(
      e.getState().stock[4],
      original.stock[4] +
        (done.battle.victory ? config.battle.rewards.coins : 0),
    );
    assert.equal(e.dispatch({ type: "BATTLE_FINISH" }).ok, false);
    const unselected = original.units.filter(
      (u) => !chosen.some((c) => c.id === u.id),
    );
    for (const u of unselected)
      assert.deepEqual(
        e.getState().units.find((v) => v.id === u.id),
        u,
      );
  } finally {
    e.dispose();
    copy.dispose();
  }
});

test("WASM manual target selection automatically hands over and resumes a saved enemy turn", async () => {
  const e = await engine(),
    copy = await engine();
  try {
    assert(e.load(mixedSave).ok);
    const ids = e
      .getState()
      .units.filter((u) => u.type === "ship")
      .map((u) => u.id);
    assert(e.dispatch({ type: "BATTLE_START", payload: { unitIds: ids } }).ok);
    const before = e.getState(),
      enemies = before.battle.fighters.filter((f) => f.enemy);
    assert(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids[0], target: enemies[1].id },
      }).ok,
    );
    assert.equal(e.getState().battle.enemyTurn, false);
    assert.equal(
      e.getState().battle.fighters.find((f) => f.id === enemies[0].id).health,
      enemies[0].health,
    );
    assert(
      e.getState().battle.fighters.find((f) => f.id === enemies[1].id).health <
        enemies[1].health,
    );
    const once = e.getState();
    assert.equal(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids[0], target: enemies[0].id },
      }).ok,
      false,
    );
    assert.deepEqual(e.getState(), once);
    assert(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids[1], target: enemies[0].id },
      }).ok,
    );
    assert(e.getState().battle.enemyTurn);
    assert.equal(
      e.dispatch({
        type: "BATTLE_ATTACK",
        payload: { id: ids[1], target: enemies[0].id },
      }).ok,
      false,
    );
    advance(e, 1000);
    assert.equal(e.getState().battle.actions, 3);
    assert(e.getState().battle.enemyTurn);
    advance(e, 250);
    assert(copy.load(e.save()).ok);
    advance(e, 750);
    advance(copy, 750);
    assert.deepEqual(clean(e.getState()), clean(copy.getState()));
    assert.equal(e.getState().battle.enemyTurn, false);
    assert.equal(e.getState().battle.round, 2);
    assert.equal(e.getState().battle.actions, 4);
    assert(
      e
        .getState()
        .battle.fighters.filter((f) => !f.enemy)
        .every((f) => !f.attacked),
    );
    assert.equal(e.getState().elapsedMs, before.elapsedMs);
  } finally {
    e.dispose();
    copy.dispose();
  }
});
