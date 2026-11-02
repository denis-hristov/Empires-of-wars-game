# Empires of wars

An offline strategy game combining city building, resource management, army development and turn-based battles. It brings together mechanics inspired by several strategy games in one campaign.

**Your goal is to defeat level 150.** Grow your settlement, upgrade your Town Hall (TH), unlock stronger buildings and train an army capable of winning the final battle.

## How to play

1. Start with a level 1 Town Hall, food and wood.
2. Build Farms and Lumberyards, collect resources and expand your economy with Stone Mines and Iron Mines.
3. Build Houses to increase population capacity and meet Town Hall upgrade requirements.
4. Upgrade your TH to unlock higher building levels and more advanced troops. The Town Hall has 10 levels.
5. Train land units in Barracks, ships in Harbors and aircraft in Air Bases. There are 30 military unit types across the three domains.
6. Improve your troops through Academy research and prepare potions in the Laboratory.
7. Select your army, fight the campaign battles and advance through all 150 levels.

Battles use turns, direct target selection and separate land, sea and air rounds when a level includes them. Army composition, troop abilities, research and resource planning all affect your progress.

The game interface is in English. The desktop game runs offline without an account or a game server. The browser release supports offline caching after its first complete load. Production and construction do not advance while the game is closed.

## Download and run on Mac or Windows

The commands below download the repository, install its JavaScript dependencies and start the game in your browser. Each operating system has one complete copyable command block. Run only the block for your operating system in a new folder where `Empires-of-wars-game` does not already exist.

Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/en/download) first. Use Node.js 22.12 or newer; npm is included with Node.js. Restart your terminal after installing them.

The repository includes the compiled WebAssembly engine, so this route does not require CMake, Emscripten, Rust or a C++ compiler. Internet access is needed to download the repository and dependencies.

### macOS

Open Terminal and paste the entire block:

```sh
git --version && node --version && npm --version &&
git clone https://github.com/denis-hristov/Empires-of-wars-game.git &&
cd Empires-of-wars-game &&
npm ci &&
npm run dev
```

### Windows

Open PowerShell and paste the entire block. `npm.cmd` works with the usual PowerShell script restrictions, so no execution-policy change is needed.

```powershell
$ErrorActionPreference = 'Stop'
git --version
if ($LASTEXITCODE -ne 0) { throw 'Install Git, then restart PowerShell.' }
node --version
if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22.12 or newer, then restart PowerShell.' }
npm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'npm is required. Reinstall Node.js, then restart PowerShell.' }
git clone https://github.com/denis-hristov/Empires-of-wars-game.git
if ($LASTEXITCODE -ne 0) { throw 'Repository download failed.' }
Set-Location Empires-of-wars-game
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
npm.cmd run dev
```

