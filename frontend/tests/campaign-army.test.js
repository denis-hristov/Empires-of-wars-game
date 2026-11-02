import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoSelectCampaignArmy,
  campaignArmyCandidates,
  campaignArmyDomains,
  replaceCampaignDomainSelection,
} from "../src/game/CampaignArmy.js";

const definition = (id, domain = "land", stats = {}) => ({
  id,
  name: id,
  domain,
  level: 1,
  health: 100,
  damage: 10,
  defense: 0,
  shield: 0,
  accuracy: 100,
  attackCooldown: 1,
  ...stats,
});
const unit = (id, type = "infantry", stats = {}) => ({
  id: String(id),
  type,
  health: 100,
  ...stats,
});
const config = {
  units: [
    definition("infantry"),
    definition("ship", "naval"),
    definition("aircraft", "air"),
  ],
};

test("Auto select takes the strongest five independently for every required domain", () => {
  const units = config.units.flatMap(({ id }, domainIndex) =>
    Array.from({ length: 7 }, (_, index) =>
      unit(domainIndex * 10 + index + 1, id, { damage: index + 1 }),
    ),
  );
  const selected = autoSelectCampaignArmy({ units }, config, [
    "land",
    "naval",
    "air",
  ]);
  assert.deepEqual(selected, [
    "7",
    "6",
    "5",
    "4",
    "3",
    "17",
    "16",
    "15",
    "14",
    "13",
    "27",
    "26",
    "25",
    "24",
    "23",
  ]);
  assert.equal(new Set(selected).size, 15);
});

test("Auto select uses all available troops when a required type has fewer than five", () => {
  const state = {
    units: [unit(1), unit(2, "ship"), unit(3, "aircraft")],
  };
  assert.deepEqual(autoSelectCampaignArmy(state, config, ["naval", "land"]), [
    "2",
    "1",
  ]);
});

test("Auto select excludes dead, cargo, reserve, unknown and unneeded troops", () => {
  const state = {
    units: [
      unit(1),
      unit(2, "infantry", { health: 0, damage: 9999 }),
      unit(3, "infantry", { carrier: "100", damage: 9999 }),
      unit(4, "infantry", { reserve: true, damage: 9999 }),
      unit(5, "unknown", { damage: 9999 }),
      unit(6, "ship", { damage: 9999 }),
      unit(7, "aircraft", { damage: 9999 }),
    ],
  };
  assert.deepEqual(autoSelectCampaignArmy(state, config, ["land"]), ["1"]);
  assert.deepEqual(autoSelectCampaignArmy({ units: [] }, config, ["land"]), []);
});

test("Auto select accounts for injuries instead of preferring a stronger troop at near zero health", () => {
  const state = {
    units: [
      unit(1, "infantry", { damage: 100, health: 1 }),
      unit(2, "infantry", { damage: 10, health: 100 }),
    ],
  };
  assert.deepEqual(autoSelectCampaignArmy(state, config, ["land"]), ["2", "1"]);
});

test("Power includes damage, current health, defense, shield, accuracy and attack cooldown", () => {
  const state = {
    units: [
      unit(1, "infantry", {
        damage: 20,
        health: 80,
        maxHealth: 100,
        defense: 25,
        shield: 50,
        accuracy: 50,
        attackCooldown: 2,
      }),
    ],
  };
  const [candidate] = campaignArmyCandidates(state, config, ["land"]);
  assert.equal(candidate.power, 812.5);
  const withoutArmor = {
    ...config,
    battle: { ...config.battle, playerArmorEnabled: false },
  };
  assert.equal(
    campaignArmyCandidates(state, withoutArmor, ["land"])[0].power,
    650,
  );
  state.units[0].defense = 9999;
  assert.equal(
    campaignArmyCandidates(state, withoutArmor, ["land"])[0].power,
    650,
  );
});

test("Power uses effective engine stats ahead of catalog or research fallbacks", () => {
  const state = {
    units: [
      unit(1, "infantry", {
        damage: 30,
        health: 200,
        maxHealth: 200,
      }),
    ],
    researchLevels: { infantry: 10 },
    unitCatalog: [
      { id: "infantry", effectiveHealth: 150, effectiveDamage: 15 },
    ],
  };
  assert.equal(campaignArmyCandidates(state, config, ["land"])[0].power, 6000);
});

test("Power falls back to catalog stats and research upgrades when no engine stats exist", () => {
  const state = {
    units: [unit(1)],
    researchLevels: { infantry: 10 },
  };
  assert.equal(campaignArmyCandidates(state, config, ["land"])[0].power, 1600);
  state.unitCatalog = [
    { id: "infantry", effectiveHealth: 200, effectiveDamage: 25 },
  ];
  assert.equal(campaignArmyCandidates(state, config, ["land"])[0].power, 2500);
});

test("Power includes already researched technology bonuses applied by the battle engine", () => {
  const state = { units: [unit(1)], technologies: ["weapons"] };
  const withTechnologies = {
    ...config,
    technologies: [
      { id: "weapons", domain: "land", healthBonus: 20, damageBonus: 5 },
      { id: "future", domain: "land", healthBonus: 200, damageBonus: 50 },
    ],
  };
  assert.equal(
    campaignArmyCandidates(state, withTechnologies, ["land"])[0].power,
    1800,
  );
  state.unitCatalog = [
    {
      id: "infantry",
      effectiveHealth: 100,
      effectiveDamage: 10,
      technologyDamageBonus: 5,
    },
  ];
  assert.equal(
    campaignArmyCandidates(state, withTechnologies, ["land"])[0].power,
    1800,
    "Technology damage already included in card totals is not counted twice",
  );
});

test("Equal power uses troop tier then numeric ID for a deterministic order", () => {
  const localConfig = {
    units: [definition("infantry"), definition("elite", "land", { level: 2 })],
  };
  const state = { units: [unit(10), unit(3, "elite"), unit(2)] };
  assert.deepEqual(autoSelectCampaignArmy(state, localConfig, ["land"]), [
    "3",
    "2",
    "10",
  ]);
});

test("Required domain groups follow the level order and are not duplicated for later rounds", () => {
  assert.deepEqual(
    campaignArmyDomains({
      rounds: ["air", "land", "air", "naval", "land"].map((domain) => ({
        domain,
      })),
    }),
    ["air", "land", "naval"],
  );
});

test("Changing or clearing one domain preserves the other selected armies", () => {
  const squad = ["1", "2", "ship", "aircraft"];
  assert.deepEqual(
    replaceCampaignDomainSelection(squad, ["1", "2", "3"], ["3"]),
    ["ship", "aircraft", "3"],
  );
  assert.deepEqual(replaceCampaignDomainSelection(squad, ["1", "2", "3"], []), [
    "ship",
    "aircraft",
  ]);
  assert.deepEqual(squad, ["1", "2", "ship", "aircraft"]);
});

test("Guaranteed-hit battles rank army power without obsolete accuracy bonuses or penalties", () => {
  const state = {
    units: [
      unit(1, "infantry", {
        damage: 20,
        health: 100,
        maxHealth: 100,
        accuracy: 1,
      }),
    ],
  };
  const guaranteed = { ...config, battle: { attacksAlwaysHit: true } };
  const [candidate] = campaignArmyCandidates(state, guaranteed, ["land"]);
  assert.equal(candidate.power, 2000);
});
