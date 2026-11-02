# Empires of wars

An English-language, offline strategy game. Build an island settlement, gather five resources, train soldiers, research technologies and lead turn-based expeditions.

Version 0.4.0 replaces the main interface with React, PixiJS and a WebAssembly build of the original C++ simulation. The browser and Tauri desktop app run exactly the same engine. The original SFML edition remains available as Classic.

## Play

Open **Empires of wars.app** on macOS. The supplied app targets Apple Silicon. No account, server or connection is needed by the desktop game.

The browser build is in `frontend/dist`. Serve this folder over HTTP on localhost or HTTPS; opening `index.html` directly as a file is not supported. Its service worker caches the complete game in the background after the first successful visit. The development server does not install this offline cache. The embedded Codex browser could play locally, but its forced reload did not work with the local server stopped; keep the preview server running there. The standalone desktop app has no such dependency.

A new city starts with a completed level-1 Town Hall, 600 food, 1,000 wood, no stone or iron, and no troops or research. Build a Farm and Lumberyard for resource production and a House for troop population capacity. Click a producing building to collect its local stores and open its action buttons. Collect remains available in the action menu. Food is spent on construction, training and research; troops have no continuous food upkeep. New cities start with zero gold. Gold is earned from victorious battles, dismissing units for 20 gold each and selling resources in Shop; existing saved gold is preserved. Tree clearing and paid-action refunds remain available.

Town Hall, Barracks, Academy, Harbor and Air Base have ten levels. House, Farm, Lumberyard, Stone Mine and Iron Mine have five. Each village has one Town Hall, at most one Academy and at most one Laboratory. Other building types can be built any number of times on suitable free map space. The Academy and Laboratory limits apply from the start of construction, including while upgrading. Existing saved buildings and paid progress remain loadable. Town Hall unlocks the permitted levels; every construction or upgrade must be paid for and completed separately. The centered upgrade menu compares the current and next artwork, benefits, costs, available resources and unmet prerequisites before confirmation. Existing and new villages can keep adding unlocked building types. Each building has its own level, upgrade timer, stores and training queue. Completed Houses add their army capacity together.

Build your army, then open Attack and select up to five units for each land, sea and air round. Empty rounds are skipped. Choose a friendly unit, then click the enemy it should attack. Each living unit attacks once; after all available units act, the turn passes automatically. Enemy units attack one at a time, independently choosing a random living target they can hit before each attack. The same target may be chosen again. Auto attack chooses targets for your army. Space pauses or resumes either side; pause buttons are omitted from the island and battle controls. Every selected round is played; win more rounds than the enemy to receive one expedition reward. A draw gives no reward.

| Action | Controls |
| --- | --- |
| Select map object | Click its sprite or occupied tile to show its action buttons |
| Build | Bottom-right Build button → building card → valid tile |
| Move building | Select building → Move → valid tile |
| Move soldier | Select soldier → Move → reachable clear destination |
| Pan / zoom | Drag / scroll, or map buttons |
| Touch | Drag / pinch; tap an object for its action buttons |
| Keyboard map navigation | Focus map, arrow keys, Enter |
| Collect | Click a producing building with stored resources, press Collect, or C |
| Upgrade / info / train | Select object → corresponding button → centered dialog |
| Save / load | F5 / F9 or Settings |
| Cancel placement | Esc |
| Pause or resume battle | Space |

The map fills the entire window. Resources and population are stacked at the top right. Build and Settings are at the bottom right; Attack and squad selection are at the bottom left. Overview, army, research, activity and camera controls are at the top left. Panels can be closed with their close button or Esc. Selecting a building to construct closes the menu so you can place it on the map. Every building, unit, tree and rock has context actions fixed at the bottom center of the screen. Only relevant actions appear: Info, Upgrade, Collect, Train, Research, Move, carrier aircraft management or Clear. Clicking a producing building collects its stored resources while opening its actions. Empty stores produce no collection command or notification. Upgrade previews remain accessible when resources or prerequisites are missing, with confirmation disabled until the engine permits it. Dialogs support Escape, outside clicks and keyboard focus navigation.

Select a tree on the map, choose **Clear** and confirm to spend 20 gold and receive 20 wood. The tile becomes buildable grass. Occupied trees cannot be removed, and cleared trees stay removed in saved games. Trees and rocks both have an Info action; rocks are permanent mountain terrain.

