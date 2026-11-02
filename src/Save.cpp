#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <sstream>
#include <stdexcept>

namespace kingdom {
namespace {
void ensure(bool ok, const std::string &why) {
    if (!ok)
        throw std::runtime_error(why);
}
Json savedFighter(const Fighter &v) {
    Json result = {{"id", v.id}, {"type", v.type}, {"enemy", v.enemy},
            {"position", Json::array({v.pos.x, v.pos.y})},
            {"health", v.health}, {"maxHealth", v.maxHealth}, {"damage", v.damage},
            {"defense", v.defense}, {"range", v.range}, {"movement", v.movement},
            {"moved", v.moved}, {"attacked", v.attacked},
            {"domain", domainName(v.domain)}, {"phase", domainName(v.phase)},
            {"carrier", v.carrier ? Json(v.carrier) : Json(nullptr)},
            {"shield", v.shield}, {"readyRound", v.readyRound}, {"strikes", v.strikes},
            {"enemyId", v.enemyId}, {"name", v.name}, {"assetPath", v.assetPath}};
    if (v.stunnedUntilRound) result["stunnedUntilRound"] = v.stunnedUntilRound;
    if (v.attacksThisTurn) result["attacksThisTurn"] = v.attacksThisTurn;
    if (v.potionShield) result["potionShield"] = v.potionShield;
    if (v.defeatedPhase >= 0) result["defeatedPhase"] = v.defeatedPhase;
    return result;
}
Fighter loadedFighter(const Json &f) {
    ensure(f.at("position").is_array() && f.at("position").size() == 2, "Invalid position");
    Fighter loaded;
    loaded.id = f.at("id"); loaded.type = f.at("type"); loaded.enemy = f.at("enemy");
    loaded.pos = {f.at("position")[0], f.at("position")[1]};
    loaded.health = f.at("health"); loaded.maxHealth = f.at("maxHealth"); loaded.damage = f.at("damage");
    loaded.defense = f.at("defense"); loaded.range = f.at("range"); loaded.movement = f.at("movement");
    loaded.moved = f.at("moved"); loaded.attacked = f.at("attacked");
    loaded.domain = domainFromName(f.value("domain", "land"));
    loaded.phase = domainFromName(f.value("phase", domainName(loaded.domain)));
    loaded.carrier = f.contains("carrier") && !f.at("carrier").is_null() ? f.at("carrier").get<Id>() : 0;
    loaded.shield = f.value("shield", 0);
    loaded.potionShield = f.value("potionShield", 0);
    loaded.defeatedPhase = f.value("defeatedPhase", -1);
    loaded.readyRound = f.value("readyRound", 1);
    loaded.strikes = f.value("strikes", 0);
    loaded.attacksThisTurn = f.value("attacksThisTurn", 0);
    loaded.stunnedUntilRound = f.value("stunnedUntilRound", 0);
    loaded.enemyId = f.value("enemyId", "");
    loaded.name = f.value("name", "");
    loaded.assetPath = f.value("assetPath", "");
    return loaded;
}
bool legacyFootprints(Json &saved, const Json &current) {
    bool changed = false;
    for (const auto &expected : current.at("buildings")) {
        auto id = expected.at("id").get<std::string>();
        auto found = std::find_if(saved["buildings"].begin(), saved["buildings"].end(),
                                  [&](const Json &b) { return b.at("id") == id; });
        if (found == saved["buildings"].end())
            continue;
        Json previous = id == "townhall" || id == "airbase" ? Json{2, 2}
                        : id == "farm"                      ? Json{2, 1}
                                                            : Json{1, 1};
        Json next = id == "townhall" ? Json{3, 3} : Json{2, 2};
        if (expected.at("footprint") == next && found->at("footprint") == previous && previous != next) {
            (*found)["footprint"] = next;
            changed = true;
        }
    }
    return changed;
}
bool legacyHousing(const Json &saved, const Json &current) {
    if (saved.at("population").at("initial") != 18 || current.at("population").at("initial") != 5 ||
        saved.at("startingBuildings") !=
            Json::parse(
                R"([{"type":"townhall","offset":[-1,-1]},{"type":"house","offset":[-2,-2]},{"type":"house","offset":[0,-2]},{"type":"house","offset":[2,-2]},{"type":"farm","offset":[-2,1]},{"type":"lumberyard","offset":[2,0]},{"type":"barracks","offset":[1,2]}])") ||
        current.at("startingBuildings") != Json::parse(R"([{"type":"townhall","offset":[-1,-1]}])"))
        return false;
    auto adjusted = saved;
    adjusted["population"]["initial"] = current.at("population").at("initial");
    adjusted["startingBuildings"] = current.at("startingBuildings");
    for (const auto &expected : current.at("buildings")) {
        auto id = expected.at("id").get<std::string>();
        if (id != "townhall" && id != "house")
            continue;
        auto found = std::find_if(adjusted["buildings"].begin(), adjusted["buildings"].end(),
                                  [&](const Json &b) { return b.at("id") == id; });
        if (found == adjusted["buildings"].end() || found->at("levels").size() != 3 ||
            expected.at("levels").size() != 3)
            return false;
        for (int i = 0; i < 3; ++i) {
            int previous = id == "townhall" ? 0 : (i + 1) * 12;
            int next = id == "townhall" ? (i + 1) * 5 : (2 << i);
            if (found->at("levels")[i].at("housing") != previous ||
                expected.at("levels")[i].at("housing") != next)
                return false;
            (*found)["levels"][i]["housing"] = next;
        }
    }
    return adjusted == current;
}
bool previousTownHallPopulation(const Json &saved, const Json &current) {
    const int before[] = {0, 100, 200, 300, 450, 600, 750, 900, 1100, 1300};
    const int after[] = {0, 50, 100, 150, 200, 300, 400, 550, 700, 850};
    auto adjusted = saved;
    for (auto &building : adjusted.at("buildings")) {
        if (building.at("id") != "townhall") continue;
        const auto &buildings = current.at("buildings");
        const auto hall = std::find_if(buildings.begin(), buildings.end(),
                                      [](const Json &entry) { return entry.at("id") == "townhall"; });
        if (hall == buildings.end() || building.at("levels").size() != 10 || hall->at("levels").size() != 10)
            return false;
        for (int level = 0; level < 10; ++level) {
            if (building["levels"][level].at("populationRequired") != before[level] ||
                hall->at("levels")[level].at("populationRequired") != after[level]) return false;
            building["levels"][level]["populationRequired"] = after[level];
        }
        return adjusted == current;
    }
    return false;
}
std::optional<Config> militaryUpgrade(const Config &current, const Json &saved) {
    if (!current.raw.contains("militaryMigration")) return std::nullopt;
    auto baseline = current.raw;
    const auto &migration = current.raw.at("militaryMigration");
    baseline.erase("militaryMigration");
    baseline.erase("militaryVersion");
    baseline["units"] = migration.at("units");
    baseline["battle"] = migration.at("battle");
    baseline["townHallLimits"] = migration.at("townHallLimits");
    for (auto &b : baseline["buildings"])
        if (b.at("id") == "townhall" || b.at("id") == "barracks" ||
            b.at("id") == "harbor" || b.at("id") == "airbase")
            b["levels"].erase(b["levels"].begin() + 3, b["levels"].end());
    auto previous = gameplayConfig(baseline);
    bool prior = saved == previous;
    bool oldHousing = legacyHousing(saved, previous);
    for (bool preserveOldHousing : {false, true}) {
        auto upgraded = current.raw;
        // Existing personnel, health, costs and queue timers retain their historical balance.
        for (auto &u : upgraded["units"])
            for (const auto &old : migration.at("units"))
                if (u.at("id") == old.at("id"))
                    for (auto it = old.begin(); it != old.end(); ++it)
                        if (it.key() != "name") u[it.key()] = it.value();
        if (preserveOldHousing) {
            upgraded["population"]["initial"] = 18;
            upgraded["startingBuildings"] = Json::parse(R"([{"type":"townhall","offset":[-1,-1]},{"type":"house","offset":[-2,-2]},{"type":"house","offset":[0,-2]},{"type":"house","offset":[2,-2]},{"type":"farm","offset":[-2,1]},{"type":"lumberyard","offset":[2,0]},{"type":"barracks","offset":[1,2]}])");
            for (auto &b : upgraded["buildings"])
                for (int i = 0; i < 3; ++i) {
                    if (b.at("id") == "townhall") b["levels"][i]["housing"] = 0;
                    if (b.at("id") == "house") b["levels"][i]["housing"] = (i + 1) * 12;
                }
        }
        if ((prior && !preserveOldHousing) || (oldHousing && preserveOldHousing) ||
            saved == gameplayConfig(upgraded)) return Config::parse(upgraded);
    }
    return std::nullopt;
}
Json position(Pos p) {
    return Json::array({p.x, p.y});
}
Pos position(const Json &j) {
    ensure(j.is_array() && j.size() == 2, "Invalid position");
    return {j.at(0).get<int>(), j.at(1).get<int>()};
}
std::string checksum(const std::string &s) {
    std::uint64_t hash = 14695981039346656037ull;
    for (unsigned char c : s) {
        hash ^= c;
        hash *= 1099511628211ull;
    }
    std::ostringstream out;
    out << std::hex << hash;
    return out.str();
}
} // namespace
Json Game::serialize(bool includePersistence) const {
    Json j = {{"schemaVersion", 1},
              {"generatorVersion", world.generator},
              {"seed", world.seed},
              {"stock", stock},
              {"civilian", civilian},
              {"elapsedMs", elapsedMs},
              {"pendingMs", pendingMs},
              {"settlementRemainder", settlementRemainder},
              {"technologies", technologies},
              {"researchLevels", researchLevels}};
    if (includePersistence && shopSequence) j["shopSequence"] = shopSequence;
    if (config.raw.contains("magic")) {
        j["magic"] = {{"version", 1}, {"level", completedLevel("laboratory")}, {"potions", potions}, {"sequence", potionSequence}, {"brewing", Json::array()}};
        for (const auto &task : brewing) j["magic"]["brewing"].push_back({{"type", task.type}, {"remainingMs", task.remainingMs}});
    }
    if (includePersistence) {
        auto savedConfig = config.raw;
        savedConfig["world"]["generatorVersion"] = world.generator;
        j["config"] = std::move(savedConfig);
        j["nextId"] = nextId;
        j["nextBattleId"] = nextBattleId;
        j["appliedRewards"] = appliedRewards;
        j["savedAtUTC"] = std::chrono::duration_cast<std::chrono::seconds>(
                              std::chrono::system_clock::now().time_since_epoch())
                              .count();
    }
    if (config.raw.contains("campaign"))
        j["campaign"] = {{"currentLevel", campaignCurrentLevel()}, {"completedLevels", completedCampaignLevels},
                         {"completed", completedCampaignLevels.size() == config.raw.at("campaign").at("levels").size()}};
    if (progression()) {
        j["researchRulesVersion"] = 2;
        j["researchBonusVersion"] = 2;
        if (!preservedResearchLevels.empty()) j["preservedResearchLevels"] = preservedResearchLevels;
    }
    if (legacyProgression) {
        j["legacyProgression"] = true;
        j["legacyHousingCapacity"] = legacyHousingCapacity;
    }
    if (preservedArmyPopulation) j["preservedArmyPopulation"] = preservedArmyPopulation;
    if (!clearedTrees.empty()) {
        j["clearedTrees"] = Json::array();
        for (auto p : clearedTrees)
            j["clearedTrees"].push_back(position(p));
    }
    j["buildings"] = Json::array();
    for (auto &b : buildings) {
        Json q = Json::array();
        for (auto &t : b.queue) {
            Json entry = {{"type", t.type}, {"remainingMs", t.remainingMs}, {"awaiting", t.awaiting}};
            if (t.paidCost) entry["paidCost"] = *t.paidCost;
            q.push_back(entry);
        }
        j["buildings"].push_back({{"id", b.id},
                                  {"type", b.type},
                                  {"position", position(b.pos)},
                                  {"level", b.level},
                                  {"state", static_cast<int>(b.state)},
                                  {"remainingMs", b.remainingMs},
                                  {"stored", b.stored},
                                  {"remainder", b.remainder},
                                  {"queue", q}});
    }
    j["units"] = Json::array();
    for (auto &u : units)
        j["units"].push_back({{"id", u.id},
                              {"source", u.source},
                              {"type", u.type},
                              {"position", position(u.pos)},
                              {"health", u.health}, {"carrier", u.carrier ? Json(u.carrier) : Json(nullptr)}, {"reserve", u.reserve}});
    j["research"] = Json::array();
    for (auto &r : research)
        j["research"].push_back({{"type", r.type}, {"academy", r.academy}, {"remainingMs", r.remainingMs}, {"level", r.level}});
    j["battle"] = nullptr;
    if (battle) {
        Json f = Json::array();
        for (const auto &fighter : battle->fighters) f.push_back(savedFighter(fighter));
        j["battle"] = {{"id", battle->id},
                       {"round", battle->round},
                       {"finished", battle->finished},
                       {"victory", battle->victory},
                       {"fighters", f},
                       {"combatVersion", 8},
                       {"campaignLevel", battle->campaignLevel},
                       {"awaitingSelection", battle->awaitingSelection},
                       {"retreated", battle->retreated},
                       {"domain", domainName(battle->domain)},
                       {"phaseIndex", battle->phaseIndex},
                       {"outcomes", battle->outcomes},
                       {"draw", battle->draw},
                       {"automatic", battle->automatic},
                       {"enemyTurn", battle->enemyTurn},
                       {"paused", battle->paused},
                       {"pendingMs", battle->pendingMs},
                       {"actions", battle->actions},
                       {"phases", Json::array()},
                       {"lastAttacks", Json::array()}};
        if (battle->doubleAttack) j["battle"]["doubleAttack"] = true;
        if (battle->animationMs) j["battle"]["animationMs"] = battle->animationMs;
        if (battle->potionEvent) {
            j["battle"]["potionEvent"] = battle->potionEvent;
            j["battle"]["lastPotion"] = battle->lastPotion;
            j["battle"]["potionTargets"] = Json::array();
            for (Id id : battle->potionTargets) j["battle"]["potionTargets"].push_back(std::to_string(id));
        }
        if (battle->campaignLevel) {
            j["battle"]["campaignArmyIds"] = Json::array();
            if (includePersistence) j["battle"]["campaignArmy"] = Json::array();
            for (const auto &saved : battle->campaignArmy) {
                j["battle"]["campaignArmyIds"].push_back(std::to_string(saved.id));
                if (includePersistence) {
                    auto active = std::find_if(battle->fighters.begin(), battle->fighters.end(),
                                                [&](const auto &fighter) { return !fighter.enemy && fighter.id == saved.id; });
                    j["battle"]["campaignArmy"].push_back(savedFighter(active == battle->fighters.end() ? saved : *active));
                }
            }
        }
        for (auto domain : battle->phases)
            j["battle"]["phases"].push_back(domainName(domain));
        for (auto hit : battle->lastAttacks) {
            Json saved = {{"attacker", hit.attacker}, {"target", hit.target}, {"damage", hit.damage}, {"shieldDamage", hit.shieldDamage}, {"missed", hit.missed}, {"healing", hit.healing}};
            if (hit.stunTurns) saved["stunTurns"] = hit.stunTurns;
            if (hit.attackerStunned) saved["attackerStunned"] = true;
            j["battle"]["lastAttacks"].push_back(std::move(saved));
        }
    }
    return j;
}
Game Game::deserialize(Config c, const Json &j) {
    ensure(j.at("schemaVersion") == 1, "Unsupported save version");
    if (c.raw.value("finalLandBossBalanceVersion", 0) == 1 && !j.at("config").contains("finalLandBossBalanceVersion")) {
        auto previous = c.raw;
        previous.erase("finalLandBossBalanceVersion");
        for (auto &level : previous["campaign"]["levels"])
            if (level.at("battleId") == 150)
                for (auto &round : level["rounds"])
                    if (round.at("domain") == "land") {
                        round.erase("enemyFinalHealthPercents");
                        round.erase("enemyFinalAttackPercents");
                    }
        // Validate the previous rules before applying the final land boss reduction once.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle && migrated.battle->campaignLevel == 150 && migrated.battle->domain == Domain::Land) {
            const auto &round = migrated.campaignLevelDefinition(150).at("rounds").at(migrated.battle->phaseIndex);
            const auto healthPercents = round.value("enemyFinalHealthPercents", Json::object());
            const auto attackPercents = round.value("enemyFinalAttackPercents", Json::object());
            const auto reduce = [](int value, int percent) {
                return std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
            };
            for (auto &fighter : migrated.battle->fighters) {
                if (!fighter.enemy) continue;
                if (healthPercents.contains(fighter.enemyId)) {
                    const int consumedShield = migrated.maxBattleShield(fighter) - fighter.shield;
                    const int percent = healthPercents.at(fighter.enemyId);
                    fighter.maxHealth = reduce(fighter.maxHealth, percent);
                    if (fighter.health > 0) fighter.health = reduce(fighter.health, percent);
                    fighter.shield = std::max(0, migrated.maxBattleShield(fighter) - consumedShield);
                }
                if (attackPercents.contains(fighter.enemyId))
                    fighter.damage = reduce(fighter.damage, attackPercents.at(fighter.enemyId));
            }
            for (auto &hit : migrated.battle->lastAttacks) {
                const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                    [&](const Fighter &fighter) { return fighter.id == hit.target; });
                if (target != migrated.battle->fighters.end() && target->enemy && healthPercents.contains(target->enemyId))
                    hit.damage = std::min(hit.damage, target->maxHealth);
            }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("combatRulesVersion", 1) == 2 && !j.at("config").contains("combatRulesVersion")) {
        auto previous = c.raw;
        previous.erase("combatRulesVersion");
        for (auto &unit : previous["units"])
            if (unit.at("id") == "phantom_bomber" || unit.at("id") == "stealth_cruiser")
                for (auto &ability : unit["abilities"]) if (ability == "stun_attackers") ability = "stun_on_hit";
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        std::vector<Id> skipped;
        if (migrated.battle && !migrated.battle->finished && !migrated.battle->enemyTurn) {
            auto &battle = *migrated.battle;
            const bool automatic = battle.automatic, paused = battle.paused;
            battle.automatic = battle.paused = false;
            // Real actions advance readyRound. Recover only units skipped for having no legal target.
            for (auto &fighter : battle.fighters)
                if (!fighter.enemy && !fighter.carrier && fighter.phase == battle.domain && fighter.attacked &&
                    fighter.health > 0 && fighter.readyRound <= battle.round) {
                    fighter.attacked = false;
                    if (migrated.validBattleTargets(fighter.id).empty()) skipped.push_back(fighter.id);
                    fighter.attacked = true;
                }
            battle.automatic = automatic; battle.paused = paused;
        }
        migrated.config = std::move(c);
        if (!skipped.empty()) {
            for (auto &fighter : migrated.battle->fighters)
                if (std::find(skipped.begin(), skipped.end(), fighter.id) != skipped.end()) fighter.attacked = false;
            migrated.normalizeBattleTurn();
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").contains("playerArmorEnabled")) {
        const auto &savedBattle = j.at("config").at("battle");
        const bool present = savedBattle.contains("playerArmorEnabled");
        ensure(!present || savedBattle.at("playerArmorEnabled").is_boolean(), "Invalid saved player armor rules");
        if (!present || (!c.playerArmorEnabled && savedBattle.at("playerArmorEnabled").get<bool>())) {
            auto previous = c.raw;
            if (present) previous["battle"]["playerArmorEnabled"] = true;
            else previous["battle"].erase("playerArmorEnabled");
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            migrated.config = std::move(c);
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.value("eliteArmyVersion", 0) == 1 && !j.at("config").contains("eliteArmyVersion")) {
        auto previous = c.raw;
        previous.erase("eliteArmyVersion");
        const std::map<std::string, int> baseline = {{"stealth_cruiser", 230}, {"plasma_tank", 180}, {"titan_mech", 225}};
        for (auto &unit : previous["units"]) {
            const auto type = unit.at("id").get<std::string>();
            if (baseline.contains(type)) { unit["damage"] = baseline.at(type); unit.erase("enemyBaseDamage"); }
            if (type == "titan_mech") unit["abilities"] = {"energy_shield", "periodic_burst"};
            if (type == "plasma_fighter") {
                unit["abilities"] = {"energy_shield", "attack_all_air"};
                unit["splashTargets"] = 0; unit["splashPercent"] = 40;
                unit["role"] = "Shielded fighter that attacks every opposing aircraft";
            }
            if (type == "stealth_cruiser") unit["abilities"] = {"stealth"};
            if (type == "phantom_bomber") unit["abilities"] = {"area_attack", "stealth", "surface_strike"};
        }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        std::map<std::string, int> oldDamage;
        for (const auto &[type, damage] : baseline) oldDamage[type] = migrated.unitDamage(type);
        migrated.config = std::move(c);
        if (migrated.battle) {
            const auto upgrade = [&](Fighter &f) {
                if (!f.enemy && oldDamage.contains(f.type)) f.damage += migrated.unitDamage(f.type) - oldDamage.at(f.type);
            };
            for (auto &f : migrated.battle->fighters) upgrade(f);
            for (auto &f : migrated.battle->campaignArmy) upgrade(f);
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("academyPricingVersion", 0) == 1 && !j.at("config").contains("academyPricingVersion")) {
        auto previous = c.raw;
        previous.erase("academyPricingVersion");
        previous["research"].erase("additionalLevelCostPercent");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("armyAbilitiesVersion", 0) == 1 && !j.at("config").contains("armyAbilitiesVersion")) {
        auto previous = c.raw;
        previous.erase("armyAbilitiesVersion");
        for (auto &unit : previous["units"]) {
            if (unit.at("id") == "missile_launcher") { unit["abilities"] = {"area_attack"}; unit["splashTargets"] = 3; unit["validTargets"] = {"land"}; }
            if (unit.at("id") == "combat_drone") unit["abilities"] = {"surface_strike", "precision"};
            if (unit.at("id") == "titan_carrier") { unit["carrierSlots"] = 4; unit["allowedAircraftTiers"] = {1, 2, 3}; }
        }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.addCampaignAircraft();
        if (migrated.battle && !migrated.battle->finished) migrated.normalizeBattleTurn();
        migrated.validate();
        return migrated;
    }
    if (c.raw.contains("shop") && !j.at("config").contains("shop")) {
        auto previous = c.raw;
        previous.erase("shop");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("enemySubmarineMultiplierVersion", 0) == 1 && !j.at("config").contains("enemySubmarineMultiplierVersion")) {
        auto previous = c.raw;
        previous.erase("enemySubmarineMultiplierVersion");
        for (auto &enemy : previous["campaign"]["enemies"])
            if (enemy.at("id") == "W06") enemy.erase("damageMultipliers");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("campaignFinalAttackVersion", 0) == 1 && !j.at("config").contains("campaignFinalAttackVersion")) {
        auto previous = c.raw;
        previous.erase("campaignFinalAttackVersion");
        for (auto &level : previous["campaign"]["levels"])
            for (auto &round : level["rounds"]) round.erase("enemyFinalAttackPercents");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle && migrated.battle->campaignLevel) {
            const auto &round = migrated.campaignLevelDefinition(migrated.battle->campaignLevel)
                .at("rounds").at(migrated.battle->phaseIndex);
            if (round.contains("enemyFinalAttackPercents"))
                for (auto &fighter : migrated.battle->fighters) {
                    if (!fighter.enemy) continue;
                    const int percent = round.at("enemyFinalAttackPercents").value(fighter.enemyId, 100);
                    fighter.damage = std::max(1, static_cast<int>(static_cast<std::int64_t>(fighter.damage) * percent / 100));
                }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("academyResearchVersion", 0) == 1 && !j.at("config").contains("academyResearchVersion")) {
        auto previous = c.raw;
        previous.erase("academyResearchVersion");
        previous["research"]["maxLevel"] = 10;
        auto &costs = previous["research"]["baseCosts"];
        costs.erase(costs.begin() + 10, costs.end());
        // Validate the exact previous rules before unlocking additional paid improvements.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("earlyLandCampaignVersion", 0) == 1 && !j.at("config").contains("earlyLandCampaignVersion")) {
        auto previous = c.raw;
        previous.erase("earlyLandCampaignVersion");
        const auto naval = Json::parse(R"({"28":["W01","W02","W04"],"29":["W04","W01","W03"],"30":["W03","W04","W02","W03"]})");
        for (auto &level : previous["campaign"]["levels"]) {
            auto id = std::to_string(level.at("battleId").get<int>());
            if (naval.contains(id))
                level["rounds"].insert(level["rounds"].begin() + 1, Json{{"domain", "naval"}, {"enemies", naval.at(id)}});
        }
        const bool earlierHarbor = previous.value("campaignProgressionVersion", 0) == 1;
        for (auto &building : previous["buildings"])
            if (building.at("id") == "harbor") building["levels"][0]["townHallRequired"] = earlierHarbor ? 3 : 4;
        previous["buildingLimits"]["harbor"][2] = earlierHarbor ? 1 : 0;
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle && migrated.battle->campaignLevel >= 28 && migrated.battle->campaignLevel <= 30)
            migrated.migrateEarlyLandCampaign();
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("campaignProgressionVersion", 0) == 1 && !j.at("config").contains("campaignProgressionVersion")) {
        auto previous = c.raw;
        previous.erase("campaignProgressionVersion");
        for (auto &level : previous["campaign"]["levels"]) {
            if (level.contains("enemyTH")) {
                level["requiredTH"] = level.at("enemyTH");
                level.erase("enemyTH");
            }
            if (level.at("battleId").get<int>() <= 20) level["rewards"]["stone"] = level.at("rewards").at("food");
            if (level.at("battleId").get<int>() <= 50) level["rewards"]["iron"] = level.at("rewards").at("food");
        }
        for (auto &building : previous["buildings"])
            if (building.at("id") == "harbor") building["levels"][0]["townHallRequired"] = 4;
        previous["buildingLimits"]["harbor"][2] = 0;
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("heavyUnitAttackVersion", 0) == 1 && !j.at("config").contains("heavyUnitAttackVersion")) {
        auto previous = c.raw;
        previous.erase("heavyUnitAttackVersion");
        for (auto &unit : previous["units"])
            if (unit.at("id") == "heavy_tank" || unit.at("id") == "battleship") {
                unit["damage"] = unit.at("id") == "heavy_tank" ? 130 : 185;
                unit.erase("enemyBaseDamage");
            }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        const std::map<std::string, int> oldDamage = {{"heavy_tank", migrated.unitDamage("heavy_tank")},
                                                     {"battleship", migrated.unitDamage("battleship")}};
        migrated.config = std::move(c);
        if (migrated.battle) {
            const auto upgrade = [&](Fighter &fighter) {
                if (!fighter.enemy && oldDamage.contains(fighter.type))
                    fighter.damage += migrated.unitDamage(fighter.type) - oldDamage.at(fighter.type);
            };
            for (auto &fighter : migrated.battle->fighters) upgrade(fighter);
            for (auto &fighter : migrated.battle->campaignArmy) upgrade(fighter);
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("campaignShieldRulesVersion", 0) == 1 && !j.at("config").contains("campaignShieldRulesVersion")) {
        auto previous = c.raw;
        previous.erase("campaignShieldRulesVersion");
        for (auto &level : previous["campaign"]["levels"])
            for (auto &round : level["rounds"]) round.erase("unshieldedEnemies");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle && migrated.battle->campaignLevel)
            for (auto &fighter : migrated.battle->fighters)
                if (fighter.enemy) fighter.shield = std::min(fighter.shield, migrated.maxBattleShield(fighter));
        migrated.validate();
        return migrated;
    }
    if (c.raw.contains("laboratoryVersion") && !j.at("config").contains("laboratoryVersion")) {
        auto previous = c.raw;
        previous.erase("laboratoryVersion"); previous.erase("magic");
        previous["buildingLimits"].erase("laboratory");
        auto &definitions = previous["buildings"];
        definitions.erase(std::remove_if(definitions.begin(), definitions.end(), [](const Json &b) { return b.at("id") == "laboratory"; }), definitions.end());
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").contains("playerDamageMatchesAttack")) {
        const auto &savedBattle = j.at("config").at("battle");
        const bool present = savedBattle.contains("playerDamageMatchesAttack");
        ensure(!present || savedBattle.at("playerDamageMatchesAttack").is_boolean(), "Invalid saved player damage rules");
        if (!present || (c.playerDamageMatchesAttack && !savedBattle.at("playerDamageMatchesAttack").get<bool>())) {
            auto previous = c.raw;
            if (present) previous["battle"]["playerDamageMatchesAttack"] = false;
            else previous["battle"].erase("playerDamageMatchesAttack");
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            migrated.config = std::move(c);
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.value("campaignAttackAdjustmentsVersion", 0) == 1 && !j.at("config").contains("campaignAttackAdjustmentsVersion")) {
        auto previous = c.raw;
        previous.erase("campaignAttackAdjustmentsVersion");
        for (auto &level : previous["campaign"]["levels"])
            if (level.at("battleId") == 58)
                for (auto &round : level["rounds"]) round.erase("enemyAttackPercents");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle && migrated.battle->campaignLevel == 58) {
            auto &b = *migrated.battle;
            const auto &ids = migrated.campaignLevelDefinition(58).at("rounds").at(b.phaseIndex).at("enemies");
            for (auto &fighter : b.fighters) {
                if (!fighter.enemy || fighter.enemyId != "AI-W2") continue;
                const auto found = std::find(ids.begin(), ids.end(), Json(fighter.enemyId));
                ensure(found != ids.end(), "Unknown campaign ship");
                fighter.damage = migrated.campaignEnemyFighter(58, b.phaseIndex, static_cast<int>(found - ids.begin())).damage;
            }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").contains("attacksAlwaysHit")) {
        const auto &savedBattle = j.at("config").at("battle");
        const bool present = savedBattle.contains("attacksAlwaysHit");
        ensure(!present || savedBattle.at("attacksAlwaysHit").is_boolean(), "Invalid saved hit rules");
        if (!present || (c.attacksAlwaysHit && !savedBattle.at("attacksAlwaysHit").get<bool>())) {
            auto previous = c.raw;
            if (present) previous["battle"]["attacksAlwaysHit"] = false;
            else previous["battle"].erase("attacksAlwaysHit");
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            migrated.config = std::move(c);
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("shieldBreakStopsDamage")) {
        const auto &savedBattle = j.at("config").at("battle");
        const bool present = savedBattle.contains("shieldBreakStopsDamage");
        ensure(!present || savedBattle.at("shieldBreakStopsDamage").is_boolean(), "Invalid saved shield rules");
        if (!present || (c.shieldBreakStopsDamage && !savedBattle.at("shieldBreakStopsDamage").get<bool>())) {
            auto previous = c.raw;
            if (present) previous["battle"]["shieldBreakStopsDamage"] = false;
            else previous["battle"].erase("shieldBreakStopsDamage");
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            migrated.config = std::move(c);
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.value("enemyAttackBonusesVersion", 0) == 1 && !j.at("config").contains("enemyAttackBonusesVersion")) {
        auto previous = c.raw;
        previous.erase("enemyAttackBonusesVersion");
        for (auto &enemy : previous["campaign"]["enemies"])
            if (enemy.at("id") == "AI-G4") enemy.erase("attackBonuses");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("enemyAirBalanceVersion", 0) == 1 && !j.at("config").contains("enemyAirBalanceVersion")) {
        auto previous = c.raw;
        previous.erase("enemyAirBalanceVersion");
        for (auto &unit : previous["units"])
            if (unit.at("domain") == "air") {
                unit.erase("enemyBaseHealth");
                unit.erase("enemyBaseDamage");
            }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        if (migrated.battle) {
            auto &b = *migrated.battle;
            for (auto &f : b.fighters) {
                if (!f.enemy || f.domain != Domain::Air) continue;
                int health, damage;
                if (b.campaignLevel) {
                    const auto &ids = migrated.campaignLevelDefinition(b.campaignLevel).at("rounds").at(b.phaseIndex).at("enemies");
                    const auto found = std::find(ids.begin(), ids.end(), Json(f.enemyId));
                    ensure(found != ids.end(), "Unknown campaign aircraft");
                    const auto reference = migrated.campaignEnemyFighter(b.campaignLevel, b.phaseIndex, static_cast<int>(found - ids.begin()));
                    health = reference.maxHealth;
                    damage = reference.damage;
                } else {
                    const auto &opponent = migrated.config.unit(f.type);
                    const auto &base = migrated.config.unit("infantry");
                    health = migrated.adjustedEnemyHealth(migrated.enemyMaxHealth(std::max(1,
                        migrated.config.enemyHealth * opponent.enemyBaseHealth / base.enemyBaseHealth)));
                    damage = migrated.adjustedEnemyAttack(migrated.enemyAttackDamage(std::max(1,
                        migrated.config.enemyDamage * opponent.enemyBaseDamage / base.enemyBaseDamage)));
                }
                // Keep wounds and casualties while restoring the documented enemy maximum.
                f.health = f.health <= 0 ? 0 : std::clamp(static_cast<int>(std::lround(
                    static_cast<double>(f.health) * health / f.maxHealth)), 1, health);
                f.maxHealth = health;
                f.damage = damage;
            }
            for (auto &hit : b.lastAttacks) {
                const auto target = std::find_if(b.fighters.begin(), b.fighters.end(), [&](const auto &f) { return f.id == hit.target; });
                if (target != b.fighters.end() && target->enemy && target->domain == Domain::Air)
                    hit.damage = std::min(hit.damage, target->maxHealth);
            }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("armoredCarrierHealingVersion", 0) == 1 && !j.at("config").contains("armoredCarrierHealingVersion")) {
        auto previous = c.raw;
        previous.erase("armoredCarrierHealingVersion");
        for (auto &unit : previous["units"])
            if (unit.at("id") == "armored_carrier") {
                unit["abilities"] = Json::array();
                unit["role"] = "Balanced armored support";
            }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("aircraftBalanceVersion", 0) == 1 && !j.at("config").contains("aircraftBalanceVersion")) {
        auto previous = c.raw;
        previous.erase("aircraftBalanceVersion");
        previous.erase("aircraftBalanceMigration");
        for (auto &unit : previous["units"])
            for (const auto &old : c.raw.at("aircraftBalanceMigration").at("units"))
                if (unit.at("id") == old.at("id"))
                    for (const auto &key : {"health", "damage", "abilities", "role", "splashTargets", "splashPercent"}) unit[key] = old.at(key);
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        const auto oldConfig = migrated.config;
        std::map<std::string, int> oldHealth;
        for (const auto &d : oldConfig.units)
            if (d.domain == Domain::Air) oldHealth[d.id] = migrated.unitHealth(d.id);
        migrated.config = std::move(c);
        const auto scale = [](int value, int before, int after) {
            return value <= 0 ? 0 : std::max(1, static_cast<int>(std::lround(static_cast<double>(value) * after / before)));
        };
        for (auto &unit : migrated.units)
            if (oldHealth.contains(unit.type))
                unit.health = std::min(migrated.unitHealth(unit.type), scale(unit.health, oldHealth.at(unit.type), migrated.unitHealth(unit.type)));
        if (migrated.battle) {
            const auto upgrade = [&](Fighter &f) {
                if (f.enemy || !oldHealth.contains(f.type)) return;
                const int health = migrated.unitHealth(f.type);
                f.health = std::min(health, scale(f.health, f.maxHealth, health));
                f.maxHealth = health;
                f.damage = migrated.unitDamage(f.type);
            };
            for (auto &f : migrated.battle->fighters) upgrade(f);
            for (auto &f : migrated.battle->campaignArmy) upgrade(f);
            if (migrated.battle->campaignLevel) migrated.syncCampaignArmy();
            migrated.normalizeBattleTurn();
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").contains("enemyHealthAdjustments")) {
        const auto &currentAdjustments = c.raw.at("battle").at("enemyHealthAdjustments");
        const auto &savedBattle = j.at("config").at("battle");
        const bool savedAdjustmentField = savedBattle.contains("enemyHealthAdjustments");
        const auto savedAdjustments = savedBattle.value("enemyHealthAdjustments", Json::array());
        ensure(savedAdjustments.is_array() && savedAdjustments.size() <= currentAdjustments.size(),
               "Unsupported enemy health adjustments");
        for (std::size_t i = 0; i < savedAdjustments.size(); ++i)
            ensure(savedAdjustments[i].is_number_integer() && savedAdjustments[i] == currentAdjustments[i],
                   "Unknown previous enemy health adjustment");
        if (!savedAdjustmentField || savedAdjustments.size() < currentAdjustments.size()) {
            auto previous = c.raw;
            if (savedAdjustmentField) previous["battle"]["enemyHealthAdjustments"] = savedAdjustments;
            else previous["battle"].erase("enemyHealthAdjustments");
            // Keep earlier health and attack migrations ahead of newly appended health modifiers.
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            auto upgraded = migrated.config.raw;
            upgraded["battle"]["enemyHealthAdjustments"] = currentAdjustments;
            migrated.config = Config::parse(std::move(upgraded));
            if (migrated.battle) {
                for (auto &fighter : migrated.battle->fighters) {
                    if (!fighter.enemy) continue;
                    const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                    const int consumedShield = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - fighter.shield;
                    for (std::size_t i = savedAdjustments.size(); i < currentAdjustments.size(); ++i) {
                        const int percent = currentAdjustments[i].get<int>();
                        const auto reduce = [&](int value) {
                            return std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
                        };
                        fighter.maxHealth = reduce(fighter.maxHealth);
                        if (fighter.health > 0) fighter.health = reduce(fighter.health);
                    }
                    fighter.shield = std::max(0, migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - consumedShield);
                }
                for (auto &hit : migrated.battle->lastAttacks) {
                    const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                                                      [&](const Fighter &fighter) { return fighter.id == hit.target; });
                    if (target != migrated.battle->fighters.end() && target->enemy)
                        hit.damage = std::min(hit.damage, target->maxHealth);
                }
            }
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("enemyAttackAdjustments")) {
        const auto &currentAdjustments = c.raw.at("battle").at("enemyAttackAdjustments");
        const auto &savedBattle = j.at("config").at("battle");
        const bool savedAdjustmentField = savedBattle.contains("enemyAttackAdjustments");
        const auto savedAdjustments = savedBattle.value("enemyAttackAdjustments", Json::array());
        ensure(savedAdjustments.is_array() && savedAdjustments.size() <= currentAdjustments.size(),
               "Unsupported enemy attack adjustments");
        for (std::size_t i = 0; i < savedAdjustments.size(); ++i) {
            const auto &adjustment = savedAdjustments[i];
            ensure(adjustment.is_object() && adjustment.size() == 2 && adjustment.contains("percent") &&
                       adjustment.at("percent").is_number_integer() && adjustment.contains("bossOnly") &&
                       adjustment.at("bossOnly").is_boolean() && adjustment == currentAdjustments[i],
                   "Unknown previous enemy attack adjustment");
        }
        if (!savedAdjustmentField || savedAdjustments.size() < currentAdjustments.size()) {
            auto previous = c.raw;
            if (savedAdjustmentField) previous["battle"]["enemyAttackAdjustments"] = savedAdjustments;
            else previous["battle"].erase("enemyAttackAdjustments");
            // Apply new attack adjustments only after all historical balance migrations.
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            auto upgraded = migrated.config.raw;
            upgraded["battle"]["enemyAttackAdjustments"] = currentAdjustments;
            migrated.config = Config::parse(std::move(upgraded));
            if (migrated.battle) {
                for (auto &fighter : migrated.battle->fighters) {
                    if (!fighter.enemy) continue;
                    bool boss = false;
                    if (migrated.battle->campaignLevel) {
                        const auto &enemies = migrated.config.raw.at("campaign").at("enemies");
                        boss = std::any_of(enemies.begin(), enemies.end(), [&](const Json &enemy) {
                            return enemy.at("id") == fighter.enemyId && enemy.at("kind") == "boss";
                        });
                    }
                    for (std::size_t i = savedAdjustments.size(); i < currentAdjustments.size(); ++i) {
                        const auto &adjustment = currentAdjustments[i];
                        if (adjustment.at("bossOnly").get<bool>() && !boss) continue;
                        fighter.damage = std::max(1, static_cast<int>(
                            static_cast<std::int64_t>(fighter.damage) * adjustment.at("percent").get<int>() / 100));
                    }
                }
            }
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("bossHealthPercent") || c.raw.at("battle").contains("bossAttackPercent")) {
        const auto &currentBattle = c.raw.at("battle");
        const auto &savedBattle = j.at("config").at("battle");
        for (const auto *key : {"bossHealthPercent", "bossAttackPercent"})
            if (currentBattle.contains(key) && savedBattle.contains(key))
                ensure(savedBattle.at(key).is_number_integer() && savedBattle.at(key) >= 1 &&
                           savedBattle.at(key) <= 100 && savedBattle.at(key) == currentBattle.at(key),
                       "Unsupported saved boss balance");
        const bool reduceHealth = currentBattle.contains("bossHealthPercent") && !savedBattle.contains("bossHealthPercent");
        const bool reduceAttack = currentBattle.contains("bossAttackPercent") && !savedBattle.contains("bossAttackPercent");
        if (reduceHealth || reduceAttack) {
            auto previous = c.raw;
            if (reduceHealth) previous["battle"].erase("bossHealthPercent");
            if (reduceAttack) previous["battle"].erase("bossAttackPercent");
            // Validate the old rules before applying each newly introduced boss modifier once.
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            auto upgraded = migrated.config.raw;
            if (reduceHealth) upgraded["battle"]["bossHealthPercent"] = currentBattle.at("bossHealthPercent");
            if (reduceAttack) upgraded["battle"]["bossAttackPercent"] = currentBattle.at("bossAttackPercent");
            migrated.config = Config::parse(std::move(upgraded));
            if (migrated.battle && migrated.battle->campaignLevel) {
                const auto &enemies = migrated.config.raw.at("campaign").at("enemies");
                const auto isBoss = [&](const Fighter &fighter) {
                    return fighter.enemy && std::any_of(enemies.begin(), enemies.end(), [&](const Json &enemy) {
                        return enemy.at("id") == fighter.enemyId && enemy.at("kind") == "boss";
                    });
                };
                const auto reduce = [](int value, int percent) {
                    return std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
                };
                for (auto &fighter : migrated.battle->fighters) {
                    if (!isBoss(fighter)) continue;
                    if (reduceHealth) {
                        const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                        const int consumedShield = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - fighter.shield;
                        const int percent = currentBattle.at("bossHealthPercent").get<int>();
                        fighter.maxHealth = reduce(fighter.maxHealth, percent);
                        if (fighter.health > 0) fighter.health = reduce(fighter.health, percent);
                        fighter.shield = std::max(0, migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - consumedShield);
                    }
                    if (reduceAttack)
                        fighter.damage = reduce(fighter.damage, currentBattle.at("bossAttackPercent").get<int>());
                }
                if (reduceHealth)
                    for (auto &hit : migrated.battle->lastAttacks) {
                        const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                                                          [&](const Fighter &fighter) { return fighter.id == hit.target; });
                        if (target != migrated.battle->fighters.end() && isBoss(*target))
                            hit.damage = std::min(hit.damage, target->maxHealth);
                    }
            }
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("enemyStatAdjustments")) {
        const auto &currentAdjustments = c.raw.at("battle").at("enemyStatAdjustments");
        const auto &savedBattle = j.at("config").at("battle");
        const bool savedAdjustmentField = savedBattle.contains("enemyStatAdjustments");
        const auto savedAdjustments = savedBattle.value("enemyStatAdjustments", Json::array());
        ensure(savedAdjustments.is_array() && savedAdjustments.size() <= currentAdjustments.size(),
               "Unsupported enemy stat adjustments");
        for (std::size_t i = 0; i < savedAdjustments.size(); ++i)
            ensure(savedAdjustments[i].is_number_integer() && savedAdjustments[i] == currentAdjustments[i],
                   "Unknown previous enemy stat adjustment");
        if (!savedAdjustmentField || savedAdjustments.size() < currentAdjustments.size()) {
            auto previous = c.raw;
            if (savedAdjustmentField) previous["battle"]["enemyStatAdjustments"] = savedAdjustments;
            else previous["battle"].erase("enemyStatAdjustments");
            // Validate the historical rules before applying only newly appended adjustments.
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            auto upgraded = migrated.config.raw;
            upgraded["battle"]["enemyStatAdjustments"] = currentAdjustments;
            migrated.config = Config::parse(std::move(upgraded));
            if (migrated.battle) {
                const auto reduce = [](int value, int percent) {
                    return std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
                };
                for (auto &fighter : migrated.battle->fighters) {
                    if (!fighter.enemy) continue;
                    const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                    const int consumedShield = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - fighter.shield;
                    for (std::size_t i = savedAdjustments.size(); i < currentAdjustments.size(); ++i) {
                        const int percent = currentAdjustments[i].get<int>();
                        fighter.maxHealth = reduce(fighter.maxHealth, percent);
                        if (fighter.health > 0) fighter.health = reduce(fighter.health, percent);
                        fighter.damage = reduce(fighter.damage, percent);
                    }
                    fighter.shield = std::max(0, migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - consumedShield);
                }
                for (auto &hit : migrated.battle->lastAttacks) {
                    const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                                                      [&](const Fighter &fighter) { return fighter.id == hit.target; });
                    if (target != migrated.battle->fighters.end() && target->enemy)
                        hit.damage = std::min(hit.damage, target->maxHealth);
                }
            }
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("enemyStatPasses")) {
        const auto &savedBattle = j.at("config").at("battle");
        const bool savedPassField = savedBattle.contains("enemyStatPasses");
        if (savedPassField)
            ensure(savedBattle.at("enemyStatPasses").is_number_integer() &&
                       savedBattle.at("enemyStatPasses") >= 1 && savedBattle.at("enemyStatPasses") <= 10,
                   "Invalid saved enemy stat passes");
        const int savedPasses = savedBattle.value("enemyStatPasses", 1);
        ensure(savedPasses <= c.enemyStatPasses, "Unsupported enemy balance downgrade");
        if (!savedPassField || savedPasses < c.enemyStatPasses) {
            auto previous = c.raw;
            if (savedPassField) previous["battle"]["enemyStatPasses"] = savedPasses;
            else previous["battle"].erase("enemyStatPasses");
            // Validate the exact prior rules before applying only the additional balance passes.
            auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
            auto upgraded = migrated.config.raw;
            upgraded["battle"]["enemyStatPasses"] = c.raw.at("battle").at("enemyStatPasses");
            migrated.config = Config::parse(std::move(upgraded));
            if (migrated.battle) {
                const auto reduce = [&](int value) {
                    return std::max(1, static_cast<int>(
                        static_cast<std::int64_t>(value) * migrated.config.enemyStatPercent / 100));
                };
                for (auto &fighter : migrated.battle->fighters) {
                    if (!fighter.enemy) continue;
                    const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                    const int consumedShield = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - fighter.shield;
                    for (int pass = savedPasses; pass < migrated.config.enemyStatPasses; ++pass) {
                        fighter.maxHealth = reduce(fighter.maxHealth);
                        if (fighter.health > 0) fighter.health = reduce(fighter.health);
                        fighter.damage = reduce(fighter.damage);
                    }
                    fighter.shield = std::max(0, migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - consumedShield);
                }
                for (auto &hit : migrated.battle->lastAttacks) {
                    const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                                                      [&](const Fighter &fighter) { return fighter.id == hit.target; });
                    if (target != migrated.battle->fighters.end() && target->enemy)
                        hit.damage = std::min(hit.damage, target->maxHealth);
                }
            }
            migrated.validate();
            return migrated;
        }
    }
    if (c.raw.at("battle").contains("enemyStatPercent") &&
        !j.at("config").at("battle").contains("enemyStatPercent")) {
        auto previous = c.raw;
        previous["battle"].erase("enemyStatPercent");
        // Validate the exact previous rules before applying the new enemy balance once.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        auto upgraded = migrated.config.raw;
        upgraded["battle"]["enemyStatPercent"] = c.raw.at("battle").at("enemyStatPercent");
        migrated.config = Config::parse(std::move(upgraded));
        if (migrated.battle) {
            for (auto &fighter : migrated.battle->fighters) {
                if (!fighter.enemy) continue;
                const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                const int oldShieldCap = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1);
                const int consumedShield = oldShieldCap - fighter.shield;
                fighter.maxHealth = migrated.enemyMaxHealth(fighter.maxHealth);
                if (fighter.health > 0) fighter.health = migrated.enemyMaxHealth(fighter.health);
                fighter.damage = std::max(1, static_cast<int>(
                    static_cast<std::int64_t>(fighter.damage) * migrated.config.enemyStatPercent / 100));
                // Capacity reductions preserve damage already absorbed by health-based shields.
                fighter.shield = std::max(0, migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1) - consumedShield);
            }
            for (auto &hit : migrated.battle->lastAttacks) {
                const auto target = std::find_if(migrated.battle->fighters.begin(), migrated.battle->fighters.end(),
                                                  [&](const Fighter &fighter) { return fighter.id == hit.target; });
                if (target != migrated.battle->fighters.end() && target->enemy)
                    hit.damage = std::min(hit.damage, target->maxHealth);
            }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").value("enemySingleTarget", false) &&
        c.raw.at("battle").contains("enemyAttackPercent") &&
        !j.at("config").at("battle").contains("enemySingleTarget")) {
        auto previous = c.raw;
        previous["battle"].erase("enemySingleTarget");
        previous["battle"]["enemyAttackPercent"] = 50;
        // Validate the previous balance and all older migrations before updating attacks once.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        auto upgraded = migrated.config.raw;
        upgraded["battle"]["enemyAttackPercent"] = c.raw.at("battle").at("enemyAttackPercent");
        upgraded["battle"]["enemySingleTarget"] = true;
        migrated.config = Config::parse(std::move(upgraded));
        if (migrated.battle)
            for (auto &fighter : migrated.battle->fighters)
                if (fighter.enemy)
                    fighter.damage = std::max(1, static_cast<int>(
                        static_cast<std::int64_t>(fighter.damage) * migrated.config.enemyAttackPercent / 50));
        migrated.validate();
        return migrated;
    }
    if (c.raw.at("battle").contains("enemyAttackPercent") &&
        !j.at("config").at("battle").contains("enemyAttackPercent")) {
        auto previous = c.raw;
        previous["battle"].erase("enemyAttackPercent");
        // Validate the historical rules before applying this balance change once.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        auto upgraded = migrated.config.raw;
        upgraded["battle"]["enemyAttackPercent"] = c.raw.at("battle").at("enemyAttackPercent");
        migrated.config = Config::parse(std::move(upgraded));
        if (migrated.battle)
            for (auto &fighter : migrated.battle->fighters)
                if (fighter.enemy) fighter.damage = migrated.enemyAttackDamage(fighter.damage);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("unitAbilityVersion", 0) == 1 && !j.at("config").contains("unitAbilityVersion")) {
        auto previous = c.raw;
        previous.erase("unitAbilityVersion");
        for (auto &unit : previous["units"]) {
            const auto type = unit.at("id").get<std::string>();
            if (type == "infantry") {
                unit["abilities"] = Json::array();
                unit["role"] = "Cheap starting squad";
            } else if (type == "heavy_infantry") {
                unit["abilities"] = Json::array({"anti_infantry"});
                unit["shield"] = 0;
                unit["role"] = "Anti-infantry fire support";
            } else if (type == "armored_jeep") {
                unit["damage"] = 65;
                unit["abilities"] = Json::array({"anti_infantry"});
                unit["role"] = "Fast infantry raider";
            } else if (type == "frigate") {
                unit["abilities"] = Json::array({"detect_submarines"});
                unit["validTargets"] = Json::array({"naval", "air"});
                unit["role"] = "Anti-air and anti-submarine escort";
            } else if (type == "attack_submarine") {
                unit["abilities"] = Json::array({"submerged", "stealth"});
                unit["shield"] = 0;
                unit["role"] = "Hidden anti-ship torpedo attacks";
            }
        }
        // Validate every old gameplay field through the existing exact historical migrations.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        const auto oldConfig = migrated.config;
        const int oldJeepDamage = migrated.unitDamage("armored_jeep");
        auto upgraded = migrated.config.raw;
        upgraded["unitAbilityVersion"] = 1;
        for (auto &unit : upgraded["units"]) {
            const auto type = unit.at("id").get<std::string>();
            if (type != "infantry" && type != "heavy_infantry" && type != "armored_jeep" &&
                type != "frigate" && type != "attack_submarine") continue;
            const auto &current = c.raw.at("units");
            const auto definition = std::find_if(current.begin(), current.end(),
                                                  [&](const Json &entry) { return entry.at("id") == type; });
            ensure(definition != current.end(), "Missing upgraded unit definition");
            unit["abilities"] = definition->at("abilities");
            unit["role"] = definition->at("role");
            if (type == "heavy_infantry") unit["shield"] = unit.at("health").get<int>() / 2;
            if (type == "attack_submarine") unit["shield"] = unit.at("health");
            if (type == "armored_jeep") unit["damage"] = unit.at("damage").get<int>() * 75 / 100;
            if (type == "frigate") unit["validTargets"] = definition->at("validTargets");
        }
        migrated.config = Config::parse(std::move(upgraded));
        if (migrated.battle) {
            const auto upgradeFighter = [&](Fighter &fighter) {
                const auto type = fighter.type == "raider" ? "infantry" : fighter.type;
                const auto &old = oldConfig.unit(type);
                const int cap = migrated.unitShield(type, fighter.maxHealth, fighter.enemy ? 0 : -1);
                // Add only the new capacity so previously consumed shields stay consumed.
                fighter.shield += std::max(0, cap - old.shield);
                if (type == "armored_jeep") {
                    if (fighter.enemy)
                        fighter.damage = std::max(1, static_cast<int>(std::lround(
                            static_cast<double>(fighter.damage) * migrated.config.unit(type).damage / old.damage)));
                    else fighter.damage += migrated.unitDamage(type) - oldJeepDamage;
                }
            };
            for (auto &fighter : migrated.battle->fighters) upgradeFighter(fighter);
            for (auto &fighter : migrated.battle->campaignArmy) upgradeFighter(fighter);
            if (migrated.battle->campaignLevel) migrated.syncCampaignArmy();
            if (std::any_of(migrated.battle->fighters.begin(), migrated.battle->fighters.end(), [&](const Fighter &fighter) {
                    return fighter.type == "frigate" && fighter.phase == migrated.battle->domain;
                })) migrated.normalizeBattleTurn();
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.contains("campaign") && !j.at("config").contains("campaign")) {
        auto previous = c.raw;
        previous.erase("campaign");
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    int generator = j.at("generatorVersion").get<int>();
    ensure(generator >= 1 && generator <= 2 && j.at("config").at("world").at("generatorVersion") == generator,
           "Incompatible world generator version");
    auto savedRules = gameplayConfig(j.at("config"));
    savedRules["world"]["generatorVersion"] = c.generator;
    auto currentRules = gameplayConfig(c.raw);
    if (c.raw.value("economicLevelFiveVersion", 0) == 1 && !j.at("config").contains("economicLevelFiveVersion")) {
        auto previous = c.raw;
        previous.erase("economicLevelFiveVersion");
        for (auto &building : previous["buildings"]) {
            const auto type = building.at("id").get<std::string>();
            if (type != "house" && type != "farm" && type != "lumberyard" && type != "stone" && type != "iron")
                continue;
            previous["buildingLimits"][type][8] = 4;
            building["levels"][4]["townHallRequired"] = 10;
        }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (previousTownHallPopulation(savedRules, currentRules)) {
        auto migrated = Game::deserialize(Config::parse(j.at("config")), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("trainingVersion", 0) == 1 && !j.at("config").contains("trainingVersion")) {
        ensure(c.raw.contains("trainingMigration"), "Missing training migration baseline");
        auto previous = c.raw;
        const auto baseline = previous.at("trainingMigration");
        previous.erase("trainingVersion");
        previous.erase("trainingMigration");
        for (auto &building : previous["buildings"]) {
            const auto type = building.at("id").get<std::string>();
            if (baseline.contains(type)) building["queueCapacity"] = baseline.at(type);
        }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        for (auto &building : migrated.buildings) {
            const auto capacity = static_cast<std::size_t>(migrated.config.building(building.type).queue);
            for (std::size_t index = capacity; index < building.queue.size(); ++index) {
                const auto &task = building.queue[index];
                const auto refund = task.paidCost.value_or(migrated.config.unit(task.type).cost);
                for (int resource = 0; resource < 5; ++resource) {
                    ensure(migrated.stock[resource] < 1'000'000'000'000ll - refund[resource], "Your stockpile cannot accept the training refund");
                    migrated.stock[resource] += refund[resource];
                }
            }
            if (building.queue.size() > capacity) building.queue.resize(capacity);
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("unitFootprintVersion", 0) == 2 && j.at("config").value("unitFootprintVersion", 0) < 2) {
        ensure(c.raw.contains("unitFootprintMigration"), "Missing unit footprint migration baseline");
        auto previous = c.raw;
        const auto baseline = previous.at("unitFootprintMigration");
        previous.erase("unitFootprintMigration");
        previous["unitFootprintVersion"] = 1;
        for (auto &unit : previous["units"]) unit["footprint"] = baseline.at(unit.at("id").get<std::string>());
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        for (auto &tile : migrated.world.tiles) tile.occupant = 0;
        for (const auto &building : migrated.buildings) migrated.occupy(building, building.id);
        // Keep stationary units in place before fitting the expanded ships and aircraft around them.
        for (const auto &unit : migrated.units) {
            const auto &old = baseline.at(unit.type);
            const auto &definition = migrated.config.unit(unit.type);
            if (!unit.carrier && !unit.reserve && old == Json{definition.width, definition.height})
                migrated.occupyUnit(unit, unit.id);
        }
        for (auto &unit : migrated.units) {
            const auto &definition = migrated.config.unit(unit.type);
            if (unit.carrier || unit.reserve || baseline.at(unit.type) == Json{definition.width, definition.height}) continue;
            Pos best = unit.pos;
            if (!migrated.canPlaceUnit(definition, best)) {
                best = {-1, -1};
                int nearest = migrated.world.width + migrated.world.height + 1;
                for (int y = 0; y < migrated.world.height; ++y)
                    for (int x = 0; x < migrated.world.width; ++x) {
                        Pos candidate{x, y};
                        const int steps = distance(unit.pos, candidate);
                        if (steps < nearest && migrated.canPlaceUnit(definition, candidate)) {
                            best = candidate;
                            nearest = steps;
                        }
                    }
            }
            if (best.x < 0) unit.reserve = true;
            else { unit.pos = best; migrated.occupyUnit(unit, unit.id); }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("populationVersion", 0) == 1 && !j.at("config").contains("populationVersion")) {
        ensure(c.raw.contains("populationMigration"), "Missing population migration baseline");
        auto previous = c.raw;
        const auto baseline = previous.at("populationMigration");
        previous.erase("populationVersion");
        previous.erase("populationMigration");
        for (auto &building : previous["buildings"]) {
            const auto type = building.at("id").get<std::string>();
            if (!baseline.contains(type)) continue;
            ensure(baseline.at(type).size() == building.at("levels").size(), "Invalid population migration baseline");
            for (std::size_t level = 0; level < building["levels"].size(); ++level)
                for (auto field : {"housing", "populationRequired"})
                    building["levels"][level][field] = baseline.at(type).at(level).at(field);
        }
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        const int paidPopulation = migrated.military() + migrated.reserved();
        migrated.config = std::move(c);
        if (paidPopulation > migrated.housing()) migrated.preservedArmyPopulation = paidPopulation;
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("unitFootprintVersion", 0) == 1 && !j.at("config").contains("unitFootprintVersion")) {
        auto previous = c.raw;
        previous.erase("unitFootprintVersion");
        for (auto &unit : previous["units"])
            unit.erase("footprint");
        // Validate the original save before expanding any troop or repairing its layout.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        for (auto &tile : migrated.world.tiles)
            tile.occupant = 0;
        for (const auto &building : migrated.buildings)
            migrated.occupy(building, building.id);
        for (auto &unit : migrated.units) {
            if (unit.carrier || unit.reserve)
                continue;
            const auto &definition = migrated.config.unit(unit.type);
            Pos best = unit.pos;
            if (!migrated.canPlaceUnit(definition, best)) {
                best = {-1, -1};
                int shortest = migrated.world.width + migrated.world.height + 1;
                for (int y = 0; y < migrated.world.height; ++y)
                    for (int x = 0; x < migrated.world.width; ++x) {
                        Pos candidate{x, y};
                        int steps = distance(unit.pos, candidate);
                        if (steps < shortest && migrated.canPlaceUnit(definition, candidate)) {
                            best = candidate;
                            shortest = steps;
                        }
                    }
            }
            if (best.x < 0)
                unit.reserve = true;
            else {
                unit.pos = best;
                migrated.occupyUnit(unit, unit.id);
            }
        }
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("economyVersion", 0) == 1 && !j.at("config").contains("economyVersion")) {
        ensure(c.raw.contains("economyMigration"), "Missing economy migration baseline");
        auto previous = c.raw;
        const auto migration = previous.at("economyMigration");
        previous.erase("economyVersion");
        previous.erase("economyMigration");
        previous["initialResources"] = migration.at("initialResources");
        for (auto &building : previous["buildings"])
            if (migration.at("productionRates").contains(building.at("id").get<std::string>())) {
                const auto &rates = migration.at("productionRates").at(building.at("id").get<std::string>());
                ensure(rates.size() == building.at("levels").size(), "Invalid economy migration baseline");
                for (std::size_t level = 0; level < rates.size(); ++level)
                    building["levels"][level]["ratePerHour"] = rates[level];
            }
        // First validate against the exact prior rules, including their historical migrations.
        auto migrated = Game::deserialize(Config::parse(std::move(previous)), j);
        migrated.config = std::move(c);
        migrated.validate();
        return migrated;
    }
    if (c.raw.value("progressionVersion", 0) == 1 && !j.at("config").contains("progressionVersion")) {
        // The previous parser accepts only the exact historical configurations and known migrations.
        ensure(c.raw.contains("progressionMigration"), "Missing progression migration baseline");
        auto migrated = Game::deserialize(Config::parse(c.raw.at("progressionMigration")), j);
        int capacity = migrated.housing();
        for (auto &b : migrated.buildings)
            for (auto &q : b.queue)
                if (!q.paidCost) q.paidCost = migrated.config.unit(q.type).cost;
        migrated.config = std::move(c);
        migrated.legacyProgression = true;
        migrated.legacyHousingCapacity = std::max(capacity, migrated.military() + migrated.reserved());
        for (auto &b : migrated.buildings) {
            if (b.type == "townhall") {
                migrated.stock[4] += b.stored;
                b.stored = b.remainder = 0;
            } else {
                b.remainder = b.remainder * 3'600'000 / Micro;
                if (b.stored == migrated.level(b).capacity) b.remainder = 0;
            }
        }
        migrated.validate();
        return migrated;
    }
    bool migrateFootprints = legacyFootprints(savedRules, currentRules);
    auto currentConfig = c.raw;
    if (savedRules != currentRules) {
        if (auto upgraded = militaryUpgrade(c, savedRules)) c = std::move(*upgraded);
        else {
            ensure(legacyHousing(savedRules, currentRules), "This save uses a different gameplay configuration");
            auto preserved = j.at("config");
            legacyFootprints(preserved, currentConfig);
            c = Config::parse(preserved);
        }
    }
    if (migrateFootprints) {
        // Validate the original layout before changing any footprints or positions.
        auto migrated = Game::deserialize(Config::parse(j.at("config")), j);
        migrated.config = std::move(c);
        auto buildings = std::move(migrated.buildings);
        auto units = std::move(migrated.units);
        migrated.buildings.clear();
        migrated.units.clear();
        for (auto &tile : migrated.world.tiles)
            tile.occupant = 0;
        std::stable_sort(buildings.begin(), buildings.end(), [](const Building &a, const Building &b) {
            return a.type == "townhall" && b.type != "townhall";
        });
        auto nearest = [&](Pos origin, const auto &allowed) {
            if (allowed(origin))
                return origin;
            Pos best{-1, -1};
            int shortest = migrated.world.width + migrated.world.height + 1;
            for (int y = 0; y < migrated.world.height; ++y)
                for (int x = 0; x < migrated.world.width; ++x) {
                    Pos p{x, y};
                    int steps = distance(origin, p);
                    if (steps < shortest && allowed(p)) {
                        best = p;
                        shortest = steps;
                    }
                }
            ensure(best.x >= 0, "The expanded buildings do not fit this saved map");
            return best;
        };
        for (auto b : buildings) {
            b.pos = nearest(b.pos, [&](Pos p) { return migrated.canPlace(b.type, p).ok; });
            migrated.occupy(b, b.id);
            migrated.buildings.push_back(b);
        }
        for (auto u : units) {
            if (u.carrier || u.reserve) { migrated.units.push_back(u); continue; }
            u.pos = nearest(u.pos, [&](Pos p) {
                return migrated.canPlaceUnit(migrated.config.unit(u.type), p);
            });
            migrated.occupyUnit(u, u.id);
            migrated.units.push_back(u);
        }
        migrated.validate();
        return migrated;
    }
    Game g(std::move(c));
    if (j.contains("magic")) {
        const auto &magic = j.at("magic");
        ensure(g.config.raw.contains("magic") && magic.at("version") == 1, "Unsupported magic data");
        ensure(magic.at("potions").is_array() && magic.at("potions").size() == 4, "Invalid potion inventory");
        for (int i = 0; i < 4; ++i) {
            ensure(magic.at("potions").at(i).is_number_integer(), "Invalid potion count");
            auto count = magic.at("potions").at(i).get<std::int64_t>();
            ensure(count >= 0 && count <= 5, "Invalid potion count");
            g.potions[i] = static_cast<int>(count);
        }
        g.potionSequence = magic.value("sequence", std::uint64_t{0});
        ensure(magic.at("brewing").is_array() && magic.at("brewing").size() <= 5, "Invalid brewing queue");
        for (const auto &task : magic.at("brewing")) g.brewing.push_back({task.at("type"), task.at("remainingMs")});
    }
    auto worldConfig = g.config;
    worldConfig.generator = generator;
    g.world = World::generate(worldConfig, j.at("seed").get<std::uint32_t>());
    if (j.contains("clearedTrees")) {
        const auto &cleared = j.at("clearedTrees");
        ensure(cleared.is_array() && cleared.size() <= g.world.tiles.size(), "Invalid cleared trees");
        for (const auto &entry : cleared) {
            ensure(entry.is_array() && entry.size() == 2 && entry[0].is_number_integer() &&
                       entry[1].is_number_integer() && entry[0].get<std::int64_t>() >= 0 &&
                       entry[0].get<std::int64_t>() < g.world.width && entry[1].get<std::int64_t>() >= 0 &&
                       entry[1].get<std::int64_t>() < g.world.height,
                   "Invalid cleared tree position");
            auto p = position(entry);
            ensure(g.world.at(p).terrain == Terrain::Forest && g.clearedTrees.insert(p).second,
                   "Invalid or duplicate cleared tree");
            g.world.at(p).terrain = Terrain::Grass;
        }
    }
    if (j.contains("shopSequence")) {
        ensure(j.at("shopSequence").is_number_integer() && j.at("shopSequence") >= 0 &&
               j.at("shopSequence") <= 9'007'199'254'740'990ull, "Invalid shop sequence");
        g.shopSequence = j.at("shopSequence").get<std::uint64_t>();
    }
    g.stock = j.at("stock").get<Stock>();
    g.civilian = j.at("civilian");
    g.nextId = j.at("nextId");
    g.nextBattleId = j.at("nextBattleId");
    g.elapsedMs = j.at("elapsedMs");
    g.pendingMs = j.at("pendingMs");
    g.settlementRemainder = j.at("settlementRemainder");
    g.technologies = j.at("technologies").get<std::set<std::string>>();
    if (j.contains("researchLevels")) {
        ensure(j.at("researchLevels").is_object(), "Invalid research levels");
        for (auto it = j.at("researchLevels").begin(); it != j.at("researchLevels").end(); ++it) {
            ensure(it.value().is_number_integer(), "Invalid research level");
            g.researchLevels[it.key()] = it.value().get<int>();
        }
    }
    int researchRulesVersion = j.value("researchRulesVersion", 1);
    ensure(researchRulesVersion >= 1 && researchRulesVersion <= 2, "Unsupported research rules version");
    const int researchBonusVersion = j.value("researchBonusVersion", 1);
    ensure(researchBonusVersion >= 1 && researchBonusVersion <= 2, "Unsupported research bonus version");
    const auto researchGain = [&](const std::string &type, bool health) {
        const auto &definition = g.config.unit(type);
        const int base = health ? definition.health : definition.damage;
        const int level = g.researchLevel(type);
        return Game::researchStat(base, level) - base * (100 + 5 * level) / 100;
    };
    const auto migrateResearchFighter = [&](Fighter fighter) {
        if (researchBonusVersion == 1 && !fighter.enemy) {
            const int gain = researchGain(fighter.type, true);
            fighter.maxHealth += gain;
            if (fighter.health > 0) fighter.health += gain;
            fighter.damage += researchGain(fighter.type, false);
        }
        return fighter;
    };
    if (j.contains("preservedResearchLevels")) {
        ensure(researchRulesVersion == 2 && j.at("preservedResearchLevels").is_object(), "Invalid preserved research");
        for (auto it = j.at("preservedResearchLevels").begin(); it != j.at("preservedResearchLevels").end(); ++it) {
            ensure(it.value().is_number_integer(), "Invalid preserved research level");
            g.preservedResearchLevels[it.key()] = it.value().get<int>();
        }
    }
    g.legacyProgression = j.value("legacyProgression", false);
    g.legacyHousingCapacity = j.value("legacyHousingCapacity", 0);
    g.preservedArmyPopulation = j.value("preservedArmyPopulation", 0);
    g.appliedRewards = j.at("appliedRewards").get<std::set<Id>>();
    if (j.contains("campaign")) {
        const auto &campaign = j.at("campaign");
        ensure(campaign.at("completedLevels").is_array(), "Invalid campaign progression");
        for (const auto &level : campaign.at("completedLevels")) {
            ensure(level.is_number_integer() && g.completedCampaignLevels.insert(level.get<int>()).second, "Invalid completed campaign level");
        }
        ensure(campaign.at("currentLevel") == g.campaignCurrentLevel(), "Invalid current campaign level");
        ensure(campaign.at("completed").is_boolean() && campaign.at("completed") ==
                   (g.completedCampaignLevels.size() == g.config.raw.at("campaign").at("levels").size()), "Invalid campaign completion");
    }
    ensure(j.at("buildings").size() <= g.world.tiles.size() && j.at("units").size() <= g.world.tiles.size(),
           "Too many entities");
    for (auto &v : j.at("buildings")) {
        Building b;
        b.id = v.at("id");
        b.type = v.at("type");
        b.pos = position(v.at("position"));
        b.level = v.at("level");
        int state = v.at("state");
        ensure(state >= 0 && state <= 2, "Invalid building state");
        b.state = static_cast<State>(state);
        b.remainingMs = v.at("remainingMs");
        b.stored = v.at("stored");
        b.remainder = v.at("remainder");
        for (auto &t : v.at("queue")) {
            b.queue.push_back({t.at("type"), t.at("remainingMs"), t.at("awaiting"), std::nullopt});
            if (t.contains("paidCost")) b.queue.back().paidCost = t.at("paidCost").get<Stock>();
        }
        auto result = g.canPlace(b.type, b.pos);
        ensure(result.ok, "Invalid saved building placement: " + result.message);
        g.occupy(b, b.id);
        g.buildings.push_back(b);
    }
    for (auto &v : j.at("units")) {
        Unit u;
        u.id = v.at("id");
        u.source = v.at("source");
        u.type = v.at("type");
        u.pos = position(v.at("position"));
        u.health = v.at("health");
        if (researchBonusVersion == 1) {
            const int gain = researchGain(u.type, true);
            ensure(u.health > 0 && u.health <= g.unitHealth(u.type) - gain, "Invalid unit health before research migration");
            u.health += gain;
        }
        u.carrier = v.contains("carrier") && !v.at("carrier").is_null() ? v.at("carrier").get<Id>() : 0;
        u.reserve = v.value("reserve", false);
        if (!u.carrier && !u.reserve) {
            ensure(g.canPlaceUnit(g.config.unit(u.type), u.pos), "Invalid or overlapping saved unit footprint");
            g.occupyUnit(u, u.id);
        }
        g.units.push_back(u);
    }
    for (auto &v : j.at("research"))
        g.research.push_back({v.at("type"), v.at("academy"), v.at("remainingMs"), v.value("level", 0)});
    if (!j.at("battle").is_null()) {
        auto &v = j.at("battle");
        Battle b;
        b.id = v.at("id");
        b.round = v.at("round");
        b.finished = v.at("finished");
        b.victory = v.at("victory");
        b.campaignLevel = v.value("campaignLevel", 0);
        b.doubleAttack = v.value("doubleAttack", false);
        b.animationMs = v.value("animationMs", std::int64_t{0});
        b.potionEvent = v.value("potionEvent", std::uint64_t{0});
        b.lastPotion = v.value("lastPotion", "");
        if (v.contains("potionTargets"))
            for (const auto &id : v.at("potionTargets")) b.potionTargets.push_back(std::stoull(id.get<std::string>()));
        b.awaitingSelection = v.value("awaitingSelection", false);
        b.retreated = v.value("retreated", false);
        if (v.contains("combatVersion")) {
            ensure(v.at("combatVersion") == 2 || v.at("combatVersion") == 3 || v.at("combatVersion") == 4 || v.at("combatVersion") == 5 || v.at("combatVersion") == 6 || v.at("combatVersion") == 7 || v.at("combatVersion") == 8, "Unsupported combat version");
            b.domain = domainFromName(v.at("domain"));
            b.phases.clear();
            for (const auto &domain : v.at("phases"))
                b.phases.push_back(domainFromName(domain));
            b.phaseIndex = v.at("phaseIndex");
            b.outcomes = v.at("outcomes").get<std::vector<int>>();
            b.draw = v.at("draw");
            b.automatic = v.at("automatic");
            b.enemyTurn = v.at("enemyTurn");
            b.paused = v.at("paused");
            b.pendingMs = v.at("pendingMs");
            b.actions = v.at("actions");
            for (const auto &hit : v.at("lastAttacks"))
                b.lastAttacks.push_back({hit.at("attacker"), hit.at("target"), hit.at("damage"), hit.value("shieldDamage", 0), hit.value("missed", false), hit.value("healing", 0), hit.value("stunTurns", 0), hit.value("attackerStunned", false)});
        } else if (b.finished)
            b.outcomes.push_back(b.victory ? 1 : 0);
        if (!b.campaignLevel && v.value("combatVersion", 1) < 7) {
            const int wins = std::count(b.outcomes.begin(), b.outcomes.end(), 1);
            const int losses = std::count(b.outcomes.begin(), b.outcomes.end(), 0);
            ensure(b.victory == (b.finished && wins > losses) && b.draw == (b.finished && wins == losses),
                   "Invalid historical expedition winner");
            // Previously unresolved expeditions are defeats; existing decisive results stay intact.
            b.draw = false;
        }
        for (const auto &f : v.at("fighters")) b.fighters.push_back(migrateResearchFighter(loadedFighter(f)));
        if (b.campaignLevel && v.value("combatVersion", 1) >= 5) {
            ensure(v.contains("campaignArmy") && v.at("campaignArmy").is_array(), "Missing saved campaign army");
            for (const auto &f : v.at("campaignArmy")) b.campaignArmy.push_back(migrateResearchFighter(loadedFighter(f)));
        }
        if (v.value("combatVersion", 1) < 3 && !b.finished) {
            // Convert grid turns to arena turns without replaying friendly attacks.
            b.pendingMs = 0;
            b.lastAttacks.clear();
            if (b.enemyTurn) {
                for (auto &f : b.fighters)
                    if (f.enemy && f.phase == b.domain)
                        f.attacked = false;
            } else {
                bool ready = std::any_of(b.fighters.begin(), b.fighters.end(), [&](const auto &f) {
                    return !f.enemy && f.phase == b.domain && f.health > 0 && !f.attacked;
                });
                if (!ready) {
                    b.enemyTurn = true;
                    for (auto &f : b.fighters)
                        if (f.enemy && f.phase == b.domain)
                            f.attacked = false;
                }
            }
        }
        g.battle = std::move(b);
        if (g.battle->campaignLevel) {
            if (v.value("combatVersion", 1) < 5) g.migrateCampaignArmy();
            else g.syncCampaignArmy();
        }
    }
    if (g.progression() && researchRulesVersion == 1) {
        // Keep paid research from the previous rules; all new commands use the tier-based caps.
        for (const auto &[type, level] : g.researchLevels)
            if (level > g.researchLimit(type, g.completedLevel("academy")))
                g.preservedResearchLevels[type] = level;
        for (const auto &project : g.research) {
            auto academy = g.findBuilding(project.academy);
            if (project.level && academy && project.level > g.researchLimit(project.type, academy->level))
                g.preservedResearchLevels[project.type] = std::max(g.preservedResearchLevels[project.type], project.level);
        }
    }
    if (j.contains("magic")) ensure(j.at("magic").at("level") == g.completedLevel("laboratory"), "Saved Laboratory level differs from completed building");
    const bool legacySubmarineTargeting = g.battle && j.at("battle").value("combatVersion", 1) < 8;
    g.validate(legacySubmarineTargeting);
    if (legacySubmarineTargeting && g.battle->finished && g.battle->retreated &&
        !g.battle->victory && !g.battle->draw && g.battle->round < 200 &&
        !g.battle->outcomes.empty() && g.battle->outcomes.back() == 0 &&
        !g.battleCanFight(false) && g.battleCanFight()) {
        // Resume only withdrawals caused by the old submarine targeting deadlock.
        auto &battle = *g.battle;
        battle.outcomes.pop_back();
        battle.finished = battle.retreated = false;
        const auto lastAttack = std::find_if(battle.lastAttacks.rbegin(), battle.lastAttacks.rend(),
                                             [](const BattleHit &hit) { return !hit.healing; });
        const auto lastActor = std::find_if(battle.fighters.begin(), battle.fighters.end(), [&](const Fighter &fighter) {
            return lastAttack != battle.lastAttacks.rend() && fighter.id == lastAttack->attacker;
        });
        battle.enemyTurn = lastActor != battle.fighters.end() && lastActor->enemy;
        battle.pendingMs = 0;
        g.normalizeBattleTurn();
    }
    g.validate();
    return g;
}
void Game::validate(bool legacySubmarineTargeting) const {
    validateMagic();
    ensure(world.width == config.width && world.height == config.height &&
               world.tiles.size() == static_cast<std::size_t>(world.width * world.height),
           "Invalid world size");
    if (!clearedTrees.empty()) {
        auto worldConfig = config;
        worldConfig.generator = world.generator;
        auto original = World::generate(worldConfig, world.seed);
        for (auto p : clearedTrees)
            ensure(world.contains(p) && original.at(p).terrain == Terrain::Forest &&
                       world.at(p).terrain == Terrain::Grass,
                   "Invalid cleared tree terrain");
    }
    ensure(civilian >= 0 && civilian <= 1'000'000, "Invalid civilian count");
    ensure(preservedArmyPopulation >= 0 && preservedArmyPopulation <= 1'000'000 &&
               (!preservedArmyPopulation || (progression() && config.raw.value("populationVersion", 0) == 1)),
           "Invalid preserved army population");
    ensure(legacyHousingCapacity >= 0 && legacyHousingCapacity <= 1'000'000 &&
               (!legacyHousingCapacity || (progression() && legacyProgression)), "Invalid legacy housing");
    ensure(nextId > 0 && nextId < (Id{1} << 62) && nextBattleId > 0 && nextBattleId < (Id{1} << 62),
           "Invalid next ID");
    ensure(elapsedMs >= 0 && pendingMs >= 0 && pendingMs < config.stepMs, "Invalid clock");
    ensure(settlementRemainder >= 0 && settlementRemainder < std::int64_t(config.settlementSeconds) * 100000,
           "Invalid settlement remainder");
    ensure(shopSequence <= 9'007'199'254'740'990ull && (!shopSequence || config.raw.contains("shop")), "Invalid shop sequence");
    for (auto n : stock)
        ensure(n >= 0 && n < 1'000'000'000'000ll, "Invalid stockpile");
    std::set<Id> ids;
    int halls = 0;
    std::vector<Id> occupancy(world.tiles.size());
    for (auto &b : buildings) {
        auto &d = config.building(b.type);
        ensure(b.id > 0 && b.id < nextId && ids.insert(b.id).second, "Invalid building ID");
        ensure(b.level > 0 && b.level <= static_cast<int>(d.levels.size()), "Invalid building level");
        const bool preservedHarbor = config.raw.value("earlyLandCampaignVersion", 0) == 1 &&
            b.type == "harbor" && b.level == 1 && townHallLevel() == 3 && b.state != State::Upgrading;
        ensure(b.type == "townhall" || (progression() && legacyProgression) || preservedHarbor || b.level <= buildingLimit(b.type),
               "Building exceeds town hall limit");
        if (b.type == "townhall")
            ++halls;
        ensure(b.remainingMs >= 0 && b.remainingMs <= 86'400'000, "Invalid build timer");
        if (b.state == State::Active)
            ensure(b.remainingMs == 0, "Active building has a timer");
        if (b.state == State::Construction)
            ensure(b.level == 1, "Construction must begin at level one");
        if (b.state == State::Upgrading)
            ensure(b.level < static_cast<int>(d.levels.size()), "Invalid upgrade");
        if (progression() && !legacyProgression && b.state == State::Upgrading && b.type != "townhall")
            ensure(b.level + 1 <= buildingLimit(b.type), "Upgrade exceeds town hall limit");
        ensure(b.stored >= 0 && b.stored <= level(b).capacity && b.remainder >= 0 && b.remainder < (progression() ? 3'600'000ll : Micro),
               "Invalid production");
        if (b.stored == level(b).capacity)
            ensure(b.remainder == 0, "Hidden production overflow");
        if (d.resource < 0)
            ensure(b.stored == 0 && b.remainder == 0, "Production on nonproducer");
        ensure(b.queue.size() <= static_cast<std::size_t>(d.queue), "Queue too large");
        for (std::size_t i = 0; i < b.queue.size(); ++i) {
            auto &q = b.queue[i];
            auto &u = config.unit(q.type);
            ensure(u.building == b.type && u.level <= b.level && q.remainingMs >= 0 &&
                       q.remainingMs <= std::int64_t(u.seconds) * 1000,
                   "Invalid training");
            ensure(!q.awaiting || (q.remainingMs == 0 && i == 0), "Invalid deployment queue");
            if (q.paidCost)
                for (auto cost : *q.paidCost) ensure(cost >= 0 && cost <= 1'000'000, "Invalid training payment");
            if (q.paidCost && !legacyProgression)
                ensure(*q.paidCost == u.cost, "Invalid training payment");
            ensure(u.technology.empty() || technologies.contains(u.technology),
                   "Missing training technology");
        }
        ensure(canPlace(b.type, b.pos, b.id).ok, "Invalid building terrain");
        for (int y = 0; y < d.height; ++y)
            for (int x = 0; x < d.width; ++x) {
                auto index = static_cast<std::size_t>((b.pos.y + y) * world.width + b.pos.x + x);
                ensure(!occupancy.at(index), "Overlapping buildings");
                occupancy[index] = b.id;
            }
    }
    ensure(halls == 1, "Exactly one town hall required");
    for (auto &u : units) {
        auto &d = config.unit(u.type);
        ensure(u.id > 0 && u.id < nextId && ids.insert(u.id).second, "Invalid unit ID");
        ensure(findBuilding(u.source) && findBuilding(u.source)->type == d.building, "Missing unit source");
        ensure(u.health > 0 && u.health <= unitHealth(u.type) && world.contains(u.pos), "Invalid unit");
        if (u.carrier) {
            auto carrier = findUnit(u.carrier);
            ensure(d.domain == Domain::Air && carrier && !carrier->carrier && !u.reserve, "Invalid aircraft assignment");
            const auto &cd = config.unit(carrier->type);
            ensure(cd.carrierSlots > 0 && std::find(cd.allowedAircraftTiers.begin(), cd.allowedAircraftTiers.end(), d.level) != cd.allowedAircraftTiers.end(), "Invalid carrier aircraft tier");
            ensure(std::count_if(units.begin(), units.end(), [&](const auto &a) { return a.carrier == carrier->id; }) <= cd.carrierSlots, "Carrier is over capacity");
            continue;
        }
        if (u.reserve) {
            ensure(d.domain == Domain::Air || config.raw.value("unitFootprintVersion", 0) >= 1,
                   "Only aircraft can await deployment under legacy rules");
            continue;
        }
        ensure(canPlaceUnit(d, u.pos, u.id), "Invalid unit footprint");
        for (int y = 0; y < d.height; ++y)
            for (int x = 0; x < d.width; ++x) {
                auto i = static_cast<std::size_t>((u.pos.y + y) * world.width + u.pos.x + x);
                ensure(!occupancy.at(i), "Overlapping unit");
                occupancy[i] = u.id;
            }
    }
    for (std::size_t i = 0; i < occupancy.size(); ++i)
        ensure(occupancy[i] == world.tiles[i].occupant, "Occupancy mismatch");
    ensure(progression() ? military() + reserved() <= std::max(housing(), preservedArmyPopulation)
                         : reserved() <= civilian && population() <= housing(), "Population invariant violated");
    for (const auto &[type, level] : researchLevels) {
        const auto &u = config.unit(type);
        ensure(progression() && level >= 0 && level <= config.raw.at("research").at("maxLevel").get<int>(), "Invalid research level");
        int preserved = preservedResearchLevels.contains(type) ? preservedResearchLevels.at(type) : 0;
        ensure(!level || (completedLevel(u.building) >= u.level &&
                   (level <= researchLimit(type, completedLevel("academy")) || level <= preserved)),
               "Research exceeds completed Academy or troop unlock");
    }
    for (const auto &[type, level] : preservedResearchLevels) {
        const auto &u = config.unit(type);
        int paidLevel = researchLevel(type);
        for (const auto &project : research)
            if (project.type == type) paidLevel = std::max(paidLevel, project.level);
        ensure(progression() && level > 0 && level <= 10 && level <= completedLevel("academy") &&
                   completedLevel(u.building) >= u.level && level <= paidLevel,
               "Invalid preserved research level");
    }
    for (auto &t : technologies) {
        auto &d = config.tech(t);
        for (auto &p : d.prerequisites)
            ensure(technologies.contains(p), "Missing technology prerequisite");
    }
    std::set<std::string> researchIds;
    std::set<Id> academyIds;
    for (auto &r : research) {
        if (r.level) {
            const auto &u = config.unit(r.type);
            auto b = findBuilding(r.academy);
            ensure(progression() && research.size() == 1 && b && b->type == "academy" &&
                       b->state == State::Active && r.level == researchLevel(r.type) + 1 &&
                       r.level <= config.raw.at("research").at("maxLevel").get<int>() && completedLevel(u.building) >= u.level &&
                       (r.level <= researchLimit(r.type, b->level) ||
                        (preservedResearchLevels.contains(r.type) && r.level <= preservedResearchLevels.at(r.type))),
                   "Invalid troop research");
            ensure(r.remainingMs >= 0 && r.remainingMs <= std::int64_t(researchSeconds(r.type)) * 1000,
                   "Invalid research timer");
            continue;
        }
        ensure(!progression() || legacyProgression, "Invalid legacy research");
        auto &d = config.tech(r.type);
        auto b = findBuilding(r.academy);
        ensure(b && b->type == "academy" && b->state == State::Active && b->level >= d.academy,
               "Invalid research building");
        ensure(r.remainingMs >= 0 && r.remainingMs <= std::int64_t(d.seconds) * 1000,
               "Invalid research timer");
        ensure(!technologies.contains(r.type) && researchIds.insert(r.type).second &&
                   academyIds.insert(r.academy).second,
               "Duplicate research");
        for (auto &p : d.prerequisites)
            ensure(technologies.contains(p), "Missing research prerequisite");
    }
    for (auto id : appliedRewards)
        ensure(id > 0 && id < nextBattleId, "Invalid reward ID");
    int completedCampaign = 0;
    for (int level : completedCampaignLevels) {
        ensure(config.raw.contains("campaign") && level == ++completedCampaign &&
                   level <= static_cast<int>(config.raw.at("campaign").at("levels").size()), "Invalid campaign progression sequence");
    }
    if (battle) {
        ensure(battle->id > 0 && battle->id < nextBattleId && !appliedRewards.contains(battle->id) &&
                   battle->round > 0,
               "Invalid battle");
        const auto &b = *battle;
        if (b.campaignLevel) {
            validateCampaignBattle();
            return;
        }
        ensure(!b.awaitingSelection && (!b.retreated ||
                   (b.finished && !b.victory && !b.draw &&
                    (b.round >= 200 || !battleCanFight(!legacySubmarineTargeting)))),
               "Invalid expedition deployment state");
        ensure(!b.phases.empty() && b.phases.size() <= 3 && b.phaseIndex >= 0 &&
                   b.phaseIndex < static_cast<int>(b.phases.size()) && b.domain == b.phases[b.phaseIndex],
               "Invalid battle phases");
        for (std::size_t i = 1; i < b.phases.size(); ++i)
            ensure(b.phases[i - 1] < b.phases[i], "Battle phases must follow land, sea, air");
        ensure(b.outcomes.size() == (b.retreated ? static_cast<std::size_t>(b.phaseIndex + 1) :
                   b.finished ? b.phases.size() : static_cast<std::size_t>(b.phaseIndex)) &&
                   (!b.finished || b.retreated || b.phaseIndex + 1 == static_cast<int>(b.phases.size())) &&
                   (!b.retreated || (!b.outcomes.empty() && b.outcomes.back() == 0)),
               "Invalid round results");
        ensure(b.pendingMs >= 0 && b.pendingMs < 1000 && b.actions >= 0 &&
                   ((b.automatic || b.enemyTurn) || b.pendingMs == 0),
               "Invalid battle clock");
        std::set<Id> fids;
        std::set<std::pair<Domain, Pos>> positions;
        std::array<std::array<int, 2>, 3> counts{}, living{};
        ensure(!b.fighters.empty() && b.fighters.size() <= 90, "Invalid army size");
        for (auto &f : b.fighters) {
            ensure(fids.insert(f.id).second, "Duplicate fighter");
            ensure(std::find(b.phases.begin(), b.phases.end(), f.phase) != b.phases.end(),
                   "Fighter has no round");
            ensure(f.pos.x >= 0 && f.pos.y >= 0 && f.pos.x < config.battleWidth &&
                       f.pos.y < config.battleHeight,
                   "Battle position invalid");
            ensure(f.health >= 0 && f.health <= f.maxHealth && f.maxHealth > 0 && f.maxHealth < 1'000'000 &&
                       f.damage > 0 && f.damage < 1'000'000 && f.defense >= 0 && f.range > 0 &&
                       f.range <= 20 && f.movement > 0 && f.movement <= 20,
                   "Invalid fighter stats");
            if (!f.enemy)
                ensure(findUnit(f.id) && findUnit(f.id)->type == f.type &&
                           config.unit(f.type).domain == f.domain,
                       "Missing home unit");
            else {
                ensure(f.id >= (Id{1} << 63), "Invalid enemy ID");
                ensure(f.type == "raider" ? f.domain == Domain::Land : config.unit(f.type).domain == f.domain, "Invalid enemy type");
            }
            if (f.carrier) {
                auto home = findUnit(f.id);
                ensure(!f.enemy && home && home->carrier == f.carrier && f.domain == Domain::Air && f.phase == Domain::Naval, "Invalid embarked fighter");
                auto carrier = std::find_if(b.fighters.begin(), b.fighters.end(), [&](const auto &v) { return v.id == f.carrier; });
                ensure(carrier != b.fighters.end() && carrier->phase == f.phase && !carrier->enemy &&
                    (!config.destroyEmbarkedAircraft || carrier->health > 0 || f.health == 0), "Missing carrier or living aircraft on a destroyed carrier");
            } else if (!f.enemy)
                ensure(!findUnit(f.id)->carrier &&
                           (!findUnit(f.id)->reserve || config.raw.value("unitFootprintVersion", 0) >= 1),
                       "Embarked or undeployed unit duplicated in independent army");
            const auto &d = config.unit(f.type == "raider" ? "infantry" : f.type);
            ensure(f.shield >= 0 && f.shield <= unitShield(d.id, f.maxHealth, f.enemy ? 0 : -1) && f.readyRound >= 1 && f.readyRound <= 1'000'000 && f.strikes >= 0, "Invalid fighter ability state");
            ++counts[static_cast<int>(f.phase)][f.enemy];
            if (f.health > 0) {
                ensure(positions.insert({f.phase, f.pos}).second, "Overlapping fighters");
                if (!f.carrier || config.raw.value("armyAbilitiesVersion", 0) < 1)
                    ++living[static_cast<int>(f.phase)][f.enemy];
            }
        }
        for (std::size_t i = 0; i < b.phases.size(); ++i) {
            auto n = static_cast<int>(b.phases[i]);
            // Six-unit legacy land squads remain loadable; new selections are capped at five.
            int cargo = std::count_if(b.fighters.begin(), b.fighters.end(), [&](const auto &f) { return f.phase == b.phases[i] && f.carrier; });
            ensure(counts[n][0] > 0 && counts[n][0] - cargo <= std::max(5, config.maxArmy) && counts[n][1] > 0 &&
                       counts[n][1] <= std::max(5, config.enemies),
                   "Invalid round army size");
            if (i < b.outcomes.size())
                ensure((b.outcomes[i] == 1 && living[n][0] > 0 && living[n][1] == 0) ||
                           (b.outcomes[i] == 0 && living[n][1] > 0 && (living[n][0] == 0 ||
                               (b.retreated && i == static_cast<std::size_t>(b.phaseIndex)))) ||
                           (b.outcomes[i] == -1 && living[n][0] > 0 && living[n][1] > 0),
                       "Invalid round winner");
            else
                ensure(living[n][0] > 0 && living[n][1] > 0, "Round result missing");
        }
        if (!b.finished)
            ensure(std::any_of(b.fighters.begin(), b.fighters.end(),
                               [&](const auto &f) {
                                   return f.phase == b.domain && f.enemy == b.enemyTurn && f.health > 0 &&
                                          !f.attacked;
                               }),
                   "Active side has no remaining attacks");
        int wins = std::count(b.outcomes.begin(), b.outcomes.end(), 1);
        int losses = std::count(b.outcomes.begin(), b.outcomes.end(), 0);
        ensure(b.victory == (b.finished && !b.retreated && wins > losses) && !b.draw,
               "Invalid expedition winner");
        ensure(b.lastAttacks.size() <= 31, "Invalid attack log");
        for (auto hit : b.lastAttacks) {
            ensure(hit.stunTurns >= 0 && hit.stunTurns <= 1 && (!hit.stunTurns || (!hit.missed && !hit.healing)) &&
                (!hit.attackerStunned || hit.stunTurns == 1), "Invalid stun log");
            auto a = std::find_if(b.fighters.begin(), b.fighters.end(),
                                  [&](const auto &f) { return f.id == hit.attacker; });
            auto t = std::find_if(b.fighters.begin(), b.fighters.end(),
                                  [&](const auto &f) { return f.id == hit.target; });
            ensure(a != b.fighters.end() && t != b.fighters.end() && a->phase == b.domain &&
                       t->phase == b.domain && hit.damage >= 0 && hit.shieldDamage >= 0 && hit.healing >= 0 &&
                       hit.damage <= t->maxHealth && hit.shieldDamage <= 1'000'000,
                   "Invalid attack log");
            if (hit.healing > 0)
                ensure(!a->enemy && !t->enemy && t->health > 0 && !hit.damage && !hit.shieldDamage && !hit.missed &&
                           hit.healing <= t->maxHealth && hit.healing <= unitHealing(a->type, a->maxHealth), "Invalid healing log");
            else ensure(a->enemy != t->enemy, "Invalid attack target");
            if (hit.attackerStunned) ensure(a->enemy && !t->enemy, "Invalid retaliation target");
        }
    }
}
std::string encodeSave(const Game &game) {
    game.validate();
    auto j = game.serialize();
    return Json{{"checksum", checksum(j.dump())}, {"game", j}}.dump();
}
Game decodeSave(Config config, const std::string &bytes) {
    ensure(bytes.size() < 16 * 1024 * 1024, "Save file too large");
    auto envelope = Json::parse(bytes);
    auto j = envelope.at("game");
    ensure(envelope.at("checksum") == checksum(j.dump()), "Save checksum mismatch");
    return Game::deserialize(std::move(config), j);
}
Json gameplayConfig(Json config) {
    config.erase("balanceStatus");
    config.erase("aircraftBalanceMigration");
    config.erase("militaryMigration");
    config.erase("progressionMigration");
    config.erase("economyMigration");
    config.erase("populationMigration");
    config.erase("unitFootprintMigration");
    config.erase("trainingMigration");
    for (auto section : {"buildings", "units", "technologies"})
        for (auto &entry : config.at(section)) {
            entry.erase("name");
            entry.erase("description");
        }
    return config;
}
} // namespace kingdom