When the server starts, open **[http://127.0.0.1:1420](http://127.0.0.1:1420)**. Keep the terminal open while playing; press Ctrl+C to stop it. This development server does not install the offline browser cache.

To play again later, open a terminal inside the downloaded `Empires-of-wars-game` folder and run `npm run dev` on Mac or `npm.cmd run dev` on Windows.

You can also use GitHub's **Code > Download ZIP**, extract the archive and open a terminal in the extracted folder. Continue from the dependency installation step for your operating system.

### Desktop application downloads

The [Build and verify workflow](https://github.com/denis-hristov/Empires-of-wars-game/actions/workflows/build.yml) is configured to build desktop applications for both platforms. After a successful run, open the run and download its artifact under **Artifacts**. GitHub requires a signed-in account to download workflow artifacts.

| Platform | Artifact | Installation |
| --- | --- | --- |
| macOS Apple Silicon | `desktop-macos-14` | Extract the archive, find `Empires of wars.app` inside `macos`, then move it to Applications. |
| Windows x64 | `desktop-windows-latest` | Extract the archive, find the installer inside `nsis`, then run it. |

These are build artifacts, not published GitHub Releases. Downloads are available only after the corresponding workflow jobs succeed, and artifacts expire according to the repository's retention settings. The Mac application uses local ad-hoc signing and is not notarized by Apple. Windows packaging is configured but has not been tested locally on Windows.

## Technologies

| Technology | How the game uses it |
| --- | --- |
| C++20 | Shared simulation engine for world generation, resources, construction, training, research, combat and save validation. |
| WebAssembly and Emscripten 4.0.15 | Compile the C++ engine so the same rules run in the browser and desktop interface. Embind exposes the engine to JavaScript. |
| React 19 and JavaScript/JSX | Game interface, resource panels, building menus, army selection and campaign screens. |
| PixiJS 8 | Renders the isometric world, artwork, selection, placement previews, camera panning and zooming. |
| CSS | Interface layout, responsive panels, dialogs and visual feedback. |
| Vite 7, Node.js and npm workspaces | Development server, frontend builds and dependency management. |
| Tauri 2 and Rust | Native desktop shell, scoped file access and save import/export dialogs for macOS and Windows. |
| JSON and nlohmann/json | Configurable balance, buildings, units, research, campaign definitions and serialized saves. |
| IndexedDB | Browser save storage with a backup. Desktop storage uses two save slots and an atomically replaced active-slot pointer. |
| Service Worker and Cache API | Cache the production browser build and its local assets for offline play after the initial complete load. |
| CMake, CTest and Node.js test runner | Native engine builds, automated rules tests, WebAssembly tests and native/WASM parity checks. |
| GitHub Actions | Automated engine/frontend checks and desktop packaging for Mac and Windows. |
| SFML 3 | Preserved optional Classic edition. The current interface uses React and PixiJS. |

### Procedural world generation from a seed

Each new map is generated from a **32-bit seed** between `0` and `4294967295`. A seed is the number that drives the generation process. With the same seed, configuration and generator version, the game creates the same map in both native C++ and WebAssembly.

The generator combines coordinate hashing, smooth interpolated noise at several scales, coordinate warping and geometric terrain masks. It can produce an irregular island, a peninsula, an archipelago or mainland crossed by a winding river. These techniques vary coastlines, water, grass, forests and mountains while keeping a central 5 by 5 area buildable for the starting settlement.

Integer interpolation keeps map generation consistent across runtimes. Generator versioning preserves terrain compatibility for older saves. This is deterministic procedural generation implemented in the game engine.

### Campaign and simulation

The 150 campaign levels are defined in `config/game.json`, separately from the procedural world generator. The engine manages building prerequisites, individual construction and training timers, population reservations, unit upgrades, combat abilities and campaign progress. Save files include validation and checksums, and save import/export allows progress to move between browser and desktop.

## Development

See [the development guide](docs/DEVELOPMENT.md) for engine rebuild commands, native tests, desktop packaging, controls, artwork and detailed game rules. Rebuilding the engine requires CMake 3.24+, a C++20 compiler, Python 3 and Emscripten 4.0.15. Building desktop applications also requires Rust and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

The Windows play commands above use the bundled WebAssembly engine. The engine setup/rebuild scripts in the development guide are Bash scripts; rebuilding on Windows requires an appropriate Emscripten environment rather than pasting those scripts into PowerShell.

| Folder | Contents |
| --- | --- |
| `src`, `include/kingdom` | C++ simulation and engine interface. |
| `engine/bindings` | WebAssembly bindings. |
| `frontend/src` | React interface, PixiJS rendering and storage adapters. |
| `frontend/public` | Bundled artwork, fonts, configuration and compiled WASM runtime. |
| `src-tauri` | Rust desktop shell, permissions, configuration and icons. |
| `config/game.json` | Game balance and campaign data. |
| `tests`, `frontend/tests` | Native and frontend/WebAssembly tests. |
| `.github/workflows` | GitHub build and packaging workflow. |

## Assets and third-party licenses

Artwork and fonts are bundled locally; the game loads no runtime assets from a CDN. Third-party components retain their own licenses. See [THIRD_PARTY.md](THIRD_PARTY.md), `assets/licenses` and the bundled font license.
