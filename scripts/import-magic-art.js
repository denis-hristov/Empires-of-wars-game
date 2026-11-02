import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.resolve(
  process.argv[2] || path.join(root, "../Game_Kingdom_Magic_Assets_SVG"),
);
const files = [
  ...Array.from({ length: 4 }, (_, index) => `magic_laboratory_0${index + 1}`),
  "spell_mass_heal",
  "spell_mass_shield",
  "spell_mass_attack_boost",
  "spell_mass_revive",
];
for (const file of files) {
  const svg = await readFile(path.join(source, `${file}.svg`), "utf8");
  const encoded = svg.match(/data:image\/png;base64,([^"\s]+)/)?.[1];
  if (!encoded) throw new Error(`Missing embedded bitmap: ${file}`);
  const png = Buffer.from(encoded, "base64");
  if (
    !png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.readUInt32BE(16) !== 1024 ||
    png.readUInt32BE(20) !== 1024
  )
    throw new Error(`Unexpected magic artwork dimensions: ${file}`);
  const destination = path.join(
    root,
    "frontend/public/assets",
    file.startsWith("magic_laboratory") ? "buildings" : "magic",
  );
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, `${file}.png`), png);
}
console.log(
  `Imported ${files.length} original magic illustrations without pixel changes.`,
);
