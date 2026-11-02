#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
void check(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
Pos freePlot(Game &g, const std::string &type) {
    for (int y = 0; y < g.world.height; ++y) for (int x = 0; x < g.world.width; ++x)
        if (g.canPlace(type, {x, y}).ok) return {x, y};
    throw std::runtime_error("Missing building plot");
}
void wait(Game &g, int ms = 100000) { g.tick(ms); }
Game settlement(int unitCount = 3) {
    Game g(Config::load(KINGDOM_CONFIG)); g.newGame(g.config.defaultSeed);
    g.stock.fill(1000000); g.buildings.front().level = 9;
    check(g.place("laboratory", freePlot(g, "laboratory")).ok, "Build Laboratory"); wait(g);
    auto id = g.buildings.back().id;
    for (int i = 0; i < 3; ++i) { check(g.upgrade(id).ok, "Upgrade Laboratory"); wait(g); }
    check(g.place("barracks", freePlot(g, "barracks")).ok, "Build Barracks"); wait(g);
    const auto source = g.buildings.back().id;
    for (int index = 0; index < unitCount; ++index) {
        const std::string type = index == 0 ? "heavy_infantry" : "infantry_squad";
        const auto &d = g.config.unit(type);
        bool placed = false;
        for (int y = 0; y < g.world.height && !placed; ++y) for (int x = 0; x < g.world.width && !placed; ++x) {
            if (!g.canPlaceUnit(d, {x, y})) continue;
            Unit u{g.nextId++, source, type, {x, y}, g.unitHealth(type)};
            g.units.push_back(u); g.occupyUnit(u, u.id); placed = true;
        }
        check(placed, "Deploy home unit");
    }
    g.validate(); return g;
}
Game combat(int unitCount = 3) {
    auto g = settlement(unitCount);
    std::vector<Id> ids; for (const auto &u : g.units) ids.push_back(u.id);
    check(g.startBattle(ids).ok, "Start expedition");
    for (auto &f : g.battle->fighters) if (f.enemy) { f.health = f.maxHealth = 100000; f.damage = 1; f.shield = 0; }
    g.validate(); return g;
}
Fighter &ally(Game &g, int index = 0) {
    int count = 0; for (auto &f : g.battle->fighters) if (!f.enemy && count++ == index) return f;
    throw std::runtime_error("Missing ally");
}
Result use(Game &g, const std::string &type) {
    auto selected = g.selectPotion(type); if (!selected.ok) return selected;
    return g.usePotion(type, g.battle->potionToken);
}
}
int main() {
    try {
        auto g = settlement();
        auto &lab = *std::find_if(g.buildings.begin(), g.buildings.end(), [](const auto &b) { return b.type == "laboratory"; });
        check(g.config.building("laboratory").width == 2 && g.config.building("laboratory").height == 2, "Laboratory occupies 2x2");
        for (int hall = 5; hall <= 10; ++hall) {
            g.buildings.front().level = hall;
            check(g.buildingLimit("laboratory") == std::clamp(hall - 5, 0, 4), "Exact Town Hall caps");
        }
        g.buildings.front().level = 9;
        check(!g.buildingRequirements("laboratory").ok, "Only one Laboratory");
        for (int level = 1; level <= 4; ++level) {
            lab.level = level;
            for (int type = 0; type < 4; ++type)
                check(g.brewRequirements(lab.id, std::array{"heal", "shield", "attack", "revive"}[type]).ok == (type < level), "One potion unlocked per completed level");
        }
        for (int i = 0; i < 5; ++i) check(g.brew(lab.id, "heal").ok, "Five repeated potions fit");
        const auto stock = g.stock;
        check(!g.brew(lab.id, "revive").ok && g.stock == stock, "Sixth potion fails without payment");
        auto restored = decodeSave(g.config, encodeSave(g));
        check(restored.potions == g.potions, "Inventory persists");

        auto removal = settlement();
        const Id removalLaboratory = std::find_if(removal.buildings.begin(), removal.buildings.end(), [](const auto &b) { return b.type == "laboratory"; })->id;
        removal.potions = {2, 1, 1, 1};
        const auto initialRemovalStock = removal.stock;
        const auto firstSequence = removal.potionSequence;
        check(removal.removePotion(removalLaboratory, "heal", firstSequence).ok, "Remove one ready potion");
        check(removal.potions == std::array<int, 4>{1, 1, 1, 1} && removal.potionCount() == 4 && removal.stock[4] == initialRemovalStock[4] + 20, "Removal frees exactly one slot and refunds 20 gold");
        check(!removal.removePotion(removalLaboratory, "heal", firstSequence).ok && removal.potions[0] == 1 && removal.stock[4] == initialRemovalStock[4] + 20, "Duplicate command cannot remove a second copy or refund twice");
        for (const auto *type : {"heal", "shield", "attack", "revive"}) {
            const auto before = removal.stock;
            check(removal.removePotion(removalLaboratory, type, removal.potionSequence).ok && removal.stock[4] == before[4] + 20, "Every potion type refunds exactly 20 gold");
            for (int i = 0; i < 4; ++i) check(removal.stock[i] == before[i], "Removal changes no other resources");
        }
        check(removal.potionCount() == 0, "All removed potions leave empty storage");
        auto removalReloaded = decodeSave(removal.config, encodeSave(removal));
        check(removalReloaded.potions == removal.potions && removalReloaded.stock == removal.stock && removalReloaded.potionSequence == removal.potionSequence, "Removed inventory, refund and replay protection persist together");
        const auto emptyStock = removal.stock;
        check(!removal.removePotion(removalLaboratory, "heal", removal.potionSequence).ok && removal.stock == emptyStock, "Empty storage cannot generate gold");
        removal.potions[0] = 1;
        removal.stock[4] = 1'000'000'000'000ll - 20;
        check(!removal.removePotion(removalLaboratory, "heal", removal.potionSequence).ok && removal.potions[0] == 1, "Gold overflow rejects removal without losing the potion");
        --removal.stock[4];
        check(removal.removePotion(removalLaboratory, "heal", removal.potionSequence).ok && removal.stock[4] == 999'999'999'999ll, "Largest legal refund reaches but never exceeds the gold cap");
        auto removalBattle = combat(); removalBattle.potions[0] = 1;
        const auto battleStock = removalBattle.stock;
        check(!removalBattle.removePotion(removalLaboratory, "heal", removalBattle.potionSequence).ok && removalBattle.potions[0] == 1 && removalBattle.stock == battleStock, "Battle inventory cannot be removed for gold");

        auto healing = combat(); healing.potions = {1, 0, 0, 0};
        auto &wounded = ally(healing); wounded.health = 1; const int shield = wounded.shield;
        auto &fallen = ally(healing, 1); fallen.health = fallen.shield = 0; fallen.defeatedPhase = 0;
        check(use(healing, "heal").ok, "Healing potion applies");
        check(ally(healing).health == ally(healing).maxHealth && ally(healing).shield == shield && ally(healing, 1).health == 0, "Heal restores HP only, never shields or dead allies");

        auto shielded = combat(); shielded.potions = {0, 2, 0, 0};
        check(use(shielded, "shield").ok, "Shield applies");
        const int nativeShield = ally(shielded).shield;
        check(ally(shielded).potionShield == 1 && ally(shielded).shield == nativeShield, "Shield grants one separate hit of protection");
        wait(shielded, 1000);
        check(!shielded.potionRequirements("shield").ok && shielded.potions[1] == 1, "Shield cannot stack or waste inventory");
        ally(shielded).potionShield = 0;
        check(use(shielded, "shield").ok && ally(shielded).potionShield == 1 && ally(shielded).shield == nativeShield, "Reusing restores one hit of protection and preserves base shield");

        auto doubled = combat(); doubled.potions = {0, 0, 2, 0};
        check(use(doubled, "attack").ok, "Attack boost applies");
        auto reloaded = decodeSave(doubled.config, encodeSave(doubled));
        check(reloaded.battle->doubleAttack && reloaded.potions[2] == 1, "Reload preserves boost and consumption");
        wait(doubled, 1000);
        check(!doubled.potionRequirements("attack").ok, "Double attack cannot stack");
        auto &a = ally(doubled); auto enemy = std::find_if(doubled.battle->fighters.begin(), doubled.battle->fighters.end(), [](const auto &f) { return f.enemy; });
        int damage = a.damage;
        check(doubled.attack(a.id, enemy->id).ok && doubled.battle->lastAttacks.front().damage == damage * 2, "Boost doubles normal attack size");
        check(a.attacked && doubled.battle->actions == 1, "No extra unit action");
        for (auto &f : doubled.battle->fighters) if (!f.enemy) f.attacked = true;
        doubled.normalizeBattleTurn();
        check(doubled.battle->enemyTurn && !doubled.battle->doubleAttack, "Boost expires when player turn ends");

        auto revival = combat(); revival.potions = {0, 0, 0, 1};
        auto &dead = ally(revival, 1); dead.health = dead.shield = 0; dead.defeatedPhase = 0;
        const auto id = dead.id; const auto position = dead.pos; const int expected = (dead.maxHealth + 1) / 2;
        check(use(revival, "revive").ok, "Revive applies");
        check(ally(revival, 1).id == id && ally(revival, 1).pos == position && ally(revival, 1).health == expected && !ally(revival, 1).shield && ally(revival, 1).attacked && ally(revival, 1).readyRound == 2, "Revive preserves identity and position, rounds half HP up, and delays action");
        auto saved = decodeSave(revival.config, encodeSave(revival)); check(saved.battle->fighters.size() == revival.battle->fighters.size(), "Revival creates no copies after reload");

        for (const int missingMarkers : {0, 1, 4}) {
            auto massRevival = combat(5); massRevival.potions = {0, 0, 0, 1};
            std::vector<Fighter> casualties;
            for (int index = 1; index < 5; ++index) {
                const Id fallenId = ally(massRevival, index).id;
                massRevival.destroyUnit(fallenId, true);
                if (index > 4 - missingMarkers) ally(massRevival, index).defeatedPhase = -1;
                casualties.push_back(ally(massRevival, index));
            }
            massRevival = decodeSave(massRevival.config, encodeSave(massRevival));
            const int survivorHealth = ally(massRevival).health;
            check(use(massRevival, "revive").ok && massRevival.battle->potionTargets.size() == 4,
                  "Revival includes all four casualties, including a missing legacy defeat marker");
            check(massRevival.potions[3] == 0 && ally(massRevival).health == survivorHealth,
                  "Mass revival consumes one potion and leaves surviving allies unchanged");
            for (int index = 1; index < 5; ++index) {
                const auto &restoredAlly = ally(massRevival, index);
                const auto &casualty = casualties[index - 1];
                check(restoredAlly.id == casualty.id && restoredAlly.pos == casualty.pos &&
                          restoredAlly.health == (casualty.maxHealth + 1) / 2 && !restoredAlly.shield &&
                          !restoredAlly.potionShield && restoredAlly.attacked && restoredAlly.readyRound == 2,
                      "Each of four revived allies keeps its identity, position and next-turn delay");
            }
            massRevival = decodeSave(massRevival.config, encodeSave(massRevival));
            check(std::count_if(massRevival.battle->fighters.begin(), massRevival.battle->fighters.end(),
                               [](const auto &f) { return !f.enemy && f.health > 0; }) == 5,
                  "All five living allies persist after mass revival and reload");
        }

        auto confirmation = combat(); confirmation.potions = {0, 0, 1, 0};
        confirmation.battle->automatic = true;
        check(confirmation.selectPotion("attack").ok, "Select potion while automatic control is enabled");
        const auto token = confirmation.battle->potionToken;
        wait(confirmation, 10000);
        check(confirmation.battle->actions == 0 && confirmation.potions[2] == 1, "Confirmation freezes auto attack without consuming");
        check(confirmation.cancelPotion().ok && confirmation.battle->automatic && confirmation.potions[2] == 1, "Cancel preserves prior automatic mode and inventory");
        check(!confirmation.usePotion("attack", token).ok, "Cancelled confirmation token is invalid");
        check(confirmation.selectPotion("attack").ok, "Open fresh confirmation");
        const auto validToken = confirmation.battle->potionToken;
        check(confirmation.usePotion("attack", validToken).ok && !confirmation.usePotion("attack", validToken).ok && confirmation.potions[2] == 0, "Duplicate use consumes and applies only once");
        wait(confirmation, 1000); check(confirmation.battle->actions > 0, "Auto attack resumes after confirmation");

        auto invalid = combat(); invalid.potions = {1, 0, 0, 1};
        check(!invalid.potionRequirements("heal").ok && !invalid.potionRequirements("revive").ok, "Invalid targets are rejected");
        invalid.battle->paused = true; check(!invalid.selectPotion("heal").ok, "Paused potion selection fails");
        invalid.battle->paused = false; invalid.battle->enemyTurn = true; check(!invalid.selectPotion("heal").ok, "Enemy turn selection fails");
        check(invalid.potions[0] == 1 && invalid.potions[3] == 1, "Invalid use never consumes");

        for (const bool nativeShield : {false, true}) {
            auto protectedAlly = combat(); protectedAlly.potions = {0, 2, 0, 0};
            const Id protectedId = ally(protectedAlly).id;
            std::erase_if(protectedAlly.battle->fighters, [&](const auto &f) { return !f.enemy && f.id != protectedId; });
            for (auto &f : protectedAlly.battle->fighters) {
                if (f.enemy) f.damage = 10;
                else { if (!nativeShield) f.shield = 0; f.defense = 0; }
            }
            const int healthBefore = ally(protectedAlly).health, shieldBefore = ally(protectedAlly).shield;
            check(use(protectedAlly, "shield").ok, "Separate potion layer applies before damage");
            protectedAlly = decodeSave(protectedAlly.config, encodeSave(protectedAlly));
            check(ally(protectedAlly).potionShield == 1 && protectedAlly.potions[1] == 1, "Reload retains protection and spent inventory");
            protectedAlly.battle->enemyTurn = true; wait(protectedAlly, 1000);
            check(ally(protectedAlly).health == healthBefore && ally(protectedAlly).shield == shieldBefore &&
                      ally(protectedAlly).potionShield == 0 && protectedAlly.battle->lastAttacks.front().shieldDamage == 1 &&
                      protectedAlly.battle->lastAttacks.front().damage == 0,
                  "Potion shield blocks the full hit while preserving health and native shield");
            protectedAlly = decodeSave(protectedAlly.config, encodeSave(protectedAlly));
            check(ally(protectedAlly).potionShield == 0, "Reload never restores a consumed potion shield");
            wait(protectedAlly, 1000);
            check(nativeShield ? ally(protectedAlly).shield < shieldBefore && ally(protectedAlly).health == healthBefore
                               : ally(protectedAlly).health < healthBefore,
                  "The following hit uses normal shield and health rules");
            protectedAlly.battle->enemyTurn = false; protectedAlly.battle->animationMs = 0;
            check(use(protectedAlly, "shield").ok && ally(protectedAlly).potionShield == 1 && protectedAlly.potions[1] == 0,
                  "Reusing restores protection after a real hit consumes it");
            for (auto &f : protectedAlly.battle->fighters) if (f.enemy) f.health = 0;
            protectedAlly.normalizeBattleTurn();
            check(protectedAlly.battle->finished && std::all_of(protectedAlly.battle->fighters.begin(), protectedAlly.battle->fighters.end(), [](const auto &f) { return f.potionShield == 0; }), "Potion shields expire when the combat round ends");
        }

        auto failure = combat(); failure.potions = {0, 0, 1, 0};
        check(failure.selectPotion("attack").ok, "Open a valid confirmation before simulated technical failure");
        ally(failure).damage = 0;
        bool rejected = false;
        try { failure.usePotion("attack", failure.battle->potionToken); } catch (const std::exception &) { rejected = true; }
        check(rejected && failure.potions[2] == 1 && !failure.battle->doubleAttack, "Technical validation failure never consumes or applies a potion");

        auto queueConfig = Config::load(KINGDOM_CONFIG).raw;
        for (auto &p : queueConfig["magic"]["potions"]) p["seconds"] = 2;
        auto queued = settlement(); queued.config = Config::parse(queueConfig);
        auto laboratory = std::find_if(queued.buildings.begin(), queued.buildings.end(), [](const auto &b) { return b.type == "laboratory"; })->id;
        for (int i = 0; i < 5; ++i) check(queued.brew(laboratory, "heal").ok, "Queue accepts five potions");
        check(!queued.brew(laboratory, "heal").ok && queued.potionCount() == 5, "Queued and ready potions share capacity");
        const auto queuedStock = queued.stock;
        check(!queued.removePotion(laboratory, "heal", queued.potionSequence).ok && queued.brewing.size() == 5 && queued.stock == queuedStock, "Removal never refunds unfinished brewing tasks");
        queued = decodeSave(queued.config, encodeSave(queued)); wait(queued, 2100);
        check(queued.potions[0] == 1 && queued.brewing.size() == 4 && queued.potionCount() == 5, "Brew timer and queue persist");
        std::cout << "Laboratory and potion rules passed\n";
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