Town Hall occupies 3 by 3 tiles. All other buildings occupy 2 by 2 tiles. Land unit types 1–3 occupy 1 by 1 tile and types 4–10 occupy 1 by 2. Ships use 1 by 1 at tiers 1–2, 1 by 2 at tiers 3–6 and 1 by 3 at tiers 7–10. Aircraft use 2 by 2 at tiers 1–6 and 2 by 3 at tiers 7–10, regardless of research level. Trees and rocks occupy one tile each. Every occupied unit cell participates in placement, movement and deployment checks. Moving a unit previews the same rules as the actual move: reachable clear destinations are green, while invalid terrain, occupied cells and blocked paths are red. Hover previews never move troops or change the save. Building artwork starts at half its previous size and grows by 5% of its current size on each completed upgrade. Building and army ground centers align with the occupied ground area; construction and movement previews use the same placement. Occupied tile footprints remain unchanged. Older saves expand building and unit footprints, moving overlapping entities to the nearest valid free position while preserving IDs and progress. If no legal space exists for an expanded unit, it waits for deployment until space is available. Embarked aircraft occupy no map cells. Battle formations keep their existing slots.

## World generation

New worlds use generator version 2. Each seed selects an irregular island, a peninsula connected to a map edge, an archipelago, or mainland crossed by a winding river. Multiple scales of smooth, warped noise vary coastlines and terrain. The central 5 by 5 tiles always remain buildable grass for the starting settlement. Identical seeds and configuration reproduce identical maps in native and WebAssembly builds.

Version 1 saves retain their original terrain when loaded and saved again. Starting a new game after loading one uses the current generator.

## Saves and compatibility

The browser stores opaque save strings in IndexedDB, with a backup in the same transaction. Desktop saves use two files and an atomically replaced active-slot pointer in the app's local data directory. On macOS this is `~/Library/Application Support/studio.empiresofwars.game/`.

Use **Settings → Export save / Import save** to transfer progress. Native file dialogs authorize only the chosen external files; normal game storage is scoped to the app directory.

Classic schema-1 saves are accepted, including active battles. Import the old `kingdom.save.json` from `~/Library/Application Support/GameKingdom/` on macOS. English names and descriptions do not invalidate these saves; altered numeric rules or balance still do. Save checksums are verified in C++ before replacement. Failed imports leave the running game untouched. If the current save is invalid, a valid backup is restored. If both fail, autosave is suspended to preserve the files.

Known earlier saves migrate to the new building progression while preserving buildings, troops, queues, resources and active battles. Existing troops and paid training remain intact when housing is rebalanced; an army above the new capacity can keep fighting, but new training requires enough completed housing. New games always use the new Town Hall-only start and troop population rules.

Classic intentionally keeps its old save directory. Internal `kingdom` namespaces and JSON IDs also remain stable for compatibility. The game-facing branding is **Empires of wars**.

## Updating artwork

Replace artwork in `frontend/public/assets/sprites`, then run `npm run update:visuals` from the project directory. On macOS this rebuilds the app and refreshes the playable copy next to the project folder. Close and reopen the game afterward. Browser development uses `npm run dev`; reload after replacing images. Do not run `generate-art.js` after installing custom artwork because it recreates the original sprites.

The 75 supplied building level illustrations are bundled under `frontend/public/assets/buildings` as their original PNG payloads, extracted losslessly from the supplied SVG containers. `BuildingSpriteArt.js` maps every building and completed level to artwork and ground coordinates. The map loads level variants as needed and the inspector uses the same mapping. During an upgrade the completed level remains visible until the next level finishes. The supplied construction_barrier artwork sits in front of each upgrading building, follows its completed size and disappears when the upgrade timer finishes. The countdown stays visible above upgrading producers even when they have stored resources. The barrier is visual and does not change map occupancy or placement rules. `SpriteAssets.js` also maps the military artwork and decorations. `SpriteLayout.js` scales from the actual texture dimensions and preserves each object's tile footprint. Artwork with a different ground plane may need its ground coordinates updated in the mapping. Export images with a transparent background to avoid a visible rectangle over the terrain.

## Development

Requirements: Node.js 22.12 or newer, npm, CMake 3.24+, a C++20 compiler and Emscripten 4.0.15. Tauri additionally needs Rust and the platform's native development tools. All application code is JavaScript/JSX, not TypeScript.

