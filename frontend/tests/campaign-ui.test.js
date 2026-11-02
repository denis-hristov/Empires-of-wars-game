import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
const config = JSON.parse(
  await readFile(new URL("../../config/game.json", import.meta.url)),
);
let server, menu, panels;
before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    configLoader: "runner",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: "custom",
  });
  menu = await server.ssrLoadModule("/src/components/CampaignMenu.jsx");
  panels = await server.ssrLoadModule("/src/components/GamePanels.jsx");
});
after(async () => server?.close());
const state = (level, townHall = 10) => ({
  townHallLevel: townHall,
  researchLevels: {},
  campaign: {
    currentLevel: level,
    completedLevels: Array.from({ length: level - 1 }, (_, i) => i + 1),
    completed: false,
  },
  units: [
    { id: "1", type: "infantry", health: 100 },
    { id: "2", type: "ship", health: 150 },
    { id: "3", type: "aircraft", health: 100 },
    { id: "4", type: "infantry", health: 100, carrier: "9" },
    { id: "5", type: "infantry", health: 0 },
  ],
});
const renderMenu = (value, squad = []) =>
  renderToStaticMarkup(
    createElement(menu.CampaignMenu, {
      state: value,
      config,
      squad,
      setSquad: () => {},
      onAttack: () => {},
    }),
  );
test("Campaign attack offers all required domain armies before the first round", () => {
  const html = renderMenu(state(51), ["1"]);
  assert.match(
    html,
    /<h3>Level 51<\/h3>.*campaign-level-meta.*<span>3 rounds<\/span><span>Land troops<\/span><span>Ships<\/span><span>Aircraft<\/span>/,
  );
  assert.match(html, /Recruit Squad #1/);
  assert.match(html, /Patrol Ship #2/);
  assert.match(html, /Recon Aircraft #3/);
  assert.match(html, /Choose land troops \(1\/5\)/);
  assert.match(html, /Choose ships \(0\/5\)/);
  assert.match(html, /Choose aircraft \(0\/5\)/);
  assert.match(html, />Auto select<\/button>/);
  assert.match(html, /This army is fixed for every round/);
  assert.match(html, /Choose at least 1 unit for: ships, aircraft/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Attack level 51/);
  assert.doesNotMatch(html, /Recruit Squad #4|Recruit Squad #5/);
  assert.match(html, /Attack level 51/);
  assert.doesNotMatch(
    html,
    /<select|<details|Battle level|Town Hall \d+ required|troops ready|campaign-round-preview|campaign-requirements|Enemy army|Empty rounds are skipped|change your squad between rounds|Choose your next squad/,
  );
});
test("Campaign attack enables launch only after selecting every required domain", () => {
  const html = renderMenu(state(51), ["1", "2", "3"]);
  assert.match(html, /Choose land troops \(1\/5\)/);
  assert.match(html, /Choose ships \(1\/5\)/);
  assert.match(html, /Choose aircraft \(1\/5\)/);
  assert.doesNotMatch(html, /Choose at least 1 unit for/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Attack level 51/);
});
test("Campaign attack only shows domains required by the complete level", () => {
  const html = renderMenu(state(1), ["1", "2", "3"]);
  assert.match(html, /Choose land troops \(1\/5\)/);
  assert.doesNotMatch(
    html,
    /Choose ships|Choose aircraft|Patrol Ship #2|Recon Aircraft #3/,
  );
});
test("Repeated rounds use one selection section per required domain", () => {
  const html = renderMenu(state(150), ["1", "2", "3"]);
  assert.equal((html.match(/class="squad-domain"/g) ?? []).length, 3);
  assert.match(html, /15 rounds/);
  assert.match(html, /This army is fixed for every round/);
});
test("Campaign attack uses the current level and shows the singular round badge", () => {
  const html = renderMenu(state(1), ["1"]);
  assert.match(html, /<h3>Level 1<\/h3>/);
  assert.match(html, /<span>1 round<\/span><span>Land troops<\/span>/);
  assert.doesNotMatch(html, /<option|Town Hall 1 required/);
  assert.match(html, /Attack level 1/);
});
test("Campaign attack explains the Town Hall lock and disables launch", () => {
  const html = renderMenu(state(11, 1), ["1"]);
  assert.match(html, /Upgrade Town Hall to level 2/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Attack level 11/);
});
test("Completed campaign does not advertise a removed level selector", () => {
  const value = state(150);
  value.campaign.completed = true;
  value.campaign.completedLevels.push(150);
  const html = renderMenu(value, ["1"]);
  assert.match(html, /Campaign complete\. All 150 levels conquered\./);
  assert.doesNotMatch(html, /replay any battle|<select|<details/);
});
test("Campaign round labels remain sequential for all fifteen repeated domain rounds", () => {
  const level = config.campaign.levels[149];
  const html = renderToStaticMarkup(
    createElement(panels.BattleRounds, {
      battle: {
        phases: level.rounds.map((round) => round.domain),
        phaseIndex: 10,
        outcomes: Array(10).fill(1),
        finished: false,
        awaitingSelection: true,
      },
    }),
  );
  assert.match(html, /Round 6/);
  assert.match(html, /Round 15/);
  assert.match(html, /Preparing round/);
});
test("Campaign defeat keeps the level explicit and victory shows the actual configured rewards", () => {
  const value = state(1);
  value.battle = {
    campaignLevel: 1,
    phases: ["land"],
    phaseIndex: 0,
    outcomes: [0],
    finished: true,
    victory: false,
  };
  let html = renderToStaticMarkup(
    createElement(panels.BattlePanel, {
      state: value,
      config,
      dispatch: () => {},
    }),
  );
  assert.match(html, /Level 1 remains unfinished/);
  value.battle.victory = true;
  value.battle.outcomes = [1];
  html = renderToStaticMarkup(
    createElement(panels.BattlePanel, {
      state: value,
      config,
      dispatch: () => {},
    }),
  );
  assert.match(html, /unlock level 2/);
  assert.doesNotMatch(html, /Captives/);
});

test("Campaign attack unlocks each full Town Hall range and locks the next range", () => {
  const ends = [10, 20, 30, 40, 50, 65, 80, 100, 125, 150];
  for (const [index, last] of ends.entries()) {
    const townHall = index + 1;
    const first = index ? ends[index - 1] + 1 : 1;
    for (const level of [first, last]) {
      const html = renderMenu(state(level, townHall), ["1", "2", "3"]);
      assert.doesNotMatch(html, /Upgrade Town Hall/);
      assert.doesNotMatch(
        html,
        new RegExp(`<button[^>]*disabled=""[^>]*>Attack level ${level}<`),
      );
    }
    if (last < 150) {
      const html = renderMenu(state(last + 1, townHall), ["1", "2", "3"]);
      assert.match(
        html,
        new RegExp(`Upgrade Town Hall to level ${townHall + 1}`),
      );
      assert.match(
        html,
        new RegExp(`<button[^>]*disabled=""[^>]*>Attack level ${last + 1}<`),
      );
    }
  }
});
