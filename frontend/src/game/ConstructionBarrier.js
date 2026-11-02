import { TILE_WIDTH } from "./Coordinates.js";
import {
  buildingVisualScale,
  completedBuildingSpriteKey,
} from "./BuildingSpriteArt.js";
import { mapFootprint } from "./UnitFootprint.js";
import { getSpriteArt } from "./SpriteAssets.js";

export function constructionBarrierLayout(building) {
  const art = getSpriteArt("construction_barrier");
  const [width, height] = mapFootprint(building);
  const baseWidth =
    (((width + height) * TILE_WIDTH) / 2) *
    buildingVisualScale(completedBuildingSpriteKey(building));
  return {
    visible: building.state === 2 && building.remainingMs > 0,
    anchorX: art.ground[0] / art.size[0],
    anchorY: art.ground[1] / art.size[1],
    scale: (baseWidth * 1.15) / art.visibleWidth,
    x: 0,
    y: baseWidth / 4 + 4,
  };
}
