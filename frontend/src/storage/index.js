export async function createStorage() {
  if (window.__TAURI_INTERNALS__)
    return (await import("./desktopStorage.js")).desktopStorage;
  return (await import("./browserStorage.js")).browserStorage;
}
export async function restore(engine, storage) {
  let failure = null,
    found = false;
  for (const key of ["current", "backup"]) {
    try {
      const bytes = await storage.read(key);
      if (!bytes) continue;
      found = true;
      const result = engine.load(bytes);
      if (result.ok)
        return key === "backup"
          ? { ok: true, message: "Your backup save was restored." }
          : result;
      failure = result.message;
    } catch (error) {
      failure = error.message;
    }
  }
  if (!found && !failure) return { ok: true, empty: true };
  throw new Error(
    `${failure || "No valid save was found."} Your existing files have been kept.`,
  );
}
