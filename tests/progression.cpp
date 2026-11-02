#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include "kingdom/Engine.hpp"
#include "PopulationSetup.hpp"
#include <algorithm>
#include <fstream>
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
void check(bool value, const std::string &why) { if (!value) throw std::runtime_error(why); }
Game fresh() { Game g(Config::load(KINGDOM_CONFIG)); g.newGame(g.config.defaultSeed); return g; }
Id id(const Game &g, const std::string &type) { for (const auto &b : g.buildings) if (b.type == type) return b.id; return 0; }
Json snapshot(const Game &g) { auto j = g.serialize(); j.erase("savedAtUTC"); return j; }
Id build(Game &g, const std::string &type) {
    for (int y = 0; y < g.world.height; ++y) for (int x = 0; x < g.world.width; ++x)
        if (g.canPlace(type, {x,y}).ok) {
            auto r = g.place(type, {x,y}); check(r.ok, type + ": " + r.message);
            auto result = g.buildings.back().id;
            check(g.buildings.back().state == State::Construction, "Construction cannot unlock levels");
            g.tick(g.config.building(type).levels.front().seconds * 1000);
            return result;
        }
    throw std::runtime_error("No plot for " + type);
}
void to(Game &g, const std::string &type, int target) {
    auto entity = id(g,type);
    if (!entity && target) entity = build(g,type);
    while (g.completedLevel(type) < target) {
        auto before = g.completedLevel(type);
        const auto cost = g.config.building(type).levels[before].cost;
        if (type == "townhall") test_support::population(g, g.config.building(type).levels[before].population);
        const auto stock = g.stock;
        auto r = g.upgrade(entity); check(r.ok, type + ": " + r.message);
        for (int n = 0; n < 5; ++n) check(g.stock[n] == stock[n] - cost[n], "Only the target level is paid");
        check(g.completedLevel(type) == before, "Upgrade effects wait for completion");
        g.tick(g.config.building(type).levels[before].seconds * 1000);
    }
}
void rejectedResearch(Game &g, Id academy, const std::string &type) {
    auto before = snapshot(g); check(!g.startResearch(academy,type).ok, "Research rejected");
    check(snapshot(g) == before, "Research rejection is atomic");
}
}
int main() {
 try {
    auto g = fresh();
    check(g.stock[0] == 600 && g.stock[1] == 1000 && !g.stock[2] && !g.stock[3], "Starter resources");
    check(g.buildings.size() == 1 && g.townHallLevel() == 1 && g.housing() == 5 && g.units.empty() && g.civilian == 0,
          "Only completed Town Hall starts built, five population places and no soldiers");
    auto initial = snapshot(g); g.tick(3600000);
    check(g.stock == initial["stock"].get<Stock>(), "Town Hall produces nothing and food has no upkeep");
    g.stock.fill(1000000);
    for (const auto &type : {"academy", "harbor", "airbase", "stone", "iron"})
        check(!g.buildingRequirements(type).ok, "Locked building " + std::string(type));
    check(!g.upgrade(id(g,"townhall")).ok, "Town Hall requires completed economy and barracks");
    auto spacious = g.config.raw; spacious["world"]["width"] = 72; spacious["world"]["height"] = 72;
    g = Game(Config::parse(spacious)); g.newGame(g.config.defaultSeed); g.stock.fill(1000000);
    for (int townHall = 1; townHall <= 10; ++townHall) {
        check(g.townHallLevel() == townHall, "Completed Town Hall");
        for (const auto &d : g.config.buildings) {
            if (d.id == "townhall") continue;
            int cap = g.config.raw["buildingLimits"][d.id][townHall - 1];
            check(g.buildingLimit(d.id) == cap, "Per-building Town Hall cap");
            if (!cap) continue;
            to(g,d.id,cap);
            if (id(g,d.id)) {
                auto unchanged = snapshot(g);
                check(!g.upgrade(id(g,d.id)).ok && snapshot(g) == unchanged, "Cannot bypass completed Town Hall cap");
                check(g.buildingRequirements(d.id).ok == (d.id != "laboratory" && d.id != "academy"), "Unlocked buildings remain available except the unique Academy and Laboratory");
            }
        }
        g.validate();
        if (townHall < 10) to(g,"townhall",townHall+1);
    }
    check(g.housing() >= 850, "Completed housing supports all Town Hall requirements");
    check(g.config.building("house").levels.back().housing == 20, "House level five has twenty places");
    check(g.config.building("townhall").levels[9].cost == Stock{12000,39000,15600,7500,0}, "Town Hall ten exact price");
    check(!g.upgrade(id(g,"townhall")).ok, "Town Hall ten is final");
    auto academy = id(g,"academy"), barracks = id(g,"barracks");
    check(g.train(barracks,"infantry").ok, "Troops train directly against House capacity");
    g.tick(g.config.unit("infantry").seconds*1000);
    auto soldier = g.units.back().id;
    g.findUnit(soldier)->health -= 7;
    check(g.researchCost("infantry") == Stock{2000,6500,2600,1250,0}, "Tier one first research uses the completed Academy ten price tier");
    for (int level = 1; level <= 14; ++level) {
        int previousHealth = g.unitHealth("infantry");
        int missingHealth = previousHealth - g.findUnit(soldier)->health;
        auto cost = g.researchCost("infantry"), stock = g.stock;
        check(g.startResearch(academy,"infantry").ok, "Sequential individual research");
        check(g.researchLevel("infantry") == level-1, "Bonus waits for research completion");
        rejectedResearch(g,academy,"infantry_squad");
        for (int i=0;i<5;++i) check(g.stock[i] == stock[i]-cost[i], "Research pays target only");
        g.tick(g.researchSeconds("infantry")*1000);
        check(g.researchLevel("infantry") == level, "Independent research level completed");
        const int expectedHealth[] = {100,105,110,115,121,127,134,140,147,155,162,171,179,188,197};
        check(g.unitHealth("infantry") == expectedHealth[level], "Research compounds without losing fractional gains between levels");
        check(g.findUnit(soldier)->health == g.unitHealth("infantry")-missingHealth, "Existing troops gain health while preserving wounds");
        check(g.researchLevel("infantry_squad") == 0, "No automatic research for other types");
    }
    rejectedResearch(g,academy,"infantry");
    check(g.unitHealth("infantry") == 197 && Game::researchBonusPercent(2) == 10.25 &&
          Game::researchBonusPercent(14) == 97.99, "Cumulative research percentage and integer health at level fourteen");
    check(Game::researchStat(10000, 14) == 19799 && Game::researchStat(20, 2) == 22 &&
          Game::researchStat(1, 10) == 1, "Exact rational research factors handle large and small base statistics");
    check(g.train(barracks,"infantry").ok, "Future unit train"); g.tick(g.config.unit("infantry").seconds*1000);
    check(g.units.back().health == 197, "Future troops receive completed research");
    check(g.startBattle(std::vector<Id>{soldier}).ok, "Researched troop enters battle");
    check(g.battle->fighters.front().maxHealth == 197 && g.battle->fighters.front().damage == g.unitDamage("infantry"), "Combat uses troop research");
    auto copy = decodeSave(g.config, encodeSave(g)); check(snapshot(g) == snapshot(copy), "Progression and combat save roundtrip");
    auto oldAcademy = g;
    auto oldAcademyConfig = oldAcademy.config.raw;
    oldAcademyConfig.erase("academyResearchVersion");
    oldAcademyConfig["research"]["maxLevel"] = 10;
    oldAcademyConfig["research"]["baseCosts"].erase(oldAcademyConfig["research"]["baseCosts"].begin()+10, oldAcademyConfig["research"]["baseCosts"].end());
    oldAcademy.config = Config::parse(oldAcademyConfig);
    oldAcademy.researchLevels["infantry"] = 10;
    for (auto &unit : oldAcademy.units) if (unit.type == "infantry") unit.health -= 35;
    for (auto &fighter : oldAcademy.battle->fighters) if (!fighter.enemy) {
        fighter.health -= 35; fighter.maxHealth -= 35; fighter.damage -= 12;
    }
    oldAcademy.validate();
    auto expandedAcademy = decodeSave(g.config, encodeSave(oldAcademy));
    auto beforeExpansion = snapshot(oldAcademy), afterExpansion = snapshot(expandedAcademy);
    beforeExpansion.erase("config"); afterExpansion.erase("config");
    check(beforeExpansion == afterExpansion,"Academy expansion preserves an active old battle, wounds, shields, research, inventory and actions");
    check(snapshot(decodeSave(g.config, encodeSave(expandedAcademy))) == snapshot(expandedAcademy),"Academy expansion is stable on repeated load");
    auto campaignMigration = g;
    campaignMigration.battle.reset();
    check(campaignMigration.startResearch(academy, "infantry_squad").ok, "Paid research queue before old-save conversion");
    check(campaignMigration.startCampaignBattle(1, {soldier, campaignMigration.units.back().id}).ok,
          "Campaign army before old-save conversion");
    auto &committed = campaignMigration.battle->fighters;
    auto firstFriendly = std::find_if(committed.begin(), committed.end(), [](const auto &fighter) { return !fighter.enemy; });
    firstFriendly->health = firstFriendly->maxHealth - 13;
    auto secondFriendly = std::find_if(firstFriendly + 1, committed.end(), [](const auto &fighter) { return !fighter.enemy; });
    secondFriendly->health = 0;
    for (auto &fighter : committed) if (!fighter.enemy) {
        fighter.maxHealth += 17; fighter.damage += 3;
        if (fighter.health) fighter.health += 17;
    }
    for (const auto &fighter : committed) if (!fighter.enemy)
        for (auto &saved : campaignMigration.battle->campaignArmy) if (saved.id == fighter.id) saved = fighter;
    campaignMigration.validate();
    auto oldResearch = campaignMigration.serialize(); oldResearch.erase("researchBonusVersion");
    for (auto &unit : oldResearch["units"]) {
        const auto type = unit.at("type").get<std::string>();
        const int base = campaignMigration.config.unit(type).health;
        unit["health"] = unit["health"].get<int>() -
            (campaignMigration.unitHealth(type) - base * (100 + 5 * campaignMigration.researchLevel(type)) / 100);
    }
    for (auto list : {"fighters", "campaignArmy"}) for (auto &fighter : oldResearch["battle"][list]) {
        if (fighter.at("enemy").get<bool>()) continue;
        const auto type = fighter.at("type").get<std::string>();
        const auto &definition = campaignMigration.config.unit(type);
        const int level = campaignMigration.researchLevel(type);
        const int healthGain = campaignMigration.unitHealth(type) - definition.health * (100 + 5 * level) / 100;
        fighter["maxHealth"] = fighter["maxHealth"].get<int>() - healthGain;
        if (fighter["health"].get<int>() > 0) fighter["health"] = fighter["health"].get<int>() - healthGain;
        fighter["damage"] = fighter["damage"].get<int>() -
            (campaignMigration.unitDamage(type) - definition.damage * (100 + 5 * level) / 100);
    }
    auto researchMigrated = Game::deserialize(campaignMigration.config, oldResearch);
    check(snapshot(researchMigrated) == snapshot(campaignMigration),
          "Old research migration preserves full health, wounds, dead fighters, paid queue, resources, IDs, enemies and committed army");
    auto researchReloaded = decodeSave(researchMigrated.config, encodeSave(researchMigrated));
    check(snapshot(researchReloaded) == snapshot(researchMigrated), "Research migration applies exactly once");
    auto previousEconomy = oldResearch;
    previousEconomy["config"].erase("economicLevelFiveVersion");
    for (auto &building : previousEconomy["config"]["buildings"]) {
        const auto type = building.at("id").get<std::string>();
        if (type != "house" && type != "farm" && type != "lumberyard" && type != "stone" && type != "iron") continue;
        previousEconomy["config"]["buildingLimits"][type][8] = 4;
        building["levels"][4]["townHallRequired"] = 10;
    }
    auto economyResearchMigrated = Game::deserialize(campaignMigration.config, previousEconomy);
    check(snapshot(economyResearchMigrated) == snapshot(campaignMigration),
          "Recursive configuration migration applies compound research exactly once");
    Engine researchEngine;
    check(Json::parse(researchEngine.init(campaignMigration.config.raw.dump()))["ok"], "Research facade initializes");
    check(Json::parse(researchEngine.load(encodeSave(researchMigrated)))["ok"], "Research facade loads compounded army");
    const auto researchState = Json::parse(researchEngine.getState());
    const auto &catalog = researchState.at("unitCatalog");
    const auto infantry = std::find_if(catalog.begin(), catalog.end(), [](const auto &unit) { return unit.at("id") == "infantry"; });
    check(infantry->at("baseHealth") == 100 && infantry->at("effectiveHealth") == 197 &&
          infantry->at("researchHealthBonus") == 97 && infantry->at("researchBonusPercent") == 97.99,
          "Training catalog reports base, cumulative bonus and effective troop statistics");
    g = fresh(); g.stock.fill(1000000); build(g,"house"); auto producer = build(g,"barracks");
    const int people = g.config.unit("infantry").people;
    int trained = 0;
    while (trained + people <= 7) { check(g.train(producer,"infantry").ok,"Population within cap");g.tick(g.config.unit("infantry").seconds*1000);trained+=people; }
    check(!g.train(producer,"infantry").ok,"House limits troop population");
    g = fresh(); g.stock.fill(1000000); auto farm = build(g,"farm"); auto lumber = build(g,"lumberyard");
    g.findBuilding(farm)->stored = g.findBuilding(farm)->remainder = 0;
    g.findBuilding(lumber)->stored = g.findBuilding(lumber)->remainder = 0;
    g.stock[0] = g.stock[1] = 0;
    for (int collection = 0; collection < 6; ++collection) {
        g.tick(600000);
        check(g.findBuilding(farm)->stored == 100 && g.findBuilding(lumber)->stored == 100, "Exact ten minute production independent of food");
        check(g.collect(farm).ok && g.collect(lumber).ok, "Collect before local storage fills");
    }
    check(g.stock[0] == 600 && g.stock[1] == 600, "Exactly six hundred resources per hour at level one");
    auto state = snapshot(g); g.tick(73); copy = decodeSave(g.config,encodeSave(g));g.tick(999);copy.tick(999);
    check(snapshot(g) == snapshot(copy), "Fractional hourly production resumes exactly");
    for (auto fixture : {"legacy-native.save.json", "empires-of-wars-145.save.json"}) {
        std::ifstream f(std::filesystem::path(KINGDOM_CONFIG).parent_path().parent_path()/"tests/fixtures"/fixture);Json old;f>>old;
        auto migrated = Game::deserialize(Config::load(KINGDOM_CONFIG),old["game"]);
        check(migrated.progression() && migrated.legacyProgression,"Known save migrates to new progression");
        check(migrated.buildings.size()==old["game"]["buildings"].size() && migrated.units.size()==old["game"]["units"].size(),"Every old building and troop retained");
        copy=decodeSave(Config::load(KINGDOM_CONFIG),encodeSave(migrated));check(snapshot(copy)==snapshot(migrated),"Migrated save roundtrip");
        auto unknown = old["game"];unknown["config"]["initialResources"]["wood"]=999;
        bool rejected=false;try{Game::deserialize(Config::load(KINGDOM_CONFIG),unknown);}catch(...){rejected=true;}
        check(rejected,"Unknown gameplay configuration still rejected");
    }
    auto currentConfig = Config::load(KINGDOM_CONFIG);
    auto originalRules = currentConfig.raw.at("progressionMigration");
    auto priorMilitary = originalRules.at("militaryMigration");
    originalRules.erase("militaryMigration"); originalRules.erase("militaryVersion");
    originalRules["units"] = priorMilitary.at("units"); originalRules["battle"] = priorMilitary.at("battle");
    originalRules["townHallLimits"] = priorMilitary.at("townHallLimits");
    for (auto &b : originalRules["buildings"])
        if (b["id"] == "townhall" || b["id"] == "barracks" || b["id"] == "harbor" || b["id"] == "airbase")
            b["levels"].erase(b["levels"].begin()+3,b["levels"].end());
    Game original(Config::parse(originalRules)); original.newGame(original.config.defaultSeed); original.stock.fill(1000000);
    auto originalBarracks = build(original,"barracks");
    check(original.train(originalBarracks,"infantry").ok,"Historical paid queue starts");
    auto originalCost = original.config.unit("infantry").cost;
    auto migrated = Game::deserialize(currentConfig,original.serialize()); auto paidStock = migrated.stock;
    check(migrated.cancelTraining(originalBarracks,0).ok,"Historical paid queue cancels");
    for (int i=0;i<5;++i) check(migrated.stock[i] == paidStock[i]+originalCost[i],"Historical queue refunds its actual paid resources");
    auto corrupted = fresh().serialize();
    corrupted["researchLevels"]["phantom_bomber"] = 10;
    bool rejected = false;try { Game::deserialize(currentConfig,corrupted); } catch(...) {rejected=true;}
    check(rejected,"Research for future troops without Academy is invalid");
    auto matrix = fresh(); matrix.stock.fill(1000000);
    matrix.findBuilding(id(matrix,"townhall"))->level = 10;
    auto matrixAcademy = build(matrix,"academy");
    for (const auto &type : {"barracks", "harbor", "airbase"}) {
        auto military = build(matrix,type); matrix.findBuilding(military)->level = 10;
    }
    for (int academyLevel = 1; academyLevel <= 10; ++academyLevel) {
        matrix.findBuilding(matrixAcademy)->level = academyLevel;
        for (const auto &unit : matrix.config.units) {
            auto probe = matrix;
            int cap = std::max(0, academyLevel - unit.level + 1) + std::max(0, academyLevel - std::max(7, unit.level) + 1);
            check(probe.researchLimit(unit.id,academyLevel) == cap,"Tier-based research cap in every domain");
            if (cap) {
                probe.researchLevels[unit.id] = cap-1;
                auto price = probe.researchCost(unit.id), beforeStock = probe.stock;
                check(probe.startResearch(matrixAcademy,unit.id).ok,"Research at the exact tier cap is allowed");
                for (int n=0;n<5;++n) check(probe.stock[n] == beforeStock[n]-price[n],"Each research level is paid separately");
                auto queued = decodeSave(probe.config,encodeSave(probe));
                check(snapshot(queued)==snapshot(probe),"Paid research above the Academy level survives save/load while queued");
                probe.tick(probe.researchSeconds(unit.id)*1000);
                check(probe.researchLevel(unit.id) == cap,"Research finishes at the tier cap");
                auto loaded = decodeSave(probe.config,encodeSave(probe));
                check(snapshot(loaded)==snapshot(probe),"Tier-limited research survives save/load");
            }
            rejectedResearch(probe,matrixAcademy,unit.id);
        }
    }
    matrix.findBuilding(matrixAcademy)->level = 3;
    matrix.researchLevels["heavy_infantry"] = 3;
    matrix.researchLevels["infantry_squad"] = 2;
    matrix.research.push_back({"infantry_squad",matrixAcademy,1000,3});
    auto earlier = matrix.serialize(); earlier.erase("researchRulesVersion");
    auto retained = Game::deserialize(matrix.config,earlier);
    check(retained.researchLevel("heavy_infantry")==3 && retained.preservedResearchLevels.at("heavy_infantry")==3,"Earlier paid research is retained");
    check(retained.preservedResearchLevels.at("infantry_squad")==3,"Earlier paid research queue is retained");
    auto resumed = decodeSave(retained.config,encodeSave(retained));
    resumed.tick(1000);
    check(resumed.researchLevel("infantry_squad")==3,"Earlier paid queue finishes without losing progress");
    rejectedResearch(resumed,matrixAcademy,"infantry_squad");
    rejectedResearch(resumed,matrixAcademy,"heavy_infantry");
    auto invalidNew = earlier; invalidNew["researchRulesVersion"]=2;
    rejected=false;try { Game::deserialize(matrix.config,invalidNew); } catch(...) {rejected=true;}
    check(rejected,"New saves cannot bypass the tier caps without recorded previous research");
    resumed.newGame(resumed.config.defaultSeed);
    check(resumed.preservedResearchLevels.empty(),"New villages do not inherit earlier research allowances");
    std::cout << "PASS full city progression, target costs, housing, exact production, independent research, combat bonuses and legacy saves\n";
    return 0;
 } catch(const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
