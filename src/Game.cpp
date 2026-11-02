#include "kingdom/Game.hpp"
#include <algorithm>
#include <limits>
#include <queue>
#include <stdexcept>

namespace kingdom {
namespace {
int compoundedResearch(int baseStat, int level, bool round = false) {
    if (level < 0 || level > MaximumResearchLevel) throw std::runtime_error("Invalid research level");
    std::uint64_t whole = baseStat, remainder = 0, denominator = 1;
    // Retain exact fractional gains without overflowing at the higher research levels.
    for (int i = 0; i < level; ++i) {
        const auto scaled = whole * 21;
        remainder = remainder * 21 + (scaled % 20) * denominator;
        denominator *= 20;
        whole = scaled / 20 + remainder / denominator;
        remainder %= denominator;
    }
    return static_cast<int>(whole + (round && remainder * 2 >= denominator));
}
} // namespace
Game::Game(Config c) : config(std::move(c)) {}
void Game::newGame(std::uint32_t seed) {
    world = World::generate(config, seed);
    stock = config.initialStock;
    civilian = config.initialPopulation;
    nextId = 1;
    nextBattleId = 1;
    elapsedMs = 0;
    settlementRemainder = 0;
    pendingMs = 0;
    buildings.clear();
    units.clear();
    research.clear();
    potions.fill(0);
    brewing.clear();
    potionSequence = shopSequence = 0;
    researchLevels.clear();
    preservedResearchLevels.clear();
    legacyProgression = false;
    legacyHousingCapacity = 0;
    preservedArmyPopulation = 0;
    technologies.clear();
    appliedRewards.clear();
    completedCampaignLevels.clear();
    clearedTrees.clear();
    battle.reset();
    diagnostics.clear();
    for (auto &start : config.raw.at("startingBuildings")) {
        Building b;
        b.id = nextId++;
        b.type = start.at("type");
        b.pos = {world.width / 2 + start.at("offset").at(0).get<int>(),
                 world.height / 2 + start.at("offset").at(1).get<int>()};
        auto valid = canPlace(b.type, b.pos);
        if (!valid.ok)
            throw std::runtime_error("Invalid starting layout: " + valid.message);
        buildings.push_back(b);
        occupy(b, b.id);
    }
    validate();
}
const Level &Game::level(const Building &b) const {
    return config.building(b.type).levels.at(static_cast<std::size_t>(b.level - 1));
}
Building *Game::findBuilding(Id id) {
    for (auto &b : buildings)
        if (b.id == id)
            return &b;
    return nullptr;
}
const Building *Game::findBuilding(Id id) const {
    for (auto &b : buildings)
        if (b.id == id)
            return &b;
    return nullptr;
}
Unit *Game::findUnit(Id id) {
    for (auto &u : units)
        if (u.id == id)
            return &u;
    return nullptr;
}
const Unit *Game::findUnit(Id id) const {
    for (auto &u : units)
        if (u.id == id)
            return &u;
    return nullptr;
}
int Game::housing() const {
    int n = 0;
    for (auto &b : buildings)
        if (b.state != State::Construction)
            n += level(b).housing;
    return config.raw.value("populationVersion", 0) == 1 ? n : std::max(n, legacyHousingCapacity);
}
int Game::military() const {
    int n = 0;
    for (auto &u : units)
        n += config.unit(u.type).people;
    return n;
}
int Game::reserved() const {
    int n = 0;
    for (auto &b : buildings)
        for (auto &q : b.queue)
            n += config.unit(q.type).people;
    return n;
}
int Game::population() const {
    return (progression() ? 0 : civilian) + military();
}
int Game::freeHousing() const {
    return std::max(0, housing() - population() - (progression() ? reserved() : 0));
}
int Game::townHallLevel() const {
    for (auto &b : buildings)
        if (b.type == "townhall" && b.state != State::Construction)
            return b.level;
    return 1;
}
bool Game::progression() const {
    return config.raw.value("progressionVersion", 0) == 1;
}
int Game::completedLevel(const std::string &type) const {
    int completed = 0;
    for (const auto &b : buildings)
        if (b.type == type && b.state != State::Construction)
            completed = std::max(completed, b.level);
    return completed;
}
int Game::buildingLimit(const std::string &type) const {
    const auto &d = config.building(type);
    if (type == "townhall") return static_cast<int>(d.levels.size());
    if (type == "laboratory") return std::clamp(townHallLevel() - 5, 0, 4);
    if (progression()) return config.raw.at("buildingLimits").at(type).at(townHallLevel() - 1).get<int>();
    return config.townHallLimits.at(townHallLevel() - 1);
}
Result Game::buildingRequirements(const std::string &type) const {
    const auto &d = config.building(type);
    if (battle) return Result::fail("Finish the battle first");
    if (type == "townhall") return Result::fail("Your island already has a Town Hall");
    if ((type == "laboratory" || type == "academy") &&
        std::any_of(buildings.begin(), buildings.end(), [&](const auto &b) { return b.type == type; }))
        return Result::fail("You can build only one " + d.name);
    if (progression()) {
        if (buildingLimit(type) < 1) return Result::fail("Requires Town Hall level " + std::to_string(d.levels.front().townHall));
    }
    const auto &l = d.levels.front();
    if (townHallLevel() < l.townHall) return Result::fail("Upgrade the Town Hall");
    if (population() < l.population) return Result::fail("Not enough population");
    if (!affordable(l.cost)) return Result::fail("Not enough resources");
    return Result::success();
}
int Game::researchLevel(const std::string &type) const {
    auto found = researchLevels.find(type);
    return found == researchLevels.end() ? 0 : found->second;
}
int Game::researchLimit(const std::string &type, int academyLevel) const {
    const int tier = config.unit(type).level;
    const int academy = std::clamp(academyLevel, 0, 10);
    const int extra = config.raw.value("academyResearchVersion", 0) == 1
        ? std::max(0, academy - std::max(7, tier) + 1) : 0;
    return std::max(0, academy - tier + 1) + extra;
}
int Game::researchAcademyLevel(const std::string &type, int targetLevel) const {
    for (int academy = 1; academy <= 10; ++academy)
        if (researchLimit(type, academy) >= targetLevel) return academy;
    return 11;
}
int Game::researchStat(int baseStat, int level) {
    return compoundedResearch(baseStat, level);
}
double Game::researchBonusPercent(int level) {
    return (compoundedResearch(10000, level, true) - 10000) / 100.0;
}
int Game::unitHealth(const std::string &type) const {
    const auto &d = config.unit(type);
    return researchStat(d.health, researchLevel(type));
}
int Game::unitDamage(const std::string &type) const {
    const auto &d = config.unit(type);
    return researchStat(d.damage, researchLevel(type));
}
int Game::enemyAttackDamage(int baseDamage) const {
    int attack = std::max(1, static_cast<int>(static_cast<std::int64_t>(baseDamage) * config.enemyAttackPercent / 100));
    return enemyStatValue(attack);
}
int Game::enemyMaxHealth(int baseHealth) const {
    return enemyStatValue(baseHealth);
}
int Game::adjustedEnemyHealth(int health) const {
    int value = std::max(1, health);
    for (int percent : config.enemyHealthAdjustments)
        value = std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
    return value;
}
int Game::adjustedEnemyAttack(int damage, bool boss) const {
    int value = std::max(1, damage);
    for (const auto &adjustment : config.enemyAttackAdjustments)
        if (!adjustment.bossOnly || boss)
            value = std::max(1, static_cast<int>(
                static_cast<std::int64_t>(value) * adjustment.percent / 100));
    return value;
}
int Game::enemyStatValue(int baseStat) const {
    int value = std::max(1, baseStat);
    for (int pass = 0; pass < config.enemyStatPasses; ++pass)
        value = std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * config.enemyStatPercent / 100));
    for (int percent : config.enemyStatAdjustments)
        value = std::max(1, static_cast<int>(static_cast<std::int64_t>(value) * percent / 100));
    return value;
}
int Game::unitShield(const std::string &type, int maxHealth, int research) const {
    const auto &d = config.unit(type);
    if (std::find(d.abilities.begin(), d.abilities.end(), "energy_shield") != d.abilities.end()) {
        if (type == "heavy_infantry") return maxHealth / 2;
        if (type == "attack_submarine") return maxHealth;
    }
    return config.raw.value("academyResearchVersion", 0) == 1
        ? researchStat(d.shield, research < 0 ? researchLevel(type) : research) : d.shield;
}
int Game::unitHealing(const std::string &type, int maxHealth) const {
    const auto &d = config.unit(type);
    if (type == "infantry" && std::find(d.abilities.begin(), d.abilities.end(), "self_repair") != d.abilities.end())
        return maxHealth / 2;
    if ((type == "frigate" || type == "strike_fighter" || type == "armored_carrier") && std::find(d.abilities.begin(), d.abilities.end(), "repair_allies") != d.abilities.end())
        return static_cast<int>(static_cast<std::int64_t>(maxHealth) * 45 / 100);
    return 0;
}
Stock Game::researchCost(const std::string &type) const {
    const auto &d = config.unit(type);
    int target = researchLevel(type) + 1;
    Stock cost{};
    if (target > researchLimit(type, 10)) return cost;
    const bool academyPricing = config.raw.value("academyPricingVersion", 0) >= 1;
    const int priceTier = academyPricing ? std::max({1, completedLevel("academy"), d.level}) : target;
    const auto &base = config.raw.at("research").at("baseCosts").at(priceTier - 1);
    const int rankPercent = academyPricing ? 100 + (target - 1) *
        config.raw.at("research").at("additionalLevelCostPercent").get<int>() : 100;
    for (int i = 0; i < 5; ++i)
        cost[i] = base.value(resourceName(i), std::int64_t{0}) * (d.level + 4) * rankPercent / 1000;
    return cost;
}
int Game::researchSeconds(const std::string &type) const {
    return config.raw.at("research").at("secondsByDomain").at(domainName(config.unit(type).domain));
}
bool Game::affordable(const Stock &cost) const {
    for (std::size_t i = 0; i < 5; ++i)
        if (stock[i] < cost[i])
            return false;
    return true;
}
void Game::pay(const Stock &cost) {
    for (std::size_t i = 0; i < 5; ++i)
        stock[i] -= cost[i];
}
void Game::occupy(const Building &b, Id id) {
    auto &d = config.building(b.type);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            world.at({b.pos.x + x, b.pos.y + y}).occupant = id;
}
Result Game::canPlace(const std::string &type, Pos p, Id ignore) const {
    auto &d = config.building(type);
    std::set<Pos> coast;
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            Pos q{p.x + x, p.y + y};
            if (!world.contains(q))
                return Result::fail("Outside the island boundaries");
            auto &t = world.at(q);
            if (t.occupant && t.occupant != ignore)
                return Result::fail("This tile is occupied");
            if (std::find(d.terrain.begin(), d.terrain.end(), t.terrain) == d.terrain.end())
                return Result::fail("This terrain cannot support the building");
            for (auto n : world.neighbors(q))
                if (world.at(n).terrain == Terrain::Water)
                    coast.insert(n);
        }
    if (static_cast<int>(coast.size()) < d.coastal)
        return Result::fail("The Harbor must touch water");
    return Result::success();
}
Result Game::place(const std::string &type, Pos p) {
    auto allowed = buildingRequirements(type);
    if (!allowed.ok) return allowed;
    auto r = canPlace(type, p);
    if (!r.ok)
        return r;
    auto &l = config.building(type).levels.front();
    if (townHallLevel() < l.townHall)
        return Result::fail("Upgrade the Town Hall");
    if (population() < l.population)
        return Result::fail("Not enough population");
    if (stock[4] < l.cost[4])
        return Result::fail("Not enough gold. Fight a battle to collect more gold.");
    if (!affordable(l.cost))
        return Result::fail("Not enough resources");
    Building b;
    b.id = nextId;
    b.type = type;
    b.pos = p;
    b.state = l.seconds ? State::Construction : State::Active;
    b.remainingMs = std::int64_t(l.seconds) * 1000;
    buildings.push_back(b);
    ++nextId;
    pay(l.cost);
    occupy(b, b.id);
    return Result::success("Construction started");
}
Result Game::clearTree(Pos p) {
    if (battle)
        return Result::fail("Finish the battle first");
    if (!world.contains(p))
        return Result::fail("Tile outside map");
    auto &tile = world.at(p);
    if (tile.terrain != Terrain::Forest)
        return Result::fail("There is no tree on this tile");
    if (tile.occupant)
        return Result::fail("This tile is occupied");
    if (stock[4] < 20)
        return Result::fail("You need 20 gold to cut down this tree");
    if (stock[1] >= 1'000'000'000'000ll - 20)
        return Result::fail("Your wood stockpile is full");
    clearedTrees.insert(p);
    stock[4] -= 20;
    stock[1] += 20;
    tile.terrain = Terrain::Grass;
    return Result::success("Tree cut down: spent 20 gold and received 20 wood.");
}
Result Game::moveBuilding(Id id, Pos p) {
    if (battle)
        return Result::fail("Finish the battle first");
    auto b = findBuilding(id);
    if (!b)
        return Result::fail("Building not found");
    if (b->state != State::Active || !b->queue.empty() ||
        std::any_of(research.begin(), research.end(), [&](auto &r) { return r.academy == id; }))
        return Result::fail("This building is busy");
    if (b->type == "laboratory" && !brewing.empty()) return Result::fail("Finish potion brewing before moving");
    auto r = canPlace(b->type, p, id);
    if (!r.ok)
        return r;
    occupy(*b, 0);
    b->pos = p;
    occupy(*b, id);
    return Result::success("Building moved");
}
bool Game::unitTerrain(const UnitDef &d, Pos p) const {
    if (!world.contains(p))
        return false;
    auto t = world.at(p).terrain;
    if (d.domain == Domain::Naval)
        return t == Terrain::Water;
    return t == Terrain::Grass || t == Terrain::Sand;
}
bool Game::canPlaceUnit(const UnitDef &d, Pos p, Id ignore) const {
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x) {
            Pos cell{p.x + x, p.y + y};
            if (!unitTerrain(d, cell))
                return false;
            Id occupant = world.at(cell).occupant;
            if (occupant && occupant != ignore)
                return false;
        }
    return true;
}
void Game::occupyUnit(const Unit &u, Id occupant) {
    const auto &d = config.unit(u.type);
    for (int y = 0; y < d.height; ++y)
        for (int x = 0; x < d.width; ++x)
            world.at({u.pos.x + x, u.pos.y + y}).occupant = occupant;
}
Result Game::canMoveUnit(Id id, Pos p) const {
    if (battle)
        return Result::fail("Finish the battle first");
    auto u = findUnit(id);
    if (!u)
        return Result::fail("Unit not found");
    if (u->carrier || u->reserve)
        return Result::fail("Unload or deploy this aircraft before moving it");
    auto &d = config.unit(u->type);
    if (!canPlaceUnit(d, p, id))
        return Result::fail("Invalid or occupied tile");
    std::queue<Pos> q;
    std::set<Pos> visited;
    q.push(u->pos);
    visited.insert(u->pos);
    bool reachable = false;
    while (!q.empty()) {
        auto n = q.front();
        q.pop();
        if (n == p) {
            reachable = true;
            break;
        }
        for (auto v : world.neighbors(n))
            if (canPlaceUnit(d, v, id) && visited.insert(v).second)
                q.push(v);
    }
    if (!reachable)
        return Result::fail("No clear path");
    return Result::success();
}
Result Game::moveUnit(Id id, Pos p) {
    auto allowed = canMoveUnit(id, p);
    if (!allowed.ok) return allowed;
    auto u = findUnit(id);
    occupyUnit(*u, 0);
    u->pos = p;
    occupyUnit(*u, id);
    return Result::success("Unit moved");
}
Result Game::dismissUnit(Id id) {
    if (battle)
        return Result::fail("Finish the battle first");
    if (!findUnit(id))
        return Result::fail("Unit not found");
    if (std::any_of(units.begin(), units.end(), [&](const auto &unit) { return unit.carrier == id; }))
        return Result::fail("Unload this carrier's aircraft before dismissing it");
    if (stock[4] >= 1'000'000'000'000ll - 20)
        return Result::fail("Your gold stockpile cannot accept 20 gold");
    destroyUnit(id);
    stock[4] += 20;
    return Result::success("Unit dismissed. You received 20 gold.");
}
Result Game::upgradeRequirements(Id id) const {
    if (battle)
        return Result::fail("Finish the battle first");
    auto b = findBuilding(id);
    if (!b)
        return Result::fail("Building not found");
    if (b->state != State::Active || !b->queue.empty() ||
        std::any_of(research.begin(), research.end(), [&](auto &r) { return r.academy == id; }))
        return Result::fail("This building already has an active task");
    if (b->type == "laboratory" && !brewing.empty()) return Result::fail("Finish potion brewing before upgrading");
    auto &d = config.building(b->type);
    if (b->level >= static_cast<int>(d.levels.size()))
        return Result::fail("Maximum level reached");
    auto &l = d.levels.at(static_cast<std::size_t>(b->level));
    if (townHallLevel() < l.townHall || (b->type != "townhall" && b->level + 1 > buildingLimit(b->type)))
        return Result::fail("Upgrade the Town Hall first");
    if (progression() && b->type == "townhall") {
        auto requirement = [&](const std::string &type, int needed) {
            return Result::fail("Requires " + config.building(type).name + " level " + std::to_string(needed));
        };
        if (completedLevel("barracks") < b->level) return requirement("barracks", b->level);
        for (const auto &type : {"farm", "lumberyard"})
            if (completedLevel(type) < buildingLimit(type)) return requirement(type, buildingLimit(type));
        if (b->level + 1 == 4 && completedLevel("stone") < 2) return requirement("stone", 2);
        if (b->level + 1 == 6 && completedLevel("iron") < 2) return requirement("iron", 2);
    }
    const bool housingRequirement = progression() && b->type == "townhall" && config.raw.value("populationVersion", 0) == 1;
    if ((housingRequirement ? housing() : population()) < l.population)
        return Result::fail(housingRequirement
            ? "Requires population capacity " + std::to_string(l.population) + " (current " + std::to_string(housing()) + "). Build or upgrade Houses."
            : "Not enough population");
    if (stock[4] < l.cost[4])
        return Result::fail("Not enough gold. Fight a battle to collect more gold.");
    if (!affordable(l.cost))
        return Result::fail("Not enough resources");
    return Result::success("Upgrade started");
}
Result Game::upgrade(Id id) {
    auto allowed = upgradeRequirements(id);
    if (!allowed.ok) return allowed;
    auto b = findBuilding(id);
    const auto &l = config.building(b->type).levels.at(static_cast<std::size_t>(b->level));
    pay(l.cost);
    b->state = l.seconds ? State::Upgrading : State::Active;
    b->remainingMs = std::int64_t(l.seconds) * 1000;
    if (!l.seconds) ++b->level;
    return Result::success("Upgrade started");
}
Result Game::collect(Id id) {
    if (battle)
        return Result::fail("Finish the battle first");
    auto b = findBuilding(id);
    if (!b)
        return Result::fail("Building not found");
    int r = config.building(b->type).resource;
    if (r < 0)
        return Result::fail("This building does not produce resources");
    if (b->stored > std::numeric_limits<std::int64_t>::max() - stock[r])
        return Result::fail("Numeric limit reached");
    auto n = b->stored;
    stock[r] += n;
    b->stored = 0;
    return Result::success("Collected " + std::to_string(n) + " " + resourceName(r));
}
std::vector<std::string> Game::trainingRequirements(Id id, const std::string &type) const {
    std::vector<std::string> why;
    auto b = findBuilding(id);
    auto &d = config.unit(type);
    if (!b || b->type != d.building) {
        why.push_back("Required: " + config.building(d.building).name);
        return why;
    }
    if (b->state != State::Active)
        why.push_back("The building must be active");
    if (b->level < d.level)
        why.push_back("Upgrade " + config.building(d.building).name + " to Lv." + std::to_string(d.level));
    if (population() < d.population)
        why.push_back("Population: " + std::to_string(d.population));
    if (!d.technology.empty() && !technologies.contains(d.technology))
        why.push_back("Technology: " + config.tech(d.technology).name);
    if (progression() && freeHousing() < d.people)
        why.push_back("Population capacity: " + std::to_string(d.people));
    if (!progression() && civilian - reserved() < d.people)
        why.push_back("Available civilians: " + std::to_string(d.people));
    for (int i = 0; i < 5; ++i)
        if (stock[i] < d.cost[i])
            why.push_back("Missing " + std::to_string(d.cost[i] - stock[i]) + " " + resourceName(i));
    if (static_cast<int>(b->queue.size()) >= config.building(b->type).queue)
        why.push_back(config.building(b->type).queue == 1
            ? "This building is training one unit. Finish or cancel it before training another."
            : "The training queue is full");
    if (battle)
        why.push_back("Finish the battle first");
    return why;
}
Result Game::train(Id id, const std::string &type) {
    auto why = trainingRequirements(id, type);
    if (!why.empty()) {
        std::string m;
        for (auto &s : why) {
            if (!m.empty())
                m += " / ";
            m += s;
        }
        return Result::fail(m);
    }
    auto &d = config.unit(type);
    findBuilding(id)->queue.push_back({type, std::int64_t(d.seconds) * 1000, false, d.cost});
    pay(d.cost);
    return Result::success("Training started");
}
Result Game::cancelTraining(Id id, int index) {
    if (battle)
        return Result::fail("Finish the battle first");
    auto b = findBuilding(id);
    if (!b || index < 0 || index >= static_cast<int>(b->queue.size()))
        return Result::fail("Training task not found");
    const auto cost = b->queue[index].paidCost.value_or(config.unit(b->queue[index].type).cost);
    for (int i = 0; i < 5; ++i)
        if (stock[i] + cost[i] >= 1'000'000'000'000ll)
            return Result::fail("Your stockpile cannot accept the refund");
    for (int i = 0; i < 5; ++i)
        stock[i] += cost[i];
    b->queue.erase(b->queue.begin() + index);
    return Result::success("Training cancelled. Resources and reserved civilians released.");
}
Result Game::embark(Id aircraft, Id carrier) {
    if (battle)
        return Result::fail("Finish the battle first");
    auto a = findUnit(aircraft), c = findUnit(carrier);
    if (!a || !c || a->health <= 0 || c->health <= 0 || aircraft == carrier)
        return Result::fail("Select a living aircraft and carrier");
    const auto &ad = config.unit(a->type), &cd = config.unit(c->type);
    if (ad.domain != Domain::Air || !cd.carrierSlots ||
        std::find(cd.allowedAircraftTiers.begin(), cd.allowedAircraftTiers.end(), ad.level) == cd.allowedAircraftTiers.end())
        return Result::fail("This aircraft type is not supported by the selected carrier");
    if (a->carrier)
        return Result::fail("This aircraft is already assigned to a carrier");
    int aboard = std::count_if(units.begin(), units.end(), [&](const auto &u) { return u.carrier == carrier; });
    if (aboard >= cd.carrierSlots)
        return Result::fail("The carrier has no free aircraft slots");
    if (!a->reserve)
        occupyUnit(*a, 0);
    a->carrier = carrier;
    a->reserve = false;
    return Result::success("Aircraft assigned to carrier");
}
Result Game::disembark(Id aircraft) {
    if (battle)
        return Result::fail("Finish the battle first");
    auto a = findUnit(aircraft);
    if (!a || !a->carrier)
        return Result::fail("This aircraft is not on a carrier");
    auto source = findBuilding(a->source);
    auto p = source ? deployment(*source, config.unit(a->type)) : std::nullopt;
    if (!p)
        return Result::fail("Clear space near the aircraft's Air Base before unloading");
    a->pos = *p;
    a->carrier = 0;
    occupyUnit(*a, a->id);
    return Result::success("Aircraft returned to Air Base");
}
void Game::destroyUnit(Id id, bool combat) {
    std::vector<Id> cargo;
    for (const auto &u : units)
        if (u.carrier == id)
            cargo.push_back(u.id);
    if (combat) {
        if (battle)
            for (auto &f : battle->fighters)
                if (f.id == id) {
                    f.health = f.shield = f.potionShield = 0;
                    if (!f.enemy) f.defeatedPhase = battle->phaseIndex;
                }
        if (config.destroyEmbarkedAircraft)
            for (Id child : cargo)
                destroyUnit(child, true);
        return;
    }
    for (Id child : cargo) {
        if (config.destroyEmbarkedAircraft)
            destroyUnit(child);
        else if (auto a = findUnit(child)) {
            a->carrier = 0;
            a->reserve = true;
        }
    }
    auto u = findUnit(id);
    if (!u)
        return;
    if (!u->carrier && !u->reserve)
        occupyUnit(*u, 0);
    std::erase_if(units, [&](const auto &candidate) { return candidate.id == id; });
}
Result Game::researchRequirements(Id id, const std::string &type) const {
    if (battle)
        return Result::fail("Finish the battle first");
    auto b = findBuilding(id);
    if (progression()) {
        const auto &u = config.unit(type);
        int target = researchLevel(type) + 1;
        if (target > researchLimit(type, 10)) return Result::fail("Maximum research level reached for this unit type");
        const int requiredAcademy = researchAcademyLevel(type, target);
        if (!b || b->type != "academy" || b->state != State::Active)
            return Result::fail("Requires an active Academy at level " + std::to_string(requiredAcademy));
        if (completedLevel(u.building) < u.level)
            return Result::fail("Unlock " + u.name + " in " + config.building(u.building).name + " first");
        if (target > researchLimit(type, b->level))
            return Result::fail("Requires an active Academy at level " + std::to_string(requiredAcademy));
        if (!research.empty()) return Result::fail("The city's research queue is busy");
        auto cost = researchCost(type);
        if (!affordable(cost)) return Result::fail("Not enough resources");
        return Result::success("Research started");
    }
    auto &d = config.tech(type);
    if (!b || b->type != "academy" || b->state != State::Active || b->level < d.academy)
        return Result::fail("Requires an active Academy at level " + std::to_string(d.academy));
    if (technologies.contains(type))
        return Result::fail("Technology already researched");
    for (auto &r : research)
        if (r.type == type || r.academy == id)
            return Result::fail("Research is already in progress");
    for (auto &p : d.prerequisites)
        if (!technologies.contains(p))
            return Result::fail("Research first: " + config.tech(p).name);
    if (!affordable(d.cost))
        return Result::fail("Not enough resources");
    return Result::success("Research started");
}
Result Game::startResearch(Id id, const std::string &type) {
    auto allowed = researchRequirements(id, type);
    if (!allowed.ok) return allowed;
    if (progression()) {
        auto cost = researchCost(type);
        research.push_back({type, id, std::int64_t(researchSeconds(type)) * 1000, researchLevel(type) + 1});
        pay(cost);
        return Result::success("Research started");
    }
    const auto &d = config.tech(type);
    research.push_back({type, id, std::int64_t(d.seconds) * 1000});
    pay(d.cost);
    return Result::success("Research started");
}
std::optional<Pos> Game::deployment(const Building &b, const UnitDef &d) const {
    auto &bd = config.building(b.type);
    for (int y = b.pos.y - d.height; y <= b.pos.y + bd.height; ++y)
        for (int x = b.pos.x - d.width; x <= b.pos.x + bd.width; ++x) {
            Pos p{x, y};
            bool beside = ((x + d.width == b.pos.x || x == b.pos.x + bd.width) &&
                           y < b.pos.y + bd.height && y + d.height > b.pos.y) ||
                          ((y + d.height == b.pos.y || y == b.pos.y + bd.height) &&
                           x < b.pos.x + bd.width && x + d.width > b.pos.x);
            if (beside && canPlaceUnit(d, p))
                return p;
        }
    return std::nullopt;
}
void Game::tick(std::int64_t ms) {
    if (ms < 0) {
        diagnostics.push_back("Negative elapsed time ignored");
        return;
    }
    if (battle) {
        tickBattle(ms);
        return;
    }
    if (ms > 86'400'000) {
        diagnostics.push_back("Elapsed time clamped to one day");
        ms = 86'400'000;
    }
    pendingMs += ms;
    while (pendingMs >= config.stepMs) {
        pendingMs -= config.stepMs;
        step();
    }
}
void Game::step() {
    elapsedMs += config.stepMs;
    if (!brewing.empty()) {
        auto &task = brewing.front();
        task.remainingMs = std::max<std::int64_t>(0, task.remainingMs - config.stepMs);
        if (!task.remainingMs) { ++potions[potionIndex(task.type)]; brewing.erase(brewing.begin()); }
    }
    for (auto &u : units)
        if (u.reserve) {
            auto source = findBuilding(u.source);
            auto p = source ? deployment(*source, config.unit(u.type)) : std::nullopt;
            if (p) {
                u.pos = *p;
                u.reserve = false;
                occupyUnit(u, u.id);
            }
        }
    for (auto &b : buildings) {
        if (b.state != State::Active) {
            b.remainingMs = std::max<std::int64_t>(0, b.remainingMs - config.stepMs);
            if (!b.remainingMs) {
                if (b.state == State::Upgrading)
                    ++b.level;
                b.state = State::Active;
            }
            continue;
        }
        auto &d = config.building(b.type);
        auto &l = level(b);
        if (d.resource >= 0 && b.stored < l.capacity) {
            const auto denominator = progression() ? 3'600'000ll : Micro;
            b.remainder += progression() ? std::int64_t(l.ratePerHour) * config.stepMs
                                        : std::int64_t(l.rate) * Micro * config.stepMs / 1000;
            b.stored += b.remainder / denominator;
            b.remainder %= denominator;
            if (b.stored >= l.capacity) {
                b.stored = l.capacity;
                b.remainder = 0;
            }
        }
        if (!b.queue.empty()) {
            auto &tr = b.queue.front();
            tr.remainingMs = std::max<std::int64_t>(0, tr.remainingMs - config.stepMs);
            if (!tr.remainingMs) {
                auto &u = config.unit(tr.type);
                auto p = deployment(b, u);
                if (!p) {
                    tr.awaiting = true;
                    continue;
                }
                Unit unit{nextId++, b.id, u.id, *p, unitHealth(u.id)};
                units.push_back(unit);
                occupyUnit(unit, unit.id);
                if (!progression()) civilian -= u.people;
                b.queue.erase(b.queue.begin());
            }
        }
    }
    for (auto &r : research)
        r.remainingMs = std::max<std::int64_t>(0, r.remainingMs - config.stepMs);
    for (auto &r : research)
        if (!r.remainingMs) {
            if (r.level) {
                int previousHealth = unitHealth(r.type);
                researchLevels[r.type] = r.level;
                int gain = unitHealth(r.type) - previousHealth;
                for (auto &u : units) if (u.type == r.type) u.health += gain;
            } else technologies.insert(r.type);
        }
    std::erase_if(research, [](auto &r) { return r.remainingMs == 0; });
    if (progression()) return;
    int rate = 0;
    for (auto [minimum, percent] : config.foodRates)
        if (stock[0] >= minimum)
            rate = percent;
    if (!freeHousing() || stock[0] < config.foodCost || !rate) {
        settlementRemainder = 0;
        return;
    }
    settlementRemainder += std::int64_t(config.stepMs) * rate;
    auto threshold = std::int64_t(config.settlementSeconds) * 1000 * 100;
    while (settlementRemainder >= threshold && freeHousing() && stock[0] >= config.foodCost) {
        settlementRemainder -= threshold;
        ++civilian;
        stock[0] -= config.foodCost;
    }
    if (!freeHousing() || stock[0] < config.foodCost)
        settlementRemainder = 0;
}
Result Game::applyReward(const BattleResult &r) {
    if (appliedRewards.contains(r.id))
        return Result::fail("This reward has already been claimed");
    if (!r.id || r.captives < 0)
        return Result::fail("Invalid reward");
    for (std::size_t i = 0; i < 5; ++i)
        if (r.rewards[i] < 0 || stock[i] > std::numeric_limits<std::int64_t>::max() - r.rewards[i])
            return Result::fail("Invalid resource amount");
    appliedRewards.insert(r.id);
    int accepted = 0;
    if (r.victory) {
        for (std::size_t i = 0; i < 5; ++i)
            stock[i] += r.rewards[i];
        accepted = std::min(r.captives, freeHousing());
        civilian += accepted;
    }
    return Result::success(r.victory ? "Victory. Welcomed " + std::to_string(accepted) + " of " +
                                           std::to_string(r.captives) + " captives."
                                     : "Your squad was lost. Prepare another expedition.");
}
} // namespace kingdom
