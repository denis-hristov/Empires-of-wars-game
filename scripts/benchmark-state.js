import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import factory from "../frontend/public/wasm/empires_engine.js";
import { GameEngine } from "../frontend/src/engine/GameEngine.js";

const config = JSON.parse(
  await readFile(new URL("../config/game.json", import.meta.url), "utf8"),
);
const wasmBinary = await readFile(
  new URL("../frontend/public/wasm/empires_engine.wasm", import.meta.url),
);
const fixture = await readFile(
  new URL("../tests/fixtures/empires-of-wars-145.save.json", import.meta.url),
  "utf8",
);
const iterations = Number(process.argv[2] || 100);
if (!Number.isInteger(iterations) || iterations < 1)
  throw new Error("Iterations must be a positive integer.");
const engine = await GameEngine.create({ factory, config, wasmBinary });
const scenarios = [];
try {
  for (const scenario of ["new game", "existing army"]) {
    if (scenario === "existing army") {
      const result = engine.load(fixture);
      if (!result.ok) throw new Error(result.message);
    }
    for (let i = 0; i < 5; i++) engine.getState();
    const samples = [];
    let state;
    for (let i = 0; i < iterations; i++) {
      const begin = performance.now();
      state = engine.getState();
      samples.push(performance.now() - begin);
    }
    const sorted = samples.toSorted((a, b) => a - b);
    scenarios.push({
      scenario,
      iterations,
      getStateMs: samples.reduce((sum, value) => sum + value, 0) / iterations,
      medianMs: sorted[Math.floor(iterations / 2)],
      p95Ms: sorted[Math.min(iterations - 1, Math.floor(iterations * 0.95))],
      stateBytes: Buffer.byteLength(JSON.stringify(state)),
      buildings: state.buildings.length,
      units: state.units.length,
      campaignBytes: Buffer.byteLength(JSON.stringify(state.campaign)),
    });
  }
} finally {
  engine.dispose();
}
console.log(JSON.stringify({ scenarios }, null, 2));