```sh
npm ci
bash scripts/setup-wasm.sh
npm run build:wasm
npm run dev
```

The setup script installs the pinned SDK under `.tools/emsdk`. If it is already installed elsewhere, set `EMSDK` to that directory. Set `CMAKE` if CMake is not on PATH.

```sh
# Native simulation and tests, without SFML
cmake -S . -B build-core -DCMAKE_BUILD_TYPE=Release
cmake --build build-core --parallel
ctest --test-dir build-core --output-on-failure

# Real WASM contract, parity and full-battle tests
npm test

# Browser release, including an offline cache
npm run build
npm run test:offline
npm run preview

# Desktop development / release
npm run desktop:dev
npm run desktop:build

# Windows installer on a configured Windows machine
npm run desktop:build -- --bundles nsis

# Optional preserved Classic edition
cmake -S . -B build-classic -DEMPIRES_BUILD_CLASSIC=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-classic --parallel
```

`npm test` uses the native `build-core/parity_snapshot` executable and the generated WASM bundle. Build both first. The included CI workflow does this on Linux, then packages macOS and Windows. The local Windows build has not been verified in this macOS environment.

## Project layout

- `include/kingdom`, `src`: portable rules, deterministic world generation and validated save codec.
- `src/Engine.cpp`: JSON facade; no SFML or storage dependency.
- `src/SaveFile.cpp`, `src/ConfigFile.cpp`: Classic filesystem adapters.
- `engine/bindings`: Embind bindings.
- `frontend/src/engine`: lifecycle-managed WASM adapter.
- `frontend/src/game`: Pixi rendering, picking and camera.
- `frontend/src/components`: React game panels.
- `frontend/src/storage`: IndexedDB, Tauri and transfer adapters.
- `frontend/public/assets`: original SVG artwork and locally bundled font.
- `src-tauri`: thin desktop shell, permissions and icons.
- `config/game.json`: all balance values and English content.
- `tests`, `frontend/tests`: native and real-WASM checks.
- `docs/MIGRATION.md`, `docs/ENGINE_API.md`: audit and interface notes.

The original Bulgarian design document and the supplied `New_update` reference files remain unchanged as source material. Active UI, configuration, errors and development documentation are English.

## Scope and current limits

All ten buildings, construction and upgrades, resource production/storage, population, training queues, research, naval/air units and expeditions across land, sea and air are available. The military catalog contains thirty provisional unit definitions, with ten tiers each for Barracks, Harbor and Air Base. Town Hall, military buildings and Academy progress through ten levels, with five levels for economic buildings and House. Building costs, research and Town Hall prerequisites follow `building-progression-spec-bg.txt` supplied alongside the project. The latest production balance uses the intervals described below. Timings, training costs and combat statistics remain provisional where the specification leaves them open.

Expeditions use opposing fixed formations on the supplied illustrated arenas, with direct target selection and no grid movement or attack-distance restriction. Ships fight in the sea round. Independent aircraft can fly air patrols or be assigned to land or sea support in the expedition menu. Weapon target restrictions apply in every arena. There is no multiplayer, audio or offline-time production. The simulation stops while the app is hidden or a menu is open, and island timers stop during battle. Delays are capped to avoid large catch-up jumps.

macOS Apple Silicon and browser versions were built and exercised locally. The app is an ad-hoc signed local development release, without a Developer ID certificate or notarization. Windows packaging is configured but still needs execution and testing on Windows.

## Assets and licenses

The SVG artwork is original project artwork. Noto Sans is bundled with its OFL license. nlohmann/json is vendored under its MIT license in `third_party/json`. React, PixiJS, Vite and Tauri remain governed by their included licenses. No images, fonts or scripts are loaded from a CDN at runtime.

Arena SVGs are bundled in `frontend/public/assets/arenas`. When the sibling `teren_for_battle` directory is present, development and release builds copy its ground, lake and sky arena files automatically. The bundled copies keep standalone builds and offline play working.

## Military units

