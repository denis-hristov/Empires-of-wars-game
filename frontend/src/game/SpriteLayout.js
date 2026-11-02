import { TILE_WIDTH, TILE_HEIGHT } from "./Coordinates.js";
import { getSpriteArt } from "./SpriteAssets.js";
import { buildingVisualScale } from "./BuildingSpriteArt.js";

export function spriteLayout(type, footprint = [1, 1], textureSize, level = 1) {
  const art = getSpriteArt(type, level);
  const [referenceWidth, referenceHeight] = art.size;
  const width = textureSize?.width || referenceWidth;
  const height = textureSize?.height || referenceHeight;
  let scaleX, scaleY;
  if (art.base) {
    const span = footprint[0] + footprint[1];
    const visualScale = buildingVisualScale(type, level);
    scaleX =
      ((span * TILE_WIDTH) / 2 / ((art.base[0] * width) / referenceWidth)) *
      visualScale;
    scaleY =
      ((span * TILE_HEIGHT) / 2 / ((art.base[1] * height) / referenceHeight)) *
      visualScale;
  } else {
    const footprintScale = art.scaleWithFootprint
      ? (footprint[0] + footprint[1]) / 2
      : 1;
    const scale =
      (art.targetHeight
        ? art.targetHeight / art.visibleHeight
        : art.targetWidth / art.visibleWidth) * footprintScale;
    scaleX = (scale * referenceWidth) / width;
    scaleY = (scale * referenceHeight) / height;
  }
  return {
    anchorX: art.ground[0] / referenceWidth,
    anchorY: art.ground[1] / referenceHeight,
    scaleX,
    scaleY,
    top: ((art.top - art.ground[1]) / referenceHeight) * height * scaleY,
  };
}
export function fitSprite(sprite, type, footprint, level = 1) {
  const layout = spriteLayout(type, footprint, sprite.texture, level);
  sprite.anchor.set(layout.anchorX, layout.anchorY);
  sprite.scale.set(layout.scaleX, layout.scaleY);
  return layout;
}

export function arenaSpriteLayout(type) {
  const art = getSpriteArt(type);
  const [width, height] = art.size;
  const [left, top, right, bottom] = art.bounds || [0, art.top, width, height];
  const scale = Math.min(1 / (bottom - top), 1.3 / (right - left));
  return {
    height: height * scale * 100,
    bottom: -(height - art.ground[1]) * scale * 100,
    baseDepth: (bottom - art.ground[1]) * scale * 100,
    anchorX: (art.ground[0] / width) * 100,
    anchorY: (art.ground[1] / height) * 100,
  };
}
