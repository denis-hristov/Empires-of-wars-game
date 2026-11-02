# Third-party components

The game uses the following separately licensed components. License copies ship in assets/licenses and assets/fonts.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| SFML | 3.0.2 | zlib/png | https://github.com/SFML/SFML |
| nlohmann/json | 3.11.3 | MIT | https://github.com/nlohmann/json |
| FreeType | SFML-pinned dependency | FreeType License | https://freetype.org/ |
| Noto Sans | Bundled variable font | SIL Open Font License 1.1 | https://github.com/google/fonts/tree/main/ofl/notosans |

Portions of this software are copyright © The FreeType Project (https://freetype.org/). All rights reserved.

SFML's Graphics module also includes third-party image loaders and OpenGL support code. Their notices are retained in the upstream SFML source and copied into assets/licenses/SFML-extlibs.md where provided. The game does not load audio or use the SFML Network module.

CMake and clang-format are development tools and are not bundled with the game.
