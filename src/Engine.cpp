#include "kingdom/Engine.hpp"
#include "kingdom/SaveCodec.hpp"
#include <charconv>
#include <algorithm>
#include <limits>
#include <stdexcept>
namespace kingdom {
namespace {
Id idValue(const Json &value) {
    if (!value.is_string())
        throw std::runtime_error("Entity IDs must be decimal strings");
    auto s = value.get<std::string>();
    Id id{};
    auto [end, ec] = std::from_chars(s.data(), s.data() + s.size(), id);
    if (ec != std::errc{} || end != s.data() + s.size() || s.empty() || !id)
        throw std::runtime_error("Invalid entity ID");
    return id;
}
Pos posValue(const Json &j) {
    for (auto key : {"x", "y"})
        if (!j.at(key).is_number_integer() || j.at(key).get<std::int64_t>() < -10000 ||
            j.at(key).get<std::int64_t>() > 10000)
            throw std::runtime_error("Invalid tile coordinate");
    return {j.at("x").get<int>(), j.at("y").get<int>()};
}
Json resourceCost(const Stock &cost) {
    Json value = Json::object();
    for (int i = 0; i < 5; ++i) if (cost[i]) value[resourceName(i)] = cost[i];
    return value;
}
void stringIds(Json &j) {
    if (j.is_object())
        for (auto it = j.begin(); it != j.end(); ++it) {
            if ((it.key() == "id" || it.key() == "source" || it.key() == "academy" ||
                 it.key() == "attacker" || it.key() == "target" || it.key() == "carrier") &&
                it.value().is_number_unsigned())
                it.value() = std::to_string(it.value().get<Id>());
            else
                stringIds(it.value());
        }
    else if (j.is_array())
        for (auto &item : j)
            stringIds(item);
}
} // namespace
void Engine::requireGame() const {
    if (!game)
        throw std::runtime_error("The engine has not been initialized");
}
std::string Engine::result(const Result &r, const std::string &code) const {
    return Json{
        {"ok", r.ok}, {"code", r.ok ? "OK" : code}, {"message", r.message}, {"stateRevision", revision}}
        .dump();
}
std::string Engine::version() const {
    return Json{{"api", 1}, {"schema", 1}, {"engine", "0.4.7"}, {"name", "Empires of wars"}}.dump();
}
std::string Engine::init(const std::string &input) {
    try {
        auto config = Config::parse(Json::parse(input));
        auto candidate = std::make_unique<Game>(config);
        candidate->newGame(config.defaultSeed);
        game = std::move(candidate);
        newGameConfig = config;
        ++revision;
        return result(Result::success("Your empire awaits."));
    } catch (const std::exception &e) {
        return result(Result::fail(e.what()), "INVALID_CONFIG");
    }
}
std::string Engine::dispatch(const std::string &input) {
    try {
        requireGame();
        if (input.size() > 65536)
            throw std::runtime_error("Command is too large");
        auto action = Json::parse(input);
        auto type = action.at("type").get<std::string>();
        auto p = action.value("payload", Json::object());
        auto entity = [&] { return idValue(p.at("id")); };
        Result r;
        if (type == "SHOP_OPTIONS")
            return Json{{"ok", true}, {"stateRevision", revision}, {"shop", game->shopOptions()}}.dump();
        if (type == "CAN_BUILD") {
            auto building = p.at("buildingType").get<std::string>();
            auto pos = posValue(p);
            Id ignore = p.contains("id") ? entity() : 0;
            r = game->canPlace(building, pos, ignore);
            if (r.ok && !ignore) {
                Game copy = *game;
                r = copy.place(building, pos);
            }
            return result(r);
        }
        if (type == "CAN_MOVE_UNIT")
            return result(game->canMoveUnit(entity(), posValue(p)));
        if (type == "BATTLE_OPTIONS") {
            auto id = entity();
            Json moves = Json::array(), targets = Json::array(), healTargets = Json::array();
            for (auto pos : game->validBattleMoves(id))
                moves.push_back({pos.x, pos.y});
            for (auto t : game->validBattleTargets(id))
                targets.push_back(std::to_string(t));
            for (auto t : game->validBattleHealTargets(id))
                healTargets.push_back(std::to_string(t));
            return Json{{"ok", true}, {"stateRevision", revision}, {"moves", moves}, {"targets", targets}, {"healTargets", healTargets}}
                .dump();
        }
        if (type == "SHOP_TRADE") {
            if (!p.at("quantity").is_number_integer() || p.at("quantity") < 1 || p.at("quantity") > 100)
                throw std::runtime_error("Shop quantity must be an integer from 1 to 100");
            if (!p.at("sequence").is_number_integer() || p.at("sequence") < 0 ||
                p.at("sequence") > 9'007'199'254'740'990ull)
                throw std::runtime_error("Invalid shop sequence");
            r = game->shopTrade(p.at("offerId").get<std::string>(), p.at("quantity").get<int>(),
                                p.at("sequence").get<std::uint64_t>());
        }
        else if (type == "BUILD")
            r = game->place(p.at("buildingType"), posValue(p));
        else if (type == "MOVE_BUILDING")
            r = game->moveBuilding(entity(), posValue(p));
        else if (type == "MOVE_UNIT")
            r = game->moveUnit(entity(), posValue(p));
        else if (type == "DISMISS_UNIT")
            r = game->dismissUnit(entity());
        else if (type == "UPGRADE")
            r = game->upgrade(entity());
        else if (type == "CLEAR_TREE")
            r = game->clearTree(posValue(p));
        else if (type == "COLLECT")
            r = game->collect(entity());
        else if (type == "TRAIN")
            r = game->train(entity(), p.at("unitType"));
        else if (type == "CANCEL_TRAINING") {
            if (!p.at("index").is_number_integer() || p.at("index").get<std::int64_t>() < 0 || p.at("index").get<std::int64_t>() > 20)
                throw std::runtime_error("Invalid training index");
            r = game->cancelTraining(entity(), p.at("index").get<int>());
        } else if (type == "EMBARK_AIRCRAFT")
            r = game->embark(entity(), idValue(p.at("carrier")));
        else if (type == "DISEMBARK_AIRCRAFT")
            r = game->disembark(entity());
        else if (type == "RESEARCH")
            r = game->startResearch(entity(), p.contains("unitType") ? p.at("unitType").get<std::string>() : p.at("technology").get<std::string>());
        else if (type == "BATTLE_START") {
            std::optional<std::vector<Id>> selected;
            if (p.contains("unitIds")) {
                if (!p.at("unitIds").is_array())
                    throw std::runtime_error("unitIds must be an array");
                selected.emplace();
                for (const auto &id : p.at("unitIds"))
                    selected->push_back(idValue(id));
            }
            std::map<Id, Domain> missions;
            if (p.contains("airMissions")) {
                if (!p.at("airMissions").is_array()) throw std::runtime_error("airMissions must be an array");
                for (const auto &mission : p.at("airMissions"))
                    if (!missions.emplace(idValue(mission.at("id")), domainFromName(mission.at("phase"))).second)
                        throw std::runtime_error("Duplicate air mission");
            }
            if (p.value("campaign", false) || p.contains("campaignLevel")) {
                if (!missions.empty()) return result(Result::fail("Campaign rounds only accept troops from their own domain"));
                int level = game->campaignCurrentLevel();
                if (p.contains("campaignLevel")) {
                    if (!p.at("campaignLevel").is_number_integer()) throw std::runtime_error("Campaign level must be an integer");
                    level = p.at("campaignLevel").get<int>();
                }
                r = game->startCampaignBattle(level, selected.value_or(std::vector<Id>{}), p.value("automatic", false));
            } else r = game->startBattle(selected, p.value("automatic", false), missions);
        } else if (type == "BATTLE_DEPLOY") {
            if (!p.at("unitIds").is_array()) throw std::runtime_error("unitIds must be an array");
            std::vector<Id> selected;
            for (const auto &id : p.at("unitIds")) selected.push_back(idValue(id));
            r = game->deployCampaignRound(selected);
        } else if (type == "BATTLE_RETREAT")
            r = game->retreatBattle();
        else if (type == "BATTLE_MOVE")
            r = game->battleMove(entity(), posValue(p));
        else if (type == "BATTLE_ATTACK")
            r = game->attack(entity(), idValue(p.at("target")));
        else if (type == "BATTLE_HEAL")
            r = game->heal(entity(), idValue(p.at("target")));
        else if (type == "BREW_POTION")
            r = game->brew(entity(), p.at("potionType"));
        else if (type == "REMOVE_POTION") {
            if (!p.at("sequence").is_number_unsigned() && !p.at("sequence").is_number_integer())
                throw std::runtime_error("Invalid potion sequence");
            const auto sequence = p.at("sequence").get<std::int64_t>();
            if (sequence < 0 || sequence > 9'007'199'254'740'990ll)
                throw std::runtime_error("Invalid potion sequence");
            r = game->removePotion(entity(), p.at("potionType"), static_cast<std::uint64_t>(sequence));
        }
        else if (type == "BATTLE_POTION_SELECT")
            r = game->selectPotion(p.at("potionType"));
        else if (type == "BATTLE_POTION_CANCEL")
            r = game->cancelPotion();
        else if (type == "BATTLE_POTION_USE") {
            if (!p.at("token").is_number_unsigned() && !p.at("token").is_number_integer())
                throw std::runtime_error("Invalid potion token");
            auto token = p.at("token").get<std::int64_t>();
            if (token <= 0) throw std::runtime_error("Invalid potion token");
            r = game->usePotion(p.at("potionType"), static_cast<std::uint64_t>(token));
        }
        else if (type == "BATTLE_END_TURN")
            r = game->endTurn();
        else if (type == "BATTLE_AUTO")
            r = game->automateBattle();
        else if (type == "BATTLE_PAUSE")
            r = game->pauseBattle();
        else if (type == "BATTLE_FINISH")
            r = game->finishBattle();
        else if (type == "NEW_GAME") {
            if (!p.at("seed").is_number_unsigned() && !p.at("seed").is_number_integer())
                throw std::runtime_error("Seed must be an integer");
            auto seed = p.at("seed").get<std::int64_t>();
            if (seed < 0 || seed > std::numeric_limits<std::uint32_t>::max())
                throw std::runtime_error("Seed out of range");
            auto candidate = std::make_unique<Game>(*newGameConfig);
            candidate->newGame(static_cast<std::uint32_t>(seed));
            game = std::move(candidate);
            r = Result::success("A new empire begins.");
        } else
            return result(Result::fail("Unknown command: " + type), "UNKNOWN_COMMAND");
        if (r.ok)
            ++revision;
        return result(r);
    } catch (const std::exception &e) {
        return result(Result::fail(e.what()), "INVALID_ARGUMENT");
    }
}
std::string Engine::tick(int milliseconds) {
    try {
        requireGame();
        if (milliseconds < 0 || milliseconds > 250)
            return result(Result::fail("Tick must be between 0 and 250 ms"), "INVALID_ARGUMENT");
        auto before = game->elapsedMs;
        int beforeActions = game->battle ? game->battle->actions : 0;
        auto turnState = [&] {
            return game->battle ? std::array<int, 4>{game->battle->round, game->battle->phaseIndex,
                                                    game->battle->enemyTurn, game->battle->finished}
                                : std::array<int, 4>{};
        };
        auto beforeTurn = turnState();
        bool beforeAnimation = game->battle && game->battle->animationMs > 0;
        game->tick(milliseconds);
        if (game->elapsedMs != before || turnState() != beforeTurn || (beforeAnimation && game->battle && !game->battle->animationMs) || (game->battle && game->battle->actions != beforeActions))
            ++revision;
        return result(Result::success());
    } catch (const std::exception &e) {
        return result(Result::fail(e.what()), "ENGINE_ERROR");
    }
}
std::string Engine::getWorld() const {
    requireGame();
    Json tiles = Json::array();
    for (auto &t : game->world.tiles)
        tiles.push_back(static_cast<int>(t.terrain));
    return Json{{"width", game->world.width},
                {"height", game->world.height},
                {"seed", game->world.seed},
                {"generatorVersion", game->world.generator},
                {"tiles", tiles}}
        .dump();
}
std::string Engine::getState() const {
    requireGame();
    auto j = game->serialize(false);
    if (game->battle) {
        auto &b = *game->battle;
        auto fighters = j["battle"]["fighters"];
        j["battle"]["fighters"] = Json::array();
        for (const auto &f : fighters)
            if (f.at("phase") == domainName(b.domain))
                j["battle"]["fighters"].push_back(f);
        for (auto &f : j["battle"]["fighters"]) {
            f["validTargets"] = game->validBattleTargets(f.at("id").get<Id>());
            for (auto &id : f["validTargets"]) id = std::to_string(id.get<Id>());
            f["validHealTargets"] = game->validBattleHealTargets(f.at("id").get<Id>());
            for (auto &id : f["validHealTargets"]) id = std::to_string(id.get<Id>());
        }
    }
    if (game->config.raw.contains("campaign")) {
        const auto &campaign = game->config.raw.at("campaign");
        j["campaign"]["maxLevel"] = campaign.at("levels").size();
        if (game->battle && game->battle->campaignLevel)
            j["battle"]["rewards"] = game->campaignLevelDefinition(game->battle->campaignLevel).at("rewards");
    }
    if (game->config.raw.contains("magic")) {
        j["magic"]["options"] = Json::array();
        for (const auto &potion : game->config.raw.at("magic").at("potions")) {
            auto option = potion;
            auto type = potion.at("id").get<std::string>();
            Id laboratory = 0;
            for (const auto &b : game->buildings) if (b.type == "laboratory") laboratory = b.id;
            if (!laboratory && !game->battle) continue;
            auto brew = game->brewRequirements(laboratory, type);
            auto use = game->potionRequirements(type);
            auto remove = game->removePotionRequirements(laboratory, type);
            option["count"] = game->potions[game->potionIndex(type)];
            option["brew"] = {{"ok", brew.ok}, {"reason", brew.message}};
            option["use"] = {{"ok", use.ok}, {"reason", use.message}};
            option["remove"] = {{"ok", remove.ok}, {"reason", remove.message}, {"gold", PotionRemovalGold}};
            j["magic"]["options"].push_back(option);
        }
        j["magic"]["used"] = game->potionCount();
        j["magic"]["capacity"] = 5;
        if (game->battle) {
            j["battle"]["potionPrompt"] = game->battle->potionPrompt;
            j["battle"]["potionToken"] = game->battle->potionToken;
            j["battle"]["animationMs"] = game->battle->animationMs;
        }
    }
    if (game->config.raw.contains("shop")) j["shop"] = {{"sequence", game->shopSequence}};
    j["battleUnitLimit"] = std::min(5, game->config.maxArmy);
    j["revision"] = revision;
    j["population"] = {{"civilian", game->civilian},   {"military", game->military()},
                       {"reserved", game->reserved()}, {"current", game->population()},
                       {"capacity", game->housing()},  {"free", game->freeHousing()}};
    j["townHallLevel"] = game->townHallLevel();
    j["researchLevels"] = Json::object();
    auto technologyDamageBonus = [&](Domain domain) {
        int bonus = 0;
        for (const auto &id : game->technologies) {
            const auto &technology = game->config.tech(id);
            if (technology.domain == domain) bonus += technology.damage;
        }
        return bonus;
    };
    j["unitCatalog"] = game->config.raw.at("units");
    for (auto &u : j["unitCatalog"]) {
        auto type = u.at("id").get<std::string>();
        const auto &def = game->config.unit(type);
        u.erase("enemyBaseHealth");
        u.erase("enemyBaseDamage");
        if (!def.burstEvery) u.erase("burstMultiplier");
        u["footprint"] = {def.width, def.height};
        u["researchLevel"] = game->researchLevel(type);
        u["researchMaxLevel"] = game->researchLimit(type, 10);
        u["academyResearchLimit"] = game->researchLimit(type, game->completedLevel("academy"));
        u["baseHealth"] = def.health;
        u["baseDamage"] = def.damage;
        u["damageMatchesAttack"] = game->config.playerDamageMatchesAttack;
        u["effectiveHealth"] = game->unitHealth(type);
        u["effectiveDamage"] = game->unitDamage(type);
        u["technologyDamageBonus"] = technologyDamageBonus(def.domain);
        u["researchHealthBonus"] = game->unitHealth(type) - def.health;
        u["researchDamageBonus"] = game->unitDamage(type) - def.damage;
        u["researchBonusPercent"] = Game::researchBonusPercent(game->researchLevel(type));
        if (game->unitShield(type, def.health, 0) > 0) {
            u["baseShield"] = game->unitShield(type, def.health, 0);
            u["effectiveShield"] = game->unitShield(type, game->unitHealth(type));
            if (type == "heavy_infantry" || type == "attack_submarine")
                u["shieldPercent"] = type == "heavy_infantry" ? 50 : 100;
        }
        if (game->unitHealing(type, def.health) > 0) {
            u["baseHealing"] = game->unitHealing(type, def.health);
            u["effectiveHealing"] = game->unitHealing(type, game->unitHealth(type));
            u["healingPercent"] = type == "infantry" ? 50 : 45;
        }
        j["researchLevels"][type] = game->researchLevel(type);
    }
    j["buildOptions"] = Json::object();
    for (const auto &def : game->config.buildings) {
        auto available = game->buildingRequirements(def.id);
        j["buildOptions"][def.id] = {{"ok", available.ok}, {"reason", available.message},
            {"cap", game->buildingLimit(def.id)}, {"maxLevel", def.levels.size()},
            {"exists", std::any_of(game->buildings.begin(), game->buildings.end(), [&](const auto &b) { return b.type == def.id; })},
            {"cost", resourceCost(def.levels.front().cost)}, {"seconds", def.levels.front().seconds},
            {"requiredTownHall", def.levels.front().townHall}};
    }
    for (auto &u : j["units"]) {
        const auto &def = game->config.unit(u.at("type"));
        auto slots = def.carrierSlots;
        u["footprint"] = {def.width, def.height};
        u["carrierSlots"] = slots;
        u["maxHealth"] = game->unitHealth(u.at("type"));
        u["damage"] = game->unitDamage(u.at("type"));
        if (slots && game->config.raw.value("armyAbilitiesVersion", 0) >= 1) {
            auto id = u.at("id").get<Id>();
            u["damage"] = game->carrierAttackDamage(id);
            for (auto domain : {Domain::Land, Domain::Naval, Domain::Air})
                u["damageByDomain"][domainName(domain)] = game->carrierAttackDamage(id, domain);
        }
        if (game->unitShield(u.at("type"), game->unitHealth(u.at("type"))))
            u["maxShield"] = game->unitShield(u.at("type"), game->unitHealth(u.at("type")));
        if (game->unitHealing(u.at("type"), game->unitHealth(u.at("type"))))
            u["healing"] = game->unitHealing(u.at("type"), game->unitHealth(u.at("type")));
        u["researchLevel"] = game->researchLevel(u.at("type"));
        u["aircraftCount"] = std::count_if(game->units.begin(), game->units.end(), [&](const auto &a) { return a.carrier == u.at("id").get<Id>(); });
    }
    if (game->battle)
        for (auto &f : j["battle"]["fighters"]) {
            const auto &d = game->config.unit(f.at("type") == "raider" ? "infantry" : f.at("type").get<std::string>());
            f["carrierSlots"] = d.carrierSlots;
            const auto fighter = std::find_if(game->battle->fighters.begin(), game->battle->fighters.end(),
                                               [&](const Fighter &value) { return value.id == f.at("id").get<Id>(); });
            if (!fighter->enemy && d.carrierSlots && game->config.raw.value("armyAbilitiesVersion", 0) >= 1) {
                f["damage"] = game->fighterAttackDamage(*fighter);
                for (auto domain : {Domain::Land, Domain::Naval, Domain::Air})
                    f["damageByDomain"][domainName(domain)] = game->fighterAttackDamage(*fighter, domain);
            }
            if (game->attacksPerTurn(*fighter) > 1) {
                f["attacksPerTurn"] = game->attacksPerTurn(*fighter);
                f["attacksRemaining"] = fighter->attacked ? 0 : game->attacksPerTurn(*fighter) - fighter->attacksThisTurn;
            }
            f["maxShield"] = game->maxBattleShield(*fighter);
            f["healing"] = game->unitHealing(d.id, f.at("maxHealth"));
            f["aircraftCount"] = std::count_if(game->battle->fighters.begin(), game->battle->fighters.end(), [&](const auto &a) { return a.carrier == f.at("id").get<Id>() && a.health > 0; });
        }
    for (auto &b : j["buildings"]) {
        auto id = b.at("id").get<Id>();
        auto building = game->findBuilding(id);
        auto &def = game->config.building(building->type);
        auto &l = game->level(*building);
        b["production"] = {{"resource", def.resource},
                           {"rate", building->state == State::Construction ? 0.0 : game->progression() ? l.ratePerHour / 3600.0 : double(l.rate)},
                           {"ratePerHour", building->state == State::Construction ? 0 : game->progression() ? l.ratePerHour : l.rate * 3600},
                           {"intervalSeconds", building->state == State::Construction || def.resource < 0 || !l.ratePerHour ? 0 : 3600 / l.ratePerHour},
                           {"capacity", l.capacity},
                           {"full", l.capacity > 0 && building->stored >= l.capacity}};
        b["housing"] = building->state == State::Construction ? 0 : l.housing;
        b["completedLevel"] = building->state == State::Construction ? 0 : building->level;
        b["maxLevel"] = def.levels.size();
        b["townHallCap"] = game->buildingLimit(building->type);
        b["footprint"] = {def.width, def.height};
        auto upgrade = game->upgradeRequirements(id);
        b["upgrade"] = {{"ok", upgrade.ok}, {"reason", upgrade.message}, {"nextLevel", building->level + 1}};
        if (building->level < static_cast<int>(def.levels.size())) {
            b["upgrade"]["cost"] = resourceCost(def.levels[building->level].cost);
            b["upgrade"]["seconds"] = def.levels[building->level].seconds;
        }
        b["training"] = Json::array();
        for (auto &unit : game->config.units)
            if (unit.building == building->type)
                b["training"].push_back(
                    {{"type", unit.id}, {"requirements", game->trainingRequirements(id, unit.id)}});
        b["researchOptions"] = Json::array();
        if (building->type == "academy" && game->progression())
            for (const auto &unit : game->config.units) {
                auto r = game->researchRequirements(id, unit.id);
                int level = game->researchLevel(unit.id);
                b["researchOptions"].push_back({{"type", unit.id}, {"unitType", unit.id}, {"name", unit.name},
                    {"level", level}, {"nextLevel", level + 1}, {"maxLevel", game->researchLimit(unit.id, 10)},
                    {"academyLimit", game->researchLimit(unit.id, building->state == State::Construction ? 0 : building->level)},
                    {"requiredAcademyLevel", game->researchAcademyLevel(unit.id, level + 1)},
                    {"preservedLevel", game->preservedResearchLevels.contains(unit.id) ? game->preservedResearchLevels.at(unit.id) : 0},
                    {"cost", resourceCost(game->researchCost(unit.id))}, {"seconds", game->researchSeconds(unit.id)},
                    {"bonusPercent", Game::researchBonusPercent(level)},
                    {"nextBonusPercent", Game::researchBonusPercent(std::min(MaximumResearchLevel, level + 1))},
                    {"currentHealth", game->unitHealth(unit.id)}, {"currentDamage", game->unitDamage(unit.id) + technologyDamageBonus(unit.domain)},
                    {"nextHealth", Game::researchStat(unit.health, std::min(MaximumResearchLevel, level + 1))},
                    {"nextDamage", Game::researchStat(unit.damage, std::min(MaximumResearchLevel, level + 1)) + technologyDamageBonus(unit.domain)},
                    {"ok", r.ok}, {"reason", r.message}});
                auto &option = b["researchOptions"].back();
                if (game->unitShield(unit.id, game->unitHealth(unit.id))) {
                    option["currentShield"] = game->unitShield(unit.id, game->unitHealth(unit.id));
                    option["nextShield"] = game->unitShield(unit.id, Game::researchStat(unit.health, std::min(MaximumResearchLevel, level + 1)), std::min(MaximumResearchLevel, level + 1));
                }
                if (game->unitHealing(unit.id, game->unitHealth(unit.id))) {
                    option["currentHealing"] = game->unitHealing(unit.id, game->unitHealth(unit.id));
                    option["nextHealing"] = game->unitHealing(unit.id, Game::researchStat(unit.health, std::min(MaximumResearchLevel, level + 1)));
                }
            }
        else if (building->type == "academy")
            for (auto &tech : game->config.technologies) {
                auto r = game->researchRequirements(id, tech.id);
                b["researchOptions"].push_back({{"type", tech.id}, {"ok", r.ok}, {"reason", r.message}});
            }
    }
    stringIds(j);
    return j.dump();
}
std::string Engine::save() const {
    requireGame();
    return encodeSave(*game);
}
std::string Engine::load(const std::string &bytes) {
    try {
        requireGame();
        auto candidate = std::make_unique<Game>(decodeSave(*newGameConfig, bytes));
        game = std::move(candidate);
        ++revision;
        return result(Result::success("Game loaded."));
    } catch (const std::exception &e) {
        return result(Result::fail(e.what()), "INVALID_SAVE");
    }
}
} // namespace kingdom
