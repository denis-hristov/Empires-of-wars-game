import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildingArtwork } from "../frontend/src/game/BuildingSpriteArt.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(
  process.argv[2] || path.join(root, "new_buildings"),
);
const destination = path.join(root, "frontend/public/assets/buildings");
await mkdir(destination, { recursive: true });
const files = Object.entries(buildingArtwork)
  .filter(([key]) => !key.startsWith("laboratory:"))
  .map(([, art]) => art.file);
for (const file of files) {
  const svg = await readFile(
    path.join(source, file.replace(/\.png$/, ".svg")),
    "utf8",
  );
  const encoded = svg.match(/data:image\/png;base64,([^"\s]+)/)?.[1];
  if (!encoded) throw new Error(`Missing embedded PNG: ${file}`);
  const png = Buffer.from(encoded, "base64");
  if (
    !png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(16) !== 1254 ||
    png.readUInt32BE(20) !== 1254
  )
    throw new Error(`Unexpected building artwork dimensions: ${file}`);
  await writeFile(path.join(destination, file), png);
}
console.log(`Imported ${files.length} original PNGs without pixel changes.`);
