import assert from "node:assert/strict";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function loadGame(engine, game) {
  const bytes = JSON.stringify(canonical(game));
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const result = engine.load(
    JSON.stringify({ checksum: hash.toString(16), game: JSON.parse(bytes) }),
  );
  assert(result.ok, result.message);
}

export function ensurePopulation(engine, required) {
  if (engine.getState().population.capacity >= required) return;
  const game = JSON.parse(engine.save()).game;
  const world = engine.getWorld();
  const hall = game.buildings.find((building) => building.type === "townhall");
  const cap = game.config.buildingLimits.house[hall.level - 1];
  const definition = game.config.buildings.find(
    (building) => building.id === "house",
  );
  const capacity = definition.levels[cap - 1].housing;
  const occupied = new Set();
  for (const entity of [
    ...engine.getState().buildings,
    ...engine.getState().units,
  ]) {
    if (entity.carrier || entity.reserve) continue;
    const [w, h] = entity.footprint;
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        occupied.add(`${entity.position[0] + dx}:${entity.position[1] + dy}`);
  }
  let total = engine.getState().population.capacity;
  for (const house of game.buildings.filter(
    (building) => building.type === "house" && building.state === 1,
  )) {
    if (total >= required) break;
    total += capacity - definition.levels[house.level - 1].housing;
    house.level = cap;
  }
  for (let y = 0; y + 1 < world.height && total < required; y++)
    for (let x = 0; x + 1 < world.width && total < required; x++) {
      const cells = [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ];
      if (
        !cells.every(
          ([cx, cy]) =>
            !occupied.has(`${cx}:${cy}`) &&
            [1, 2, 3].includes(world.tiles[cy * world.width + cx]),
        )
      )
        continue;
      for (const [cx, cy] of cells) {
        occupied.add(`${cx}:${cy}`);
        if (world.tiles[cy * world.width + cx] === 3)
          (game.clearedTrees ??= []).push([cx, cy]);
      }
      game.buildings.push({
        id: game.nextId++,
        type: "house",
        position: [x, y],
        level: cap,
        state: 1,
        remainingMs: 0,
        stored: 0,
        remainder: 0,
        queue: [],
      });
      total += capacity;
    }
  assert(total >= required, "Population fixture fits on the island");
  loadGame(engine, game);
}
