import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const root = new URL("../dist/", import.meta.url),
  origin = "http://localhost",
  base = origin + "/game/";
const stored = new Map(),
  listeners = {};
const key = (request) =>
  new URL(typeof request === "string" ? request : request.url, base).href;
const cache = {
  async addAll(paths) {
    for (const path of paths)
      stored.set(key(path), await readFile(new URL(path, root)));
  },
  async match(request) {
    return stored.get(key(request));
  },
};
vm.runInNewContext(await readFile(new URL("sw.js", root), "utf8"), {
  URL,
  self: {
    location: { origin },
    clients: { claim: async () => {} },
    addEventListener: (name, handler) => (listeners[name] = handler),
  },
  caches: {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  },
  fetch: async () => {
    throw new Error("Network is unavailable");
  },
});
let pending;
listeners.install({ waitUntil: (value) => (pending = value) });
await pending;
listeners.activate({ waitUntil: (value) => (pending = value) });
await pending;
for (const [url, mode, path] of [
  [base, "navigate", "index.html"],
  [base + "arbitrary-route", "navigate", "index.html"],
  [base + "wasm/empires_engine.wasm", "cors", "wasm/empires_engine.wasm"],
  [base + "config/game.json", "cors", "config/game.json"],
]) {
  listeners.fetch({
    request: { method: "GET", url, mode },
    respondWith: (value) => (pending = value),
  });
  assert.deepEqual(await pending, await readFile(new URL(path, root)));
}
assert(stored.size > 30);
console.log(
  `Offline worker checks passed: ${stored.size} assets cached, navigation/WASM/config available without network.`,
);
