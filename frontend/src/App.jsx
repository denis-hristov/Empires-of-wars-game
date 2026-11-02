import { Dialog } from "./components/Dialog.jsx";
import { ShopPanel } from "./components/ShopPanel.jsx";
import {
  ObjectActionDialog,
  ObjectQuickActions,
} from "./components/ObjectActions.jsx";
import { mapObject } from "./game/MapObjectActions.js";
import { BattleArena } from "./components/BattleArena.jsx";
import { battleDomains } from "./game/BattlePresentation.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine } from "./engine/GameEngine.js";
import { createStorage, restore } from "./storage/index.js";
import { exportFile, chooseDesktopSave } from "./storage/transfer.js";
import { GameCanvas } from "./game/GameCanvas.jsx";
import { mapUnitAtTile } from "./game/UnitFootprint.js";
import { placementPreview } from "./game/MapPlacement.js";
import { Icon } from "./components/Icons.jsx";
import {
  ActivityPanel,
  BuildMenu,
  Inspector,
  SpriteImage,
  ResourcePanel,
  ResearchPanel,
  AttackMenu,
} from "./components/GamePanels.jsx";
export default function App() {
  useEffect(() => {
    if (
      window.__TAURI_INTERNALS__ ||
      import.meta.env.DEV ||
      !("serviceWorker" in navigator)
    )
      return;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((error) => {
        console.warn("Offline cache setup failed", error);
      });
  }, []);

  const [engine, setEngine] = useState(null),
    [state, setState] = useState(null),
    [world, setWorld] = useState(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(null),
    [resourceSession, setResourceSession] = useState(0);
  const [selected, setSelected] = useState(null),
    [mode, setMode] = useState(null),
    [hover, setHover] = useState(null),
    [placement, setPlacement] = useState(null),
    [battleOptions, setBattleOptions] = useState(null);
  const [panel, setPanel] = useState(null),
    [squad, setSquad] = useState([]),
    [filter, setFilter] = useState("All"),
    [paused, setPaused] = useState(false),
    [speed, setSpeed] = useState(1),
    [menu, setMenu] = useState(null),
    [seed, setSeed] = useState("7319"),
    [saving, setSaving] = useState(false),
    [savedAt, setSavedAt] = useState(null),
    [sceneReady, setSceneReady] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(false),
    [actionsOpen, setActionsOpen] = useState(false),
    [objectDialog, setObjectDialog] = useState(null),
    [selectionAnchor, setSelectionAnchor] = useState(null);
  const storage = useRef(null),
    scene = useRef(null),
    file = useRef(null),
    runtime = useRef({}),
    saveChain = useRef(Promise.resolve()),
    autosaveBlocked = useRef(false),
    alive = useRef(true);
  runtime.current = {
    engine,
    state,
    paused,
    menu,
    objectDialog,
    speed,
    mode,
    selected,
  };
  const notify = useCallback((message, ok = true) => {
    setToast(ok ? null : { message, ok: false, key: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    alive.current = true;
    let current;
    (async () => {
      try {
        current = await GameEngine.create();
        storage.current = await createStorage();
        try {
          const result = await restore(current, storage.current);
          if (!result.empty)
            notify(result.message || "Welcome back. Your empire is ready.");
        } catch (e) {
          autosaveBlocked.current = true;
          setPaused(true);
          notify(e.message, false);
        }
        if (!alive.current) {
          current.dispose();
          return;
        }
        setEngine(current);
        const s = current.getState();
        setState(s);
        setWorld(current.getWorld());
        setSelected(
          s.battle
            ? s.battle.fighters.find((f) => !f.enemy && f.health > 0)?.id
            : s.buildings[0]?.id,
        );
      } catch (e) {
        if (alive.current) setError(e.message);
      }
    })();
    return () => {
      alive.current = false;
      current?.dispose();
    };
  }, [notify]);
  const refresh = useCallback(
    (includeWorld = false) => {
      if (!engine) return;
      setState(engine.getState());
      if (includeWorld) setWorld(engine.getWorld());
    },
    [engine],
  );
  const getShopOptions = useCallback(
    () => engine?.dispatch({ type: "SHOP_OPTIONS" }),
    [engine],
  );
  const saveNow = useCallback(
    async (quiet = false) => {
      if (!engine || !storage.current) return false;
      const bytes = engine.save();
      if (!quiet) setSaving(true);
      const task = saveChain.current
        .catch(() => {})
        .then(() =>
          storage.current.write(bytes, (old) => engine.validateSave(old)),
        );
      saveChain.current = task;
      try {
        await task;
        if (alive.current) {
          setSavedAt(new Date());
          if (!quiet) {
            autosaveBlocked.current = false;
            notify("Your empire has been saved.");
          }
        }
        return true;
      } catch (e) {
        if (alive.current) notify(`Save failed: ${e.message}`, false);
        return false;
      } finally {
        if (alive.current) setSaving(false);
      }
    },
    [engine, notify],
  );
  const loadNow = useCallback(async () => {
    try {
      await saveChain.current.catch(() => {});
      const result = await restore(engine, storage.current);
      if (result.empty) {
        notify("No saved empire yet.", false);
        return;
      }
      refresh(true);
      setResourceSession((session) => session + 1);
      setActionsOpen(false);
      setObjectDialog(null);
      setSelected(null);
      setMode(null);
      setPanel(null);
      setSquad([]);
      setInspectorOpen(false);
      autosaveBlocked.current = false;
      notify(result.message || "Your empire has been restored.");
      setMenu(null);
    } catch (e) {
      notify(e.message, false);
    }
  }, [engine, refresh, notify]);
  const dispatch = useCallback(
    (type, payload = {}) => {
      const result = engine.dispatch({ type, payload });
      if (!result.ok) {
        notify(result.message, false);
        return result;
      }
      const s = engine.getState();
      setState(s);
      if (result.message) notify(result.message);
      if (type === "BUILD") {
        setMode(null);
        setSelected(s.buildings.at(-1).id);
        setInspectorOpen(false);
        setActionsOpen(true);
      }
      if (type === "MOVE_BUILDING" || type === "MOVE_UNIT") {
        setMode(null);
        setActionsOpen(true);
      }
      if (type === "DISMISS_UNIT") {
        setObjectDialog(null);
        setActionsOpen(false);
        setInspectorOpen(false);
        setSelected(null);
        setSelectionAnchor(null);
        setMode(null);
        setSquad((current) => current.filter((id) => id !== payload.id));
      }
      if (["CLEAR_TREE", "BATTLE_START", "NEW_GAME"].includes(type)) {
        setObjectDialog(null);
        setActionsOpen(false);
      }
      if (type === "CLEAR_TREE") {
        setWorld(engine.getWorld());
        setSelected(null);
        setInspectorOpen(false);
      }
      if (type === "BATTLE_START") {
        setPanel(null);
        setInspectorOpen(false);
        setMode(null);
        setSelected(s.battle.fighters.find((f) => !f.enemy)?.id);
      }
      if (type === "BATTLE_FINISH") {
        setSelected(null);
        setPanel(null);
        setSquad([]);
      }
      if (type === "NEW_GAME") {
        setResourceSession((session) => session + 1);
        setPanel(null);
        setSquad([]);
        setInspectorOpen(false);
        setWorld(engine.getWorld());
        setSelected(s.buildings[0].id);
        setMode(null);
      }
      if (type === "SHOP_TRADE" && !autosaveBlocked.current) saveNow(true);
      return result;
    },
    [engine, notify, saveNow],
  );
  useEffect(() => {
    if (!engine) return;
    let last = performance.now(),
      snapshotElapsed = 0;
    const timer = setInterval(() => {
      const now = performance.now(),
        r = runtime.current;
      const elapsed = now - last;
      last = now;
      if ((r.paused && !r.state?.battle) || r.menu || document.hidden) return;
      const accepted = Math.min(250, Math.max(0, Math.floor(elapsed)));
      let result;
      for (let i = 0; i < (r.state?.battle ? 1 : r.speed); i++)
        result = engine.tick(accepted);
      snapshotElapsed += accepted;
      if (snapshotElapsed >= 200) {
        snapshotElapsed = 0;
        if (result?.stateRevision !== r.state?.revision)
          setState(engine.getState());
      }
    }, 100);
    return () => clearInterval(timer);
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const timer = setInterval(() => {
      if (!autosaveBlocked.current && !runtime.current.menu) saveNow(true);
    }, 30000);
    const hide = () => {
      if (document.hidden && !autosaveBlocked.current) saveNow(true);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [engine, saveNow]);
  useEffect(() => {
    setPlacement(placementPreview(engine, state, mode, hover));
  }, [engine, mode, hover, state?.revision]);
  useEffect(() => {
    if (
      !engine ||
      !state?.battle ||
      state.battle.automatic ||
      state.battle.enemyTurn ||
      state.battle.paused ||
      !selected
    ) {
      setBattleOptions(null);
      return;
    }
    setBattleOptions(
      engine.dispatch({ type: "BATTLE_OPTIONS", payload: { id: selected } }),
    );
  }, [engine, selected, state?.revision]);
  useEffect(() => {
    const key = (e) => {
      if (runtime.current.menu || runtime.current.objectDialog) return;
      if (e.key === "Escape") {
        setActionsOpen(false);
        setMode(null);
        setInspectorOpen(false);
        setPanel(null);
        return;
      }
      if (e.target.closest("input,textarea")) return;
      if (e.key === "F5") {
        e.preventDefault();
        saveNow();
      }
      if (e.key === "F9") {
        e.preventDefault();
        loadNow();
      }
      if (e.code === "Space" && !e.target.closest("button")) {
        e.preventDefault();
        if (runtime.current.state?.battle) dispatch("BATTLE_PAUSE");
        else setPaused((p) => !p);
      }
      if (
        e.key.toLowerCase() === "c" &&
        typeof runtime.current.selected === "string" &&
        !runtime.current.state?.battle
      )
        dispatch("COLLECT", { id: runtime.current.selected });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [saveNow, loadNow, dispatch]);
  useEffect(() => {
    const b = state?.battle;
    if (
      b &&
      !b.fighters.some(
        (f) =>
          f.id === selected &&
          !f.enemy &&
          !f.carrier &&
          f.health > 0 &&
          !f.attacked,
      )
    )
      setSelected(
        b.fighters.find(
          (f) => !f.enemy && !f.carrier && f.health > 0 && !f.attacked,
        )?.id ?? null,
      );
  }, [state?.battle, selected]);
  function select(id) {
    setSelected(id);
    setMode(null);
    setInspectorOpen(false);
    setObjectDialog(null);
    setActionsOpen(true);
    setPanel(null);
    const unit = state.units.find((item) => item.id === id);
    if (unit?.carrier || unit?.reserve) {
      setActionsOpen(false);
      setObjectDialog({ action: "info", selection: id });
    }
  }
  function togglePanel(next) {
    setPanel((current) => (current === next ? null : next));
    setActionsOpen(false);
    setObjectDialog(null);
    setInspectorOpen(false);
    setMode(null);
  }
  function openObjectAction(action) {
    const object = mapObject(state, selected, config);
    if (!object) return;
    if (action === "collect") {
      dispatch("COLLECT", { id: object.entity.id });
    } else if (action === "move") {
      setMode({
        type: object.kind === "unit" ? "move-unit" : "move",
        id: object.entity.id,
      });
      setActionsOpen(false);
      setObjectDialog(null);
      setInspectorOpen(false);
    } else {
      setObjectDialog({ action, selection: selected });
      setInspectorOpen(false);
      setPanel(null);
    }
  }
  function onPick(tile, hit) {
    if (state.battle) return;
    if (mode?.type === "build") {
      dispatch("BUILD", { buildingType: mode.buildingType, ...tile });
      return;
    }
    if (mode?.type === "move-unit") {
      dispatch("MOVE_UNIT", { id: mode.id, ...tile });
      return;
    }
    if (mode?.type === "move") {
      dispatch("MOVE_BUILDING", { id: mode.id, ...tile });
      return;
    }
    const b =
      state.buildings.find((b) => b.id === hit) ||
      state.buildings.find(
        (b) =>
          tile.x >= b.position[0] &&
          tile.x < b.position[0] + b.footprint[0] &&
          tile.y >= b.position[1] &&
          tile.y < b.position[1] + b.footprint[1],
      );
    const u =
      state.units.find((u) => u.id === hit) || mapUnitAtTile(state.units, tile);
    if (hit && u) {
      select(u.id);
      return;
    }
    if (b) {
      select(b.id);
      if (b.production.resource >= 0 && b.stored > 0)
        dispatch("COLLECT", { id: b.id });
      return;
    }
    if (u) {
      select(u.id);
      return;
    }
    const terrain = world.tiles[tile.y * world.width + tile.x];
    if (terrain === 3 || terrain === 4) {
      select({
        kind: terrain === 3 ? "tree" : "rock",
        position: [tile.x, tile.y],
      });
      return;
    }
    setActionsOpen(false);
    setSelected(null);
    setInspectorOpen(false);
    setPanel(null);
  }
  async function exportSave() {
    try {
      if (await exportFile(engine.save(), state.seed))
        notify(
          "Save exported. Keep this file to move your empire between devices.",
        );
    } catch (e) {
      notify(`Export failed: ${e.message}`, false);
    }
  }
  async function importBytes(bytes) {
    if (bytes.length > 16 * 1024 * 1024) {
      notify("The save file is too large.", false);
      return;
    }
    const result = engine.load(bytes);
    if (!result.ok) {
      notify(result.message, false);
      return;
    }
    autosaveBlocked.current = false;
    refresh(true);
    setResourceSession((session) => session + 1);
    setActionsOpen(false);
    setObjectDialog(null);
    setSelected(null);
    setMode(null);
    setMenu(null);
    setPanel(null);
    setSquad([]);
    setInspectorOpen(false);
    notify("Save imported successfully.");
    await saveNow(true);
  }
  async function importSave(event) {
    const f = event.target.files[0];
    event.target.value = "";
    if (!f) return;
    if (f.size > 16 * 1024 * 1024) {
      notify("The save file is too large.", false);
      return;
    }
    try {
      await importBytes(await f.text());
    } catch (e) {
      notify(`Import failed: ${e.message}`, false);
    }
  }
  async function chooseImport() {
    if (!window.__TAURI_INTERNALS__) {
      file.current.click();
      return;
    }
    try {
      const bytes = await chooseDesktopSave();
      if (bytes !== null) await importBytes(bytes);
    } catch (e) {
      notify(`Import failed: ${e.message}`, false);
    }
  }
  async function newGame() {
    const value = Number(seed);
    if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
      notify("Enter a seed between 0 and 4294967295.", false);
      return;
    }
    if (!(await saveNow(true))) return;
    const result = dispatch("NEW_GAME", { seed: value });
    if (result.ok) {
      setMenu(null);
      setPaused(false);
      autosaveBlocked.current = false;
      await saveNow(true);
    }
  }
  const config = useMemo(
    () =>
      engine
        ? {
            ...engine.config,
            units: state?.unitCatalog || engine.config.units,
          }
        : null,
    [engine, state?.unitCatalog],
  );
  if (error)
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <Icon name="army" size={42} />
          <h1>We could not open your empire.</h1>
          <p>{error}</p>
          <button className="button primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  if (!state || !engine)
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <div className="loading-crest">
            <Icon name="army" size={42} />
          </div>
          <span className="eyebrow">EMPIRES OF WARS</span>
          <h1>A world is taking shape.</h1>
          <p>Preparing your island and its stories.</p>
          <div className="loading-line" />
        </div>
      </div>
    );
  const activeObject = mapObject(state, selected, config);
  const dialogObject = objectDialog
    ? mapObject(state, objectDialog.selection, config)
    : null;
  return (
    <div
      className={`app ${state.battle ? "in-battle" : ""} ${inspectorOpen ? "inspector-open" : ""}`}
    >
      <main className="world-workspace" inert={!!menu || !!objectDialog}>
        <section className="world-map" aria-label="Game world">
          {state.battle ? (
            <BattleArena
              state={state}
              config={config}
              selected={selected}
              onSelect={setSelected}
              dispatch={dispatch}
              onSettings={() => setMenu("settings")}
            />
          ) : (
            <>
              <GameCanvas
                world={world}
                config={config}
                state={state}
                selection={selected}
                mode={mode}
                placement={placement}
                battleOptions={battleOptions}
                onPick={onPick}
                onHover={setHover}
                onSelectionAnchor={setSelectionAnchor}
                onReady={(value) => {
                  scene.current = value;
                  setSceneReady(true);
                }}
                onError={(e) => setError(`Map rendering failed: ${e.message}`)}
              />
              <div className="hud-top-left">
                <div className="empire-heading">
                  <img src="./assets/crest.svg" alt="" />
                  <div>
                    <span className="eyebrow">EMPIRES OF WARS</span>
                    <h1>
                      {state.battle
                        ? `${battleDomains[state.battle.domain]} battlefield`
                        : `Island ${state.seed}`}
                    </h1>
                  </div>
                </div>
                <nav className="hud-toolbar" aria-label="Empire controls">
                  <button
                    aria-label="Island overview"
                    aria-expanded={inspectorOpen}
                    onClick={() => {
                      setPanel(null);
                      setActionsOpen(false);
                      setSelected(null);
                      setMode(null);
                      setInspectorOpen((v) => !v);
                    }}
                    disabled={!!state.battle}
                  >
                    <Icon name="globe" />
                    <span>Overview</span>
                  </button>
                  <button
                    aria-expanded={panel === "army"}
                    aria-controls="army-panel"
                    onClick={() => togglePanel("army")}
                    disabled={!!state.battle}
                  >
                    <Icon name="army" />
                    <span>Army</span>
                  </button>
                  <button
                    aria-expanded={panel === "research"}
                    aria-controls="research-panel"
                    onClick={() => togglePanel("research")}
                    disabled={!!state.battle}
                  >
                    <Icon name="research" />
                    <span>Research</span>
                  </button>
                  <button
                    aria-expanded={panel === "activity"}
                    aria-controls="activity-panel"
                    onClick={() => togglePanel("activity")}
                    disabled={!!state.battle}
                  >
                    <Icon name="build" />
                    <span>Activity</span>
                  </button>
                </nav>
                <div className="hud-map-tools" aria-label="Map controls">
                  <button
                    aria-label="Zoom in"
                    onClick={() =>
                      scene.current?.setZoom(scene.current.zoom * 1.2)
                    }
                  >
                    +
                  </button>
                  <button
                    aria-label="Zoom out"
                    onClick={() =>
                      scene.current?.setZoom(scene.current.zoom / 1.2)
                    }
                  >
                    −
                  </button>
                  <button
                    aria-label="Center map"
                    onClick={() => scene.current?.center()}
                  >
                    <Icon name="target" size={17} />
                  </button>
                  <button
                    aria-label={`Simulation speed ${speed}x`}
                    disabled={!!state.battle}
                    onClick={() => setSpeed((v) => (v === 1 ? 3 : 1))}
                  >
                    {speed}×
                  </button>
                </div>
                {(state.battle || paused) && (
                  <div className="hud-status">
                    <span className="status-dot" />
                    {state.battle
                      ? `${battleDomains[state.battle.domain]} · Turn ${state.battle.round}`
                      : "Simulation paused"}
                  </div>
                )}
              </div>
              {actionsOpen &&
                !mode &&
                !panel &&
                !inspectorOpen &&
                !objectDialog &&
                !menu && (
                  <ObjectQuickActions
                    object={activeObject}
                    state={state}
                    anchor={selectionAnchor}
                    onAction={openObjectAction}
                    onClose={() => setActionsOpen(false)}
                  />
                )}
              {mode && (
                <div
                  className={`placement-banner ${placement?.ok === false ? "invalid" : ""}`}
                >
                  <Icon name="build" size={18} />
                  <span>
                    {placement?.ok === false
                      ? placement.message
                      : mode.type === "move-unit"
                        ? "Move your unit to a green tile"
                        : `${mode.type === "build" ? "Place" : "Move"} your building on a green tile`}
                  </span>
                  <button
                    onClick={() => setMode(null)}
                    aria-label="Cancel placement"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}
              {!sceneReady && (
                <div className="map-loading">Preparing the landscape…</div>
              )}
            </>
          )}
          <ResourcePanel
            key={resourceSession}
            state={state}
            hidden={!!state.battle}
          />
        </section>
        <div className="hud-bottom-right">
          <button
            className="hud-action settings-action"
            aria-label="Settings"
            aria-haspopup="dialog"
            onClick={() => {
              setMenu("settings");
              setActionsOpen(false);
              setPanel(null);
              setInspectorOpen(false);
            }}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <button
            className="hud-action shop-action"
            aria-label="Shop"
            aria-haspopup="dialog"
            aria-expanded={menu === "shop"}
            disabled={!!state.battle}
            onClick={() => {
              setMenu("shop");
              setActionsOpen(false);
              setObjectDialog(null);
              setPanel(null);
              setInspectorOpen(false);
              setMode(null);
            }}
          >
            <Icon name="shop" size={23} />
            <span>Shop</span>
          </button>
          <button
            className="hud-action build-action"
            aria-expanded={panel === "build"}
            aria-controls="build-panel"
            disabled={!!state.battle}
            onClick={() => togglePanel("build")}
          >
            <Icon name="build" size={24} />
            <span>Build</span>
          </button>
        </div>
        <button
          className="hud-action attack-action"
          aria-expanded={panel === "attack"}
          aria-controls="attack-panel"
          onClick={() => togglePanel("attack")}
        >
          <Icon name="army" size={24} />
          <span>{state.battle ? "Battle" : "Attack"}</span>
        </button>
        {panel && !state.battle && (
          <section
            key={`${panel}-${state.battle?.id ?? "home"}-${state.battle?.phaseIndex ?? 0}-${!!state.battle?.finished}`}
            id={`${panel}-panel`}
            className={`hud-panel ${panel === "build" ? "hud-panel-build" : panel === "attack" ? "hud-panel-attack" : "hud-panel-management"}`}
            aria-label={panel === "attack" ? "Attack menu" : `${panel} menu`}
          >
            <div className="hud-panel-heading">
              <h2>
                {
                  {
                    build: "Construction",
                    attack: state.battle ? "Battle command" : "Battle campaign",
                    army: "Your army",
                    research: "Research",
                    activity: "Activity",
                  }[panel]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            {panel === "build" && (
              <BuildMenu
                state={state}
                config={config}
                mode={mode}
                filter={filter}
                setFilter={setFilter}
                onBuild={(buildingType) => {
                  setMode({ type: "build", buildingType });
                  setActionsOpen(false);
                  setPanel(null);
                  setInspectorOpen(false);
                }}
              />
            )}
            {panel === "attack" && (
              <AttackMenu
                state={state}
                config={config}
                squad={squad}
                setSquad={setSquad}
                onAttack={(unitIds, airMissions, campaignLevel) =>
                  dispatch("BATTLE_START", {
                    unitIds,
                    airMissions,
                    ...(campaignLevel ? { campaign: true, campaignLevel } : {}),
                  })
                }
              />
            )}
            {panel === "army" && (
              <div className="army-list">
                {state.units.map((u) => (
                  <button
                    className="army-chip"
                    key={u.id}
                    onClick={() => select(u.id)}
                  >
                    <SpriteImage type={u.type} />
                    <span>
                      {config.units.find((d) => d.id === u.type).name}
                      <small>
                        #{u.id} · {u.health} HP{" "}
                        {u.carrier
                          ? `· Carrier #${u.carrier}`
                          : u.reserve
                            ? "· Awaiting deployment"
                            : u.carrierSlots
                              ? `· ${u.aircraftCount}/${u.carrierSlots} aircraft`
                              : ""}
                      </small>
                    </span>
                  </button>
                ))}
                {!state.units.length && (
                  <p>Train your first soldiers at the Barracks.</p>
                )}
              </div>
            )}
            {panel === "research" && (
              <ResearchPanel
                state={state}
                config={config}
                dispatch={dispatch}
              />
            )}
            {panel === "activity" && (
              <>
                <ActivityPanel
                  state={state}
                  config={config}
                  onSelect={select}
                />
                {!state.buildings.some(
                  (b) => b.state !== 1 || b.queue.length,
                ) &&
                  !state.research.length && (
                    <p>No construction, training or research in progress.</p>
                  )}
              </>
            )}
          </section>
        )}
        {inspectorOpen && !state.battle && (
          <section
            className="hud-panel hud-panel-management"
            aria-label="Selection details"
          >
            <div className="hud-panel-heading">
              <h2>Island management</h2>
              <button
                className="icon-button"
                aria-label="Close inspector"
                onClick={() => setInspectorOpen(false)}
              >
                <Icon name="close" />
              </button>
            </div>
            <Inspector
              state={state}
              config={config}
              selected={selected}
              mode={mode}
              placement={placement}
              dispatch={dispatch}
              setMode={(value) => {
                setMode(value);
                setInspectorOpen(false);
              }}
              onSelect={select}
              onOpenAttack={() => togglePanel("attack")}
            />
          </section>
        )}
      </main>
      {objectDialog && dialogObject && !state.battle && (
        <ObjectActionDialog
          object={dialogObject}
          action={objectDialog.action}
          state={state}
          config={config}
          dispatch={dispatch}
          onClose={() => setObjectDialog(null)}
          onAction={openObjectAction}
          onSelect={(id) => {
            setSelected(id);
            setObjectDialog({ action: "info", selection: id });
          }}
          onOpenAttack={() => togglePanel("attack")}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.ok ? "" : "error"}`}
          role="status"
          aria-live="polite"
        >
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <input
        hidden
        type="file"
        accept=".json,application/json"
        ref={file}
        onChange={importSave}
      />
      {menu && (
        <Dialog
          title={
            menu === "shop"
              ? "Shop"
              : menu === "help"
                ? "Your first empire"
                : menu === "new"
                  ? "A new beginning"
                  : "Empires of wars"
          }
          onClose={() => setMenu(null)}
          className={menu === "shop" ? "shop-dialog" : ""}
        >
          {menu === "shop" && (
            <ShopPanel
              state={state}
              dispatch={dispatch}
              getOffers={getShopOptions}
            />
          )}
          {menu === "settings" && (
            <>
              <p>
                Version 0.4.7 · Your troops deal the shown Attack. Progress is
                stored on this device.
              </p>
              <div className="menu-grid">
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => saveNow()}
                >
                  Save game <kbd>F5</kbd>
                </button>
                <button className="button secondary" onClick={loadNow}>
                  Load game <kbd>F9</kbd>
                </button>
                <button className="button secondary" onClick={exportSave}>
                  Export save
                </button>
                <button className="button secondary" onClick={chooseImport}>
                  Import save
                </button>
                <button
                  className="button secondary"
                  onClick={() => setMenu("help")}
                >
                  How to play
                </button>
                <button
                  className="button secondary"
                  onClick={() => setMenu("new")}
                >
                  New island
                </button>
              </div>
              <div className="hint-box">
                Saves can travel between the browser and desktop app. Classic
                native saves can also be imported. No account required.
              </div>
              <small>
                {savedAt
                  ? `Saved ${savedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                  : "Autosaves every 30 seconds"}
              </small>
            </>
          )}
          {menu === "new" && (
            <>
              <p>
                Your current empire will be saved first. The previous save
                remains available as the backup.
              </p>
              <label className="seed-label">
                World seed
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <button className="button primary full" onClick={newGame}>
                Create island
              </button>
            </>
          )}
          {menu === "help" && (
            <>
              <ol className="help-steps">
                <li>
                  <strong>Start your settlement.</strong> Begin with Town Hall
                  1, 600 food and 1,000 wood. Open Build to construct a Farm and
                  Lumberyard. Click a building to open its action buttons.
                  Clicking a producing building also collects its stored
                  resources. Choose Train for troops or Upgrade to compare the
                  next level and its cost.
                </li>
                <li>
                  <strong>Make room to grow.</strong> Your House provides 20,
                  40, 70, 110 or 160 army population at levels 1 to 5. Training
                  reserves capacity immediately. Build one of each building and
                  upgrade every level separately within the Town Hall limit.
                </li>
                <li>
                  <strong>Build your army.</strong> Each completed Barracks,
                  Harbor or Air Base level unlocks the matching unit type.
                  Harbor unlocks at Town Hall 4 and Air Base at Town Hall 6.
                  Research each type independently at the Academy, with one
                  research project at a time. Academy levels 7 to 10 unlock two
                  improvements each, reaching up to research level 14. Each
                  improvement adds 5% to the already improved attack, health,
                  shields and healing. Training cards show base stats, the
                  research bonus and the total.
                </li>
                <li>
                  <strong>Conquer the campaign.</strong> Open Attack to see your
                  current level and required troops. Choose up to 5 units for
                  each required land, sea or air army before starting, or use
                  Auto select to pick the strongest available troops. Your
                  chosen survivors fight every round automatically without squad
                  changes. Choose a unit and an enemy to attack, or enable Auto
                  attack. Win every round to unlock the next level. Defeat or
                  retreat keeps the same level available.
                </li>
                <li>
                  <strong>Develop your city.</strong> Complete the building
                  requirements shown at the Town Hall to reach the next level.
                  New production, unit unlocks and research bonuses apply after
                  each project finishes.
                </li>
              </ol>
              <div className="shortcut-row">
                <kbd>F5</kbd> Save <kbd>F9</kbd> Load <kbd>Esc</kbd> Cancel{" "}
                <kbd>Space</kbd> Pause / resume
              </div>
              <button
                className="button primary full"
                onClick={() => setMenu(null)}
              >
                Build my empire
              </button>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
