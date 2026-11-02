import "pixi.js/unsafe-eval";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { toScreen, pickTile } from "./Coordinates.js";
import { fitSprite, spriteLayout } from "./SpriteLayout.js";
import {
  footprintCenter,
  mapFootprint,
  mapUnitAtTile,
} from "./UnitFootprint.js";
import { constructionBarrierLayout } from "./ConstructionBarrier.js";
import { spriteArt, spriteUrl } from "./SpriteAssets.js";
import {
  buildingArtwork,
  buildingSpriteKey,
  completedBuildingSpriteKey,
} from "./BuildingSpriteArt.js";
const names = [
  ...Object.keys(spriteArt).filter(
    (type) => !buildingArtwork[buildingSpriteKey(type)],
  ),
  "townhall:1",
];
function diamond(g, x, y, color, alpha = 1) {
  g.poly([x, y - 18, x + 36, y, x, y + 18, x - 36, y]).fill({ color, alpha });
}
function noise(x, y) {
  return ((Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0) % 100;
}
export class WorldScene {
  constructor(host, callbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.app = new Application();
    this.entities = new Map();
    this.listeners = [];
    this.selection = null;
    this.mode = null;
    this.hover = null;
    this.zoom = 0.7;
    this.disposed = false;
    this.initialized = false;
    this.cameraChanged = false;
    this.points = new Map();
    this.textureLoads = new Map();
    this.textureErrors = new Map();
  }
  async init() {
    await this.app.init({
      resizeTo: this.host,
      background: "#397984",
      antialias: true,
      resolution: Math.min(devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
      powerPreference: "low-power",
    });
    this.initialized = true;
    if (this.disposed) {
      this.destroyApp();
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.app.canvas.tabIndex = 0;
    this.app.canvas.setAttribute("role", "application");
    this.app.canvas.setAttribute(
      "aria-label",
      "Island map. Arrow keys select tiles. Enter interacts. Drag to pan. Scroll to zoom.",
    );
    this.root = new Container();
    this.terrain = new Graphics();
    this.decorations = [];
    this.objects = new Container();
    this.objects.sortableChildren = true;
    this.overlay = new Graphics();
    this.root.addChild(this.terrain, this.overlay, this.objects);
    this.app.stage.addChild(this.root);
    const textures = await Promise.all(
      names.map((name) => Assets.load(spriteUrl(name))),
    );
    if (this.disposed) {
      this.destroyApp();
      return;
    }
    this.textures = Object.fromEntries(
      names.map((name, i) => [name, textures[i]]),
    );
    this.ghost = new Sprite(Texture.EMPTY);
    this.ghost.visible = false;
    this.root.addChild(this.ghost);
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.cameraChanged) this.center();
    });
    this.resizeObserver.observe(this.host);
    this.app.ticker.add((ticker) => this.animate(ticker.deltaTime));
    this.ready = true;
  }
  textureFor(key) {
    if (this.textures[key]) return this.textures[key];
    if (this.textureLoads.has(key)) return null;
    const failure = this.textureErrors.get(key);
    if (failure && Date.now() < failure.retryAt) return null;
    this.textureErrors.delete(key);
    const pending = Assets.load(spriteUrl(key))
      .then((texture) => {
        this.textureLoads.delete(key);
        if (this.disposed) return;
        this.textures[key] = texture;
        if (this.state)
          this.update(
            this.state,
            this.selection,
            this.mode,
            this.placement,
            this.battleOptions,
          );
      })
      .catch((error) => {
        this.textureLoads.delete(key);
        this.textureErrors.set(key, { error, retryAt: Date.now() + 5000 });
      });
    this.textureLoads.set(key, pending);
    return null;
  }
  on(name, listener, options) {
    this.app.canvas.addEventListener(name, listener, options);
    this.listeners.push([name, listener, options]);
  }
  local(event) {
    const box = this.app.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  worldPoint(point) {
    return {
      x: (point.x - this.root.x) / this.zoom,
      y: (point.y - this.root.y) / this.zoom,
    };
  }
  dimensions() {
    return this.battle
      ? { width: this.config.battle.width, height: this.config.battle.height }
      : this.world;
  }
  tileAt(point) {
    const d = this.dimensions();
    return d ? pickTile(this.worldPoint(point), d.width, d.height) : null;
  }
  bindInput() {
    this.on("contextmenu", (e) => e.preventDefault());
    this.on("pointerdown", (e) => {
      this.app.canvas.focus();
      this.app.canvas.setPointerCapture(e.pointerId);
      const p = this.local(e);
      this.points.set(e.pointerId, p);
      this.drag = { start: p, last: p, button: e.button, moved: false };
      if (this.points.size === 2) this.pinch = this.pinchInfo();
    });
    this.on("pointermove", (e) => {
      const p = this.local(e);
      if (this.points.has(e.pointerId)) this.points.set(e.pointerId, p);
      if (this.points.size === 2) {
        const next = this.pinchInfo();
        if (this.pinch)
          this.setZoom(
            (this.zoom * next.distance) / Math.max(this.pinch.distance, 1),
            next.center,
          );
        this.pinch = next;
        if (this.drag) this.drag.moved = true;
        return;
      }
      if (this.drag && this.points.has(e.pointerId)) {
        const dx = p.x - this.drag.last.x,
          dy = p.y - this.drag.last.y;
        if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 5)
          this.drag.moved = true;
        if (this.drag.moved || this.drag.button === 2) {
          this.root.x += dx;
          this.root.y += dy;
          this.cameraChanged = true;
        }
        this.drag.last = p;
      }
      const tile = this.tileAt(p);
      if (tile?.x !== this.hover?.x || tile?.y !== this.hover?.y) {
        this.hover = tile;
        this.callbacks.onHover(tile);
        this.drawOverlay();
      }
    });
    this.on("pointerup", (e) => {
      const p = this.local(e);
      this.points.delete(e.pointerId);
      if (this.drag && !this.drag.moved && this.drag.button === 0) {
        const hit = this.mode
          ? null
          : [
              ...this.entities.values(),
              ...this.decorations
                .filter(
                  (sprite) =>
                    [3, 4].includes(sprite.terrainType) && sprite.visible,
                )
                .map((sprite) => ({
                  node: sprite,
                  sprite,
                  tile: sprite.tile,
                  decoration: true,
                })),
            ]
              .sort((a, b) => b.node.zIndex - a.node.zIndex)
              .find(
                (item) =>
                  item.sprite.visible &&
                  (item.sprite.getBounds().containsPoint(p.x, p.y) ||
                    (item.barrier?.visible &&
                      item.barrier.getBounds().containsPoint(p.x, p.y))),
              );
        const tile = hit?.decoration ? hit.tile : this.tileAt(p) || hit?.tile;
        if (tile) this.callbacks.onPick(tile, hit?.id || null);
      }
      this.drag = null;
      this.pinch = null;
    });
    this.on("pointercancel", (e) => {
      this.points.delete(e.pointerId);
      this.drag = null;
      this.pinch = null;
    });
    this.on(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0014), this.local(e));
      },
      { passive: false },
    );
    this.on("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const d = this.dimensions(),
          p = this.hover || {
            x: Math.floor(d.width / 2),
            y: Math.floor(d.height / 2),
          };
        const delta = {
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        }[e.key];
        this.hover = {
          x: Math.max(0, Math.min(d.width - 1, p.x + delta[0])),
          y: Math.max(0, Math.min(d.height - 1, p.y + delta[1])),
        };
        this.callbacks.onHover(this.hover);
        this.drawOverlay();
      }
      if (e.key === "Enter" && this.hover) {
        e.preventDefault();
        this.callbacks.onPick(this.hover, null);
      }
    });
  }
  pinchInfo() {
    const [a, b] = [...this.points.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }
  setZoom(
    value,
    anchor = { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 },
  ) {
    const old = this.worldPoint(anchor);
    this.zoom = Math.max(0.3, Math.min(2.4, value));
    this.root.scale.set(this.zoom);
    this.root.position.set(
      anchor.x - old.x * this.zoom,
      anchor.y - old.y * this.zoom,
    );
    this.cameraChanged = true;
  }
  center() {
    if (!this.root || !this.world) return;
    const d = this.dimensions();
    if (this.battle) {
      const left = this.host.clientWidth >= 950 ? 390 : 20;
      const right = 28,
        top = 100,
        bottom = 105;
      const bounds = {
        left: -d.height * 36,
        right: d.width * 36,
        top: Math.min(
          -18,
          ...this.battle.fighters.map((f) => spriteLayout(f.type).top - 30),
        ),
        bottom: (d.width + d.height - 2) * 18 + 25,
      };
      this.zoom = Math.max(
        0.32,
        Math.min(
          (this.host.clientWidth - left - right) / (bounds.right - bounds.left),
          (this.host.clientHeight - top - bottom) /
            (bounds.bottom - bounds.top),
          1.8,
        ),
      );
      this.root.scale.set(this.zoom);
      this.root.position.set(
        left +
          (this.host.clientWidth - left - right) / 2 -
          ((bounds.left + bounds.right) / 2) * this.zoom,
        top +
          (this.host.clientHeight - top - bottom) / 2 -
          ((bounds.top + bounds.bottom) / 2) * this.zoom,
      );
      this.cameraChanged = false;
      return;
    }
    this.zoom = Math.min(
      this.host.clientWidth / 1550,
      this.host.clientHeight / 810,
      1.05,
    );
    this.zoom = Math.max(0.32, this.zoom);
    this.root.scale.set(this.zoom);
    const mid = toScreen(d.width / 2, d.height / 2);
    this.root.position.set(
      this.host.clientWidth / 2 - mid.x * this.zoom,
      this.host.clientHeight * 0.54 - mid.y * this.zoom,
    );
    this.cameraChanged = false;
  }
  setWorld(world, config) {
    const changed =
      !this.world ||
      this.world.seed !== world.seed ||
      this.world.generatorVersion !== world.generatorVersion ||
      this.world.width !== world.width ||
      this.world.height !== world.height;
    const terrainChanged = this.world !== world;
    this.world = world;
    this.config = config;
    if (terrainChanged) this.drawTerrain();
    if (changed) this.center();
  }
  drawTerrain() {
    if (!this.terrain || !this.world) return;
    this.terrain.clear();
    this.decorations.forEach((child) => child.destroy());
    this.decorations = [];
    const d = this.dimensions();
    for (let sum = 0; sum < d.width + d.height; sum++)
      for (let x = 0; x < d.width; x++) {
        const y = sum - x;
        if (y < 0 || y >= d.height) continue;
        const p = toScreen(x, y),
          n = noise(x, y);
        const type = this.battle
          ? this.battle.domain === "naval"
            ? 6
            : this.battle.domain === "air"
              ? 7
              : 2
          : this.world.tiles[y * d.width + x];
        if (type === 0) {
          let coast = false;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const xx = x + dx,
              yy = y + dy;
            if (
              xx >= 0 &&
              yy >= 0 &&
              xx < d.width &&
              yy < d.height &&
              this.world.tiles[yy * d.width + xx] !== 0
            )
              coast = true;
          }
          if (coast) {
            diamond(this.terrain, p.x, p.y, 0x60a4a4, 0.7);
            if (n < 45)
              this.terrain
                .moveTo(p.x - 13, p.y)
                .lineTo(p.x + 11, p.y - 2)
                .stroke({ color: 0xc2ddd0, alpha: 0.5, width: 1 });
          } else if (n < 25)
            this.terrain
              .moveTo(p.x - 9, p.y)
              .lineTo(p.x + 9, p.y - 1)
              .stroke({ color: 0xa5d3cf, alpha: 0.15, width: 1 });
          continue;
        }
        const color =
          type === 6
            ? (x + y) % 2
              ? 0x397e99
              : 0x438da7
            : type === 7
              ? (x + y) % 2
                ? 0xa5c5d8
                : 0xb5d4e5
              : type === 1
                ? n < 50
                  ? 0xd8ca97
                  : 0xd2c28f
                : this.battle
                  ? (x + y) % 2
                    ? 0x8da57b
                    : 0x95ad83
                  : n < 30
                    ? 0x9eb58a
                    : n < 65
                      ? 0xa6bb90
                      : 0xa0b78a;
        this.terrain
          .poly([
            p.x - 36,
            p.y,
            p.x,
            p.y + 18,
            p.x + 36,
            p.y,
            p.x + 36,
            p.y + 7,
            p.x,
            p.y + 25,
            p.x - 36,
            p.y + 7,
          ])
          .fill(type === 6 ? 0x2b6177 : type === 7 ? 0x7ea4bb : 0x7f8b64);
        diamond(this.terrain, p.x, p.y, color);
        if (type === 2 && n < 20 && !this.battle)
          this.terrain
            .moveTo(p.x, p.y)
            .lineTo(p.x + 2, p.y - 4)
            .moveTo(p.x + 4, p.y + 1)
            .lineTo(p.x + 6, p.y - 2)
            .stroke({ color: 0x6b8e65, alpha: 0.5, width: 1 });
        if ((type === 3 || type === 4) && !this.battle) {
          const sprite = new Sprite(
            this.textures[type === 3 ? "tree" : "rock"],
          );
          fitSprite(sprite, type === 3 ? "tree" : "rock");
          sprite.position.set(p.x, p.y);
          sprite.zIndex = x + y;
          sprite.tile = { x, y };
          sprite.terrainType = type;
          this.objects.addChild(sprite);
          this.decorations.push(sprite);
          sprite.label = `decoration-${x}-${y}`;
        }
      }
  }
  update(state, selection, mode, placement, battleOptions) {
    if (!this.ready) return;
    const switched =
      Boolean(state.battle) !== Boolean(this.battle) ||
      state.battle?.domain !== this.battle?.domain;
    this.state = state;
    this.battle = state.battle;
    this.selection = selection;
    this.mode = mode;
    this.placement = placement;
    this.battleOptions = battleOptions;
    if (switched) {
      this.entities.forEach((e) => e.node.destroy({ children: true }));
      this.entities.clear();
      this.drawTerrain();
      this.center();
    }
    const list = this.battle
      ? this.battle.fighters.map((f) => ({ ...f, kind: "fighter" }))
      : [
          ...state.buildings.map((b) => ({ ...b, kind: "building" })),
          ...state.units
            .filter((u) => !u.carrier && !u.reserve)
            .map((u) => ({ ...u, kind: "unit" })),
        ];
    const alive = new Set(list.map((e) => e.id));
    for (const [id, e] of this.entities)
      if (!alive.has(id)) {
        e.node.destroy({ children: true });
        this.entities.delete(id);
      }
    for (const entity of list) {
      let visual = this.entities.get(entity.id);
      const key =
        entity.kind === "building"
          ? completedBuildingSpriteKey(entity)
          : entity.type;
      const texture = this.textureFor(key);
      const footprint = this.battle ? [1, 1] : mapFootprint(entity);
      const p = toScreen(
        ...(this.battle ? entity.position : footprintCenter(entity)),
      );
      if (!visual) {
        const node = new Container(),
          sprite = new Sprite(texture || Texture.EMPTY);
        node.addChild(sprite);
        const barrier = new Sprite(this.textures.construction_barrier);
        barrier.visible = false;
        node.addChild(barrier);
        const badge = new Text({
          text: "",
          style: {
            fontFamily: "sans-serif",
            fontSize: 14,
            fontWeight: "600",
            fill: "#fff4d7",
            stroke: { color: "#234b47", width: 4 },
          },
        });
        badge.anchor.set(0.5, 1);
        node.addChild(badge);
        const health = new Graphics();
        node.addChild(health);
        node.position.set(p.x, p.y);
        this.objects.addChild(node);
        visual = {
          id: entity.id,
          node,
          sprite,
          barrier,
          badge,
          health,
          target: p,
          artKey: texture ? key : null,
        };
        this.entities.set(entity.id, visual);
      }
      if (texture) {
        visual.sprite.texture = texture;
        visual.artKey = key;
      }
      const layout = fitSprite(visual.sprite, visual.artKey || key, footprint);
      visual.target = p;
      visual.tile = { x: entity.position[0], y: entity.position[1] };
      visual.node.zIndex =
        entity.position[0] +
        entity.position[1] +
        footprint[0] +
        footprint[1] -
        2 +
        0.1;
      visual.sprite.visible = entity.health !== 0 && Boolean(visual.artKey);
      visual.sprite.tint = entity.enemy ? 0xffb0a0 : 0xffffff;
      visual.sprite.alpha = entity.state === 0 ? 0.65 : 1;
      visual.barrier.visible = false;
      if (entity.kind === "building") {
        const barrier = constructionBarrierLayout(entity);
        visual.barrier.visible = barrier.visible;
        visual.barrier.anchor.set(barrier.anchorX, barrier.anchorY);
        visual.barrier.scale.set(barrier.scale);
        visual.barrier.position.set(barrier.x, barrier.y);
      }
      visual.badge.y = layout.top - 8;
      visual.badge.text =
        entity.kind === "building"
          ? entity.state !== 1
            ? `${Math.ceil(entity.remainingMs / 1000)}s`
            : entity.stored > 0
              ? `+${entity.stored}`
              : entity.queue.length
                ? `${Math.ceil(entity.queue[0].remainingMs / 1000)}s`
                : ""
          : entity.carrierSlots
            ? `${entity.aircraftCount}/${entity.carrierSlots}`
            : this.battle && entity.health > 0
              ? `${entity.health}`
              : "";
      visual.health.clear();
      if (this.battle && entity.health > 0) {
        visual.health
          .roundRect(-17, layout.top + 8, 34, 4, 2)
          .fill(0x344e44)
          .roundRect(
            -17,
            layout.top + 8,
            (34 * entity.health) / entity.maxHealth,
            4,
            2,
          )
          .fill(entity.enemy ? 0xc67a60 : 0xe5c783);
      }
    }
    if (!this.battle) {
      const occupied = new Set();
      for (const b of state.buildings)
        for (let y = 0; y < b.footprint[1]; y++)
          for (let x = 0; x < b.footprint[0]; x++)
            occupied.add(
              `decoration-${b.position[0] + x}-${b.position[1] + y}`,
            );
      for (const decoration of this.decorations)
        decoration.visible = !occupied.has(decoration.label);
    }
    this.drawOverlay();
  }
  drawOverlay() {
    if (!this.overlay || !this.state) return;
    this.overlay.clear();
    this.ghost.visible = false;
    if (this.battleOptions)
      for (const p of this.battleOptions.moves || []) {
        const c = toScreen(...p);
        diamond(this.overlay, c.x, c.y, 0xd7f4af, 0.4);
        this.overlay
          .poly([c.x, c.y - 18, c.x + 36, c.y, c.x, c.y + 18, c.x - 36, c.y])
          .stroke({ color: 0xe2f0bf, alpha: 0.4, width: 0.8 });
      }
    for (const id of this.battleOptions?.targets || []) {
      const target = this.battle?.fighters.find((f) => f.id === id);
      if (target) {
        const p = toScreen(...target.position);
        this.overlay
          .poly([p.x, p.y - 18, p.x + 36, p.y, p.x, p.y + 18, p.x - 36, p.y])
          .stroke({ color: 0xe7a18a, width: 3 });
      }
    }
    const selected =
      !this.battle && ["tree", "rock"].includes(this.selection?.kind)
        ? this.selection
        : (this.battle
            ? this.battle.fighters
            : [
                ...this.state.buildings,
                ...this.state.units.filter((u) => !u.carrier && !u.reserve),
              ]
          ).find((e) => e.id === this.selection);
    if (selected) {
      const [w, h] = this.battle ? [1, 1] : mapFootprint(selected);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = toScreen(
            selected.position[0] + x,
            selected.position[1] + y,
          );
          this.overlay
            .poly([p.x, p.y - 18, p.x + 36, p.y, p.x, p.y + 18, p.x - 36, p.y])
            .stroke({ color: 0xf6dc96, width: 2.5 });
        }
    }
    if (this.hover) {
      let footprint = [1, 1];
      let origin = this.hover;
      if (this.mode?.type === "build")
        footprint = this.config.buildings.find(
          (b) => b.id === this.mode.buildingType,
        ).footprint;
      if (["move", "move-unit"].includes(this.mode?.type))
        footprint = selected?.footprint || [1, 1];
      if (!this.battle && !this.mode) {
        const hoveredUnit = mapUnitAtTile(this.state.units, this.hover);
        const selectedUnit = this.state.units.find(
          (unit) =>
            unit.id === this.selection && !unit.carrier && !unit.reserve,
        );
        if (hoveredUnit) {
          footprint = mapFootprint(hoveredUnit);
          origin = { x: hoveredUnit.position[0], y: hoveredUnit.position[1] };
        } else if (selectedUnit) {
          footprint = mapFootprint(selectedUnit);
        }
      }
      if (this.mode) {
        const type =
          this.mode.type === "build"
            ? buildingSpriteKey(this.mode.buildingType)
            : selected && completedBuildingSpriteKey(selected);
        const texture = type && this.textureFor(type);
        if (texture) {
          this.ghost.texture = texture;
          const p = toScreen(
            this.hover.x + (footprint[0] - 1) / 2,
            this.hover.y + (footprint[1] - 1) / 2,
          );
          this.ghost.position.set(p.x, p.y);
          fitSprite(this.ghost, type, footprint);
          this.ghost.alpha = 0.58;
          this.ghost.tint = this.placement?.ok === false ? 0xeaa291 : 0xffffff;
          this.ghost.visible = true;
        }
      }
      for (let y = 0; y < footprint[1]; y++)
        for (let x = 0; x < footprint[0]; x++) {
          const p = toScreen(origin.x + x, origin.y + y);
          diamond(
            this.overlay,
            p.x,
            p.y,
            this.mode ? (this.placement?.ok ? 0xb6e594 : 0xdb8269) : 0xffecc0,
            this.mode?.type === "build" ? 0.5 : 0.2,
          );
        }
    }
  }
  emitSelectionAnchor() {
    let anchor = null;
    if (this.selection && !this.mode && !this.battle) {
      const decoration = ["tree", "rock"].includes(this.selection.kind);
      const entity = decoration
        ? this.selection
        : [
            ...this.state.buildings,
            ...this.state.units.filter(
              (unit) => !unit.carrier && !unit.reserve,
            ),
          ].find((item) => item.id === this.selection);
      if (entity) {
        const visual = decoration ? null : this.entities.get(entity.id);
        const point = visual
          ? { x: visual.node.x, y: visual.node.y }
          : toScreen(...footprintCenter(entity));
        const [w, h] = mapFootprint(entity);
        const x = this.root.x + point.x * this.zoom;
        const y = this.root.y + point.y * this.zoom;
        const kind = decoration
          ? entity.kind
          : this.state.buildings.some((building) => building.id === entity.id)
            ? "building"
            : "unit";
        anchor = {
          key: decoration
            ? `${kind}:${entity.position.join(":")}`
            : `${kind}:${entity.id}`,
          x: Math.round(x),
          top: Math.round(
            visual?.sprite?.visible
              ? visual.sprite.getBounds().minY
              : y - 60 * this.zoom,
          ),
          bottom: Math.round(y + (w + h) * 9 * this.zoom),
          width: this.host.clientWidth,
          height: this.host.clientHeight,
        };
      }
    }
    const key = JSON.stringify(anchor);
    if (key !== this.anchorKey) {
      this.anchorKey = key;
      this.callbacks.onSelectionAnchor?.(anchor);
    }
  }
  animate(delta) {
    if (!this.ready) return;
    for (const v of this.entities.values()) {
      v.node.x += (v.target.x - v.node.x) * Math.min(1, 0.18 * delta);
      v.node.y += (v.target.y - v.node.y) * Math.min(1, 0.18 * delta);
    }
    this.emitSelectionAnchor();
  }
  dispose() {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    for (const [name, listener, options] of this.listeners)
      this.app.canvas?.removeEventListener(name, listener, options);
    this.destroyApp();
  }
  destroyApp() {
    if (!this.initialized) return;
    this.initialized = false;
    this.ready = false;
    this.app.destroy(true, {
      children: true,
      texture: false,
      textureSource: false,
    });
  }
}
