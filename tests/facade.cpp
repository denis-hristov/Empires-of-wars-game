#include "kingdom/Engine.hpp"
#include "kingdom/SaveCodec.hpp"
#include <fstream>
#include <iostream>
using namespace kingdom;
std::string read(const std::filesystem::path &p) {
    std::ifstream f(p);
    return {std::istreambuf_iterator<char>(f), {}};
}
void check(bool ok, const char *why) {
    if (!ok)
        throw std::runtime_error(why);
}
int main() {
    try {
        auto root = std::filesystem::path(EMPIRES_ROOT);
        auto config = read(root / "config/game.json");
        Engine e;
        check(Json::parse(e.init(config))["ok"], "init");
        auto original = e.save();
        check(!Json::parse(e.dispatch(R"({"type":"NOT_A_COMMAND"})"))["ok"], "unknown command");
        check(!Json::parse(
                  e.dispatch(R"({"type":"BUILD","payload":{"buildingType":"house","x":1.2,"y":4}})"))["ok"],
              "fractional coordinates");
        auto beforeInvalid = Json::parse(original).at("game");
        auto afterInvalid = Json::parse(e.save()).at("game");
        beforeInvalid.erase("savedAtUTC");
        afterInvalid.erase("savedAtUTC");
        check(afterInvalid == beforeInvalid, "invalid command atomicity");
        check(!Json::parse(e.tick(-1))["ok"], "negative delta");
        check(!Json::parse(e.tick(251))["ok"], "large delta");
        auto legacy = root / "tests/fixtures/legacy-native.save.json";
        if (std::filesystem::exists(legacy)) {
            check(Json::parse(e.load(read(legacy)))["ok"], "real legacy native save import");
            auto state = Json::parse(e.getState());
            check(state["battle"]["fighters"].back()["id"].is_string(), "64-bit enemy IDs must be strings");
        }
        for (auto fixture : {"legacy-native.save.json", "empires-of-wars-145.save.json"}) {
            check(Json::parse(e.load(read(root / "tests/fixtures" / fixture)))["ok"],
                  "legacy import under current rules");
            auto expanded = Json::parse(e.getState());
            auto fixtureGame = Json::parse(read(root / "tests/fixtures" / fixture))["game"];
            check(expanded["buildings"].size() == fixtureGame["buildings"].size() &&
                      expanded["units"].size() == fixtureGame["units"].size(),
                  "migration preserves every building and unit");
            for (const auto &building : expanded["buildings"])
                check(building["footprint"] == (building["type"] == "townhall" ? Json{3, 3} : Json{2, 2}),
                      "legacy buildings use the new footprints");
            auto oldWorld = Json::parse(e.getWorld());
            check(oldWorld["generatorVersion"] == 1, "keep original terrain generator");
            auto migrated = e.save();
            check(Json::parse(migrated)["game"]["config"]["world"]["generatorVersion"] == 1,
                  "save records original terrain generator");
            check(Json::parse(e.load(migrated))["ok"], "legacy round trip");
            check(Json::parse(e.getWorld()) == oldWorld, "legacy terrain round trip");
            check(Json::parse(e.dispatch(R"({"type":"NEW_GAME","payload":{"seed":145}})"))["ok"],
                  "new game after legacy import");
            check(Json::parse(e.getWorld())["generatorVersion"] == 2,
                  "new game uses current generator after legacy import");
            auto fresh = Json::parse(e.getState());
            check(fresh["buildings"].size() == 1 && fresh["population"]["current"] == 0 &&
                      fresh["population"]["capacity"] == 5,
                  "new game uses current housing and layout after legacy import");
        }
        check(Json::parse(e.load(original))["ok"], "load");
        auto corrupt = Json::parse(original);
        corrupt["game"]["stock"][0] = -1;
        check(!Json::parse(e.load(corrupt.dump()))["ok"], "checksum validation");
        auto savedGame = Json::parse(original)["game"];
        auto changed = Config::parse(Json::parse(config));
        changed.raw["buildings"][0]["name"] = "Translated name";
        auto loaded = Game::deserialize(changed, savedGame);
        loaded.validate();
        changed.raw["buildings"][0]["levels"][0]["cost"]["wood"] = 9999;
        bool rejected = false;
        try {
            Game::deserialize(changed, savedGame);
        } catch (...) {
            rejected = true;
        }
        check(rejected, "balance changes rejected");
        Engine b;
        check(Json::parse(b.init(config))["ok"], "second engine");
        for (int i = 0; i < 20; ++i) {
            e.tick(100);
            b.tick(100);
        }
        auto aState = Json::parse(e.getState()), bState = Json::parse(b.getState());
        aState.erase("revision");
        bState.erase("revision");
        check(aState == bState, "deterministic facade");
        std::cout << "Engine contract, input validation, legacy migration and checksum checks passed\n";
        return 0;
    } catch (const std::exception &e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
