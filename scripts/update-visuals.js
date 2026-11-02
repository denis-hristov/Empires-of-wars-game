import { access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  spriteArt,
  getSpriteArt,
  spriteFile,
} from "../frontend/src/game/SpriteAssets.js";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const type of Object.keys(spriteArt)) {
  const file = spriteFile(type);
  await access(
    path.join(
      root,
      "frontend/public",
      getSpriteArt(type).path || `assets/sprites/${file}`,
    ),
  ).catch(() => {
    throw new Error(`Missing sprite for ${type}: ${file}`);
  });
}
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "desktop:build"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (process.platform === "darwin") {
  const name = "Empires of wars.app";
  const source = path.join(root, "src-tauri/target/release/bundle/macos", name);
  const destination = path.join(root, "..", name);
  execFileSync("/usr/bin/ditto", [source, destination], { stdio: "inherit" });
  execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", destination],
    { stdio: "inherit" },
  );
  console.log(
    `Updated ${destination}. Close and reopen the game to load the new artwork.`,
  );
}
