import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../frontend/dist/", import.meta.url);
async function files(dir, prefix = "") {
  const list = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "sw.js") continue;
    const path = prefix + entry.name;
    if (entry.isDirectory())
      list.push(...(await files(new URL(entry.name + "/", dir), path + "/")));
    else list.push(path);
  }
  return list;
}
const paths = (await files(root)).sort(),
  hash = createHash("sha256");
for (const path of paths) hash.update(await readFile(new URL(path, root)));
const version = hash.digest("hex").slice(0, 16);
await writeFile(
  new URL("sw.js", root),
  `const CACHE='empires-of-wars-${version}';
const FILES=${JSON.stringify(paths.map((p) => "./" + p))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('empires-of-wars-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{if(event.request.mode==='navigate'){const shell=await cache.match('./index.html');if(shell)return shell;}const found=await cache.match(event.request);if(found)return found;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return cache.match('./index.html');throw error;}}));});
`,
);
console.log("Offline cache prepared:", paths.length, "local assets.");
