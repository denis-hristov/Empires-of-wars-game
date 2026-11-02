#pragma once
#include "kingdom/Game.hpp"
#include <stdexcept>
namespace test_support {
inline void population(kingdom::Game &game, int required) {
    const int cap = game.buildingLimit("house");
    for (auto &building : game.buildings)
        if (building.type == "house" && building.state == kingdom::State::Active)
            building.level = cap;
    while (game.housing() < required) {
        kingdom::Pos plot{-1, -1};
        for (int pass = 0; pass < 2 && plot.x < 0; ++pass) {
            for (int y = 0; y < game.world.height && plot.x < 0; ++y)
                for (int x = 0; x < game.world.width && plot.x < 0; ++x)
                    if (game.canPlace("house", {x, y}).ok) {
                        bool deploymentSpace = true;
                        for (const auto &building : game.buildings) {
                            if (building.type != "barracks" && building.type != "airbase" && building.type != "harbor") continue;
                            const auto &definition = game.config.building(building.type);
                            if (x < building.pos.x + definition.width + 1 && x + 2 > building.pos.x - 1 &&
                                y < building.pos.y + definition.height + 1 && y + 2 > building.pos.y - 1)
                                deploymentSpace = false;
                        }
                        if (deploymentSpace) plot = {x, y};
                    }
            if (plot.x < 0 && pass == 0)
                for (int y = 0; y < game.world.height; ++y)
                    for (int x = 0; x < game.world.width; ++x)
                        if (game.world.at({x, y}).terrain == kingdom::Terrain::Forest && !game.world.at({x, y}).occupant)
                            if (!game.clearTree({x, y}).ok) throw std::runtime_error("Cannot clear population fixture plot");
        }
        if (plot.x < 0) throw std::runtime_error("No population fixture plot");
        auto result = game.place("house", plot);
        if (!result.ok) throw std::runtime_error(result.message);
        const auto id = game.buildings.back().id;
        game.tick(game.config.building("house").levels.front().seconds * 1000);
        game.findBuilding(id)->level = cap;
    }
}
}