Military building level N unlocks every unit from tier 1 through N. Earlier types remain trainable after every upgrade. Each building shows all unlocked units together, with a count; future tiers appear under Next unlocks. Every card includes its role, stats, abilities, resource costs, training time and explicit requirements. Town Hall adds 5 population places per completed level, from 5 at level 1 to 50 at level 10. Each completed House contributes 2, 5, 10, 15 or 20 places at levels 1–5. These contributions are totals per building and add together. Town Hall upgrades to levels 2–10 require combined completed housing of 50, 100, 150, 200, 300, 400, 550, 700 and 850 respectively, alongside the existing building and resource prerequisites. Army losses and training reservations do not reduce this upgrade requirement total. Training reserves capacity immediately; completing training converts that reservation into army population. One click on Train starts a unit immediately in Barracks, Harbor and Air Base. Each building can train one unit at a time; separate buildings train independently. Completing or cancelling that task frees its slot. A finished unit waiting for deployment space still occupies its building’s slot. On migration, the first existing task keeps its paid resources and remaining time; extra queued tasks are cancelled with their exact resource payments refunded. The first three land squads each use four population but remain one unit with one ID and one health pool. Cancelling a queued or deployment-blocked task refunds its cost and releases its reservation once.

Select a Light Aircraft Carrier or Titan Carrier from the army list to board or unload previously trained tier 1–3 aircraft. They have two and four slots respectively. Embarked aircraft leave their independent map position and cannot be selected for another mission. They fight as separate aircraft in the carrier's sea round; the default loss policy destroys them immediately if their carrier sinks. Set `battle.destroyEmbarkedAircraft` to false to return surviving aircraft to Air Base reserve after a carrier loss.

`config/game.json` is the balance registry for all thirty types, target categories, armor classes, damage multipliers, shields, evasion, detection, area damage, periodic bursts, turn cooldowns, costs and crew. `attackCooldown` is measured in turn pairs. `range` remains descriptive for direct arena targeting and limits no single-target attacks; area attacks affect up to `splashTargets` additional valid targets within two formation cells. Military building level alone unlocks each unit type. Academy research is independent for each of the thirty types, starts at zero and uses one city-wide queue. For every land, sea and air type, its research cap is max(0, completed Academy level minus unit unlock tier plus one), plus one extra level for every completed Academy level from max(7, unit unlock tier) onward. Academy levels 7, 8, 9 and 10 each unlock two paid improvements per available unit type. Barracks, Harbor or Air Base must also unlock that unit type. Research advances one paid level at a time. At Academy 3, types 1, 2 and 3 can reach research 3, 2 and 1 respectively. At Academy 7, types 1 through 7 can reach research 8, 7, 6, 5, 4, 3 and 2. At Academy 10, the ten types in each domain have maximum research levels 14, 13, 12, 11, 10, 9, 8, 6, 4 and 2. Every research level multiplies accumulated attack and health by 1.05, up to the cap for that unit type. Recruit Squad and support-unit healing, Heavy Infantry shields and Attack Submarine shields are calculated from the resulting maximum health. Other player shields gain the same cumulative 5% research multiplier. Area and special attack damage use the improved attack; their targeting and ability percentages stay the same. Enemy shields do not receive player research bonuses. Type 1 can reach about +97.99% at research 14 and type 10 can reach +10.25% at research 2. Integer stats are rounded down only after computing the full accumulated multiplier. The bonus applies to current and future troops of that type. Training cards show each base HP/Attack value, the exact integer research bonus and the resulting total.

All thirty military types use their own supplied transparent artwork from the sibling `new_trups/land`, `new_trups/sea` and `new_trups/air` folders. Bundled SVG copies live in `frontend/public/assets/sprites`. `frontend/src/game/UnitSpriteArt.js` maps stable unit IDs to filenames, canvas dimensions, visible bounds, ground anchors and facing directions. The map, training cards, army list and battle arenas use this artwork. Arena sizing preserves proportions and turns both armies toward their opponents. On the island map, artwork is centered on the full unit footprint; clicking any occupied cell of a large unit selects it.

Artwork overrides are kept separate from the gameplay registry so existing save checksums and configuration compatibility remain intact. Unit IDs, statistics and training rules are unchanged. To replace an illustration, update its bundled SVG and its entry in `UnitSpriteArt.js`, then run `npm run update:visuals`. Advanced animation remains deferred.

Known historical saves migrate to the expanded catalog and building progression, preserving existing troops, the active training task and active battles. Extra tasks from the old training queue are refunded during migration. New games always use the new catalog balance. Unknown gameplay changes are still rejected. Combat version 6 preserves aircraft assignments, phase membership, shields, healing events, used actions, cooldowns and burst counters.

## Building progression

