import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  battleActionPaths,
  battleActionSummary,
  fighterTargetAction,
  unitAbilityDetails,
} from "../src/game/BattlePresentation.js";

const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server, arena, panels;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  arena = await server.ssrLoadModule("/src/components/BattleArena.jsx");
  panels = await server.ssrLoadModule("/src/components/GamePanels.jsx");
});
after(async () => server?.close());

function battleFixture(healTargets = ["2"]) {
  const frigate = config.units.find((unit) => unit.id === "frigate");
  return {
    config: {
      ...config,
      units: [{ ...frigate, abilities: ["repair_allies"] }],
    },
    state: {
      battle: {
        id: "battle",
        domain: "naval",
        phases: ["naval"],
        phaseIndex: 0,
        outcomes: [],
        round: 1,
        actions: 0,
        lastAttacks: [],
        fighters: [
          {
            id: "1",
            type: "frigate",
            domain: "naval",
            health: 360,
            maxHealth: 360,
            healing: 162,
            validTargets: ["e1"],
            validHealTargets: healTargets,
          },
          {
            id: "2",
            type: "ship",
            domain: "naval",
            health: 50,
            maxHealth: 150,
            attacked: true,
          },
          {
            id: "e1",
            type: "ship",
            domain: "naval",
            health: 150,
            maxHealth: 150,
            enemy: true,
          },
        ],
      },
    },
    selected: "1",
    onSelect() {},
    dispatch() {},
    onSettings() {},
  };
}

test("Frigate directly highlights wounded allies for healing and enemies for attack without mode buttons", () => {
  const html = renderToStaticMarkup(
    createElement(arena.BattleArena, battleFixture()),
  );
  assert.match(
    html,
    /Click a wounded ally to heal up to 162 HP, or click an enemy to attack/,
  );
  assert.match(html, /class="arena-fighter friendly[^"\n]*healable/);
  assert.match(html, /aria-label="Heal ship 2, 50 of 150 health with Frigate"/);
  assert.match(html, /aria-label="Attack ship 1, 150 health with Frigate"/);
  assert.doesNotMatch(
    html,
    /Frigate action|arena-action-choice|>Heal ally|>Attack<\/button>/,
  );
  const noTargets = renderToStaticMarkup(
    createElement(arena.BattleArena, battleFixture([])),
  );
  assert.doesNotMatch(noTargets, /healable|aria-label="Heal /);
  assert.match(noTargets, /targetable/);
});

test("Direct targeting accepts wounded allies after their action, self healing and valid enemy attacks", () => {
  const [healer, ally, enemy] = battleFixture().state.battle.fighters;
  assert.equal(fighterTargetAction(healer, ally), "BATTLE_HEAL");
  assert.equal(fighterTargetAction(healer, enemy), "BATTLE_ATTACK");
  assert.equal(fighterTargetAction(healer, { ...ally, health: 0 }), null);
  assert.equal(fighterTargetAction(healer, { ...ally, id: "unknown" }), null);
  assert.equal(fighterTargetAction(healer, { ...enemy, id: "unknown" }), null);
  assert.equal(fighterTargetAction(null, ally), null);
  assert.equal(
    fighterTargetAction({ ...healer, validHealTargets: [healer.id] }, healer),
    "BATTLE_HEAL",
  );
});

test("Action paths connect the actual attacker to every target and distinguish healing", () => {
  const fighters = battleFixture().state.battle.fighters;
  const paths = battleActionPaths(fighters, [
    { attacker: "1", target: "e1", damage: 20 },
    { attacker: "1", target: "2", healing: 90 },
    { attacker: "1", target: "1", healing: 10 },
    { attacker: "missing", target: "e1", damage: 1 },
  ]);
  assert.equal(paths.length, 2);
  assert(paths[0].from.x < paths[0].to.x);
  assert.equal(paths[0].healing, false);
  assert.equal(paths[1].healing, true);
  assert.equal(paths[0].from.x, paths[1].from.x);
  assert.notDeepEqual(paths[0].to, paths[1].to);
  const reverse = battleActionPaths(fighters, [
    { attacker: "e1", target: "2", damage: 5 },
  ]);
  assert(reverse[0].from.x > reverse[0].to.x);
});

