export const TILE_WIDTH = 72,
  TILE_HEIGHT = 36;
export function toScreen(x, y) {
  return { x: ((x - y) * TILE_WIDTH) / 2, y: ((x + y) * TILE_HEIGHT) / 2 };
}
export function pickTile(point, width, height) {
  const gx = point.x / TILE_WIDTH + point.y / TILE_HEIGHT;
  const gy = point.y / TILE_HEIGHT - point.x / TILE_WIDTH;
  for (let y = Math.floor(gy) - 1; y <= Math.floor(gy) + 1; y++)
    for (let x = Math.floor(gx) - 1; x <= Math.floor(gx) + 1; x++) {
      const center = toScreen(x, y);
      if (
        x >= 0 &&
        y >= 0 &&
        x < width &&
        y < height &&
        Math.abs(point.x - center.x) / (TILE_WIDTH / 2) +
          Math.abs(point.y - center.y) / (TILE_HEIGHT / 2) <=
          1
      )
        return { x, y };
    }
  return null;
}
