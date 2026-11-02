#include "kingdom/Engine.hpp"
#include "kingdom/SaveCodec.hpp"
#include <fstream>
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
void check(bool ok, const std::string &why) { if (!ok) throw std::runtime_error(why); }
Json snapshot(const Game &game) {
    auto saved = game.serialize();
    saved.erase("savedAtUTC");
    return saved;
}
Game fresh(Config config) {
    Game game(std::move(config));
    game.newGame(game.config.defaultSeed);
    return game;
}
Id building(const Game &game, const std::string &type) {
    for (const auto &b : game.buildings) if (b.type == type) return b.id;
    return 0;
}
Id build(Game &game, const std::string &type) {
    for (int y = 0; y < game.world.height; ++y)
        for (int x = 0; x < game.world.width; ++x)
            if (game.canPlace(type, {x, y}).ok) {
                auto result = game.place(type, {x, y});
                check(result.ok, type + ": " + result.message);
                Id id = game.buildings.back().id;
                game.tick(game.config.building(type).levels.front().seconds * 1000);
                return id;
            }
    throw std::runtime_error("No plot for " + type);
}
Config previousEconomy(const Config &current) {
    auto previous = current.raw;
    auto migration = previous.at("economyMigration");
    previous.erase("economyVersion");
    previous.erase("economyMigration");
    previous["initialResources"] = migration.at("initialResources");
    for (auto &b : previous["buildings"])
        if (migration["productionRates"].contains(b["id"].get<std::string>()))
            for (std::size_t level = 0; level < b["levels"].size(); ++level)
                b["levels"][level]["ratePerHour"] = migration["productionRates"][b["id"].get<std::string>()][level];
    return Config::parse(std::move(previous));
}
void sameProgress(const Game &before, const Game &after) {
    auto oldState = snapshot(before), newState = snapshot(after);
    oldState.erase("config");
    newState.erase("config");
    check(oldState == newState, "Economy migration preserves all progress, gold, stored production, timers and battle state");
}
}
int main() {
    try {
        const auto current = Config::load(KINGDOM_CONFIG);
        auto game = fresh(current);
        check(game.stock[4] == 0, "A new game starts without gold");
        for (const auto &definition : current.buildings)
            check(definition.resource != 4, "Buildings cannot produce gold");
        game.tick(3600000);
        check(game.stock[4] == 0, "Passive time never earns gold");
        check(game.applyReward({1, false, current.rewards, 0}).ok && game.stock[4] == 0,
              "A lost battle earns no gold");
        check(game.applyReward({2, true, current.rewards, 0}).ok && game.stock[4] == current.rewards[4],
              "A victorious battle awards gold");
        auto earned = game.stock[4];
        check(!game.applyReward({2, true, current.rewards, 0}).ok && game.stock[4] == earned,
              "A battle reward cannot be replayed");

        game = fresh(current);
        game.stock.fill(1000000);
        game.findBuilding(building(game, "townhall"))->level = 10;
        const std::array<int, 5> intervals{6, 4, 3, 2, 1};
        for (const auto &type : {"farm", "lumberyard", "stone", "iron"}) {
            auto id = build(game, type);
            for (int level = 1; level <= 5; ++level) {
                auto producer = game.findBuilding(id);
                producer->level = level;
                producer->stored = producer->remainder = 0;
                auto milliseconds = intervals[level - 1] * 1000;
                check(current.building(type).levels[level - 1].ratePerHour == 3600000 / milliseconds,
                      std::string(type) + " level " + std::to_string(level) + " has the integer interval");
                game.tick(milliseconds - current.stepMs);
                check(game.findBuilding(id)->stored == 0, "No resource is produced before its exact interval");
                game.tick(current.stepMs);
                check(game.findBuilding(id)->stored == 1 && game.findBuilding(id)->remainder == 0,
                      "Exactly one resource is produced at the interval boundary");
                game.tick(milliseconds * 7);
                check(game.findBuilding(id)->stored == 8 && game.findBuilding(id)->remainder == 0,
                      "Production retains exact timing across multiple intervals");
                game.findBuilding(id)->stored = game.level(*game.findBuilding(id)).capacity - 1;
                game.tick(milliseconds * 2);
                check(game.findBuilding(id)->stored == game.level(*game.findBuilding(id)).capacity &&
                          game.findBuilding(id)->remainder == 0,
                      "Local storage retains its configured limit");
            }
        }
        game.validate();
        check(game.stock[4] == 1000000, "All producing buildings leave gold unchanged");
        auto goldConfig = current.raw;
        for (auto &b : goldConfig["buildings"])
            if (b["id"] == "house") b["levels"][1]["cost"]["coins"] = 50;
        game = fresh(Config::parse(goldConfig));
        game.stock.fill(1000000);
        game.findBuilding(building(game, "townhall"))->level = 10;
        auto house = build(game, "house");
        game.stock[4] = 49;
        auto unchanged = snapshot(game);
        auto result = game.upgrade(house);
        check(!result.ok && result.message == "Not enough gold. Fight a battle to collect more gold.",
              "Upgrade gold shortage gives an actionable battle hint");
        check(snapshot(game) == unchanged, "A rejected gold upgrade changes nothing");
        game.stock[4] = 50;
        check(game.upgrade(house).ok && game.stock[4] == 0, "An upgrade accepts the exact gold boundary");

        game = fresh(previousEconomy(current));
        game.stock.fill(1000000);
        auto farm = build(game, "farm");
        build(game, "house");
        build(game, "house");
        auto barracks = build(game, "barracks");
        check(game.train(barracks, "infantry").ok, "Prepare a historical troop");
        game.tick(game.config.unit("infantry").seconds * 1000);
        check(game.train(barracks, "infantry").ok, "Retain the historical paid training queue");
        game.findBuilding(farm)->stored = 17;
        game.findBuilding(farm)->remainder = 1234567;
        game.stock[4] = 713;
        check(game.startBattle(std::vector<Id>{game.units.front().id}).ok, "Retain an active battle during migration");
        auto migrated = decodeSave(current, encodeSave(game));
        sameProgress(game, migrated);
        check(migrated.config.raw.at("economyVersion") == 1 && migrated.config.initialStock[4] == 0 &&
                  migrated.config.building("farm").levels.front().ratePerHour == 600,
              "An installed progression save receives the new economy rules");
        auto copy = decodeSave(current, encodeSave(migrated));
        check(snapshot(migrated) == snapshot(copy), "The migrated battle and production roundtrip exactly");
        auto unknown = game.serialize();
        unknown["config"]["buildings"][0]["levels"][0]["cost"]["wood"] = 999;
        bool rejected = false;
        try { Game::deserialize(current, unknown); } catch (...) { rejected = true; }
        check(rejected, "Unknown previous gameplay configurations remain rejected");

        Engine engine;
        check(Json::parse(engine.init(current.raw.dump()))["ok"], "Initialize facade");
        check(Json::parse(engine.load(encodeSave(migrated)))["ok"], "Load migrated facade state");
        auto state = Json::parse(engine.getState());
        for (const auto &b : state["buildings"])
            if (b["type"] == "farm")
                check(b["production"]["intervalSeconds"] == 6 && b["production"]["ratePerHour"] == 600,
                      "The facade exposes the current integer production interval");
        check(Json::parse(engine.dispatch(R"({"type":"NEW_GAME","payload":{"seed":7319}})"))["ok"],
              "Start a new game after migration");
        check(Json::parse(engine.getState())["stock"][4] == 0, "New games after migration also start without gold");
        std::cout << "PASS exact production intervals, battle gold, upgrade hint and installed-save migration\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