Town Hall 2 unlocks Academy; Town Hall 3 unlocks Stone Mine; Town Hall 4 unlocks Harbor; Town Hall 5 unlocks Iron Mine; Town Hall 6 unlocks Air Base. Economic caps reach level 4 at Town Hall 8 and level 5 at Town Hall 9. Unlocking never grants a free building or level.

To reach the next Town Hall level, finish Barracks at the current Town Hall level and Farm/Lumberyard at their current allowed cap. Reaching Town Hall 4 also requires Stone Mine 2; reaching Town Hall 6 requires Iron Mine 2. Academy, Harbor, Air Base and House are optional for Town Hall progression.

Farm, Lumberyard, Stone Mine and Iron Mine each produce one of their own resource every 6, 4, 3, 2 or 1 seconds at levels 1–5. This shortens the six-second starting interval by 33% per upgrade, rounded to whole seconds, and gives hourly totals of 600, 900, 1,200, 1,800 and 3,600 before local storage fills. The inspector shows the exact interval. Storage capacity, construction/training durations, deployment and refunds retain their existing behavior. Gold is earned from victories or by dismissing an existing unit for 20 gold. Upgrade menus with insufficient gold show the missing amount and a shortcut to the battle menu.

To reimport the supplied building artwork, run `node scripts/import-building-art.js /path/to/new_buildings`, then rebuild the browser and desktop app. Source illustrations remain unchanged.

Research rules version 2 records the tier-based caps in saves. Research already paid for under the earlier rules, including a paid project still in progress, is preserved explicitly. Preserved research retains its existing troop bonuses, while every new research command follows the new cap. New saves validate completed and queued research against the per-unit cap or their recorded paid legacy level. Upgrading an Academy changes caps only and never grants research automatically. Academy research expansion version 1 preserves existing completed levels, paid queues, resources, wounds and active battles while unlocking the additional levels. Existing costs for research 1 through 10 are preserved; base costs double at each added research level from 11 through 14. Research durations are unchanged.

### Military map sizes

Land troops retain their existing footprints. Recruit Squad and Infantry Squad, unlocked at Barracks levels 1 and 2, render at 62.5% of their original island-map size, a 25% increase over the reduced size, while keeping the same centered ground anchors and occupied cells. Ships from tiers 1–2 occupy 1×1 tiles, tiers 3–6 occupy 1×2 and tiers 7–10 occupy 1×3. Aircraft from tiers 1–6 occupy 2×2 tiles and tiers 7–10 occupy 2×3. These sizes depend on the unit’s unlock tier, not its Academy research. Artwork is centered over the whole footprint; ships and aircraft scale with their occupied area. Aircraft artwork on the island map is displayed at half its previous size across all ten tiers, centered over the same occupied cells. Every cell must be valid and free for movement, deployment and unloading. Existing troops retain their IDs, source, health and battle state; expanded units move to the nearest legal space or wait in reserve if the map is full.

Select a land, naval or air unit and choose Dismiss to review the 20-gold payment and freed population, then confirm. Unit information also offers dismissal for embarked and reserve troops. Each dismissal removes one complete unit or squad, clears its occupied tiles, releases its personnel and credits 20 gold once. Loaded carriers must unload their aircraft first. Dismissal is unavailable during a battle.

## Battle campaign

Attack opens the campaign of 150 battles and 474 ordered rounds from `Game_Kingdom_150_Battle_Levels_Specification.txt`. Each round uses its exact enemy slots and supplied artwork. Choose the complete army before starting: 1–5 living, independent troops for each required land, naval or air domain. Auto select chooses up to five strongest available troops in each required domain. The committed army cannot change during the level. Round victories automatically send the surviving selected troops into the next round; casualties are never replaced from the island. Loaded aircraft remain with their carrier on the island.

Every round must be won. Defeat, a stalemate or retreat ends the attempt without advancing the campaign. Claiming a victory applies that level's configured resources once for the attempt and unlocks the next level when its Town Hall requirement is met. Attack follows the current campaign level automatically and shows its round count and required troop domains. Existing saves start the new campaign at level 1 and retain their island and army. New saves preserve progress, the committed army and the exact state of an active battle.

