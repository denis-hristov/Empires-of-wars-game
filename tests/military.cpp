#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include "PopulationSetup.hpp"
#include <algorithm>
#include <fstream>
#include <iostream>
using namespace kingdom;
void check(bool ok, const std::string &why) { if (!ok) throw std::runtime_error(why); }
Id source(const Game &g, const std::string &type) { for (const auto &b : g.buildings) if (b.type == type) return b.id; throw std::runtime_error("No source"); }
Id addBuilding(Game &g, const std::string &type) {
    for (int y = 0; y < g.world.height; ++y) for (int x = 0; x < g.world.width; ++x)
        if (g.canPlace(type, {x,y}).ok) {
            check(g.place(type,{x,y}).ok,"place " + type);
            Id id = g.buildings.back().id;
            g.tick(6000); return id;
        }
    throw std::runtime_error("No plot " + type);
}
Game prepared() {
    auto spacious = Config::load(KINGDOM_CONFIG).raw; spacious["world"]["width"] = 72; spacious["world"]["height"] = 72;
    Game g(Config::parse(spacious)); g.newGame(7319); g.stock.fill(1'000'000);
    g.buildings.front().level = 10;
    g.findBuilding(addBuilding(g,"house"))->level = 5;
    for (auto type : {"barracks","harbor","airbase"}) g.findBuilding(addBuilding(g,type))->level = 10;
    test_support::population(g,160);
    g.civilian = 0;
    g.validate(); return g;
}
Id train(Game &g, const std::string &type) {
    const auto &d = g.config.unit(type); auto b = source(g,d.building);
    auto r = g.train(b,type); check(r.ok,r.message);
    g.tick(d.seconds*1000);
    check(g.units.back().type == type,"completed " + type);
    Id id = g.units.back().id;
    bool relocated = false;
    for (int y = g.world.height - 1; y >= 0 && !relocated; --y)
        for (int x = g.world.width - 1; x >= 0 && !relocated; --x)
            relocated = g.moveUnit(id, {x,y}).ok;
    return id;
}
Game roundTrip(const Game &g) { auto copy = decodeSave(g.config,encodeSave(g)); copy.validate(); return copy; }
int main(int argc, char **argv) {
    try {
        auto spacious = Config::load(KINGDOM_CONFIG).raw; spacious["world"]["width"] = 72; spacious["world"]["height"] = 72;
        auto progression = Game(Config::parse(spacious));
        progression.newGame(7319); progression.stock.fill(1'000'000);
        auto trainingBuilding = addBuilding(progression, "barracks");
        for (int next = 2; next <= 10; ++next) {
            while (progression.buildingLimit("barracks") < next) {
                auto paid = progression.stock;
                check(!progression.upgrade(trainingBuilding).ok && progression.stock == paid, "Town Hall dependency is atomic through tier ten");
                auto develop = [&](const std::string &type, int target) {
                    Id entity = 0;
                    for (const auto &b : progression.buildings) if (b.type == type) entity = b.id;
                    if (!entity) entity = addBuilding(progression,type);
                    while (progression.findBuilding(entity)->level < target) {
                        int current = progression.findBuilding(entity)->level;
                        check(progression.upgrade(entity).ok,"Town Hall economy prerequisite");
                        progression.tick(progression.config.building(type).levels[current].seconds*1000);
                    }
                };
                for (const auto &type : {"farm", "lumberyard"}) develop(type,progression.buildingLimit(type));
                if (next == 4) develop("stone",2);
                if (next == 6) develop("iron",2);
                auto hall = progression.buildings.front().id;
                test_support::population(progression, progression.config.building("townhall").levels[next-1].population);
                check(progression.upgrade(hall).ok, "Town Hall progression");
                progression.tick(progression.config.building("townhall").levels[next-2].seconds * 1000 + 100000);
            }
            check(progression.upgrade(trainingBuilding).ok, "military building progression");
            progression.tick(progression.config.building("barracks").levels[next-1].seconds * 1000);
            check(progression.findBuilding(trainingBuilding)->level == next, "completed military upgrade");
        }
        progression.validate();
        std::cout << "PASS Town Hall dependencies and military upgrades through tier ten\n";
        auto g = prepared();
        for (auto category : {Domain::Land,Domain::Naval,Domain::Air}) {
            int expected = 1;
            for (const auto &d : g.config.units) if (d.domain == category) {
                check(d.level == expected++,"catalog order"); train(g,d.id);
            }
            check(expected == 11,"exactly ten units per category");
        }
        check(g.units.size()==30,"thirty trained entities");
        g = roundTrip(g);
        std::cout << "PASS all thirty types train, deploy and round trip\n";
        for (const auto &u : g.units) {
            auto duel = g;
            check(duel.startBattle(std::vector<Id>{u.id},true).ok,"all types enter combat");
            duel.tick(1'000'000);
            check(duel.battle->finished,"all types finish combat without deadlock: " + u.type);
            duel = roundTrip(duel);
            check(duel.finishBattle().ok,"combat casualties commit");
            duel.validate();
        }
        std::cout << "PASS all thirty types fight and preserve completed combat saves\n";
        auto unitId = [&](const std::string &type) { for (const auto &u : g.units) if(u.type==type) return u.id; throw std::runtime_error("missing unit"); };
        auto durable = [](Game &game) {
            for (auto &f : game.battle->fighters) {
                f.health = f.maxHealth = 100000;
                f.damage = 1; f.defense = 0; f.shield = 0;
            }
        };
        auto combatSnapshot = [](const Game &game) {
            auto saved = game.serialize(); saved.erase("savedAtUTC"); return saved;
        };
        auto targeting = g;
        check(targeting.startBattle(std::vector<Id>{unitId("infantry"), unitId("infantry_squad"), unitId("heavy_infantry")}, true).ok,
              "multiple friendly targets for independent enemy choices");
        durable(targeting);
        std::vector<Id> targetingEnemies;
        for (auto &f : targeting.battle->fighters) if (f.enemy) {
            f.type = "raider"; f.domain = Domain::Land;
            targetingEnemies.push_back(f.id);
        }
        targeting.validate();
        check(targetingEnemies.size() >= 2, "targeting regression needs independent enemy attackers");
        auto friendlyAuto = targeting;
        for (auto &f : friendlyAuto.battle->fighters) if (f.id == targetingEnemies.front()) f.health = 1000;
        auto friendlyManual = friendlyAuto;
        friendlyAuto.tick(1000);
        check(friendlyAuto.battle->lastAttacks.front().target == targetingEnemies.front(),
              "friendly automatic targeting still prefers the weakest weighted enemy");
        check(friendlyManual.automateBattle().ok, "manual targeting mode remains available");
        check(friendlyManual.attack(unitId("infantry"), targetingEnemies.back()).ok &&
              friendlyManual.battle->lastAttacks.front().target == targetingEnemies.back(),
              "friendly manual targeting retains the player's chosen enemy");
        std::map<Id, std::set<Id>> enemyChoices;
        std::map<int, std::set<Id>> roundChoices;
        std::map<Id, int> enemyAttacks;
        for (int action = 0; action < 150; ++action) {
            const int round = targeting.battle->round;
            const int before = targeting.battle->actions;
            targeting.tick(1000);
            check(!targeting.battle->finished && targeting.battle->actions == before + 1,
                  "each available fighter attacks once at the existing delay");
            const auto &hit = targeting.battle->lastAttacks.front();
            if (std::find(targetingEnemies.begin(), targetingEnemies.end(), hit.attacker) != targetingEnemies.end()) {
                enemyChoices[hit.attacker].insert(hit.target);
                roundChoices[round].insert(hit.target);
                ++enemyAttacks[hit.attacker];
            }
        }
        for (Id enemyId : targetingEnemies)
            check(enemyAttacks[enemyId] >= 20 && enemyChoices[enemyId].size() > 1,
                  "every enemy independently varies its target across repeated attacks");
        check(std::any_of(roundChoices.begin(), roundChoices.end(), [](const auto &choices) { return choices.second.size() > 1; }),
              "enemies can choose different targets within the same turn");
        targeting.tick(375);
        auto targetingReloaded = roundTrip(targeting);
        for (int delta : {625, 250, 750, 1000, 4000, 500, 500, 10000}) {
            targeting.tick(delta); targetingReloaded.tick(delta);
            check(combatSnapshot(targeting) == combatSnapshot(targetingReloaded),
                  "save reload preserves subsequent random choices, hits, timing and battle state");
        }
        auto restricted = g;
        const auto visibleShip = unitId("ship"), hiddenSubmarine = unitId("attack_submarine");
        const auto navalSupport = unitId("aircraft"), deadEscort = unitId("frigate"), futurePlane = unitId("jet_fighter");
        check(restricted.startBattle(std::vector<Id>{visibleShip, hiddenSubmarine, navalSupport, deadEscort, futurePlane}, true,
                                    {{navalSupport, Domain::Naval}}).ok,
              "enemy candidates include visible, submerged, dead, wrong-domain and later-phase units");
        durable(restricted);
        for (auto &f : restricted.battle->fighters) {
            if (f.enemy && f.phase == Domain::Naval) { f.type = "ship"; f.domain = Domain::Naval; }
            if (f.id == deadEscort) f.health = 0;
        }
        restricted = roundTrip(restricted);
        int restrictedEnemyAttacks = 0;
        for (int action = 0; action < 60; ++action) {
            restricted.tick(1000);
            check(!restricted.battle->finished && restricted.battle->domain == Domain::Naval,
                  "restricted targeting stays in the current naval phase");
            const auto &hit = restricted.battle->lastAttacks.front();
            auto attacker = std::find_if(restricted.battle->fighters.begin(), restricted.battle->fighters.end(),
                                         [&](const auto &f) { return f.id == hit.attacker; });
            if (attacker->enemy) {
                ++restrictedEnemyAttacks;
                check(hit.target == visibleShip,
                      "enemy selects the sole valid living target, excluding dead, submerged, wrong-domain and later-phase units");
            }
        }
        check(restrictedEnemyAttacks >= 20, "single eligible target works across repeated independent enemy attacks");
        std::cout << "PASS independent random enemy targets, target restrictions, deterministic reload and friendly targeting\n";
        auto splash = g;
        auto launcher = unitId("missile_launcher");
        check(splash.startBattle(std::vector<Id>{launcher}).ok, "area attack battle");
        std::vector<Id> splashTargets;
        for (auto &f : splash.battle->fighters) if (f.enemy) { f.type="infantry"; f.domain=Domain::Land; f.shield=0; f.health=f.maxHealth=900; f.pos.y=static_cast<int>(splashTargets.size()); splashTargets.push_back(f.id); }
        check(splash.attack(launcher, splashTargets.front()).ok && splash.battle->lastAttacks.size()==2, "area attack hits adjacent second target");
        check(splash.battle->lastAttacks[1].damage > 0, "area damage is applied");
        splash=roundTrip(splash);
        auto shielded=g;
        auto plasma=unitId("plasma_tank");
        check(shielded.startBattle(std::vector<Id>{plasma},true).ok,"shield battle");
        bool absorbed=false;
        for(int i=0;i<500 && !shielded.battle->finished;++i){shielded.tick(1000);for(auto hit:shielded.battle->lastAttacks)absorbed|=hit.shieldDamage>0;}
        check(absorbed,"energy shields absorb incoming damage");
        auto stealth=g;
        auto patrol=unitId("ship");
        check(stealth.startBattle(std::vector<Id>{patrol}).ok,"submarine target validation");
        for(auto &f:stealth.battle->fighters)if(f.enemy){f.type="attack_submarine";f.domain=Domain::Naval;f.shield=0;}
        check(!stealth.validBattleTargets(patrol).empty(),"visible enemy submarines can be attacked without a hidden detector requirement");
        auto detected=g;
        auto frigate=unitId("frigate");
        check(detected.startBattle(std::vector<Id>{frigate}).ok,"escort detection");
        for(auto &f:detected.battle->fighters)if(f.enemy){f.type="attack_submarine";f.domain=Domain::Naval;f.shield=0;}
        check(!detected.validBattleTargets(frigate).empty(),"frigate detects and counters submarines");
        std::cout << "PASS area damage, shield absorption and submarine detection\n";
        auto barracks = source(g,"barracks");
        auto before = g.stock; auto civilians = g.civilian;
        check(g.train(barracks,"infantry").ok,"queue squad");
        check(g.reserved()==4 && g.civilian==civilians,"reserve four people as one squad");
        check(g.cancelTraining(barracks,0).ok && g.stock==before && g.reserved()==0,"exact refund and reservation release");
        check(!g.cancelTraining(barracks,0).ok && g.stock==before,"no double refund");
        for (const auto &buildingType : {"barracks", "harbor", "airbase"}) {
            auto cumulative = prepared();
            auto producer = source(cumulative, buildingType);
            cumulative.findBuilding(producer)->level = 1;
            for (int tier = 1; tier <= 10; ++tier) {
                if (tier > 1) {
                    check(cumulative.upgrade(producer).ok, "upgrade military building");
                    cumulative.tick(cumulative.config.building(buildingType).levels[tier - 1].seconds * 1000);
                }
                check(cumulative.findBuilding(producer)->level == tier, "completed cumulative upgrade");
                int available = 0;
                for (const auto &def : cumulative.config.units) {
                    if (def.building != buildingType) continue;
                    auto unchanged = cumulative.serialize();
                    unchanged.erase("savedAtUTC");
                    auto result = cumulative.train(producer, def.id);
                    if (def.level <= tier) {
                        check(result.ok, "all earlier tiers remain trainable after upgrade: " + def.id);
                        check(cumulative.reserved() == def.people, "correct crew reserved for earlier unit");
                        check(cumulative.cancelTraining(producer, 0).ok, "release cumulative training task");
                        ++available;
                    } else {
                        check(!result.ok, "future tiers remain locked: " + def.id);
                    }
                    auto after = cumulative.serialize();
                    after.erase("savedAtUTC");
                    check(after == unchanged, "unlocked training refunds and rejected future training preserve state");
                }
                check(available == tier, "tier N exposes every unit from 1 through N");
                cumulative = roundTrip(cumulative);
            }
        }
        std::cout << "PASS cumulative training for all three buildings after every upgrade and save reload\n";
        auto typeId=[&](const std::string &type){for(const auto &u:g.units)if(u.type==type)return u.id;throw std::runtime_error("missing type");};
        auto light=typeId("light_aircraft_carrier"), titan=typeId("titan_carrier");
        auto recon=typeId("aircraft"), fighter=typeId("fighter_aircraft"), attack=typeId("attack_aircraft"), jet=typeId("jet_fighter");
        auto oldPos=g.findUnit(recon)->pos;
        check(!g.embark(jet,light).ok,"tier four rejected");
        check(g.embark(recon,light).ok && g.embark(fighter,light).ok,"two aircraft embark");
        check(!g.world.at(oldPos).occupant,"embarked aircraft frees map tile");
        check(!g.embark(attack,light).ok && !g.embark(recon,titan).ok,"capacity and duplicate assignment rejected");
        check(!g.moveUnit(recon,oldPos).ok,"embarked aircraft cannot move independently");
        g=roundTrip(g);
        check(!g.startBattle(std::vector<Id>{light,recon}).ok,"embarked plane cannot also join air army");
        check(g.startBattle(std::vector<Id>{light},true).ok,"carrier expedition");
        check(std::count_if(g.battle->fighters.begin(),g.battle->fighters.end(),[](const auto &f){return !f.enemy && f.domain==Domain::Air && f.phase==Domain::Naval;})==2,"carrier retains aircraft snapshots in the naval phase");
        g=roundTrip(g);
        for(auto &f:g.battle->fighters) { if(f.id==light) f.health=1; f.damage=f.enemy?10000:1; }
        g.tick(20000);
        check(g.battle->finished,"carrier battle terminates");
        for(const auto &f:g.battle->fighters)if(!f.enemy)check(f.health==0,"carrier loss destroys attached aircraft immediately");
        check(g.finishBattle().ok && !g.findUnit(light) && !g.findUnit(recon) && !g.findUnit(fighter),"centralized loss removes carrier and aircraft once");
        g=roundTrip(g);
        std::cout << "PASS queue refunds, tier locks, capacity, unique aircraft and carrier casualties\n";
        auto more1=train(g,"aircraft"),more2=train(g,"fighter_aircraft"),more3=train(g,"aircraft"),more4=train(g,"fighter_aircraft");
        for(auto id:{more1,more2,more3,more4})check(g.embark(id,titan).ok,"four titan slots");
        check(g.embark(attack,titan).ok,"fifth titan aircraft accepted");
        auto sixth=train(g,"jet_fighter");
        check(!g.embark(sixth,titan).ok,"sixth titan aircraft rejected");
        check(g.disembark(more4).ok && !g.findUnit(more4)->carrier,"unload retains identity");
        check(g.disembark(attack).ok,"unload attack aircraft for surface mission");
        g=roundTrip(g);
        auto preserved=g;
        preserved.config.destroyEmbarkedAircraft=false;
        preserved.destroyUnit(titan);
        for(auto id:{more1,more2,more3})check(preserved.findUnit(id) && preserved.findUnit(id)->reserve,"configurable aircraft survival");
        preserved.tick(50); preserved.validate();
        std::cout << "PASS titan capacity, unloading and configurable loss policy\n";
        auto land=typeId("heavy_tank");
        check(!g.startBattle(std::vector<Id>{land},false,{{land,Domain::Naval}}).ok,"non-air mission rejected");
        check(g.startBattle(std::vector<Id>{land,attack},false,{{attack,Domain::Land}}).ok,"air support mission");
        check(g.battle->phases.size()==1,"support plane has exactly one battle phase");
        auto invalidTarget=std::find_if(g.battle->fighters.begin(),g.battle->fighters.end(),[](const auto &f){return f.enemy && f.domain==Domain::Air;});
        check(invalidTarget!=g.battle->fighters.end(),"heavy armor has an air counter");
        auto snapshot=g.serialize();
        check(!g.attack(land,invalidTarget->id).ok && snapshot==g.serialize(),"tank cannot attack aircraft or mutate state on rejection");
        auto targets=g.validBattleTargets(attack);
        check(std::find(targets.begin(),targets.end(),invalidTarget->id)!=targets.end(),"support aircraft can counter hostile aviation");
        g=roundTrip(g);check(g.automateBattle().ok,"auto support");g.tick(500000);check(g.battle->finished,"mixed battle completes");check(g.finishBattle().ok,"return mixed army");g.validate();
        std::cout << "PASS weapon target restrictions and air support round trip\n";
        // A standalone submarine cannot be hit by a patrol boat without detection.
        auto subGame=prepared();auto sub=train(subGame,"attack_submarine");
        check(subGame.startBattle(std::vector<Id>{sub}).ok,"submarine battle");
        auto enemy=std::find_if(subGame.battle->fighters.begin(),subGame.battle->fighters.end(),[](const auto &f){return f.enemy;});
        enemy->type="ship";enemy->domain=Domain::Naval;enemy->shield=0;
        subGame=roundTrip(subGame);
        std::cout << "PASS submerged units and stealth state validate\n";
        if(argc>1){auto fixture=prepared();auto c=train(fixture,"titan_carrier");auto a=train(fixture,"aircraft");train(fixture,"fighter_aircraft");train(fixture,"attack_aircraft");train(fixture,"jet_fighter");train(fixture,"plasma_tank");train(fixture,"missile_launcher");train(fixture,"phantom_bomber");fixture.embark(a,c);std::ofstream out(argv[1]);out<<encodeSave(fixture);}
        return 0;
    } catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
