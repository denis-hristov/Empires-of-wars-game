import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  rename,
  remove,
} from "@tauri-apps/plugin-fs";
const options = { baseDir: BaseDirectory.AppLocalData };
// Two slots and an atomically replaced pointer keep the last committed save intact.
async function activeSlot() {
  if (!(await exists("active.txt", options))) return "a";
  const slot = await readTextFile("active.txt", options);
  if (slot !== "a" && slot !== "b") return "a";
  return slot;
}
async function readSlot(slot) {
  return (await exists(`${slot}.json`, options))
    ? readTextFile(`${slot}.json`, options)
    : null;
}
export const desktopStorage = {
  async read(key = "current") {
    await mkdir("", { ...options, recursive: true });
    const slot = await activeSlot();
    return readSlot(key === "backup" ? (slot === "a" ? "b" : "a") : slot);
  },
  async write(bytes, isValid) {
    await mkdir("", { ...options, recursive: true });
    const active = await activeSlot(),
      old = await readSlot(active);
    // If the current slot is damaged, overwrite it and preserve the valid backup.
    const next = old && !isValid(old) ? active : active === "a" ? "b" : "a";
    await writeTextFile(`${next}.tmp`, bytes, options);
    if (await exists(`${next}.json`, options))
      await remove(`${next}.json`, options);
    await rename(`${next}.tmp`, `${next}.json`, {
      oldPathBaseDir: BaseDirectory.AppLocalData,
      newPathBaseDir: BaseDirectory.AppLocalData,
    });
    await writeTextFile("active.tmp", next, options);
    await rename("active.tmp", "active.txt", {
      oldPathBaseDir: BaseDirectory.AppLocalData,
      newPathBaseDir: BaseDirectory.AppLocalData,
    });
  },
};
