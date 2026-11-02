#include "kingdom/Game.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace kingdom {
namespace {
const Json &enemyDefinition(const Config &config, const std::string &id) {
    const auto &enemies = config.raw.at("campaign").at("enemies");
    const auto found = std::find_if(enemies.begin(), enemies.end(), [&](const Json &e) { return e.at("id") == id; });
    if (found == enemies.end()) throw std::runtime_error("Unknown campaign enemy: " + id);
    return *found;
}
Fighter campaignFighter(const Game &game, const Unit &unit) {
    const auto &d = game.config.unit(unit.type);
    Fighter f;
    f.id = unit.id; f.type = unit.type; f.domain = f.phase = d.domain;
    f.health = unit.health; f.maxHealth = game.unitHealth(unit.type); f.damage = game.unitDamage(unit.type);
    f.defense = d.defense; f.range = d.range; f.movement = d.movement;
    f.name = d.name; f.assetPath = d.assetPath;
    for (const auto &technology : game.technologies) {
        const auto &tech = game.config.tech(technology);
        if (tech.domain == d.domain) { f.health += tech.health; f.maxHealth += tech.health; f.damage += tech.damage; }
    }
    f.shield = game.unitShield(f.type, f.maxHealth);
    return f;
}
void ensure(bool valid, const std::string &message) {
    if (!valid) throw std::runtime_error(message);
}
}
int Game::campaignCurrentLevel() const {
    int maximum = config.raw.contains("campaign") ? static_cast<int>(config.raw.at("campaign").at("levels").size()) : 150;
    return std::min(maximum, static_cast<int>(completedCampaignLevels.size()) + 1);
}
const Json &Game::campaignLevelDefinition(int level) const {
    if (!config.raw.contains("campaign")) throw std::runtime_error("The campaign is not available in this game configuration");
    const auto &levels = config.raw.at("campaign").at("levels");
    if (level < 1 || level > static_cast<int>(levels.size())) throw std::runtime_error("Invalid campaign level");
    return levels.at(level - 1);
}
Result Game::startCampaignBattle(int level, const std::vector<Id> &selectedUnits, bool automatic) {
    if (battle) return Result::fail("A battle is already active");
    const auto &definition = campaignLevelDefinition(level);
    if (level > campaignCurrentLevel()) return Result::fail("Win the previous campaign level first");
    if (townHallLevel() < definition.at("requiredTH").get<int>())
        return Result::fail("This level requires Town Hall " + std::to_string(definition.at("requiredTH").get<int>()));
    std::set<Domain> required;
    for (const auto &round : definition.at("rounds")) required.insert(domainFromName(round.at("domain")));
    if (selectedUnits.empty() || selectedUnits.size() > required.size() * 5)
        return Result::fail("Choose 1 to 5 units for every required troop type before the battle");
    std::set<Id> selected;
    std::map<Domain, int> counts;
    Battle candidate;
    candidate.id = nextBattleId;
    candidate.campaignLevel = level;
    candidate.automatic = automatic;
    candidate.phases.clear();
    for (const auto &round : definition.at("rounds")) candidate.phases.push_back(domainFromName(round.at("domain")));
    for (Id id : selectedUnits) {
        if (!selected.insert(id).second) return Result::fail("Each unit can only be selected once");
        const auto *unit = findUnit(id);
        if (!unit || unit->health <= 0 || unit->carrier || unit->reserve)
            return Result::fail("Select available living units from your army");
        Domain domain = config.unit(unit->type).domain;
        if (!required.contains(domain)) return Result::fail("This level does not require " + domainName(domain) + " units");
        if (++counts[domain] > 5) return Result::fail("Select at most 5 units of each required troop type");
        candidate.campaignArmy.push_back(campaignFighter(*this, *unit));
    }
    for (Domain domain : required)
        if (!counts[domain]) return Result::fail("Choose at least 1 " + domainName(domain) + " unit for this level");
    candidate.domain = candidate.phases.front();
    battle = std::move(candidate);
    ++nextBattleId;
    addCampaignAircraft();
    deployCampaignPhase();
    return Result::success("The campaign battle begins with your selected army.");
}
Result Game::deployCampaignRound(const std::vector<Id> &) {
    return Result::fail("The army is fixed for this level. Choose all troops before starting the battle");
}
int Game::campaignEnemyShield(int levelNumber, int phaseIndex, const Fighter &fighter) const {
    const auto &round = campaignLevelDefinition(levelNumber).at("rounds").at(phaseIndex);
    if (round.contains("unshieldedEnemies")) {
        const auto &unshielded = round.at("unshieldedEnemies");
        if (std::find(unshielded.begin(), unshielded.end(), Json(fighter.enemyId)) != unshielded.end()) return 0;
    }
    return unitShield(fighter.type == "raider" ? "infantry" : fighter.type, fighter.maxHealth, fighter.enemy ? 0 : -1);
}
int Game::maxBattleShield(const Fighter &fighter) const {
    if (fighter.enemy && battle && battle->campaignLevel)
        return campaignEnemyShield(battle->campaignLevel, battle->phaseIndex, fighter);
    return unitShield(fighter.type == "raider" ? "infantry" : fighter.type, fighter.maxHealth, fighter.enemy ? 0 : -1);
}
Fighter Game::campaignEnemyFighter(int levelNumber, int phaseIndex, int index) const {
    const auto &level = campaignLevelDefinition(levelNumber);
    const auto &round = level.at("rounds").at(phaseIndex);
    int th = level.value("enemyTH", level.at("requiredTH").get<int>());
    double difficulty = th <= 3 ? .85 : th <= 5 ? .95 : th <= 8 ? 1.0 : th == 9 ? 1.1 : 1.2;
    double stage = (1.0 + .055 * (levelNumber - 1)) * difficulty;
    int specials = std::count_if(round.at("enemies").begin(), round.at("enemies").end(), [&](const Json &id) {
        return enemyDefinition(config, id.get<std::string>()).at("kind") != "ordinary";
    });
    const auto domain = domainFromName(round.at("domain"));
    const auto &id = round.at("enemies").at(index);
    const auto &enemy = enemyDefinition(config, id.get<std::string>());
    const UnitDef *base = &config.unit(enemy.at("unitType"));
    const std::string kind = enemy.at("kind");
    if (kind != "ordinary")
        for (const auto &unit : config.units)
            if (unit.domain == domain && unit.level == th) base = &unit;
    double hp = stage, attack = stage;
    if (kind == "boss") { hp *= 2.5 + .15 * (th - 1); attack *= 1.3 + .05 * (th - 1); }
    if (kind == "ai") { hp *= 3.0 + .2 * (th - 1); attack *= 1.5 + .05 * (th - 1); }
    if (kind != "ordinary" && specials >= 2) hp *= .75;
    if (round.contains("enemyAttackPercents"))
        attack *= round.at("enemyAttackPercents").value(id.get<std::string>(), 100) / 100.0;
    Fighter f;
    f.id = (Id{1} << 63) + static_cast<Id>(phaseIndex * 10 + index);
    f.type = base->id; f.enemyId = id.get<std::string>(); f.name = enemy.at("name");
    f.assetPath = enemy.at("assetPath");
    f.enemy = true; f.domain = f.phase = domain;
    f.health = f.maxHealth = enemyMaxHealth(std::max(1, static_cast<int>(std::lround(base->enemyBaseHealth * hp))));
    f.damage = enemyAttackDamage(std::max(1, static_cast<int>(std::lround(base->enemyBaseDamage * attack))));
    if (kind == "boss") {
        f.health = f.maxHealth = std::max(1, static_cast<int>(
            static_cast<std::int64_t>(f.maxHealth) * config.bossHealthPercent / 100));
        f.damage = std::max(1, static_cast<int>(
            static_cast<std::int64_t>(f.damage) * config.bossAttackPercent / 100));
    }
    f.health = f.maxHealth = adjustedEnemyHealth(f.maxHealth);
    f.damage = adjustedEnemyAttack(f.damage, kind == "boss");
    if (round.contains("enemyFinalHealthPercents"))
        f.health = f.maxHealth = std::max(1, static_cast<int>(static_cast<std::int64_t>(f.maxHealth) *
            round.at("enemyFinalHealthPercents").value(f.enemyId, 100) / 100));
    if (round.contains("enemyFinalAttackPercents"))
        f.damage = std::max(1, static_cast<int>(static_cast<std::int64_t>(f.damage) *
            round.at("enemyFinalAttackPercents").value(f.enemyId, 100) / 100));
    f.defense = base->defense; f.range = base->range; f.movement = base->movement;
    f.shield = campaignEnemyShield(levelNumber, phaseIndex, f);
    f.pos = {config.battleWidth - 1, index * config.battleHeight / static_cast<int>(round.at("enemies").size())};
    return f;
}
void Game::addCampaignAircraft() {
    if (!battle || !battle->campaignLevel || config.raw.value("armyAbilitiesVersion", 0) < 1) return;
    auto &b = *battle;
    for (const auto &unit : units) {
        if (!unit.carrier) continue;
        const auto carrier = std::find_if(b.campaignArmy.begin(), b.campaignArmy.end(),
            [&](const auto &f) { return f.id == unit.carrier; });
        if (carrier == b.campaignArmy.end() || std::any_of(b.campaignArmy.begin(), b.campaignArmy.end(),
            [&](const auto &f) { return f.id == unit.id; })) continue;
        Fighter cargo = campaignFighter(*this, unit);
        cargo.carrier = unit.carrier;
        cargo.phase = carrier->phase;
        const auto activeCarrier = std::find_if(b.fighters.begin(), b.fighters.end(),
            [&](const auto &f) { return f.id == unit.carrier; });
        if (carrier->health <= 0 || (activeCarrier != b.fighters.end() && activeCarrier->health <= 0))
            cargo.health = cargo.shield = 0;
        b.campaignArmy.push_back(cargo);
        if (activeCarrier != b.fighters.end()) {
            int row = std::count_if(b.fighters.begin(), b.fighters.end(), [](const auto &f) { return !f.enemy; });
            cargo.pos = {row / config.battleHeight, row % config.battleHeight};
            cargo.attacked = true;
            b.fighters.push_back(cargo);
        }
    }
}
void Game::deployCampaignPhase() {
    auto &b = *battle;
    clearPotionEffects();
    std::vector<Fighter> fighters;
    for (const auto &saved : b.campaignArmy) {
        if (saved.phase != b.domain) continue;
        Fighter f = saved;
        int row = static_cast<int>(fighters.size());
        f.pos = {row / config.battleHeight, row % config.battleHeight};
        f.moved = f.attacked = false;
        f.attacksThisTurn = 0;
        f.readyRound = 1;
        fighters.push_back(std::move(f));
    }
    const auto &round = campaignLevelDefinition(b.campaignLevel).at("rounds").at(b.phaseIndex);
    for (int index = 0; index < static_cast<int>(round.at("enemies").size()); ++index)
        fighters.push_back(campaignEnemyFighter(b.campaignLevel, b.phaseIndex, index));
    b.fighters = std::move(fighters);
    b.awaitingSelection = false; b.round = 1; b.enemyTurn = false; b.pendingMs = 0;
    b.lastAttacks.clear();
    checkBattle();
    // The first side is normalized by the same turn logic used by regular expeditions.
    if (!b.finished && !b.awaitingSelection) {
        bool automatic = b.automatic, paused = b.paused;
        b.automatic = b.paused = false;
        bool ready = std::any_of(b.fighters.begin(), b.fighters.end(), [&](const auto &f) {
            return !f.enemy && (!validBattleTargets(f.id).empty() || !validBattleHealTargets(f.id).empty());
        });
        b.automatic = automatic;
        b.paused = paused;
        if (!ready) {
            b.enemyTurn = true;
            for (auto &fighter : b.fighters) if (!fighter.enemy) fighter.attacked = true;
        }
    }
}
void Game::syncCampaignArmy() {
    for (const auto &fighter : battle->fighters) {
        if (fighter.enemy) continue;
        auto found = std::find_if(battle->campaignArmy.begin(), battle->campaignArmy.end(),
                                  [&](const auto &saved) { return saved.id == fighter.id; });
        if (found != battle->campaignArmy.end()) *found = fighter;
    }
}
void Game::returnCampaignRound() {
    syncCampaignArmy();
    for (const auto &fighter : battle->campaignArmy) {
        auto *unit = findUnit(fighter.id);
        if (!unit) continue;
        if (fighter.health <= 0) destroyUnit(fighter.id);
        else unit->health = std::clamp(fighter.health - (fighter.maxHealth - unitHealth(unit->type)), 1, unitHealth(unit->type));
    }
}
void Game::migrateCampaignArmy() {
    auto &b = *battle;
    ensure(!b.phases.empty() && b.phaseIndex >= 0 && b.phaseIndex < static_cast<int>(b.phases.size()), "Invalid campaign rounds");
    for (const auto &fighter : b.fighters)
        if (!fighter.enemy) b.campaignArmy.push_back(fighter);
    if (b.finished) return;
    std::set<Domain> required(b.phases.begin() + b.phaseIndex, b.phases.end());
    for (Domain domain : required) {
        if (std::any_of(b.campaignArmy.begin(), b.campaignArmy.end(),
                        [&](const auto &f) { return f.domain == domain; })) continue;
        std::vector<const Unit *> available;
        for (const auto &unit : units)
            if (unit.health > 0 && !unit.carrier && !unit.reserve && config.unit(unit.type).domain == domain)
                available.push_back(&unit);
        std::sort(available.begin(), available.end(), [&](const auto *a, const auto *other) {
            const auto &ad = config.unit(a->type), &bd = config.unit(other->type);
            if (ad.level != bd.level) return ad.level > bd.level;
            if (unitDamage(a->type) != unitDamage(other->type)) return unitDamage(a->type) > unitDamage(other->type);
            if (a->health != other->health) return a->health > other->health;
            return a->id < other->id;
        });
        for (std::size_t i = 0; i < std::min<std::size_t>(5, available.size()); ++i)
            b.campaignArmy.push_back(campaignFighter(*this, *available[i]));
        if (available.empty()) {
            b.outcomes.push_back(0);
            b.finished = b.retreated = true;
            b.victory = b.draw = b.awaitingSelection = b.enemyTurn = false;
            b.pendingMs = 0; b.lastAttacks.clear();
            return;
        }
    }
    if (b.awaitingSelection) deployCampaignPhase();
}
void Game::migrateEarlyLandCampaign() {
    auto &b = *battle;
    const int previousPhase = b.phaseIndex;
    const bool navalDefeat = previousPhase == 1 && b.finished && !b.victory;
    // Return ships with their existing wounds and casualties before releasing them from the level.
    for (const auto &fighter : b.campaignArmy) {
        if (fighter.domain != Domain::Naval) continue;
        auto *home = findUnit(fighter.id);
        if (!home) continue;
        if (fighter.health <= 0) destroyUnit(fighter.id);
        else home->health = std::clamp(fighter.health - (fighter.maxHealth - unitHealth(fighter.type)), 1, unitHealth(fighter.type));
    }
    std::erase_if(b.campaignArmy, [](const Fighter &fighter) { return fighter.domain == Domain::Naval; });
    b.phases.erase(b.phases.begin() + 1);
    if (b.outcomes.size() > 1) b.outcomes.erase(b.outcomes.begin() + 1);
    if (previousPhase == 0) return;
    if (previousPhase > 1) {
        --b.phaseIndex;
        for (auto &fighter : b.fighters) if (fighter.defeatedPhase >= 1) --fighter.defeatedPhase;
        for (auto &fighter : b.campaignArmy) if (fighter.defeatedPhase >= 1) --fighter.defeatedPhase;
        return;
    }
    clearPotionEffects();
    b.domain = Domain::Land; b.draw = b.awaitingSelection = b.enemyTurn = false;
    b.pendingMs = b.animationMs = 0; b.lastAttacks.clear(); b.round = 1;
    b.phaseIndex = navalDefeat || b.phases.size() == 1 ? 0 : 1;
    b.finished = navalDefeat || b.phases.size() == 1;
    b.retreated = navalDefeat;
    b.victory = b.finished && !navalDefeat;
    b.outcomes = {navalDefeat ? 0 : 1};
    if (!b.finished) {
        deployCampaignPhase();
        syncCampaignArmy();
        return;
    }
    // The removed final sea round leaves a claimable land victory, or preserves a prior defeat.
    b.fighters = b.campaignArmy;
    const auto &round = campaignLevelDefinition(b.campaignLevel).at("rounds").at(0);
    for (int index = 0; index < static_cast<int>(round.at("enemies").size()); ++index) {
        auto enemy = campaignEnemyFighter(b.campaignLevel, 0, index);
        enemy.health = enemy.shield = 0;
        b.fighters.push_back(std::move(enemy));
    }
}
Result Game::retreatBattle() {
    if (!battle || !battle->campaignLevel || battle->finished)
        return Result::fail("There is no active campaign battle to retreat from");
    clearPotionEffects();
    battle->outcomes.push_back(0);
    battle->finished = true; battle->victory = false; battle->draw = false;
    battle->retreated = true; battle->awaitingSelection = false;
    battle->enemyTurn = false; battle->pendingMs = 0; battle->lastAttacks.clear();
    return Result::success("Retreated. This campaign level remains available to try again.");
}
void Game::validateCampaignBattle() const {
    const auto &b = *battle;
    const auto &level = campaignLevelDefinition(b.campaignLevel);
    ensure(b.campaignLevel <= campaignCurrentLevel(), "Campaign battle skips a locked level");
    ensure(townHallLevel() >= level.at("requiredTH").get<int>(), "Campaign battle exceeds Town Hall unlock");
    ensure(b.phases.size() == level.at("rounds").size() && b.phaseIndex >= 0 &&
               b.phaseIndex < static_cast<int>(b.phases.size()) && b.domain == b.phases[b.phaseIndex], "Invalid campaign rounds");
    for (std::size_t i = 0; i < b.phases.size(); ++i)
        ensure(domainName(b.phases[i]) == level.at("rounds")[i].at("domain").get<std::string>(), "Campaign round domain differs from specification");
    ensure(b.outcomes.size() == static_cast<std::size_t>(b.phaseIndex + (b.finished ? 1 : 0)), "Invalid campaign round results");
    for (std::size_t i = 0; i < b.outcomes.size(); ++i)
        ensure(b.outcomes[i] == 1 || (b.finished && i + 1 == b.outcomes.size() && (b.outcomes[i] == 0 || b.outcomes[i] == -1)), "Campaign continued after a lost round");
    bool won = b.finished && b.outcomes.size() == b.phases.size() && std::all_of(b.outcomes.begin(), b.outcomes.end(), [](int outcome) { return outcome == 1; });
    ensure(b.victory == won && !b.draw && !b.awaitingSelection, "Invalid campaign winner");
    ensure(b.pendingMs >= 0 && b.pendingMs < 1000 && b.actions >= 0 &&
               ((b.automatic || b.enemyTurn) || b.pendingMs == 0), "Invalid campaign clock");
    std::set<Id> armyIds;
    std::map<Domain, int> armyCounts;
    std::set<Domain> required(b.phases.begin(), b.phases.end());
    for (const auto &f : b.campaignArmy) {
        const auto &d = config.unit(f.type);
        const auto *home = findUnit(f.id);
        ensure(armyIds.insert(f.id).second && !f.enemy && f.domain == d.domain && required.contains(f.phase),
               "Invalid committed campaign army");
        if (!f.carrier) ensure(f.domain == f.phase && ++armyCounts[f.domain] <= 5, "Invalid committed campaign squad size");
        else {
            const auto carrier = std::find_if(b.campaignArmy.begin(), b.campaignArmy.end(),
                [&](const auto &v) { return v.id == f.carrier && !v.carrier && v.phase == f.phase; });
            ensure(config.raw.value("armyAbilitiesVersion", 0) >= 1 && f.domain == Domain::Air && f.phase == Domain::Naval &&
                carrier != b.campaignArmy.end() && (!config.destroyEmbarkedAircraft || carrier->health > 0 || f.health == 0), "Invalid committed carrier aircraft");
        }
        ensure(home && home->type == f.type && home->carrier == f.carrier && !home->reserve, "Missing committed campaign troop");
        ensure(f.health >= 0 && f.health <= f.maxHealth && f.maxHealth > 0 && f.maxHealth < 1'000'000 &&
                   f.damage > 0 && f.damage < 1'000'000 && f.defense >= 0 && f.range > 0 && f.range <= 20 &&
                   f.movement > 0 && f.movement <= 20 && f.shield >= 0 && f.shield <= unitShield(f.type, f.maxHealth) &&
                   f.readyRound >= 1 && f.readyRound <= 1'000'000 && f.strikes >= 0,
               "Invalid committed campaign troop statistics");
    }
    if (!b.finished)
        for (auto phase = b.phases.begin() + b.phaseIndex; phase != b.phases.end(); ++phase)
            ensure(armyCounts[*phase] >= 1, "Missing troops for a remaining campaign round");
    if (b.fighters.empty()) {
        ensure(b.retreated && b.finished, "Missing campaign army");
        return;
    }
    int friendly = 0, livingFriendly = 0, livingEnemy = 0;
    std::set<Id> ids;
    std::set<Pos> positions;
    std::vector<std::string> enemies;
    for (const auto &f : b.fighters) {
        const auto &d = config.unit(f.type);
        ensure(ids.insert(f.id).second && f.phase == b.domain &&
            (f.carrier ? f.domain == Domain::Air && b.domain == Domain::Naval : f.domain == b.domain), "Invalid campaign fighter domain or identity");
        ensure(f.pos.x >= 0 && f.pos.y >= 0 && f.pos.x < config.battleWidth && f.pos.y < config.battleHeight, "Invalid campaign fighter position");
        ensure(f.health >= 0 && f.health <= f.maxHealth && f.maxHealth > 0 && f.maxHealth < 1'000'000 &&
                   f.damage > 0 && f.damage < 1'000'000 && f.defense >= 0 && f.range > 0 && f.range <= 20 &&
                   f.movement > 0 && f.movement <= 20 && f.shield >= 0 && f.shield <= maxBattleShield(f) &&
                   f.readyRound >= 1 && f.readyRound <= 1'000'000 && f.strikes >= 0, "Invalid campaign fighter statistics");
        if (f.health > 0) ensure(positions.insert(f.pos).second, "Overlapping campaign fighters");
        if (f.enemy) {
            const auto &enemy = enemyDefinition(config, f.enemyId);
            ensure(f.id >= (Id{1} << 63) && domainName(f.domain) == enemy.at("domain").get<std::string>(), "Invalid campaign enemy");
            enemies.push_back(f.enemyId);
            if (f.health > 0) ++livingEnemy;
        } else {
            const auto *home = findUnit(f.id);
            ensure(armyIds.contains(f.id) && home && home->type == f.type && d.domain == f.domain && home->carrier == f.carrier && !home->reserve, "Missing home campaign troop");
            if (f.carrier) {
                auto carrier = std::find_if(b.fighters.begin(), b.fighters.end(), [&](const auto &v) { return v.id == f.carrier && !v.carrier; });
                ensure(carrier != b.fighters.end() && (!config.destroyEmbarkedAircraft || carrier->health > 0 || f.health == 0), "Missing campaign carrier");
            } else {
                ++friendly;
                if (f.health > 0) ++livingFriendly;
            }
        }
    }
    ensure(friendly >= 1 && friendly == armyCounts[b.domain] && enemies == level.at("rounds").at(b.phaseIndex).at("enemies").get<std::vector<std::string>>(), "Campaign squad differs from specified slots");
    if (!b.finished) ensure(livingFriendly > 0 && livingEnemy > 0, "Campaign round result missing");
    else if (!b.retreated)
        ensure((b.victory && livingFriendly > 0 && livingEnemy == 0) ||
                   (!b.victory && ((livingFriendly == 0 && livingEnemy > 0) || b.outcomes.back() == -1)), "Invalid campaign round winner");
    ensure(b.lastAttacks.size() <= 31, "Invalid campaign attack log");
    for (const auto &hit : b.lastAttacks) {
            ensure(hit.stunTurns >= 0 && hit.stunTurns <= 1 && (!hit.stunTurns || (!hit.missed && !hit.healing)) &&
                (!hit.attackerStunned || hit.stunTurns == 1), "Invalid stun log");
        const auto attacker = std::find_if(b.fighters.begin(), b.fighters.end(), [&](const Fighter &f) { return f.id == hit.attacker; });
        const auto target = std::find_if(b.fighters.begin(), b.fighters.end(), [&](const Fighter &f) { return f.id == hit.target; });
        ensure(attacker != b.fighters.end() && target != b.fighters.end() && hit.damage >= 0 &&
                   hit.shieldDamage >= 0 && hit.healing >= 0 && hit.damage <= target->maxHealth &&
                   hit.shieldDamage <= 1'000'000, "Invalid campaign attack log");
        if (hit.healing > 0)
            ensure(!attacker->enemy && !target->enemy && target->health > 0 && !hit.damage && !hit.shieldDamage && !hit.missed &&
                       hit.healing <= target->maxHealth && hit.healing <= unitHealing(attacker->type, attacker->maxHealth), "Invalid campaign healing log");
        else ensure(attacker->enemy != target->enemy, "Invalid campaign attack target");
        if (hit.attackerStunned) ensure(attacker->enemy && !target->enemy, "Invalid retaliation target");
    }
}
} // namespace kingdom
