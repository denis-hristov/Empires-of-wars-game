#include "kingdom/Game.hpp"
#include <algorithm>
#include <limits>
#include <stdexcept>

namespace kingdom {
namespace {
constexpr std::array<const char *, 4> types{"heal", "shield", "attack", "revive"};
void ensureMagic(bool ok, const char *message) {
    if (!ok) throw std::runtime_error(message);
}
Stock potionCost(const Json &definition) {
    Stock cost{};
    for (int i = 0; i < 5; ++i) cost[i] = definition.at("cost").value(resourceName(i), std::int64_t{0});
    return cost;
}
bool affected(const Battle &battle, const Fighter &fighter, int index) {
    if (fighter.enemy || fighter.carrier || fighter.phase != battle.domain) return false;
    // Older battle saves can omit the defeat marker for casualties in the active arena.
    if (index == 3) return fighter.health == 0 &&
        (fighter.defeatedPhase == -1 || fighter.defeatedPhase == battle.phaseIndex);
    if (fighter.health <= 0) return false;
    if (index == 0) return fighter.health < fighter.maxHealth;
    if (index == 1) return fighter.potionShield < 1;
    return true;
}
}
int Game::potionIndex(const std::string &type) const {
    auto found = std::find(types.begin(), types.end(), type);
    if (found == types.end()) throw std::runtime_error("Unknown potion type");
    return static_cast<int>(found - types.begin());
}
int Game::potionCount() const {
    int count = static_cast<int>(brewing.size());
    for (int n : potions) count += n;
    return count;
}
Result Game::brewRequirements(Id id, const std::string &type) const {
    const int index = potionIndex(type);
    if (!config.raw.contains("magic")) return Result::fail("The Laboratory is unavailable");
    if (battle) return Result::fail("Finish the battle before brewing");
    const auto *laboratory = findBuilding(id);
    if (!laboratory || laboratory->type != "laboratory") return Result::fail("Build a Laboratory at Town Hall 6");
    if (laboratory->state != State::Active) return Result::fail("Finish Laboratory construction or upgrade first");
    if (laboratory->level < index + 1) return Result::fail("Requires Laboratory level " + std::to_string(index + 1));
    if (potionCount() >= 5) return Result::fail("Potion storage is full (5/5), including brewing potions");
    const auto &definition = config.raw.at("magic").at("potions").at(index);
    if (!affordable(potionCost(definition))) return Result::fail("Not enough resources to brew this potion");
    return Result::success();
}
Result Game::brew(Id id, const std::string &type) {
    const auto allowed = brewRequirements(id, type);
    if (!allowed.ok) return allowed;
    const int index = potionIndex(type);
    const auto &definition = config.raw.at("magic").at("potions").at(index);
    const int seconds = definition.at("seconds");
    if (seconds) brewing.push_back({type, std::int64_t(seconds) * 1000});
    else ++potions[index];
    pay(potionCost(definition));
    return Result::success(seconds ? "Potion brewing started" : "Potion ready");
}
Result Game::removePotionRequirements(Id id, const std::string &type) const {
    const int index = potionIndex(type);
    if (!config.raw.contains("magic")) return Result::fail("The Laboratory is unavailable");
    if (battle) return Result::fail("Finish the battle before removing potions");
    const auto *laboratory = findBuilding(id);
    if (!laboratory || laboratory->type != "laboratory" || laboratory->state == State::Construction)
        return Result::fail("A completed Laboratory is required");
    if (!potions[index]) return Result::fail("No ready potion of this type to remove");
    if (stock[4] >= 1'000'000'000'000ll - PotionRemovalGold)
        return Result::fail("Your gold stockpile cannot accept 20 gold");
    if (potionSequence >= 9'007'199'254'740'990ull) return Result::fail("Potion command limit reached");
    return Result::success();
}
Result Game::removePotion(Id id, const std::string &type, std::uint64_t expectedSequence) {
    const auto allowed = removePotionRequirements(id, type);
    if (!allowed.ok) return allowed;
    if (expectedSequence != potionSequence)
        return Result::fail("Potion storage changed. Select Remove again");
    const int index = potionIndex(type);
    auto result = Result::success("Removed 1 " + config.raw.at("magic").at("potions").at(index).at("name").get<std::string>() + " potion. Received 20 gold");
    // All checks and allocations precede this atomic inventory and gold update.
    --potions[index];
    stock[4] += PotionRemovalGold;
    ++potionSequence;
    return result;
}
Result Game::potionRequirements(const std::string &type) const {
    const int index = potionIndex(type);
    if (!battle || battle->finished || battle->awaitingSelection) return Result::fail("No active battle");
    if (battle->paused) return Result::fail("Resume the battle first");
    if (battle->enemyTurn) return Result::fail("Potions are available during your turn");
    if (battle->animationMs > 0) return Result::fail("Wait for the combat animation to finish");
    if (!potions[index]) return Result::fail("No potion of this type in storage");
    if (index == 2 && battle->doubleAttack) return Result::fail("Double attack is already active this turn");
    bool valid = std::any_of(battle->fighters.begin(), battle->fighters.end(), [&](const auto &f) { return affected(*battle, f, index); });
    if (!valid) return Result::fail(index == 0 ? "No wounded living allies" : index == 1 ? "All living allies already have a potion shield" : index == 3 ? "No fallen allies from this round" : "No living allies");
    return Result::success();
}
Result Game::selectPotion(const std::string &type) {
    const int index = potionIndex(type);
    if (!battle || battle->finished || battle->awaitingSelection) return Result::fail("No active battle");
    if (battle->enemyTurn || battle->paused || battle->animationMs > 0)
        return Result::fail("Inspect potions between combat actions during your turn");
    if (!potions[index]) return Result::fail("This potion is no longer available");
    if (!battle->potionPrompt.empty()) return Result::fail("A potion confirmation is already open");
    if (potionSequence >= 9'007'199'254'740'990ull) return Result::fail("Potion command limit reached");
    battle->potionPrompt = type;
    battle->potionToken = ++potionSequence;
    return Result::success();
}
Result Game::cancelPotion() {
    if (battle) { battle->potionPrompt.clear(); battle->potionToken = 0; }
    return Result::success();
}
Result Game::usePotion(const std::string &type, std::uint64_t token) {
    potionIndex(type);
    if (!battle || battle->potionPrompt != type || battle->potionToken != token)
        return Result::fail("This potion confirmation has expired");
    const auto allowed = potionRequirements(type);
    if (!allowed.ok) return allowed;
    // Apply, validate and consume on a candidate so any error leaves the live game intact.
    Game candidate = *this;
    auto &b = *candidate.battle;
    const int index = candidate.potionIndex(type);
    b.potionTargets.clear();
    for (auto &f : b.fighters) {
        if (!affected(b, f, index)) continue;
        b.potionTargets.push_back(f.id);
        if (index == 0) f.health = f.maxHealth;
        if (index == 1) f.potionShield = 1;
        if (index == 3) {
            f.health = std::max(1, (f.maxHealth + 1) / 2);
            f.shield = f.potionShield = 0;
            f.moved = f.attacked = true;
            f.attacksThisTurn = candidate.attacksPerTurn(f) > 1 ? candidate.attacksPerTurn(f) : 0;
            f.readyRound = std::max(f.readyRound, b.round + 1);
        }
    }
    if (index == 2) b.doubleAttack = true;
    --candidate.potions[index];
    b.potionPrompt.clear(); b.potionToken = 0;
    b.lastPotion = type; ++b.potionEvent;
    b.animationMs = 900;
    candidate.validate();
    const auto count = b.potionTargets.size();
    *this = std::move(candidate);
    return Result::success(config.raw.at("magic").at("potions").at(index).at("name").get<std::string>() + ": affected " + std::to_string(count) + " allied units");
}
void Game::clearPotionEffects() {
    if (!battle) return;
    battle->doubleAttack = false;
    battle->potionPrompt.clear(); battle->potionToken = 0;
    for (auto &f : battle->fighters) f.potionShield = 0;
    for (auto &f : battle->campaignArmy) f.potionShield = 0;
}
void Game::validateMagic() const {
    ensureMagic(potionSequence <= 9'007'199'254'740'990ull, "Invalid potion sequence");
    int laboratories = 0;
    for (const auto &building : buildings) if (building.type == "laboratory") ++laboratories;
    ensureMagic(laboratories <= 1, "Only one Laboratory is allowed");
    for (int n : potions) ensureMagic(n >= 0 && n <= 5, "Invalid potion count");
    ensureMagic(potionCount() <= 5, "Potion storage capacity exceeded");
    for (int i = 0; i < 4; ++i)
        ensureMagic(!potions[i] || completedLevel("laboratory") >= i + 1, "Potion requires a completed Laboratory level");
    for (const auto &task : brewing) {
        const int i = potionIndex(task.type);
        ensureMagic(config.raw.contains("magic") && completedLevel("laboratory") >= i + 1, "Invalid potion brewing unlock");
        ensureMagic(task.remainingMs > 0 && task.remainingMs <= config.raw.at("magic").at("potions").at(i).at("seconds").get<std::int64_t>() * 1000, "Invalid potion brewing timer");
    }
    if (!battle) return;
    const auto &b = *battle;
    ensureMagic(b.animationMs >= 0 && b.animationMs <= 900, "Invalid combat animation timer");
    ensureMagic(!b.doubleAttack || (!b.enemyTurn && !b.finished), "Invalid double attack lifetime");
    auto validateFighter = [&](const Fighter &f) {
        ensureMagic(f.stunnedUntilRound >= 0 && f.stunnedUntilRound <= 1'000'000 &&
            (!f.stunnedUntilRound || (f.enemy && f.readyRound > f.stunnedUntilRound)), "Invalid stun duration");
        ensureMagic(f.attacksThisTurn >= 0 && f.attacksThisTurn <= attacksPerTurn(f), "Invalid remaining attacks");
        ensureMagic(f.potionShield >= 0 && f.potionShield <= 1 && (!f.potionShield || (!f.enemy && f.health > 0)), "Invalid potion shield");
        ensureMagic(f.defeatedPhase >= -1 && f.defeatedPhase <= b.phaseIndex && (!f.enemy || f.defeatedPhase == -1), "Invalid fallen unit round");
    };
    for (const auto &f : b.fighters) validateFighter(f);
    for (const auto &f : b.campaignArmy) validateFighter(f);
}
} // namespace kingdom
