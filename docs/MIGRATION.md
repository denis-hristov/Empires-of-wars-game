# Migration audit and verification

## Original architecture

SFML dependencies were confined to `Renderer.hpp`, `Renderer.cpp` and `main.cpp`. `Config`, `World`, `Game`, `Battle` and the save validators already held the authoritative rules. The two portability barriers were configuration file loading and disk operations embedded in `Save.cpp`. These are now separate native adapters.

## Feature mapping

| Original feature | New surface | Authority |
| --- | --- | --- |
| Deterministic island | Pixi terrain and camera | C++ world generator |
| Ten buildings and terrain restrictions | Construction cards, ghost and inspector | `place`, `canPlace` |
| Relocation and upgrades | Inspector actions | C++ validation |
| Five resources, local caps and collect | HUD and storage card | C++ simulation |
| Housing and settlement | HUD and House inspector | C++ population rules |
| Training and blocked deployment | Barracks/Harbor/Air Base panels and queue | C++ queue processing |
| Technologies and unlocks | Academy inspector and Research tab | C++ research rules |
| Movement domains | Sprite selection and tile input | C++ path checks |
| Turn-based expedition and enemy AI | Tactical map, squad, end turn | C++ battle model |
| Victory, casualties and captives | Results and reward claim | C++, exactly-once rewards |
| Save/load and backup | Game menu, autosave, storage adapters | C++ codec and validation |

## New runtime

The core builds without SFML, filesystems or a browser UI. The WebAssembly artifact is compiled with filesystem and dynamic JavaScript execution disabled. Both React browser and Tauri desktop use this same artifact. The desktop shell does not maintain a second simulation implementation.

The Pixi CSP polyfill provides shader synchronization without dynamic `eval`; the desktop CSP does not grant JavaScript unsafe-eval. WASM compilation is explicitly allowed. Filesystem capabilities cover only app-local data and files explicitly selected through the native dialog.

The visual layer includes original SVG sprites, depth sorting, exact diamond picking, drag/keyboard pan selection, wheel/pinch zoom, placement ghosts, unit interpolation, health bars, C++-computed movement/attack highlights and responsive panels. React and Pixi lifecycles release the engine, listeners, observers and canvas.

## Verification record

- Original 33 C++ rule scenarios pass.
- Additional native facade checks pass: input validation, atomic rejection, old save import, 64-bit IDs, checksum, translated metadata and unchanged balance.
- Nine Node tests instantiate the actual generated WASM module, not mocks. They cover invalid commands, legacy save round trips, different timer cadences, construction/collect/train/battle, backup recovery, disposal, coordinate picking, exact native/WASM parity and a complete victory with exactly-once rewards.
- Browser manual checks: startup, resource collection, house construction, native-save import, battle selection/movement/attack, responsive 476px and 1440px layouts. No runtime warnings/errors after fixes.
- macOS checks: launch, Pixi rendering under CSP, resource collection, explicit save, automatic load, native file export and import of an original active-battle save. Exported desktop save successfully imported into browser with matching resources.
- Production offline worker checks validate all cached assets plus navigation, WASM and configuration responses with networking unavailable. The embedded browser reported OFFLINE READY, but its forced reload with the local server stopped produced a blank page. This embedded-browser limitation remains documented; ordinary-browser offline navigation still needs a separate manual check.
- Classic SFML edition still compiles with the translated interface.

## Remaining platform work

Windows and Intel macOS were not executed locally. The Windows/macOS CI workflow is provided for repeatable packaging, but its runs are not claimed as completed. macOS signing/notarization and public web hosting are outside this local release.

Original GDD and incoming update reference documents are preserved in their original language. This audit and the README describe the delivered English edition.