Town Hall campaign ranges are 1: 1–10, 2: 11–20, 3: 21–30, 4: 31–40, 5: 41–50, 6: 51–65, 7: 66–80, 8: 81–100, 9: 101–125 and 10: 126–150. Levels must still be won in order. Harbor unlocks at Town Hall 4. Levels 28–30 contain only their existing land rounds, so ships first become necessary at level 31. The optional per-level `enemyTH` retains the original enemy scaling when an unlock boundary changes.

Victory rewards for levels 1–20 contain no stone or iron; levels 21–50 contain no iron. Other reward amounts remain configured per level. Campaign progression version 1 loads older saves with their existing resources, completed levels and battle state intact. Pending victory claims use the updated reward table, with no retroactive changes to rewards already claimed.

The engine accepts `BATTLE_START` with `{ campaign: true, campaignLevel, unitIds }` and `BATTLE_RETREAT`. `BATTLE_DEPLOY` rejects changes to a committed campaign army. Existing expedition commands remain compatible. Enemy stat scaling follows the specification's provisional formula; difficulty can be tuned after playtesting.

`frontend/tests/campaign-data.test.js` checks every enemy slot against the supplied specification, all 60 illustrations, unique AI encounters and the final boss roster. `frontend/tests/campaign-engine.test.js` checks progression, loss, rewards, Town Hall locks, deployment, save/resume and all 15 final rounds.


## Interface performance

State polling sends dynamic campaign progress without resending the complete level and enemy definitions. Upgrade and research previews use read-only eligibility checks shared with the corresponding actions. Island terrain and decorations rebuild when world data changes, while normal state updates, selection and pointer movement reuse the existing scenery. Manual or paused battles do not request identical snapshots repeatedly.

Run `node scripts/benchmark-state.js` to measure the WebAssembly snapshot cost for a new island and the bundled army fixture. On the development machine, the army snapshot dropped from about 67 ms to 1.2 ms after removing repeated full-game copies; this measures snapshot preparation, rather than overall frame rate.


Research bonus version 2 stores the accumulated 5% formula independently of the Academy tier-cap rules. Older linear-bonus saves retain their paid research, queued projects and resources. Existing troop health and friendly battle snapshots receive the difference between their old and new researched maximum, preserving damage already taken. A migrated save records the new bonus version so loading it again does not add that difference twice.


## Unit support abilities

After the enemy side completes its attacks, each living Recruit Squad in the current arena restores health equal to 50% of its own maximum HP. A wounded Recruit heals itself; a Recruit already at full HP heals a wounded ally, preferring the lowest remaining health percentage. Healing is capped at the target's maximum and never revives a fallen unit. A round still contested after 200 turn pairs ends in a stalemate, preventing recovery from creating an endless fight; a campaign stalemate ends the attempt without rewards.

Heavy Infantry starts combat with a shield equal to 50% of its maximum HP. Attack Submarine starts with a shield equal to 100% of its maximum HP. These shields absorb damage before HP and grow with Academy research. Their remaining shield carries between campaign rounds without refreshing.

Armored Jeep has 48 base attack, reduced from 65 with integer rounding, and hits every valid enemy ground unit in the current round with one action. Its area attack has no formation-distance limit and retains the existing weapon target restrictions.

Select a Frigate and use Attack to target an enemy ship, or Heal ally to restore a chosen wounded friendly troop in the same arena, including the Frigate itself. Healing restores up to 45% of the Frigate's researched maximum HP and consumes its action in place of attacking. Automatic control chooses between repair and attack while maintaining offensive progress. Academy research previews and unit cards show the resulting healing and shield values.

`BATTLE_HEAL` accepts `{ id, target }` decimal-string IDs. Battle fighters expose `validHealTargets`, `healing` and `maxShield`; `BATTLE_OPTIONS` includes `healTargets`. Battle hit events include `healing` for recovery effects. Combat version 6 preserves recovery events, depleted shields and spent actions. Known saves from before these abilities migrate once while retaining wounds, research and ongoing battle progress.

Enemy base attack uses 75% through `battle.enemyAttackPercent`, which is 50% stronger than the previous 50% balance. The additional enemy stat multiplier described below applies afterward. This applies after the existing difficulty scaling to all land, sea and air opponents, including ordinary campaign troops, bosses and AI encounters. Integer attack is rounded down with a minimum of one. These earlier attack-only migrations are applied once and preserve troop health, armor and shields.

`battle.enemySingleTarget` makes each enemy attack hit only its chosen target, including enemy units whose normal weapons have splash or all-target attacks. Player area attacks keep their existing behavior. Old active 50% enemy-attack saves gain 50% attack once in this migration and retain their spent actions and battle clock.

