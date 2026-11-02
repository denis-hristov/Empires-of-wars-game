import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
await access(path.join(root, "frontend/public/wasm/empires_engine.wasm")).catch(
  () => {
    throw new Error("Build the C++ engine first: npm run build:wasm");
  },
);
await mkdir(path.join(root, "frontend/public/config"), { recursive: true });
await cp(
  path.join(root, "config/game.json"),
  path.join(root, "frontend/public/config/game.json"),
);
await cp(
  path.join(root, "assets/fonts"),
  path.join(root, "frontend/public/assets/fonts"),
  { recursive: true },
);
await cp(
  path.join(root, "assets/licenses"),
  path.join(root, "frontend/public/assets/licenses"),
  { recursive: true },
);

const arenaNames = [
  "ground_battle_arena.svg",
  "lake_battle_arena.svg",
  "fsky_battle_arena.svg",
];
const arenaDestination = path.join(root, "frontend/public/assets/arenas");
await mkdir(arenaDestination, { recursive: true });
for (const name of arenaNames) {
  const source = path.join(root, "../teren_for_battle", name);
  const destination = path.join(arenaDestination, name);
  let supplied = true;
  try {
    await access(source);
  } catch {
    supplied = false;
  }
  if (supplied) await cp(source, destination);
  else await access(destination);
}
