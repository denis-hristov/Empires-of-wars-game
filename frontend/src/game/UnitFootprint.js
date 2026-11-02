export function mapFootprint(entity) {
  return entity.footprint || [1, 1];
}

export function footprintCenter(entity) {
  const [width, height] = mapFootprint(entity);
  return [
    entity.position[0] + (width - 1) / 2,
    entity.position[1] + (height - 1) / 2,
  ];
}

export function occupiesTile(entity, tile) {
  const [width, height] = mapFootprint(entity);
  return (
    tile.x >= entity.position[0] &&
    tile.x < entity.position[0] + width &&
    tile.y >= entity.position[1] &&
    tile.y < entity.position[1] + height
  );
}

export function mapUnitAtTile(units, tile) {
  return units.find(
    (unit) => !unit.carrier && !unit.reserve && occupiesTile(unit, tile),
  );
}
