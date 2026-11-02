import catalog from "../../../config/game.json" with { type: "json" };
import { assetUrl } from "../engine/GameEngine.js";
import { unitArtwork } from "./UnitSpriteArt.js";
import { buildingArtwork, buildingSpriteKey } from "./BuildingSpriteArt.js";

// Art coordinates refer to the supplied SVG canvas and its ground plane.
export const spriteArt = {
  construction_barrier: {
    file: "construction_barrier.png",
    size: [1536, 1024],
    ground: [768, 900],
    visibleWidth: 1508,
    targetWidth: 90,
    top: 208,
  },
  tree: {
    size: [1233, 1275],
    ground: [614, 1035],
    visibleWidth: 1072,
    targetWidth: 57.6,
    top: 79,
  },
  rock: {
    size: [1360, 1157],
    ground: [680, 1050],
    visibleWidth: 1345,
    targetWidth: 57.6,
    top: 7,
  },
  infantry: {
    size: [1051, 1496],
    ground: [537, 1395],
    visibleHeight: 1365,
    targetHeight: 60,
    top: 67,
  },
  raider: {
    size: [1051, 1496],
    ground: [529, 1460],
    visibleHeight: 1467,
    targetHeight: 60,
    top: 29,
  },
  ship: {
    size: [1323, 1189],
    ground: [660, 1030],
    visibleWidth: 1293,
    targetWidth: 61.2,
    top: 18,
  },
  aircraft: {
    size: [1536, 1024],
    ground: [768, 890],
    visibleWidth: 1536,
    targetWidth: 64.8,
    top: 0,
  },
};
for (const building of catalog.buildings) {
  spriteArt[building.id] = buildingArtwork[buildingSpriteKey(building.id)];
}
const unitDefaults = {
  land: spriteArt.infantry,
  naval: spriteArt.ship,
  air: spriteArt.aircraft,
};
for (const unit of catalog.units) {
  const art = unitArtwork[unit.id];
  spriteArt[unit.id] = art
    ? {
        ...art,
        visibleWidth: art.bounds[2] - art.bounds[0],
        targetWidth:
          unit.domain === "naval"
            ? 61.2
            : unit.domain === "air"
              ? 32.4
              : unit.building === "barracks" && unit.level <= 2
                ? 40.5
                : 64.8,
        scaleWithFootprint: unit.domain === "naval" || unit.domain === "air",
        top: art.bounds[1],
        path: `assets/sprites/${art.file}`,
      }
    : {
        ...unitDefaults[unit.domain],
        file: unit.assetPath.split("/").at(-1),
        path: unit.assetPath,
      };
}
// Campaign art loads when its round is shown, without slowing the island preload.
export const enemySpriteArt = Object.fromEntries(
  (catalog.campaign?.enemies || []).map((enemy) => {
    const art = enemy.art;
    return [
      enemy.id,
      {
        ...art,
        // Campaign artwork faces left before the arena applies its team direction.
        facing: -1,
        file: enemy.assetPath.split("/").at(-1),
        path: enemy.assetPath,
        visibleWidth: art.bounds[2] - art.bounds[0],
        targetWidth: enemy.kind === "ordinary" ? 64.8 : 81,
        top: art.bounds[1],
      },
    ];
  }),
);
export function getSpriteArt(type, level = 1) {
  const art =
    buildingArtwork[buildingSpriteKey(type, level)] ||
    spriteArt[type] ||
    enemySpriteArt[type];
  if (!art) throw new Error(`Unknown sprite: ${type}`);
  return art;
}
export function spriteFile(type, level = 1) {
  return getSpriteArt(type, level).file || `${type}.svg`;
}
export function spriteUrl(type, level = 1) {
  const art = getSpriteArt(type, level);
  return assetUrl(art.path || `assets/sprites/${spriteFile(type, level)}`);
}
