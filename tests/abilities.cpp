#include "kingdom/Game.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <tuple>

using namespace kingdom;
namespace {
void check(bool value, const std::string &message) { if (!value) throw std::runtime_error(message); }
Game fresh() {
    Game game(Config::load(KINGDOM_CONFIG));
    game.newGame(game.config.defaultSeed);
    return game;
}
Fighter troop(const Game &game, const std::string &type, Id id, bool enemy = false) {
    const auto &d = game.config.unit(type);
    Fighter fighter;
    fighter.id = id; fighter.type = type; fighter.enemy = enemy;
    fighter.domain = fighter.phase = d.domain;
    fighter.health = fighter.maxHealth = game.unitHealth(type);
    fighter.damage = game.unitDamage(type); fighter.defense = d.defense;
    fighter.range = d.range; fighter.movement = d.movement;
    fighter.shield = game.unitShield(type, fighter.maxHealth, enemy ? 0 : -1);
    return fighter;
}
Game arena(Domain domain) {
    auto game = fresh();
    game.battle.emplace();
    game.battle->id = 1; game.battle->domain = domain; game.battle->phases = {domain};
    return game;
}
Fighter &find(Game &game, Id id) {
    auto &fighters = game.battle->fighters;
    return *std::find_if(fighters.begin(), fighters.end(), [&](const auto &f) { return f.id == id; });
}
void enemy(Game &game, Id id, Domain domain, int damage = 1) {
    auto fighter = troop(game, domain == Domain::Land ? "infantry_squad" : "ship", id, true);
    fighter.health = fighter.maxHealth = 1000; fighter.damage = damage; fighter.defense = 0;
    game.battle->fighters.push_back(fighter);
}
}
int main() {
    try {
        auto game = fresh();
        for (const auto &type : {"infantry", "heavy_infantry", "frigate", "attack_submarine"}) game.researchLevels[type] = 4;
        check(game.unitHealing("infantry", game.unitHealth("infantry")) == game.unitHealth("infantry") / 2,
              "Recruit repair scales with researched maximum health");
        check(game.unitHealing("frigate", game.unitHealth("frigate")) == game.unitHealth("frigate") * 45 / 100,
              "Frigate healing scales with researched maximum health");
        for (const auto &type : {"heavy_infantry", "attack_submarine"}) {
            Unit unit; unit.id = game.nextId++; unit.type = type; unit.health = game.unitHealth(type);
            game.units.push_back(unit);
        }
        check(game.startBattle(std::vector<Id>{game.units[0].id, game.units[1].id}).ok, "Shielded troops deploy");
        for (const auto &fighter : game.battle->fighters) if (!fighter.enemy)
            check(fighter.shield == fighter.maxHealth / (fighter.type == "heavy_infantry" ? 2 : 1),
                  "Every shield starts at its researched health ratio");
        auto campaign = fresh(); campaign.researchLevels["heavy_infantry"] = 3;
        Unit heavy; heavy.id = campaign.nextId++; heavy.type = "heavy_infantry"; heavy.health = campaign.unitHealth(heavy.type);
        campaign.units.push_back(heavy);
        check(campaign.startCampaignBattle(1, {heavy.id}).ok, "Shielded campaign deployment");
        check(campaign.battle->campaignArmy.front().shield == campaign.unitHealth(heavy.type) / 2 &&
              find(campaign, heavy.id).shield == campaign.unitHealth(heavy.type) / 2,
              "Committed campaign army receives researched shields");
        const auto campaignStock = campaign.stock;
        campaign.battle->round = 200;
        campaign.normalizeBattleTurn();
        check(campaign.battle->finished && campaign.battle->retreated && !campaign.battle->victory &&
                  !campaign.battle->draw && campaign.battle->outcomes == std::vector<int>{0} &&
                  find(campaign, heavy.id).health == heavy.health,
              "A capped campaign ends as a defeat while preserving surviving committed troops");
        check(campaign.finishBattle().ok && campaign.stock == campaignStock &&
                  campaign.completedCampaignLevels.empty() && !campaign.finishBattle().ok,
              "A campaign stalemate grants neither rewards nor campaign progress, even on a repeated claim");

        auto researchedShields = fresh();
        for (const auto &[type, rank, expected] : {std::tuple{"plasma_tank", 4, 237}, std::tuple{"titan_mech", 2, 281},
                                                  std::tuple{"titan_carrier", 2, 380}, std::tuple{"plasma_fighter", 4, 182}}) {
            researchedShields.researchLevels[type] = rank;
            check(researchedShields.unitShield(type, researchedShields.unitHealth(type)) == expected,
                  "Every player energy shield gains the accumulated research bonus");
            check(researchedShields.unitShield(type, researchedShields.unitHealth(type), 0) == researchedShields.config.unit(type).shield,
                  "Enemy shields never gain player research bonuses");
        }

        auto recovery = arena(Domain::Land);
        auto recruit = troop(recovery, "infantry", 1); recruit.maxHealth = 162; recruit.health = 40; recruit.defense = 0;
        auto fallen = troop(recovery, "infantry_squad", 2); fallen.health = 0;
        recovery.battle->fighters = {recruit, fallen}; enemy(recovery, 101, Domain::Land); enemy(recovery, 102, Domain::Land);
        recovery.battle->enemyTurn = true;
        recovery.tick(1000);
        check(find(recovery, 1).health == 39 && recovery.battle->lastAttacks.size() == 1,
              "Recruit waits for the entire enemy side before healing");
        recovery.tick(1000);
        check(find(recovery, 1).health == 119 && find(recovery, 2).health == 0 &&
              recovery.battle->round == 2 && !recovery.battle->enemyTurn,
              "Recruit heals half researched maximum health once without reviving casualties");
        check(recovery.battle->lastAttacks.size() == 2 && recovery.battle->lastAttacks.back().healing == 81,
              "Enemy attack and actual recovery are both retained for presentation");
        recovery.tick(10000);
        check(find(recovery, 1).health == 119, "Waiting for manual control cannot trigger extra recovery");

        auto support = arena(Domain::Land);
        recruit = troop(support, "infantry", 1); recruit.maxHealth = recruit.health = 162; recruit.defense = 0;
        auto ally = troop(support, "heavy_infantry", 2); ally.health = 20; ally.shield = 0; ally.defense = 0;
        support.battle->fighters = {recruit, ally}; enemy(support, 101, Domain::Land);
        auto &foe = find(support, 101); foe.damage = 1;
        recruit = find(support, 1);
        foe.attacked = true; support.battle->enemyTurn = true;
        support.tick(1000);
        check(find(support, 1).health == 162 && find(support, 2).health == 101,
              "Full health Recruit gives half its own maximum health to a wounded ally");

        for (bool hostile : {false, true}) {
            auto guaranteed = arena(Domain::Naval);
            for (auto &definition : guaranteed.config.units) {
                definition.accuracy = 1;
                definition.evasion = 80;
                definition.detection = 0;
            }
            auto attacker = troop(guaranteed, "ship", hostile ? 101 : 1, hostile);
            auto victim = troop(guaranteed, "attack_boat", hostile ? 1 : 101, !hostile);
            attacker.damage = 10;
            victim.health = victim.maxHealth = 10000; victim.defense = 0;
            guaranteed.battle->fighters = {attacker, victim};
            for (int hit = 0; hit < 40; ++hit) {
                auto &actor = find(guaranteed, attacker.id);
                actor.attacked = false; actor.readyRound = guaranteed.battle->round;
                guaranteed.battle->enemyTurn = hostile;
                if (hostile) guaranteed.tick(1000);
                else check(guaranteed.attack(attacker.id, victim.id).ok, "Valid player attack");
                check(!guaranteed.battle->lastAttacks.front().missed && guaranteed.battle->lastAttacks.front().damage > 0,
                      "Player and enemy attacks always hit even with minimum accuracy and maximum evasion");
            }
        }

        for (int shield : {1, 50, 330}) {
            auto protectedSub = arena(Domain::Naval);
            auto submarine = troop(protectedSub, "attack_submarine", 1);
            submarine.shield = shield;
            auto escort = troop(protectedSub, "frigate", 101, true);
            escort.damage = 1000;
            auto secondEscort = escort; secondEscort.id = 102;
            protectedSub.battle->fighters = {submarine, escort, secondEscort};
            protectedSub.battle->enemyTurn = true;
            protectedSub.tick(1000);
            check(find(protectedSub, 1).health == submarine.health && find(protectedSub, 1).shield == 0 &&
                      protectedSub.battle->lastAttacks.front().damage == 0 &&
                      protectedSub.battle->lastAttacks.front().shieldDamage == shield,
                  "Even one shield point absorbs the whole hit without losing submarine health");
            protectedSub.tick(1000);
            check(find(protectedSub, 1).health == 0 && protectedSub.battle->lastAttacks.front().damage > 0,
                  "The next enemy hit can damage health after the shield is broken");
        }
        for (const auto &attacker : game.config.units) {
            if (attacker.validTargets.empty() || !attacker.damage) continue;
            const Domain domain = attacker.validTargets.front();
            auto protectedTarget = arena(domain);
            auto target = troop(protectedTarget, domain == Domain::Land ? "heavy_infantry" : domain == Domain::Naval ? "ship" : "aircraft", 1);
            target.health = target.maxHealth = 10000; target.shield = 0; target.potionShield = 1;
            auto foe = troop(protectedTarget, attacker.id, 101, true);
            foe.phase = domain; foe.damage = 1000;
            if (attacker.burstEvery) foe.strikes = attacker.burstEvery - 1;
            auto secondFoe = foe; secondFoe.id = 102;
            protectedTarget.battle->fighters = {target, foe, secondFoe};
            protectedTarget.battle->enemyTurn = true;
            protectedTarget.tick(1000);
            check(find(protectedTarget, 1).health == 10000 && find(protectedTarget, 1).potionShield == 0 &&
                      protectedTarget.battle->lastAttacks.front().damage == 0 &&
                      protectedTarget.battle->lastAttacks.front().shieldDamage == 1,
                  "Potion shield blocks the complete hit from " + attacker.id);
            protectedTarget.tick(1000);
            check(find(protectedTarget, 1).health < 10000 && protectedTarget.battle->lastAttacks.front().damage > 0,
                  "A later hit from " + attacker.id + " damages health after the potion shield breaks");
        }
        auto potionFormation = arena(Domain::Land);
        potionFormation.config.enemySingleTarget = false;
        for (Id id : {1, 2, 3}) {
            auto target = troop(potionFormation, "heavy_infantry", id);
            target.health = target.maxHealth = 10000; target.shield = 0; target.potionShield = id == 3 ? 0 : 1;
            potionFormation.battle->fighters.push_back(target);
        }
        auto areaAttacker = troop(potionFormation, "armored_jeep", 101, true); areaAttacker.damage = 1000;
        potionFormation.battle->fighters.push_back(areaAttacker);
        potionFormation.battle->enemyTurn = true;
        potionFormation.tick(1000);
        check(potionFormation.battle->lastAttacks.size() == 3 && find(potionFormation, 1).health == 10000 &&
                  find(potionFormation, 2).health == 10000 && !find(potionFormation, 1).potionShield &&
                  !find(potionFormation, 2).potionShield && find(potionFormation, 3).health < 10000,
              "Area hits independently consume potion shields and protect only shielded allies");

        auto shieldedFormation = arena(Domain::Land);
        auto shieldBreaker = troop(shieldedFormation, "armored_jeep", 1);
        shieldedFormation.battle->fighters = {shieldBreaker};
        for (Id id : {101, 102, 103}) {
            auto foe = troop(shieldedFormation, "heavy_infantry", id, true);
            foe.health = foe.maxHealth = 1000;
            foe.shield = id == 103 ? 0 : 1;
            shieldedFormation.battle->fighters.push_back(foe);
        }
        check(shieldedFormation.attack(1, 101).ok && shieldedFormation.battle->lastAttacks.size() == 3 &&
                  find(shieldedFormation, 101).health == 1000 && find(shieldedFormation, 101).shield == 0 &&
                  find(shieldedFormation, 102).health == 1000 && find(shieldedFormation, 102).shield == 0 &&
                  find(shieldedFormation, 103).health < 1000,
              "Area attacks apply shield protection separately to every target on either side");

        auto jeepBattle = arena(Domain::Land);
        auto jeep = troop(jeepBattle, "armored_jeep", 1);
        jeepBattle.battle->fighters.push_back(jeep);
        for (int i = 0; i < 5; ++i) { enemy(jeepBattle, 101 + i, Domain::Land); find(jeepBattle, 101 + i).pos = {i * 5, i * 5}; }
        check(jeepBattle.attack(1, 101).ok && jeepBattle.battle->lastAttacks.size() == 5,
              "Jeep attacks every valid enemy regardless of formation distance");
        int expectedDamage = jeep.damage;
        for (const auto &hit : jeepBattle.battle->lastAttacks)
            check(hit.damage == expectedDamage && !hit.healing, "Jeep uses full reduced attack for every enemy");

        for (const auto &targetDefinition : game.config.units) {
            if (targetDefinition.domain != Domain::Naval) continue;
            for (const auto &identity : {"W06", ""}) {
                auto submarineStrike = arena(Domain::Naval);
                auto target = troop(submarineStrike, targetDefinition.id, 1);
                target.health = target.maxHealth = 10000; target.shield = 0; target.defense = 50;
                auto submarine = troop(submarineStrike, "attack_submarine", 101, true);
                submarine.enemyId = identity; submarine.damage = 225;
                submarineStrike.battle->fighters = {target, submarine};
                submarineStrike.battle->enemyTurn = true;
                submarineStrike.tick(1000);
                const int multiplier = std::string(identity) == "W06" ? 100
                    : targetDefinition.armorClass == "large" ? 220 : targetDefinition.armorClass == "armored" ? 150 : 100;
                const int expected = 225 * multiplier / 100;
                check(submarineStrike.battle->lastAttacks.front().damage == expected &&
                          submarineStrike.battle->lastAttacks.front().shieldDamage == 0,
                      "W06 uses its displayed attack against every ship without player Armor; other submarines retain their multipliers");
            }
        }

        for (const auto &identity : {"AI-G4", "G06"}) {
            auto bossStrike = arena(Domain::Land);
            auto target = troop(bossStrike, "light_tank", 1);
            target.health = target.maxHealth = 1000;
            auto boss = troop(bossStrike, "light_tank", 101, true);
            boss.enemyId = identity; boss.health = boss.maxHealth = 3007; boss.damage = 199;
            bossStrike.battle->fighters = {target, boss};
            bossStrike.battle->enemyTurn = true;
            bossStrike.tick(1000);
            const int expected = std::string(identity) == "AI-G4" ? 199 : 288;
            check(bossStrike.battle->lastAttacks.front().damage == expected &&
                      find(bossStrike, 1).health == 1000 - expected,
                  "AI-G4 uses base attack without removed player Armor while other enemies retain their bonuses");
        }
        auto friendlyTank = arena(Domain::Land);
        auto tank = troop(friendlyTank, "light_tank", 1); tank.damage = 199;
        auto tankTarget = troop(friendlyTank, "light_tank", 101, true);
        tankTarget.health = tankTarget.maxHealth = 1000;
        friendlyTank.battle->fighters = {tank, tankTarget};
        check(friendlyTank.attack(1, 101).ok && friendlyTank.battle->lastAttacks.front().damage == 199,
              "Player Light Tank deals its shown attack without armor or anti-armor adjustments");

        for (const auto &unit : fresh().config.units) {
            if (unit.carrierSlots) continue;
            for (const auto &armorClass : {"light", "armored", "large", "submerged"}) {
                auto exactDamage = arena(unit.domain);
                exactDamage.researchLevels[unit.id] = std::min(3, 11 - unit.level);
                auto actor = troop(exactDamage, unit.id, 1);
                actor.strikes = std::max(0, unit.burstEvery - 1);
                const auto targetDomain = unit.validTargets.front();
                const std::string targetType = targetDomain == Domain::Land ? "infantry_squad" :
                                               targetDomain == Domain::Naval ? "ship" : "aircraft";
                auto victim = troop(exactDamage, targetType, 101, true);
                victim.phase = actor.phase;
                victim.health = victim.maxHealth = 100000;
                victim.defense = 9999; victim.shield = 0;
                for (auto &definition : exactDamage.config.units)
                    if (definition.id == targetType) definition.armorClass = armorClass;
                exactDamage.battle->fighters = {actor, victim};
                check(exactDamage.attack(1, 101).ok &&
                          exactDamage.battle->lastAttacks.front().damage == actor.damage &&
                          find(exactDamage, 101).health == 100000 - actor.damage,
                      "Every researched player troop deals the shown Attack against every armor class");
            }
        }
        for (const auto &unit : fresh().config.units) {
            auto noArmor = arena(unit.domain);
            auto victim = troop(noArmor, unit.id, 1);
            victim.health = victim.maxHealth = 10000; victim.shield = 0; victim.defense = 9999;
            const auto attackerType = unit.domain == Domain::Land ? "infantry_squad" : unit.domain == Domain::Naval ? "ship" : "aircraft";
            for (auto &definition : noArmor.config.units)
                if (definition.id == attackerType) definition.detection = 100;
            auto attacker = troop(noArmor, attackerType, 101, true); attacker.damage = 200;
            noArmor.battle->fighters = {victim, attacker}; noArmor.battle->enemyTurn = true;
            noArmor.tick(1000);
            check(!noArmor.battle->lastAttacks.empty() && noArmor.battle->lastAttacks.front().damage == 200,
                  "Every player troop receives the full enemy hit without an Armor reduction: " + unit.id + " received " + (noArmor.battle->lastAttacks.empty() ? "no hit" : std::to_string(noArmor.battle->lastAttacks.front().damage)));
        }
        auto legacyArmor = arena(Domain::Land);
        legacyArmor.config.playerArmorEnabled = true;
        auto armoredVictim = troop(legacyArmor, "infantry_squad", 1); armoredVictim.defense = 50;
        auto oldAttacker = troop(legacyArmor, "infantry_squad", 101, true); oldAttacker.damage = 100;
        legacyArmor.battle->fighters = {armoredVictim, oldAttacker}; legacyArmor.battle->enemyTurn = true;
        legacyArmor.tick(1000);
        check(legacyArmor.battle->lastAttacks.front().damage == 50,
              "Historical Armor rules remain available for validating old saves");
        auto enemyArmor = arena(Domain::Land);
        enemyArmor.config.playerDamageMatchesAttack = false;
        auto playerAttacker = troop(enemyArmor, "infantry_squad", 1); playerAttacker.damage = 100;
        auto enemyVictim = troop(enemyArmor, "infantry_squad", 101, true); enemyVictim.defense = 50;
        enemyArmor.battle->fighters = {playerAttacker, enemyVictim};
        check(enemyArmor.attack(1,101).ok && enemyArmor.battle->lastAttacks.front().damage == 50,
              "Disabling player Armor does not remove an enemy's Armor under legacy player damage rules");
        auto legacyDamage = arena(Domain::Land);
        legacyDamage.config.playerDamageMatchesAttack = false;
        tank = troop(legacyDamage, "light_tank", 1); tank.damage = 199;
        tankTarget = troop(legacyDamage, "light_tank", 101, true);
        tankTarget.health = tankTarget.maxHealth = 1000;
        legacyDamage.battle->fighters = {tank, tankTarget};
        check(legacyDamage.attack(1, 101).ok && legacyDamage.battle->lastAttacks.front().damage == 269,
              "Legacy player damage rules remain available for validated historical saves");

        auto carrierHealing = arena(Domain::Land);
        carrierHealing.researchLevels["armored_carrier"] = 2;
        auto carrierMedic = troop(carrierHealing, "armored_carrier", 1);
        auto woundedAlly = troop(carrierHealing, "heavy_infantry", 2);
        woundedAlly.health = 10;
        auto fallenAlly = troop(carrierHealing, "infantry_squad", 3); fallenAlly.health = 0;
        carrierHealing.battle->fighters = {carrierMedic, woundedAlly, fallenAlly};
        enemy(carrierHealing, 101, Domain::Land);
        check(carrierHealing.unitHealing("armored_carrier", 240) == 108 &&
                  carrierHealing.unitHealing("armored_carrier", carrierMedic.maxHealth) == 118,
              "Armored Carrier healing scales with researched maximum health just like Frigate");
        check(carrierHealing.validBattleHealTargets(1) == std::vector<Id>{2} &&
                  !carrierHealing.heal(1, 3).ok && !carrierHealing.heal(1, 101).ok,
              "Armored Carrier only selects living wounded allies");
        check(carrierHealing.heal(1, 2).ok && find(carrierHealing, 2).health == 128 &&
                  carrierHealing.battle->lastAttacks.front().healing == 118 &&
                  !carrierHealing.attack(1, 101).ok,
              "Armored Carrier heals its chosen ally instead of attacking this turn");
        auto carrierAuto = arena(Domain::Land);
        carrierMedic.health = carrierMedic.maxHealth - 20;
        carrierAuto.battle->fighters = {carrierMedic};
        enemy(carrierAuto, 101, Domain::Land);
        carrierAuto.battle->automatic = true;
        carrierAuto.tick(1000);
        check(find(carrierAuto, 1).health == carrierMedic.maxHealth &&
                  carrierAuto.battle->lastAttacks.front().healing == 20,
              "Automatic Armored Carrier healing is capped at the ally maximum, including itself");

        auto airHealing = arena(Domain::Land);
        auto medic = troop(airHealing, "strike_fighter", 1); medic.phase = Domain::Land;
        auto groundAlly = troop(airHealing, "infantry", 2); groundAlly.health = 1;
        airHealing.battle->fighters = {medic, groundAlly}; enemy(airHealing, 101, Domain::Land);
        check(airHealing.unitHealing("strike_fighter", medic.maxHealth) == 225,
              "Strike Fighter heals for 45 percent of its doubled health");
        check(airHealing.heal(1, 2).ok && find(airHealing, 2).health == groundAlly.maxHealth,
              "Strike Fighter heals ground allies in its assigned mission without overhealing");
        check(!airHealing.attack(1, 101).ok, "Strike Fighter healing consumes its action");
        auto plasmaBattle = arena(Domain::Naval);
        auto plasma = troop(plasmaBattle, "plasma_fighter", 1); plasma.phase = Domain::Naval;
        plasmaBattle.battle->fighters = {plasma}; enemy(plasmaBattle, 101, Domain::Naval);
        enemy(plasmaBattle, 102, Domain::Naval);
        for (Id id : {103, 104}) {
            auto aircraft = troop(plasmaBattle, "jet_fighter", id, true);
            aircraft.phase = Domain::Naval; aircraft.health = aircraft.maxHealth = 2000;
            aircraft.defense = aircraft.shield = 0; aircraft.pos = {static_cast<int>(id), 0};
            plasmaBattle.battle->fighters.push_back(aircraft);
        }
        check(plasmaBattle.attack(1, 101).ok && plasmaBattle.battle->lastAttacks.size() == 4,
              "Plasma hits its selected target and every other enemy regardless of distance");
        check(find(plasmaBattle, 101).health == 795 && find(plasmaBattle, 102).health == 898 && find(plasmaBattle, 103).health == 1898 &&
              find(plasmaBattle, 104).health == 1898,
              "Plasma keeps full primary damage and spreads half damage to other ships and aircraft");
        check(game.unitHealth("jet_fighter") == 253 && game.unitDamage("jet_fighter") == 506 &&
              game.unitHealth("plasma_fighter") == 625 && game.unitDamage("plasma_fighter") == 205,
              "Special aircraft have the requested health and attack");

        auto repairs = arena(Domain::Naval);
        auto frigate = troop(repairs, "frigate", 1); frigate.maxHealth = frigate.health = 500;
        auto ship = troop(repairs, "ship", 2); ship.maxHealth = 500; ship.health = 100;
        auto dead = troop(repairs, "ship", 3); dead.health = 0;
        repairs.battle->fighters = {frigate, ship, dead}; enemy(repairs, 101, Domain::Naval);
        auto air = troop(repairs, "aircraft", 102, true); air.phase = Domain::Naval;
        repairs.battle->fighters.push_back(air);
        check(repairs.validBattleHealTargets(1) == std::vector<Id>{2}, "Only living wounded allies are selectable");
        auto targets = repairs.validBattleTargets(1);
        check(targets == std::vector<Id>{101}, "Frigate weapons target opposing ships only");
        check(!repairs.heal(1, 3).ok && !repairs.heal(1, 101).ok, "Healing rejects casualties and enemies");
        check(repairs.heal(1, 2).ok && find(repairs, 2).health == 325 &&
              repairs.battle->lastAttacks.front().healing == 225 && repairs.battle->actions == 1,
              "Chosen ally receives 45 percent Frigate maximum health as one action");
        check(!repairs.attack(1, 101).ok && repairs.validBattleHealTargets(1).empty(),
              "Healing consumes the Frigate attack for that turn");
        auto selfRepair = arena(Domain::Naval);
        frigate.health = 10; selfRepair.battle->fighters = {frigate}; enemy(selfRepair, 101, Domain::Naval);
        check(selfRepair.heal(1, 1).ok && find(selfRepair, 1).health == 235, "Frigate can select itself for repairs");
        auto automated = arena(Domain::Naval);
        frigate.health = 100; automated.battle->fighters = {frigate}; enemy(automated, 101, Domain::Naval);
        automated.battle->automatic = true;
        automated.tick(1000);
        check(find(automated, 1).health == 325 && automated.battle->lastAttacks.front().healing == 225,
              "Automatic Frigate can repair a wounded friendly ship");
        automated.tick(2000);
        check(find(automated, 1).strikes == 2 && find(automated, 101).health < 1000,
              "Automatic Frigate alternates repairs with attacks to keep combat moving");
        auto narrowed = arena(Domain::Naval);
        frigate.health = frigate.maxHealth;
        air = troop(narrowed, "aircraft", 101, true); air.phase = Domain::Naval;
        narrowed.battle->fighters = {frigate, air};
        narrowed.normalizeBattleTurn();
        check(narrowed.battle->enemyTurn && !narrowed.battle->finished,
              "Removing obsolete Frigate air targeting yields an unplayable friendly side to the enemy");
        auto blocked = narrowed;
        auto &airFighter = find(blocked, 101); airFighter.type = "fighter_aircraft";
        const int friendlyHealth = find(blocked, 1).health, enemyHealth = airFighter.health;
        blocked.normalizeBattleTurn();
        check(blocked.battle->finished && !blocked.battle->draw && !blocked.battle->victory &&
                  blocked.battle->retreated && blocked.battle->outcomes == std::vector<int>{0} &&
                  find(blocked, 1).health == friendlyHealth && find(blocked, 101).health == enemyHealth,
              "Untargetable armies yield a defender victory without killing either side or leaving a stuck battle");
        auto timed = arena(Domain::Naval);
        timed.battle->fighters = {frigate}; enemy(timed, 101, Domain::Naval);
        timed.battle->automatic = true; timed.battle->pendingMs = 517;
        timed.normalizeBattleTurn();
        check(timed.battle->pendingMs == 517 && !timed.battle->enemyTurn && !find(timed, 1).attacked,
              "Normalizing a ready side preserves automatic attack timing and actions");
        auto stalemate = fresh(); stalemate.researchLevels["infantry"] = 10;
        Unit resilient; resilient.id = stalemate.nextId++; resilient.type = "infantry";
        resilient.health = stalemate.unitHealth(resilient.type); stalemate.units.push_back(resilient);
        check(stalemate.startBattle(std::vector<Id>{resilient.id}, true).ok, "Researched Recruit enters a normal expedition");
        auto strikeFighter = troop(stalemate, "strike_fighter", 101, true);
        strikeFighter.phase = Domain::Land;
        strikeFighter.health = strikeFighter.maxHealth = stalemate.config.enemyHealth *
            stalemate.config.unit("strike_fighter").health / stalemate.config.unit("infantry").health;
        strikeFighter.damage = stalemate.config.enemyDamage * stalemate.config.unit("strike_fighter").damage /
            stalemate.config.unit("infantry").damage;
        stalemate.battle->fighters = {find(stalemate, resilient.id), strikeFighter};
        stalemate.normalizeBattleTurn();
        stalemate.tick(10000);
        check(!stalemate.battle->finished && find(stalemate, resilient.id).health == resilient.health &&
              find(stalemate, 101).health == strikeFighter.maxHealth,
              "Researched Recruit can fully recover from an aircraft it cannot attack");
        const auto resources = stalemate.stock; const auto people = stalemate.civilian;
        stalemate.tick(250000);
        check(stalemate.battle->finished && !stalemate.battle->draw && !stalemate.battle->victory &&
              stalemate.battle->retreated && stalemate.battle->round == 200 &&
              stalemate.battle->outcomes == std::vector<int>{0},
              "Healing stalemates end in a defender victory after 200 rounds");
        check(stalemate.finishBattle().ok && stalemate.stock == resources && stalemate.civilian == people &&
              stalemate.findUnit(resilient.id), "A stalemate returns survivors without granting victory rewards");
        auto lastRoundWin = arena(Domain::Land);
        lastRoundWin.battle->fighters = {troop(lastRoundWin, "infantry", 1)};
        enemy(lastRoundWin, 101, Domain::Land); find(lastRoundWin, 101).health = 1;
        lastRoundWin.battle->round = 200;
        check(lastRoundWin.attack(1, 101).ok && lastRoundWin.battle->victory && !lastRoundWin.battle->draw,
              "Eliminating the enemy at the round limit still awards the normal victory");
        std::cout << "PASS researched shields, end-side Recruit recovery, formation-wide Jeep attacks and targeted Frigate repairs\n";
    } catch (const std::exception &error) {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