test("Battle feedback names healing as restored HP and explains shield damage", () => {
  assert.equal(
    battleActionSummary({ damage: 0, healing: 90 }),
    "Your unit restored 90 HP.",
  );
  assert.equal(
    battleActionSummary({ missed: true }, true),
    "Enemy unit missed.",
  );
  assert.match(
    battleActionSummary({ damage: 10, shieldDamage: 30 }),
    /10 damage and 30 shield damage/,
  );
  assert.equal(
    battleActionSummary({ damage: 0, shieldDamage: 1 }, true),
    "Enemy unit dealt 1 shield damage. Health was protected.",
  );
  const props = battleFixture();
  props.state.battle.lastAttacks = [
    { attacker: "1", target: "2", damage: 0, healing: 100 },
  ];
  const html = renderToStaticMarkup(createElement(arena.BattleArena, props));
  assert.match(html, /Frigate healed ship for 100 HP/);
  assert.doesNotMatch(html, /dealt 0 damage/);
});

test("Ability descriptions explain automatic healing, max HP scaling and all-target attacks", () => {
  const recruit = unitAbilityDetails({
    abilities: ["self_repair"],
    healing: 55,
    healingPercent: 50,
  }).join(" ");
  assert.match(recruit, /After each enemy turn, heals itself for 55 HP/);
  assert.match(recruit, /At full health, heals a wounded ally instead/);
  assert.match(recruit, /Academy health research also improves/);
  const shield = unitAbilityDetails({
    abilities: [],
    shield: 200,
    shieldPercent: 100,
  }).join(" ");
  assert.match(shield, /200 shield \(100% of maximum HP\)/);
  assert.match(shield, /Health can be damaged by later hits after it breaks/);
  assert.match(
    unitAbilityDetails({ abilities: ["attack_all"] }).join(" "),
    /all opposing units at full damage/,
  );
});

test("Academy cards display the current and next ability totals", () => {
  const infantry = config.units.find((unit) => unit.id === "infantry");
  const heavy = config.units.find((unit) => unit.id === "heavy_infantry");
  const option = (unit, extra) => ({
    type: unit.id,
    level: 0,
    maxLevel: 8,
    academyLimit: 8,
    nextLevel: 1,
    bonusPercent: 0,
    nextBonusPercent: 5,
    seconds: 30,
    cost: {},
    ok: true,
    ...extra,
  });
  const html = renderToStaticMarkup(
    createElement(panels.ResearchPanel, {
      state: {
        buildings: [
          {
            id: "9",
            type: "academy",
            level: 10,
            state: 1,
            researchOptions: [
              option(infantry, {
                currentHealth: 100,
                nextHealth: 105,
                currentDamage: 34,
                nextDamage: 35,
                currentHealing: 50,
                nextHealing: 52,
              }),
              option(heavy, { currentShield: 87, nextShield: 91 }),
            ],
          },
        ],
        research: [],
      },
      config,
      dispatch() {},
    }),
  );
  assert.match(html, /HP 100 → 105/);
  assert.match(html, /Attack 34 → 35/);
  assert.match(html, /Healing 50 HP → 52 HP/);
  assert.match(html, /Shield 87 → 91/);
  assert.match(html, /Healing and shields based on maximum HP grow/);
});

test("Training shows researched healing and shield totals with their actual bonuses", () => {
  const renderUnit = (type) => {
    const definition = config.units.find((unit) => unit.id === type);
    const building = {
      id: "9",
      type: definition.building,
      level: 10,
      state: 1,
      queue: [],
      training: [{ type, requirements: [] }],
    };
    return renderToStaticMarkup(
      createElement(panels.TrainingRoster, {
        building,
        state: {
          buildings: [building],
          units: [],
          researchLevels: { [type]: 2 },
        },
        config: { ...config, units: [definition] },
        dispatch() {},
      }),
    );
  };
  assert.match(
    renderUnit("infantry"),
    /Healing: 50 base \+ 5 improvements = 55 total/,
  );
  assert.match(
    renderUnit("heavy_infantry"),
    /Shield: 87 base \+ 9 improvements = 96 total/,
  );
  assert.match(
    renderUnit("armored_carrier"),
    /Healing: 108 base \+ 10 improvements = 118 total/,
  );
  assert.match(
    renderUnit("frigate"),
    /Healing: 162 base \+ 16 improvements = 178 total/,
  );
  assert.match(
    renderUnit("attack_submarine"),
    /Shield: 330 base \+ 33 improvements = 363 total/,
  );
});

