import assert from "node:assert/strict";
export function previousCombatRules(config) {
  const old = structuredClone(config);
  delete old.combatRulesVersion;
  for (const u of old.units)
    if (["stealth_cruiser", "phantom_bomber"].includes(u.id))
      u.abilities = u.abilities.map((a) =>
        a === "stun_attackers" ? "stun_on_hit" : a,
      );
  return old;
}
export function exactCombatGame(e) {
  return JSON.parse(
    e
      .save()
      .replace(
        /("(?:id|attacker|target|carrier)"\s*:\s*)(\d{16,})/g,
        '$1"__id_$2"',
      ),
  ).game;
}
export function loadCombatGame(e, g) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  const bytes = JSON.stringify(canonical(g)).replace(/"__id_(\d+)"/g, "$1");
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(bytes))
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  const r = e.load(`{"checksum":"${hash.toString(16)}","game":${bytes}}`);
  assert(r.ok, r.message);
}
export function naval81Case(e, config) {
  const game = exactCombatGame(e),
    world = e.getWorld();
  const land = game.units.find((u) => u.id === 45),
    air = game.units.find((u) => u.id === 47);
  const academy = game.buildings.find((b) => b.type === "house");
  academy.type = "academy";
  academy.level = 10;
  game.researchLevels = {
    jet_fighter: 11,
    titan_carrier: 2,
    stealth_cruiser: 4,
  };
  Object.assign(land, {
    type: "missile_launcher",
    health: 250,
    carrier: null,
    reserve: false,
  });
  game.units = [land, air];
  const occupied = new Set();
  for (const u of game.units) {
    const d = config.units.find((d) => d.id === u.type);
    for (let y = 0; y < d.footprint[1]; y++)
      for (let x = 0; x < d.footprint[0]; x++)
        occupied.add(`${u.position[0] + x}:${u.position[1] + y}`);
  }
  const source = (type) => game.buildings.find((b) => b.type === type).id;
  const health = (d, rank = 0) =>
    Number((BigInt(d.health) * 21n ** BigInt(rank)) / 20n ** BigInt(rank));
  const add = (type, carrier = null) => {
    const d = config.units.find((d) => d.id === type),
      rank = game.researchLevels[type] || 0;
    const u = {
      id: game.nextId++,
      type,
      health: health(d, rank),
      source: source(d.building),
      carrier,
      reserve: false,
      position: [14, 24],
    };
    if (!carrier) {
      let plot;
      for (let y = 0; y + d.footprint[1] <= world.height && !plot; y++)
        for (let x = 0; x + d.footprint[0] <= world.width && !plot; x++) {
          const cells = [];
          for (let dy = 0; dy < d.footprint[1]; dy++)
            for (let dx = 0; dx < d.footprint[0]; dx++)
              cells.push([x + dx, y + dy]);
          if (
            cells.every(
              ([cx, cy]) =>
                world.tiles[cy * world.width + cx] === 0 &&
                !occupied.has(`${cx}:${cy}`),
            )
          ) {
            plot = [x, y];
            for (const [cx, cy] of cells) occupied.add(`${cx}:${cy}`);
          }
        }
      assert(plot, "Naval deployment plot");
      u.position = plot;
    }
    game.units.push(u);
    return u.id;
  };
  const carriers = [];
  for (let i = 0; i < 3; i++) {
    const c = add("titan_carrier");
    carriers.push(c);
    for (let j = 0; j < 5; j++) add("jet_fighter", c);
  }
  const cruisers = [add("stealth_cruiser"), add("stealth_cruiser")];
  game.campaign = {
    completed: false,
    currentLevel: 81,
    completedLevels: Array.from({ length: 80 }, (_, i) => i + 1),
  };
  loadCombatGame(e, game);
  let r = e.dispatch({
    type: "BATTLE_START",
    payload: {
      campaignLevel: 81,
      unitIds: [
        String(land.id),
        String(air.id),
        ...carriers.map(String),
        ...cruisers.map(String),
      ],
    },
  });
  assert(r.ok, r.message);
  const first = exactCombatGame(e);
  for (const f of first.battle.fighters)
    if (f.enemy) {
      f.health = 1;
      f.shield = 0;
    }
  loadCombatGame(e, first);
  const actor = e
    .getState()
    .battle.fighters.find((f) => f.id === String(land.id));
  r = e.dispatch({
    type: "BATTLE_ATTACK",
    payload: { id: actor.id, target: actor.validTargets[0] },
  });
  assert(r.ok, r.message);
  const sea = exactCombatGame(e);
  assert.equal(sea.battle.domain, "naval");
  sea.battle.round = 3;
  sea.battle.animationMs = 0;
  for (const f of sea.battle.fighters)
    if (carriers.includes(f.id)) {
      f.attacked = true;
      f.readyRound = 1;
    }
  const foes = sea.battle.fighters.filter((f) => f.enemy);
  for (const [i, hp] of [1845, 1142, 78, 2274, 1102].entries())
    foes[i].health = hp;
  sea.battle.fighters.find((f) => f.id === cruisers[0]).health = 119;
  sea.battle.fighters.find((f) => f.id === cruisers[1]).health = 875;
  loadCombatGame(e, sea);
  return {
    carriers: carriers.map(String),
    cruisers: cruisers.map(String),
    submarine: e.getState().battle.fighters.find((f) => f.enemyId === "W06").id,
  };
}
