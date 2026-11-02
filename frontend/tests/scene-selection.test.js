import { test } from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite, Texture, Ticker } from "pixi.js";
import { WorldScene } from "../src/game/WorldScene.js";
import { toScreen } from "../src/game/Coordinates.js";

function scene() {
  const anchors = [];
  const world = new WorldScene(
    { clientWidth: 1280, clientHeight: 720 },
    {
      onSelectionAnchor: (anchor) => anchors.push(anchor),
    },
  );
  world.ready = true;
  world.root = new Container();
  world.root.position.set(640, -120);
  world.zoom = 0.8;
  world.root.scale.set(world.zoom);
  world.state = {
    buildings: [
      { id: "1", type: "farm", position: [18, 20], footprint: [2, 2] },
    ],
    units: [
      { id: "2", type: "infantry", position: [16, 19], footprint: [1, 1] },
    ],
  };
  for (const entity of [...world.state.buildings, ...world.state.units]) {
    const node = new Container(),
      sprite = new Sprite(Texture.EMPTY);
    node.addChild(sprite);
    const point = toScreen(...entity.position);
    node.position.set(point.x, point.y);
    world.root.addChild(node);
    world.entities.set(entity.id, { node, sprite, target: point });
  }
  return { world, anchors };
}

function terrainScene() {
  const world = new WorldScene({}, {});
  const calls = { terrain: 0, center: 0 };
  world.drawTerrain = () => calls.terrain++;
  world.center = () => calls.center++;
  const map = {
    seed: 7319,
    generatorVersion: 1,
    width: 2,
    height: 2,
    tiles: [2, 3, 2, 2],
  };
  return { world, calls, map };
}

test("Updating configuration for the same island preserves terrain and decoration sprites", () => {
  const { world, calls, map } = terrainScene();
  world.setWorld(map, { units: [] });
  const updatedConfig = { units: [{ id: "infantry", attack: 4 }] };
  for (let i = 0; i < 20; i++) world.setWorld(map, updatedConfig);
  assert.equal(world.config, updatedConfig);
  assert.equal(calls.terrain, 1);
  assert.equal(calls.center, 1);
});

test("Clearing a tree redraws the same island without resetting the camera", () => {
  const { world, calls, map } = terrainScene();
  const config = { units: [] };
  world.setWorld(map, config);
  const cleared = { ...map, tiles: [2, 2, 2, 2] };
  world.setWorld(cleared, config);
  assert.equal(world.world, cleared);
  assert.equal(calls.terrain, 2);
  assert.equal(calls.center, 1);
});

test("Loading a different island redraws terrain and centers its camera", () => {
  const { world, calls, map } = terrainScene();
  const config = { units: [] };
  world.setWorld(map, config);
  const nextIsland = { ...map, seed: 9051, tiles: [2, 2, 4, 2] };
  world.setWorld(nextIsland, config);
  assert.equal(world.world, nextIsland);
  assert.equal(calls.terrain, 2);
  assert.equal(calls.center, 2);
});

test("Selecting trees and rocks emits finite anchors without requiring an entity sprite", () => {
  const { world, anchors } = scene();
  for (const kind of ["tree", "rock"]) {
    world.selection = { kind, position: [7, 11] };
    world.animate(1);
    const anchor = anchors.at(-1),
      position = toScreen(7, 11);
    assert.equal(anchor.key, `${kind}:7:11`);
    assert.equal(anchor.x, Math.round(640 + position.x * 0.8));
    assert(Number.isFinite(anchor.top) && Number.isFinite(anchor.bottom));
  }
});

test("The real animation ticker continues through repeated building, terrain and unit selection", () => {
  const { world, anchors } = scene();
  const ticker = new Ticker();
  let frames = 0;
  ticker.add((tick) => {
    world.animate(tick.deltaTime);
    frames++;
  });
  const selections = [
    "1",
    { kind: "tree", position: [7, 11] },
    "2",
    { kind: "rock", position: [9, 12] },
    null,
  ];
  try {
    for (let i = 0; i < 500; i++) {
      world.selection = selections[i % selections.length];
      ticker.update((i + 1) * 17);
    }
    assert.equal(frames, 500);
    assert.equal(anchors.length, 500);
    assert.equal(anchors.at(-1), null);
  } finally {
    ticker.destroy();
  }
});

test("Stable selection avoids repeated menu updates and pending artwork has a safe fallback", () => {
  const { world, anchors } = scene();
  world.selection = { kind: "tree", position: [7, 11] };
  for (let i = 0; i < 20; i++) world.animate(1);
  assert.equal(anchors.length, 1);
  world.selection = "1";
  world.entities.delete("1");
  world.animate(1);
  assert.equal(anchors.at(-1).key, "building:1");
  assert(Number.isFinite(anchors.at(-1).top));
  world.mode = { type: "build" };
  world.animate(1);
  assert.equal(anchors.at(-1), null);
});

test("Movement overlays use building green for valid destinations and red for invalid destinations across the whole unit", () => {
  const { world } = scene();
  const fills = [];
  world.overlay = {
    clear() {
      fills.length = 0;
      return this;
    },
    poly() {
      return this;
    },
    stroke() {
      return this;
    },
    fill(options) {
      fills.push(options);
      return this;
    },
  };
  world.ghost = new Sprite(Texture.EMPTY);
  world.textureFor = () => Texture.EMPTY;
  world.selection = "2";
  world.mode = { type: "move-unit", id: "2" };
  world.hover = { x: 12, y: 14 };
  for (const [type, footprint] of [
    ["infantry", [1, 1]],
    ["titan_carrier", [1, 3]],
    ["phantom_bomber", [2, 3]],
  ]) {
    Object.assign(world.state.units[0], { type, footprint });
    for (const ok of [false, true]) {
      world.placement = { ok };
      world.drawOverlay();
      assert.equal(fills.length, footprint[0] * footprint[1]);
      assert(fills.every((fill) => fill.color === (ok ? 0xb6e594 : 0xdb8269)));
      assert.equal(world.ghost.tint, ok ? 0xffffff : 0xeaa291);
      assert.equal(world.ghost.visible, true);
      assert.deepEqual(
        { x: world.ghost.position.x, y: world.ghost.position.y },
        toScreen(12 + (footprint[0] - 1) / 2, 14 + (footprint[1] - 1) / 2),
      );
    }
  }
});