`battle.enemyStatPercent` applies a further 90% multiplier to the current enemy maximum HP and attack, after the existing attack and difficulty scaling. This reduces both statistics by 10% for all enemy domains and encounter kinds. Living units keep at least one HP and attack point; dead units remain dead. Existing active saves apply this change once, keeping the same health percentage approximately after integer rounding. Shields tied to maximum HP use the reduced capacity while preserving damage already absorbed. Player statistics and the single-target enemy attack policy are preserved.

`battle.enemyStatPasses` is now 2. Each pass applies the 90% health and attack multiplier with integer rounding, so the second pass reduces the previous version's current enemy statistics by another 10%. The combined multiplier is about 81% before rounding. Missing pass counts in previous saves mean one pass; loading those saves applies only the newly added pass once and preserves combat progress.

`battle.enemyStatAdjustments` now contains `[85]`. Each adjustment is applied after the existing health and attack reductions, rounding down with a minimum of one. This additional step lowers the last version's enemy HP and attack by 15% across all domains, ordinary opponents, bosses and AI encounters. Old saves apply only previously missing adjustment steps once, preserving wounds, shield damage, spent actions and results. Player unit statistics and single-target enemy attacks keep their existing rules.


Shield breaking protection

`battle.shieldBreakStopsDamage` prevents excess damage from passing through a shield on the hit that breaks it. Even one remaining shield point protects all health for that hit; later hits can damage health after the shield reaches zero. This applies separately to each primary or area target and to both armies. Existing saves retain their wounds, remaining shields and attack logs when the rule is enabled.


Guaranteed hits and level 58

`battle.attacksAlwaysHit` makes every legal player and enemy attack hit; armor, shields, cooldowns and target restrictions still apply. Campaign army selection ignores accuracy bonuses and penalties under this rule. Level 58 applies an 81% attack factor to AI-W2 before the global enemy balance factors, resulting in 257 attack and the existing 3381 maximum HP. Old saves update this enemy's attack while retaining wounds, shields, turns and army progress.


Player damage matches Attack

`battle.playerDamageMatchesAttack` makes every player troop's direct hit use its displayed, researched Attack. Enemy armor, target-specific multipliers, burst bonuses and first-strike bonuses do not alter these hits. Shields retain their whole-hit protection, actual HP damage is capped by remaining health, and secondary splash keeps its configured percentage. All-target attacks still hit each target at full attack. Enemy attacks keep their existing rules. Historical saves retain all battle state and enable the new rule for future player hits. Training and Academy cards explain this behavior and include existing legacy technology attack bonuses in their displayed attack totals.

## Laboratory and potions

One optional Laboratory occupies 2 by 2 island tiles. Town Hall 6 unlocks Laboratory 1; Town Hall 7, 8 and 9 allow manual upgrades to Laboratory 2, 3 and 4. Construction and the three upgrades use the Barracks costs and durations for reaching levels 6, 7, 8 and 9 respectively: 48, 56, 64 and 72 seconds. No level or building is granted automatically.

The Potions action opens production and storage. Healing, Shield, Double attack and Revival unlock at the corresponding completed Laboratory levels and cost 100, 150, 200 and 300 gold. Production currently completes instantly. Production durations remain configurable through `magic.potions[].seconds`; `magic.productionTimingPending` records that production timing has not been balanced. Ready potions and queued potions share five storage spaces, with any mix or five copies of one unlocked type. The four building illustrations and four spell illustrations are extracted from the supplied SVG files without changing their original PNG pixels. Reimport them with `node scripts/import-magic-art.js /path/to/Game_Kingdom_Magic_Assets_SVG`.

The Laboratory also offers Remove for each potion type. Confirming removes exactly one ready potion, frees one storage space and credits 20 gold regardless of its brewing price. Cancel leaves inventory and resources unchanged. Removal is unavailable during battles, for empty ready inventory, or when the gold stockpile cannot accept the refund. Queued production is not removed. Inventory and gold persist together, and a saved sequence rejects duplicate or stale removal commands.

Battle controls show five potion slots and a confirmation with the exact effect and duration. Selection does not spend a potion. Auto attack retains its setting and waits while confirmation is open. Closing, cancelling, stale confirmation tokens and invalid use never consume inventory. Successful use applies an atomic engine command, consumes one potion and leaves the player's unit actions intact. Potions are unavailable while paused, during the opponent's turn or while a combat effect is animating.

