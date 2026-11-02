export async function exportFile(bytes, seed) {
  const name = `empires-of-wars-${seed}.save.json`;
  if (window.__TAURI_INTERNALS__) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Game save", extensions: ["json"] }],
    });
    if (!path) return false;
    await writeTextFile(path, bytes);
  } else {
    const blob = new Blob([bytes], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return true;
}
export async function chooseDesktopSave() {
  const [{ open }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Game save", extensions: ["json"] }],
  });
  return path ? readTextFile(path) : null;
}
