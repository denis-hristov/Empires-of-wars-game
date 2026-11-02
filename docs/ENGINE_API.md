# Engine API 1

`Engine` owns one C++ `Game`. Embind exposes the same facade used by the native parity tests. JavaScript must call `delete()` on an Embind object when disposing it; `GameEngine.dispose()` does this and is idempotent.

## Methods

| Method | Input | Result |
| --- | --- | --- |
| `version()` | none | JSON string: api 1, schema 1, engine 0.4.0 |
| `init(config)` | JSON configuration string | Command result |
| `dispatch(action)` | JSON string `{type,payload}` | Command result or query data |
| `getState()` | none | Dynamic state JSON, string entity IDs, C++ eligibility checks |
| `getWorld()` | none | Width, height, seed, generatorVersion and flat terrain array |
| `tick(ms)` | Integer 0..250 | Command result; C++ advances fixed 50ms steps |
| `save()` | none | Opaque, checksummed schema-1 save string |
| `load(bytes)` | Original save string | Command result; failed loads are atomic |

Command results have `ok`, `code`, `message` and `stateRevision`. Unknown commands and malformed inputs return explicit errors. Never coerce entity IDs to JavaScript numbers. Enemy battle IDs can exceed the safe integer range. Never parse and reserialize a save in JavaScript: doing so loses 64-bit precision and invalidates its checksum.

## Commands

| Type | Payload |
| --- | --- |
| `CAN_BUILD` | `buildingType`, integer `x`, `y`; optional string `id` for relocation |
| `CAN_MOVE_UNIT` | string unit `id`, integer `x`, `y`; checks the full footprint, terrain, occupancy and reachable path without moving the unit |
| `BUILD` | `buildingType`, `x`, `y` |
| `MOVE_BUILDING`, `MOVE_UNIT` | string `id`, `x`, `y` |
| `UPGRADE`, `COLLECT` | string `id` |
| `DISMISS_UNIT` | string unit `id`; removes one land, naval or air unit, frees its full footprint and population, and grants exactly 20 gold once. Rejects battles, missing units, loaded carriers and a full gold stockpile without mutation. Embarked and reserve units may be dismissed. |
| `CLEAR_TREE` | integer `x`, `y`; removes an unoccupied forest tile for 20 coins and grants 20 wood. Rejected during battles. Refresh `getWorld()` after success. |
| `TRAIN` | string building `id`, `unitType` |
| `CANCEL_TRAINING` | string building `id`, integer queue `index`; refund and reservation release are applied once |
| `EMBARK_AIRCRAFT` | string aircraft `id`, string `carrier`; validates living units, tier, capacity and exclusive assignment |
| `DISEMBARK_AIRCRAFT` | string aircraft `id`; requires a free deployment tile at the original Air Base |
| `RESEARCH` | string academy `id`, `technology` |
| `NEW_GAME` | unsigned 32-bit integer `seed` |
| `BATTLE_START` | Optional `unitIds`: distinct living unit ID strings, at most 5 per domain (up to 15 total). Rounds follow land, naval, air; unselected domains are skipped. Omit to select the first 5 living units in each domain. Optional `automatic` defaults to false. Invalid selections are atomic. |
| `BATTLE_AUTO`, `BATTLE_PAUSE`, `BATTLE_FINISH` | none |
| `BATTLE_ATTACK` | string fighter `id`, string `target`; a living enemy in the current phase that the unit can target with its weapons and detection. Each friendly unit attacks once, only on the friendly turn. |
| `BATTLE_OPTIONS` | string fighter `id`; returns empty `moves` and string `targets` for valid weapon targets when the unit can act |

`CAN_BUILD`, `CAN_MOVE_UNIT` and `BATTLE_OPTIONS` do not mutate the game. Preview eligibility is advisory: the final command always revalidates. The C++ snapshot supplies production rates/capacities, footprints, housing, population, upgrade eligibility, training requirements and research eligibility. React formats these values without implementing game formulas.

## Serialization boundary

`Save.cpp` validates, encodes and decodes in memory. `SaveFile.cpp` handles Classic native disk writes and backup recovery. Browser and desktop adapters store the original string untouched. Translation compatibility removes only names/descriptions and the balance-status annotation before comparing saved and current configuration; gameplay fields remain strict except for the recognized previous housing balance. Those saves retain their saved housing rules and population. The engine separately retains the current startup configuration so NEW_GAME always uses the latest layout and capacities.

Optional `clearedTrees` position arrays preserve tree removal before buildings and units are restored. Older saves without this field remain supported. New games reset cleared terrain.

The original save format has no explicit application-brand field and is still schema 1. No schema migration is required for the English edition.

