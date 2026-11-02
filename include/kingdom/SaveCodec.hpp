#pragma once
#include "kingdom/Game.hpp"
namespace kingdom {
std::string encodeSave(const Game &game);
Game decodeSave(Config config, const std::string &bytes);
Json gameplayConfig(Json config);
} // namespace kingdom