test("Air Base cards show the updated aircraft stats and abilities", () => {
  const aircraft = config.units.filter((unit) => unit.domain === "air");
  const building = {
    id: "airbase",
    type: "airbase",
    level: 10,
    state: 1,
    queue: [],
    training: aircraft.map((unit) => ({ type: unit.id, requirements: [] })),
  };
  const html = renderToStaticMarkup(
    createElement(panels.TrainingRoster, {
      building,
      state: { buildings: [building], units: [], researchLevels: {} },
      config,
      dispatch() {},
    }),
  );
  for (const unit of aircraft) {
    const card = html.split(`<h3>${unit.name}</h3>`)[1]?.split("</section>")[0];
    assert(card, unit.name);
    assert(
      card.includes(`HP <strong>${unit.health}</strong>`),
      `${unit.name} HP`,
    );
    assert(
      card.includes(`Attack <strong>${unit.damage}</strong>`),
      `${unit.name} Attack`,
    );
  }
  assert.match(html, /heal a wounded ally for 225 HP/);
  assert.match(html, /every other enemy at 50% Attack/);
});

test("New troop descriptions explain formation splash, two attacks and aircraft payload", () => {
  const details = (id) =>
    unitAbilityDetails(config.units.find((u) => u.id === id)).join(" ");
  assert.match(details("missile_launcher"), /every other enemy at 50% Attack/);
  assert.match(details("combat_drone"), /attack twice per turn/);
  assert.match(details("light_aircraft_carrier"), /up to 2 aircraft/);
  assert.match(details("titan_carrier"), /up to 5 aircraft/);
  assert.match(details("titan_carrier"), /empty carrier cannot attack/);
});

test("Battle shows the Drone remaining attack and hides embarked aircraft as independent actors", () => {
  const props = battleFixture([]);
  props.config = config;
  props.state.battle.fighters[0] = {
    ...props.state.battle.fighters[0],
    type: "combat_drone",
    attacksPerTurn: 2,
    attacksRemaining: 1,
  };
  props.state.battle.fighters.push({
    id: "cargo",
    type: "aircraft",
    carrier: "1",
    health: 120,
    maxHealth: 120,
  });
  const html = renderToStaticMarkup(createElement(arena.BattleArena, props));
  assert.match(html, /1 attack left/);
  assert.doesNotMatch(html, /Recon Aircraft/);
});

test("Carrier management lists the supported aircraft for each carrier and actual attack", () => {
  const carrier = {
    id: "c",
    type: "titan_carrier",
    damageByDomain: { naval: 130, air: 636 },
  };
  const html = renderToStaticMarkup(
    createElement(panels.CarrierManagement, {
      carrier,
      state: { units: [] },
      config,
      dispatch() {},
    }),
  );
  assert.match(html, /Aircraft 0\/5/);
  assert.match(
    html,
    /Recon Aircraft, Fighter Aircraft, Attack Aircraft, Jet Fighter/,
  );
  assert.match(html, /Attack against ships: 130/);
  assert.match(html, /Attack against aircraft: 636/);
});

test("Elite troop ability descriptions and combat feedback explain one-turn stun and double attacks", () => {
  const details = (type) =>
    unitAbilityDetails(config.units.find((u) => u.id === type)).join(" ");
  assert.match(
    details("stealth_cruiser"),
    /attacker is stunned and misses its next turn/,
  );
  assert.match(details("phantom_bomber"), /stuns do not stack/);
  assert.match(details("titan_mech"), /attack twice per turn/);
  assert.match(details("plasma_fighter"), /every other enemy at 50% Attack/);
  assert.match(
    battleActionSummary({ damage: 0, shieldDamage: 1, stunTurns: 1 }),
    /stunned for one turn/,
  );
  assert.match(
    battleActionSummary(
      { damage: 237, shieldDamage: 0, stunTurns: 1, attackerStunned: true },
      true,
      "Enemy W06",
      "Stealth Cruiser",
    ),
    /Enemy W06 is stunned and will miss its next turn/,
  );
  const props = battleFixture([]);
  props.state.battle.fighters.find((f) => f.enemy).stunnedUntilRound = 1;
  const html = renderToStaticMarkup(createElement(arena.BattleArena, props));
  assert.match(html, /Stunned · skips this turn/);
});
