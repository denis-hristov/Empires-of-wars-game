#include "kingdom/Game.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace kingdom {
std::string domainName(Domain d) {
    if (d == Domain::Land) return "land";
    if (d == Domain::Naval) return "naval";
    if (d == Domain::Air) return "air";
    throw std::runtime_error("Invalid battle domain");
}
Domain domainFromName(const std::string &d) {
    if (d == "land") return Domain::Land;
    if (d == "naval") return Domain::Naval;
    if (d == "air") return Domain::Air;
    throw std::runtime_error("Invalid battle domain");
}
namespace {
constexpr std::int64_t AttackDelay = 1000;
constexpr int MaximumBattleRounds = 200;
Fighter *fighter(Battle &b, Id id) {
    for (auto &f : b.fighters) if (f.id == id) return &f;
    return nullptr;
}
const UnitDef &definition(const Game &g, const Fighter &f) {
    return g.config.unit(f.type == "raider" ? "infantry" : f.type);
}
bool ability(const UnitDef &d, const std::string &name) {
    return std::find(d.abilities.begin(), d.abilities.end(), name) != d.abilities.end();
}
bool canTarget(const Game &g, const Fighter &a, const Fighter &t, bool submarinesDetectSubmerged = true) {
    if (a.health <= 0 || t.health <= 0 || a.enemy == t.enemy ||
        a.phase != g.battle->domain || t.phase != a.phase) return false;
    const bool carrierRules = g.config.raw.value("armyAbilitiesVersion", 0) >= 1;
    if (carrierRules && (a.carrier || t.carrier)) return false;
    const auto &d = definition(g, a), &td = definition(g, t);
    if (carrierRules && !a.enemy && d.carrierSlots && g.fighterAttackDamage(a, t.domain) <= 0) return false;
    if (std::find(d.validTargets.begin(), d.validTargets.end(), t.domain) == d.validTargets.end()) return false;
    if (ability(td, "submerged") && (a.enemy || !submarinesDetectSubmerged || g.config.raw.value("combatRulesVersion", 1) < 2)) {
        bool detected = (submarinesDetectSubmerged && ability(d, "submerged")) ||
            std::any_of(g.battle->fighters.begin(), g.battle->fighters.end(), [&](const auto &f) {
            return f.health > 0 && f.phase == a.phase && f.enemy == a.enemy &&
                   definition(g, f).detection > 0;
        });
        if (!detected) return false;
    }
    return true;
}
bool hasTarget(const Game &g, const Fighter &a) {
    return std::any_of(g.battle->fighters.begin(), g.battle->fighters.end(), [&](const auto &f) {
        return canTarget(g, a, f);
    });
}
bool canHeal(const Game &g, const Fighter &a, const Fighter &t) {
    return !a.enemy && !a.carrier && !t.carrier && a.health > 0 && t.health > 0 && t.health < t.maxHealth && a.enemy == t.enemy &&
           a.phase == g.battle->domain && t.phase == a.phase &&
           ability(definition(g, a), "repair_allies") && g.unitHealing(a.type, a.maxHealth) > 0;
}
Fighter *chooseHealTarget(Game &g, const Fighter &a) {
    Fighter *target = nullptr;
    for (auto &f : g.battle->fighters)
        if (canHeal(g, a, f) && (!target ||
            static_cast<std::int64_t>(f.health) * target->maxHealth <
            static_cast<std::int64_t>(target->health) * f.maxHealth)) target = &f;
    return target;
}
bool hasAction(Game &g, const Fighter &a) {
    return hasTarget(g, a) || (!g.battle->automatic && !a.enemy && chooseHealTarget(g, a));
}
void restoreHealth(Game &g, const Fighter &healer, Fighter &target) {
    int restored = std::min(target.maxHealth - target.health, g.unitHealing(healer.type, healer.maxHealth));
    if (restored <= 0) return;
    target.health += restored;
    g.battle->lastAttacks.push_back({healer.id, target.id, 0, 0, false, restored});
}
void recruitRecovery(Game &g) {
    auto &b = *g.battle;
    for (auto &healer : b.fighters) {
        if (healer.enemy || healer.phase != b.domain || healer.health <= 0 ||
            !ability(definition(g, healer), "self_repair") || g.unitHealing(healer.type, healer.maxHealth) <= 0) continue;
        Fighter *target = healer.health < healer.maxHealth ? &healer : nullptr;
        if (!target)
            for (auto &ally : b.fighters)
                if (!ally.enemy && ally.phase == healer.phase && ally.id != healer.id &&
                    ally.health > 0 && ally.health < ally.maxHealth && (!target ||
                    static_cast<std::int64_t>(ally.health) * target->maxHealth <
                    static_cast<std::int64_t>(target->health) * ally.maxHealth)) target = &ally;
        if (target) restoreHealth(g, healer, *target);
    }
}
bool sideReady(Game &g) {
    const auto &b = *g.battle;
    return std::any_of(b.fighters.begin(), b.fighters.end(), [&](const auto &f) {
        return f.phase == b.domain && f.enemy == b.enemyTurn && f.health > 0 && !f.attacked &&
               f.readyRound <= b.round && hasAction(g, f);
    });
}
std::uint64_t targetRoll(const Game &g, const Fighter &a) {
    const auto &b = *g.battle;
    // Saved battle counters keep random choices consistent after reload and across runtimes.
    std::uint64_t roll = g.world.seed;
    roll ^= b.id * 0x9e3779b97f4a7c15ull;
    roll ^= a.id * 0xbf58476d1ce4e5b9ull;
    roll ^= (static_cast<std::uint64_t>(b.actions) + 1) * 0x94d049bb133111ebull;
    roll ^= static_cast<std::uint64_t>(b.phaseIndex) * 0xd6e8feb86659fd93ull;
    roll += 0x9e3779b97f4a7c15ull;
    roll = (roll ^ (roll >> 30)) * 0xbf58476d1ce4e5b9ull;
    roll = (roll ^ (roll >> 27)) * 0x94d049bb133111ebull;
    return roll ^ (roll >> 31);
}
Fighter *chooseTarget(Game &g, const Fighter &a) {
    if (a.enemy) {
        std::vector<Fighter *> targets;
        for (auto &f : g.battle->fighters)
            if (canTarget(g, a, f)) targets.push_back(&f);
        return targets.empty() ? nullptr : targets[targetRoll(g, a) % targets.size()];
    }
    Fighter *target = nullptr;
    for (auto &f : g.battle->fighters)
        if (canTarget(g, a, f) && (!target ||
            (f.health + f.shield) * definition(g, *target).targetWeight <
            (target->health + target->shield) * definition(g, f).targetWeight)) target = &f;
    return target;
}
void nextSide(Game &g, bool recovered = false) {
    auto &b = *g.battle;
    // Skip units without weapons for the remaining targets, including cooldown turns.
    for (int attempt = 0; attempt < 22 && !b.finished && !b.awaitingSelection; ++attempt) {
        bool ready = false;
        for (auto &f : b.fighters)
            if (f.phase == b.domain && f.enemy == b.enemyTurn && f.health > 0 && !f.attacked) {
                if (f.readyRound > b.round || !hasAction(g, f)) f.attacked = true;
                else ready = true;
            }
        if (ready) return;
        if (b.enemyTurn) {
            if (!recovered) recruitRecovery(g);
            recovered = false;
            ++b.round;
        }
        if (!b.enemyTurn) { b.doubleAttack = false; b.potionPrompt.clear(); }
        b.enemyTurn = !b.enemyTurn;
        b.pendingMs = 0;
        for (auto &f : b.fighters)
            if (f.phase == b.domain && f.enemy == b.enemyTurn) {
                f.moved = f.attacked = false;
                f.attacksThisTurn = 0;
                if (f.stunnedUntilRound < b.round) f.stunnedUntilRound = 0;
            }
    }
}
void healAction(Game &g, Fighter &a, Fighter &target) {
    auto &b = *g.battle;
    a.attacksThisTurn = 0;
    a.attacked = true;
    a.readyRound = b.round + definition(g, a).attackCooldown;
    ++a.strikes;
    ++b.actions;
    b.lastAttacks.clear();
    b.animationMs = 900;
    restoreHealth(g, a, target);
}
void strike(Game &g, Fighter &a, Fighter &target) {
    auto &b = *g.battle;
    const auto &d = definition(g, a);
    const bool shownAttack = !a.enemy && g.config.playerDamageMatchesAttack;
    const bool attackBonuses = !shownAttack && (!a.enemy || !g.config.enemiesWithoutAttackBonuses.contains(a.enemyId));
    const int attacks = g.attacksPerTurn(a);
    a.attacksThisTurn = attacks > 1 ? std::min(attacks, a.attacksThisTurn + 1) : 0;
    a.attacked = attacks == 1 || a.attacksThisTurn >= attacks;
    if (a.attacked) a.readyRound = b.round + d.attackCooldown;
    ++a.strikes;
    ++b.actions;
    b.lastAttacks.clear();
    b.animationMs = 900;
    auto hit = [&](Fighter &t, int percent) {
        const auto &td = definition(g, t);
        int detection = d.detection;
        for (const auto &escort : b.fighters)
            if (escort.phase == a.phase && escort.enemy == a.enemy && escort.health > 0)
                detection = std::max(detection, definition(g, escort).detection);
        int chance = std::clamp(d.accuracy - std::max(0, td.evasion - detection), 15, 100);
        std::uint64_t roll = a.id * 6364136223846793005ull + t.id * 1442695040888963407ull +
                             b.id * 31 + static_cast<std::uint64_t>(b.actions) * 7919;
        if (!g.config.attacksAlwaysHit && static_cast<int>((roll ^ (roll >> 32)) % 100) >= chance) {
            b.lastAttacks.push_back({a.id, t.id, 0, 0, true});
            return;
        }
        int multiplier = 100;
        if (attackBonuses && (!a.enemy || !g.config.enemiesWithoutDamageMultipliers.contains(a.enemyId)))
            for (const auto &key : {domainName(t.domain), td.armorClass})
                if (d.damageMultipliers.contains(key)) multiplier = std::max(multiplier, d.damageMultipliers.at(key));
        int power = g.fighterAttackDamage(a, t.domain) * (!a.enemy && b.doubleAttack ? 2 : 1) * multiplier / 100;
        if (attackBonuses && d.burstEvery && a.strikes % d.burstEvery == 0) power = power * d.burstMultiplier / 100;
        if (attackBonuses && b.round == 1 && ability(d, "first_strike")) power = power * 125 / 100;
        int penetration = attackBonuses ? d.armorPenetration : 0;
        const int armor = shownAttack || (!t.enemy && !g.config.playerArmorEnabled) ? 0 : t.defense * (100 - penetration) / 100;
        int damage = std::max(1, power * percent / 100 - armor);
        const int potionAbsorbed = std::min(t.potionShield, damage);
        t.potionShield -= potionAbsorbed;
        // The potion shield blocks one complete hit before the native shield is touched.
        if (potionAbsorbed > 0) damage = 0;
        const bool shielded = t.shield > 0;
        int absorbed = std::min(t.shield, damage);
        t.shield -= absorbed;
        // A shield protects health for the entire hit that breaks it.
        damage = shielded && g.config.shieldBreakStopsDamage ? 0 : std::min(t.health, damage - absorbed);
        t.health -= damage;
        b.lastAttacks.push_back({a.id, t.id, damage, absorbed + potionAbsorbed, false});
        if (!a.enemy && t.health > 0 && ability(d, "stun_on_hit")) {
            t.stunnedUntilRound = std::max(t.stunnedUntilRound, b.round);
            t.readyRound = std::max(t.readyRound, b.round + 1);
            b.lastAttacks.back().stunTurns = 1;
        }
        if (a.enemy && !t.enemy && ability(td, "stun_attackers")) {
            a.stunnedUntilRound = std::max(a.stunnedUntilRound, b.round + 1);
            a.readyRound = std::max(a.readyRound, b.round + 2);
            a.attacked = true;
            b.lastAttacks.back().stunTurns = 1;
            b.lastAttacks.back().attackerStunned = true;
        }
        if (!t.health) g.destroyUnit(t.id, true);
    };
    Pos center = target.pos;
    hit(target, 100);
    if (a.enemy && g.config.enemySingleTarget) return;
    if (ability(d, "attack_all_splash")) {
        for (auto &other : b.fighters)
            if (other.id != target.id && canTarget(g, a, other)) hit(other, d.splashPercent);
        return;
    }
    if (ability(d, "attack_all_air")) {
        for (auto &other : b.fighters)
            if (other.id != target.id && other.domain == Domain::Air && canTarget(g, a, other)) hit(other, 100);
        return;
    }
    if (ability(d, "attack_all")) {
        for (auto &other : b.fighters)
            if (other.id != target.id && canTarget(g, a, other)) hit(other, 100);
        return;
    }
    int splash = 0;
    for (auto &other : b.fighters)
        if (splash < d.splashTargets && other.id != target.id && canTarget(g, a, other) &&
            distance(center, other.pos) <= 2) {
            hit(other, d.splashPercent);
            ++splash;
        }
}
} // namespace
int Game::attacksPerTurn(const Fighter &f) const {
    return !f.enemy && config.raw.value("armyAbilitiesVersion", 0) >= 1 &&
        ability(definition(*this, f), "two_attacks") ? 2 : 1;
}
int Game::fighterAttackDamage(const Fighter &f, std::optional<Domain> target) const {
    if (f.enemy || config.raw.value("armyAbilitiesVersion", 0) < 1 || !definition(*this, f).carrierSlots)
        return f.damage;
    const bool carrierStrike = config.raw.value("combatRulesVersion", 1) >= 2;
    const auto &targets = definition(*this, f).validTargets;
    if (carrierStrike && target && std::find(targets.begin(), targets.end(), *target) == targets.end()) return 0;
    int damage = 0;
    if (battle && f.health > 0)
        for (const auto &plane : battle->fighters) {
            if (plane.carrier != f.id || plane.health <= 0) continue;
            const auto &d = definition(*this, plane);
            if (!target || carrierStrike || std::find(d.validTargets.begin(), d.validTargets.end(), *target) != d.validTargets.end())
                damage += plane.damage;
        }
    return damage;
}
int Game::carrierAttackDamage(Id id, std::optional<Domain> target) const {
    const bool carrierStrike = config.raw.value("combatRulesVersion", 1) >= 2;
    if (carrierStrike && target) {
        const auto *carrier = findUnit(id);
        if (!carrier) return 0;
        const auto &targets = config.unit(carrier->type).validTargets;
        if (std::find(targets.begin(), targets.end(), *target) == targets.end()) return 0;
    }
    int damage = 0;
    for (const auto &plane : units) {
        if (plane.carrier != id || plane.health <= 0) continue;
        const auto &d = config.unit(plane.type);
        if (target && !carrierStrike && std::find(d.validTargets.begin(), d.validTargets.end(), *target) == d.validTargets.end()) continue;
        damage += unitDamage(plane.type);
        for (const auto &technology : technologies) {
            const auto &t = config.tech(technology);
            if (t.domain == d.domain) damage += t.damage;
        }
    }
    return damage;
}
Result Game::startBattle(const std::optional<std::vector<Id>> &selectedUnits, bool automatic,
                         const std::map<Id, Domain> &airMissions) {
    if (battle) return Result::fail("A battle is already active");
    const int limit = std::min(5, config.maxArmy);
    std::set<Id> selected;
    std::array<int, 3> counts{}, highest{};
    auto phase = [&](const Unit &u) { return airMissions.contains(u.id) ? airMissions.at(u.id) : config.unit(u.type).domain; };
    if (selectedUnits) {
        if (selectedUnits->empty() || selectedUnits->size() > static_cast<std::size_t>(limit * 3))
            return Result::fail("Select 1 to 5 units per land, sea or air round");
        for (Id id : *selectedUnits) {
            if (!selected.insert(id).second) return Result::fail("Each unit can only be selected once");
            auto u = findUnit(id);
            if (!u || u->health <= 0 || u->carrier || u->reserve) return Result::fail("Select available living units from your army");
            if (++counts[static_cast<int>(phase(*u))] > limit) return Result::fail("Select at most 5 units in each round");
        }
    } else {
        for (const auto &u : units) {
            int p = static_cast<int>(phase(u));
            if (u.health > 0 && !u.carrier && !u.reserve && counts[p] < limit) { selected.insert(u.id); ++counts[p]; }
        }
    }
    for (auto [id, mission] : airMissions) {
        auto u = findUnit(id);
        if (!u || !selected.contains(id) || config.unit(u->type).domain != Domain::Air)
            return Result::fail("Air missions require a selected independent aircraft");
        const auto &d = config.unit(u->type);
        if (std::find(d.validTargets.begin(), d.validTargets.end(), mission) == d.validTargets.end())
            return Result::fail("This aircraft has no weapons for the selected mission");
    }
    if (selected.empty()) return Result::fail("Train at least one land, naval or air unit");
    Battle b;
    b.id = nextBattleId;
    b.automatic = automatic;
    b.phases.clear();
    auto addFighter = [&](const Unit &u, Domain arena) {
        const auto &d = config.unit(u.type);
        Fighter f;
        f.id = u.id; f.type = u.type; f.domain = d.domain; f.phase = arena; f.carrier = u.carrier;
        f.health = u.health; f.maxHealth = unitHealth(u.type); f.damage = unitDamage(u.type); f.defense = d.defense;
        f.range = d.range; f.movement = d.movement;
        for (const auto &technology : technologies) {
            const auto &t = config.tech(technology);
            if (t.domain == d.domain) { f.health += t.health; f.maxHealth += t.health; f.damage += t.damage; }
        }
        f.shield = unitShield(f.type, f.maxHealth);
        b.fighters.push_back(f);
    };
    for (Domain arena : {Domain::Land, Domain::Naval, Domain::Air}) {
        if (!counts[static_cast<int>(arena)]) continue;
        b.phases.push_back(arena);
        for (const auto &u : units) {
            if (!selected.contains(u.id) || phase(u) != arena) continue;
            addFighter(u, arena);
            highest[static_cast<int>(arena)] = std::max(highest[static_cast<int>(arena)], config.unit(u.type).level);
            for (const auto &cargo : units) if (cargo.carrier == u.id) addFighter(cargo, arena);
        }
        int row = 0;
        for (auto &f : b.fighters) if (f.phase == arena) { f.pos = {row / config.battleHeight, row % config.battleHeight}; ++row; }
        int enemies = std::min(5, config.enemies);
        const auto &base = config.unit("infantry");
        for (int i = 0; i < enemies; ++i) {
            const UnitDef *opponent = &config.unit(arena == Domain::Land ? "infantry" : arena == Domain::Naval ? "ship" : "aircraft");
            if (!config.enemyTierOffsets.empty()) {
                int tier = std::clamp(highest[static_cast<int>(arena)] + config.enemyTierOffsets[i % config.enemyTierOffsets.size()], 1, 10);
                Domain category = arena;
                if (i == enemies - 1 && highest[static_cast<int>(arena)] >= 7 && arena != Domain::Air) { category = Domain::Air; tier = 5; }
                for (const auto &d : config.units) if (d.domain == category && d.level == tier) opponent = &d;
            }
            Fighter f;
            f.id = (Id{1} << 63) + static_cast<Id>(static_cast<int>(arena) * 100 + i);
            f.type = arena == Domain::Land && opponent->id == "infantry" ? "raider" : opponent->id;
            f.enemy = true; f.domain = opponent->domain; f.phase = arena;
            f.pos = {config.battleWidth - 1, i * config.battleHeight / enemies};
            f.health = f.maxHealth = adjustedEnemyHealth(enemyMaxHealth(std::max(1, config.enemyHealth * opponent->enemyBaseHealth / base.enemyBaseHealth)));
            f.damage = adjustedEnemyAttack(enemyAttackDamage(std::max(1, config.enemyDamage * opponent->enemyBaseDamage / base.enemyBaseDamage)));
            f.defense = config.enemyDefense * std::max(1, opponent->defense) / std::max(1, base.defense);
            f.range = opponent->range; f.movement = opponent->movement;
            f.shield = unitShield(f.type == "raider" ? "infantry" : f.type, f.maxHealth, 0);
            b.fighters.push_back(f);
        }
    }
    b.domain = b.phases.front();
    battle = std::move(b);
    ++nextBattleId;
    checkBattle();
    if (!battle->finished && !battle->awaitingSelection) nextSide(*this);
    return Result::success("The expedition begins. Select your unit and a valid enemy target.");
}
Result Game::battleMove(Id, Pos) { return Result::fail("Units hold their arena positions. Select your unit and an enemy to attack."); }
Result Game::attack(Id attacker, Id target) {
    if (battle && !battle->potionPrompt.empty()) return Result::fail("Close the potion confirmation first");
    if (!battle || battle->finished || battle->awaitingSelection) return Result::fail("No active turn");
    if (battle->enemyTurn) return Result::fail("Wait for the enemy to finish attacking");
    if (battle->paused) return Result::fail("Resume the battle before attacking");
    if (battle->automatic) return Result::fail("Take manual control before choosing a target");
    auto a = fighter(*battle, attacker), t = fighter(*battle, target);
    if (!a || !t || a->enemy || !canTarget(*this, *a, *t)) return Result::fail("This unit cannot attack that target");
    if (a->attacked || a->readyRound > battle->round) return Result::fail("This unit has already attacked or is reloading");
    strike(*this, *a, *t);
    int damage = battle->lastAttacks.front().damage;
    checkBattle();
    if (!battle->finished && !battle->awaitingSelection) nextSide(*this);
    return Result::success("Attack: " + std::to_string(damage) + " damage");
}
Result Game::heal(Id healer, Id target) {
    if (battle && !battle->potionPrompt.empty()) return Result::fail("Close the potion confirmation first");
    if (!battle || battle->finished || battle->awaitingSelection) return Result::fail("No active turn");
    if (battle->enemyTurn) return Result::fail("Wait for the enemy to finish attacking");
    if (battle->paused) return Result::fail("Resume the battle before healing");
    if (battle->automatic) return Result::fail("Take manual control before choosing a healing target");
    auto a = fighter(*battle, healer), t = fighter(*battle, target);
    if (!a || !t || a->enemy || !canHeal(*this, *a, *t)) return Result::fail("This unit cannot heal that target");
    if (a->attacked || a->readyRound > battle->round) return Result::fail("This unit has already acted or is reloading");
    healAction(*this, *a, *t);
    int restored = battle->lastAttacks.front().healing;
    checkBattle();
    if (!battle->finished && !battle->awaitingSelection) nextSide(*this);
    return Result::success("Healed: " + std::to_string(restored) + " health");
}
bool Game::battleCanFight(bool submarinesDetectSubmerged) const {
    return battle && std::any_of(battle->fighters.begin(), battle->fighters.end(), [&](const Fighter &f) {
        return f.phase == battle->domain && f.health > 0 &&
            std::any_of(battle->fighters.begin(), battle->fighters.end(), [&](const Fighter &target) {
                return canTarget(*this, f, target, submarinesDetectSubmerged);
            });
    });
}
void Game::checkBattle() {
    if (!battle || battle->finished || battle->awaitingSelection) return;
    bool friendly = false, enemy = false;
    for (const auto &f : battle->fighters) if (f.phase == battle->domain && f.health > 0 &&
        (!f.carrier || config.raw.value("armyAbilitiesVersion", 0) < 1)) {
        if (f.enemy) enemy = true; else friendly = true;
    }
    if (friendly && enemy) {
        if (battleCanFight() && battle->round < MaximumBattleRounds) return;
        // The attacker withdraws when combat cannot finish; the defender keeps the objective.
        clearPotionEffects();
        battle->outcomes.push_back(0);
        battle->finished = battle->retreated = true;
        battle->victory = battle->draw = battle->awaitingSelection = battle->enemyTurn = false;
        battle->pendingMs = 0;
        return;
    }
    clearPotionEffects();
    battle->outcomes.push_back(friendly ? 1 : 0);
    if (battle->campaignLevel) {
        if (battle->outcomes.back() != 1) {
            battle->finished = true; battle->victory = false; battle->draw = false;
        } else if (battle->phaseIndex + 1 == static_cast<int>(battle->phases.size())) {
            battle->finished = true; battle->victory = true;
        } else {
            syncCampaignArmy();
            battle->domain = battle->phases[++battle->phaseIndex];
            deployCampaignPhase();
            return;
        }
        battle->enemyTurn = false; battle->pendingMs = 0; battle->lastAttacks.clear();
        return;
    }
    if (battle->phaseIndex + 1 < static_cast<int>(battle->phases.size())) {
        battle->domain = battle->phases[++battle->phaseIndex]; battle->round = 1; battle->enemyTurn = false;
        battle->pendingMs = 0; battle->lastAttacks.clear();
        checkBattle();
        return;
    }
    battle->finished = true; battle->enemyTurn = false;
    int wins = std::count(battle->outcomes.begin(), battle->outcomes.end(), 1);
    int losses = std::count(battle->outcomes.begin(), battle->outcomes.end(), 0);
    battle->victory = wins > losses; battle->draw = false; battle->pendingMs = 0;
}
Result Game::endTurn() { return Result::fail("Each ready unit must use its available attacks. The turn changes automatically."); }
void Game::automaticTurn() {
    auto actor = std::find_if(battle->fighters.begin(), battle->fighters.end(), [&](const auto &f) {
        return f.phase == battle->domain && f.enemy == battle->enemyTurn && f.health > 0 && !f.attacked;
    });
    if (actor == battle->fighters.end()) { nextSide(*this); return; }
    auto target = chooseTarget(*this, *actor);
    // Alternate repairs with attacks so automatic support units keep advancing combat.
    auto repair = target && actor->strikes % 2 == 0 ? chooseHealTarget(*this, *actor) : nullptr;
    if (repair) healAction(*this, *actor, *repair);
    else if (target) strike(*this, *actor, *target);
    else actor->attacked = true;
    bool recovered = battle->enemyTurn && !sideReady(*this);
    if (recovered) recruitRecovery(*this);
    checkBattle();
    if (!battle->finished && !battle->awaitingSelection) nextSide(*this, recovered);
}
void Game::tickBattle(std::int64_t ms) {
    if (battle->paused || !battle->potionPrompt.empty()) return;
    battle->animationMs = std::max<std::int64_t>(0, battle->animationMs - ms);
    if (battle->paused || battle->finished || battle->awaitingSelection || (!battle->automatic && !battle->enemyTurn)) return;
    battle->pendingMs += std::min<std::int64_t>(ms, 86'400'000);
    while (battle->pendingMs >= AttackDelay && !battle->finished && !battle->awaitingSelection && (battle->automatic || battle->enemyTurn)) {
        battle->pendingMs -= AttackDelay;
        auto carry = battle->pendingMs;
        int phase = battle->phaseIndex;
        automaticTurn();
        if (!battle->finished && !battle->awaitingSelection && (battle->automatic || battle->enemyTurn))
            battle->pendingMs = !battle->campaignLevel || battle->phaseIndex == phase ? carry : 0;
    }
}
Result Game::automateBattle() {
    if (battle && !battle->potionPrompt.empty()) return Result::fail("Close the potion confirmation first");
    if (!battle || battle->finished) return Result::fail("No active battle");
    battle->automatic = !battle->automatic;
    if (!battle->enemyTurn) battle->pendingMs = 0;
    return Result::success(battle->automatic ? "Auto attack enabled" : "Manual control enabled");
}
Result Game::pauseBattle() {
    if (battle && !battle->potionPrompt.empty()) return Result::fail("Close the potion confirmation first");
    if (!battle || battle->finished) return Result::fail("No active battle");
    battle->paused = !battle->paused;
    return Result::success(battle->paused ? "Battle paused" : "Battle resumed");
}
Result Game::finishBattle() {
    if (!battle || !battle->finished) return Result::fail("The battle is not finished");
    if (battle->campaignLevel) {
        const auto &level = campaignLevelDefinition(battle->campaignLevel);
        Stock rewards{};
        for (int i = 0; i < 5; ++i) rewards[i] = level.at("rewards").value(resourceName(i), std::int64_t{0});
        bool victory = battle->victory;
        Game candidate = *this;
        auto result = candidate.applyReward({battle->id, victory, rewards, 0});
        if (!result.ok) return result;
        candidate.returnCampaignRound();
        if (battle->victory) candidate.completedCampaignLevels.insert(battle->campaignLevel);
        candidate.battle.reset();
        *this = std::move(candidate);
        result.message = victory ? "Victory. Campaign progress saved." : "Defeat. Try this campaign level again.";
        return result;
    }
    for (const auto &f : battle->fighters) {
        if (f.enemy) continue;
        auto u = findUnit(f.id);
        if (!u) continue;
        if (f.health <= 0) destroyUnit(f.id);
        else u->health = std::clamp(f.health - (f.maxHealth - unitHealth(u->type)), 1, unitHealth(u->type));
    }
    const bool victory = battle->victory, retreated = battle->retreated;
    BattleResult reward{battle->id, battle->victory, config.rewards, config.captives};
    auto result = applyReward(reward);
    battle.reset();
    if (result.ok && !victory)
        result.message = retreated ? "Defeat. The enemy held its position. Your surviving units returned."
                                   : "Defeat. Your surviving units returned.";
    return result;
}
std::vector<Pos> Game::validBattleMoves(Id) const { return {}; }
std::vector<Id> Game::validBattleTargets(Id id) const {
    std::vector<Id> result;
    if (!battle || battle->finished || battle->awaitingSelection || battle->automatic || battle->enemyTurn || battle->paused) return result;
    for (const auto &f : battle->fighters)
        if (f.id == id && !f.enemy && !f.attacked && f.readyRound <= battle->round)
            for (const auto &t : battle->fighters) if (canTarget(*this, f, t)) result.push_back(t.id);
    return result;
}
std::vector<Id> Game::validBattleHealTargets(Id id) const {
    std::vector<Id> result;
    if (!battle || battle->finished || battle->awaitingSelection || battle->automatic || battle->enemyTurn || battle->paused) return result;
    for (const auto &f : battle->fighters)
        if (f.id == id && !f.enemy && !f.attacked && f.readyRound <= battle->round)
            for (const auto &t : battle->fighters) if (canHeal(*this, f, t)) result.push_back(t.id);
    return result;
}
void Game::normalizeBattleTurn() {
    checkBattle();
    if (battle && !battle->finished && !battle->awaitingSelection) nextSide(*this);
}
} // namespace kingdom
