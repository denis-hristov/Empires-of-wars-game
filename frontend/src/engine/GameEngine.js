export const API_VERSION = 1;
export function assetUrl(path) {
  return new URL(
    `${import.meta.env?.BASE_URL || "./"}${path}`,
    globalThis.location?.href || "http://localhost/",
  ).href;
}
export class GameEngine {
  static async create(options = {}) {
    const config =
      options.config ||
      (await fetch(assetUrl("config/game.json")).then((response) => {
        if (!response.ok)
          throw new Error("The game configuration could not be loaded.");
        return response.json();
      }));
    const factory =
      options.factory ||
      (await import(/* @vite-ignore */ assetUrl("wasm/empires_engine.js")))
        .default;
    const module = await factory({
      locateFile: (name) => assetUrl(`wasm/${name}`),
      ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    });
    const engine = new GameEngine(module, config);
    try {
      const version = JSON.parse(engine.instance.version());
      if (version.api !== API_VERSION || version.schema !== 1)
        throw new Error(
          "This game engine version is not compatible with the interface.",
        );
      const result = JSON.parse(engine.instance.init(JSON.stringify(config)));
      if (!result.ok) throw new Error(result.message);
      return engine;
    } catch (error) {
      engine.dispose();
      throw error;
    }
  }
  constructor(module, config) {
    this.module = module;
    this.config = config;
    this.instance = new module.Engine();
  }
  ensureAlive() {
    if (!this.instance) throw new Error("The game engine has been disposed.");
  }
  dispatch(action) {
    this.ensureAlive();
    return JSON.parse(this.instance.dispatch(JSON.stringify(action)));
  }
  getState() {
    this.ensureAlive();
    return JSON.parse(this.instance.getState());
  }
  getWorld() {
    this.ensureAlive();
    return JSON.parse(this.instance.getWorld());
  }
  tick(deltaMs) {
    this.ensureAlive();
    if (!Number.isInteger(deltaMs) || deltaMs < 0 || deltaMs > 250)
      return {
        ok: false,
        code: "INVALID_ARGUMENT",
        message: "Tick must be an integer between 0 and 250 ms",
      };
    return JSON.parse(this.instance.tick(deltaMs));
  }
  save() {
    this.ensureAlive();
    return this.instance.save();
  }
  load(bytes) {
    this.ensureAlive();
    return JSON.parse(this.instance.load(bytes));
  }
  validateSave(bytes) {
    this.ensureAlive();
    const probe = new this.module.Engine();
    try {
      probe.init(JSON.stringify(this.config));
      return JSON.parse(probe.load(bytes)).ok;
    } catch {
      return false;
    } finally {
      probe.delete();
    }
  }
  dispose() {
    this.instance?.delete();
    this.instance = null;
    this.module = null;
  }
}