Healing restores living allies in the current round to their individual maximum HP without affecting shields. Shield grants each living ally a separate shield that blocks one entire successful hit regardless of its damage, preserving HP and existing shields. The hit consumes only the potion shield; later hits follow normal shield and HP rules. Each primary or area target resolves protection separately, and misses do not consume it. Reusing restores missing potion shields without stacking. This layer ends when depleted or the campaign/expedition round ends. Double attack doubles attack power through the rest of the player's current turn, without granting actions or boosting healing and shields. Revival restores only allies defeated in the current round to the same identity and position at half maximum HP, rounded up, with no shields; their next action is available from the next player turn. Casualties from earlier campaign rounds cannot be revived.

Magic save version 1 stores the Laboratory's completed level, all four potion counts, brewing timers and replay protection sequence. Historical saves gain an unbuilt Laboratory and empty storage. Active effects and already consumed potions survive saving and loading. Confirmation windows are transient and close on reload without restoring spent potions. Temporary effects clear at their specified turn or round boundary.

Native `laboratory_potions` tests cover unlocks, capacity, healing, shields, damage, revival, persistence, production queues and confirmation behavior. `frontend/tests/laboratory-wasm.test.js` verifies the real WebAssembly command boundary, historical saves, costs, exact-once consumption and automatic battle control.


Level 58 AI-W2 has no shield. The round-specific `unshieldedEnemies` rule changes its initial and maximum shield to zero while preserving all health, attack and other combat rules. Campaign shield rules version 1 migrates earlier saves by removing only shield capacity disabled by the configured round. Wounds, actions, turn state, attack logs and campaign progress remain intact, including an already active level 58 battle. Other opponents and player shields retain their usual rules.


Heavy unit attack

`heavyUnitAttackVersion: 1` raises the player's Heavy Tank base attack from 130 to 195 (+50%) and Battleship base attack from 185 to 231 (+25%, rounded down). Research scales the new base attack. Explicit `enemyBaseDamage` values retain the previous enemy attacks. Previous saves apply the researched attack difference once to friendly fighters and the committed campaign army, preserving technology bonuses, wounds, actions, cooldowns and battle results.


Early land campaign version 1 removes the naval rounds from levels 28, 29 and 30 while retaining their land enemies and rewards. Existing attempts preserve completed land rounds and return committed ships with their wounds and casualties. An active removed sea round advances to the next land round or leaves a victory ready to claim; prior defeats remain defeats. Previously paid level-1 Harbors at Town Hall 3 remain loadable, while new Harbor construction requires Town Hall 4.

Level 76 AI-G5 attack adjustment

`campaignFinalAttackVersion: 1` applies `enemyFinalAttackPercents` after all existing campaign attack factors. Only AI-G5 in the land round of level 76 receives 70% of its previous attack: 351 becomes 245, rounded down. Its 6134 maximum HP and all other statistics are preserved. Existing active or finished attempts apply the attack reduction once while preserving wounds, shields, actions, attack logs and campaign progress. Other enemies and rounds are unchanged.

W06 Stealth Submarine attack correction

`enemySubmarineMultiplierVersion: 1` disables `damageMultipliers` only for campaign enemy W06 in every round and level. Its displayed attack no longer gains the Attack Submarine template's hidden 220% bonus against large ships or 150% bonus against armored targets. Torpedo armor penetration, targeting, shields, cooldowns and all base statistics are preserved. Level 76 W06 keeps 1045 maximum HP and 225 Attack; an unshielded target with no armor loses 225 HP. Other enemies and player units retain their existing rules. Old saves gain the corrected rule without changing fighter snapshots, wounds, actions, inventory or historical attack events.

## Shop

Shop sits between Settings and Build at the bottom right. Buy and sell tabs offer food, wood, stone and metal in both directions. The initial offers exchange 100 gold for 1000 food, 1000 wood, 500 stone or 250 metal; selling those same amounts returns 50 gold. Choose one, five or ten offers at a time. Trading is available outside battles and saves immediately. The engine calculates every price, verifies the stockpile and capacity, and rejects stale duplicate trades. Existing saves gain the shop without changing their resources, buildings or battle progress. Exchange rates are configured in `shop.offers`.