`BATTLE_AUTO` toggles automatic target selection for the player. Every living unit attacks once per side's turn. The turn passes automatically after the last available unit acts. Enemy attacks always run through `tick`, one unit every 1000 ms; friendly automatic attacks use the same pacing. Disabling automatic play does not skip or immediately execute an enemy turn. `BATTLE_PAUSE` pauses or resumes either side. Used attacks remain spent when changing control modes. `BATTLE_MOVE` and `BATTLE_END_TURN` are retired and return explicit errors without mutation.

The arena renderer uses fixed formations and direct enemy targeting; positions and range are retained as legacy saved metadata and do not restrict arena attacks. Combat version 3 retains each unit's used action and the remaining attack delay. Versions 1 and 2 migrate without replaying friendly actions; an exhausted legacy friendly squad yields to the enemy.

`getState().battle` contains the active domain fighters only, ordered `phases`, `phaseIndex`, completed `outcomes` (1 win, 0 loss, -1 stalemate), `domain`, `round` (turn pair within this domain), `automatic`, `enemyTurn` (next side), `paused`, and `lastAttacks` with exact string IDs. `battleUnitLimit` is the current per-domain selection cap. Saves retain every domain roster and the partial clock; legacy land battles remain manual and loadable.

Every selected domain is played. Winning more domain rounds than losing gives one expedition reward; equal wins and losses produce a draw with no reward. All selected casualties are applied on return home. Island production stays paused throughout the expedition.

## Military catalog and combat version 4

`BATTLE_START` accepts optional `airMissions: [{id, phase}]`, where `phase` is `land`, `naval` or `air`. Assignments must reference selected independent aircraft with weapons for that category. The five-unit limit applies to the assigned phase. Carried aircraft join their selected carrier automatically and do not consume independent selection slots. A plane cannot appear in two phases.

Unit state adds nullable string `carrier`, boolean `reserve`, `carrierSlots`, and `aircraftCount`. Reserved aircraft wait for a deployment tile after a carrier loss with the survival policy enabled. `unitCatalog` exposes the effective definitions, including preserved legacy crew values.

Fighters distinguish physical `domain` from battle `phase`. `getState().battle.fighters` includes only the active phase, including carrier aircraft and assigned air support. Each fighter exposes authoritative `validTargets` ID strings, current `shield`, `readyRound`, `strikes` and nullable `carrier`. Carrier fighters also expose live aircraft counts and slots.

`lastAttacks` records health `damage`, `shieldDamage` and `missed` for the primary and any area targets. Zero health damage is valid for a miss or fully absorbed hit. With `battle.shieldBreakStopsDamage` enabled, any shield present at the start of a hit protects health for that entire hit, including the hit that breaks the shield. `shieldDamage` records only the shield points actually removed; excess damage is discarded. A later hit can damage health once the shield is zero. With `battle.attacksAlwaysHit` enabled, every legal hit succeeds, including area damage and enemy attacks. With `battle.playerDamageMatchesAttack` enabled, player direct hits equal the fighter's displayed `damage`: target armor, damage multipliers, bursts and first-strike boosts are bypassed. Configured secondary splash percentages still apply. Shield protection and remaining-HP caps apply afterward. Enemy damage calculations are unchanged. Historical saves enable the rule without changing fighter snapshots or prior hit events. Older saves may retain historical `missed` events. Accuracy rolls remain deterministic for legacy rules with guaranteed hits disabled. Dead carriers apply their loss policy immediately; home units and population are reconciled centrally at expedition completion. Units with no legal remaining target or an active cooldown yield their action automatically; mutual inability to attack produces a stalemate.

Historical three-unit configurations are recognized through `militaryMigration`, which is excluded from balance comparison. Only exact historical gameplay definitions or their approved expanded forms are migrated. Building footprints, historical housing, original unit personnel and production timers remain validated. The current startup catalog remains separate for NEW_GAME.

## Shop exchanges

`SHOP_TRADE` takes `{ offerId, quantity, sequence }`. Quantity must be an integer from 1 to 100; sequence must match `getState().shop.sequence`. The engine resolves the offer ID and amounts from its configuration. Successful exchanges atomically transfer both resources and advance the saved sequence; stale or duplicate commands, missing resources, capacity overflow and active battles never mutate the game. `SHOP_OPTIONS` is a read-only query whose `shop.offers[].choices` supplies authoritative totals and eligibility for 1, 5 and 10 offers. Normal snapshots contain only `shop.sequence`; quotes are fetched when the shop opens, so idle state polling remains compact. Prior saves start with sequence zero and unchanged resources.
