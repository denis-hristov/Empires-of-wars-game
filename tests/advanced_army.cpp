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
    for (auto type : {"barracks","harbor","airbase","academy"}) g.findBuilding(addBuilding(g,type))->level = 10;
    g.tick(120000);
    g.config.enemies=5;
    g.config.raw["battle"]["enemies"]=5;
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

Fighter &find(Game &g, Id id) {
    return *std::find_if(g.battle->fighters.begin(), g.battle->fighters.end(), [&](const auto &f) { return f.id == id; });
}
std::vector<Id> enemies(Game &g) {
    std::vector<Id> ids;
    for (auto &f : g.battle->fighters) if (f.enemy) {
        f.health = f.maxHealth = 100000; f.shield = f.defense = 0; f.damage = 1;
        ids.push_back(f.id);
    }
    return ids;
}
int main() {
    try {
        auto launcher = prepared(); auto missile = train(launcher,"missile_launcher");
        check(launcher.startBattle(std::vector<Id>{missile}).ok,"Deploy launcher");
        const auto targets = enemies(launcher);
        for (int i=0; i<static_cast<int>(targets.size()); ++i) find(launcher,targets[i]).pos = {7,i};
        find(launcher,targets.back()).type = "aircraft"; find(launcher,targets.back()).domain = Domain::Air;
        const int damage = find(launcher,missile).damage;
        find(launcher,targets[1]).potionShield = 0;
        find(launcher,targets[2]).shield = 20;
        check(launcher.attack(missile,targets.front()).ok,"Missile fires");
        check(launcher.battle->lastAttacks.size() == targets.size(),"Missile hits every enemy including distant aircraft");
        for (int i=0;i<static_cast<int>(targets.size());++i)
            check(find(launcher,targets[i]).health == 100000 - (i==2 ? 0 : i==0 ? damage : damage/2),"Full primary and half secondary damage with per-target shield protection");
        launcher=roundTrip(launcher);

        auto drone = prepared(); auto droneId = train(drone,"combat_drone");
        check(drone.startBattle(std::vector<Id>{droneId}).ok,"Deploy drone");
        const auto airTargets=enemies(drone);
        const int droneDamage=find(drone,droneId).damage;
        check(drone.attack(droneId,airTargets[0]).ok && !find(drone,droneId).attacked &&
            find(drone,droneId).attacksThisTurn==1 && !drone.battle->enemyTurn,"Drone keeps a second attack");
        auto droneAuto=roundTrip(drone); droneAuto.battle->automatic=true; droneAuto.tick(1000);
        check(droneAuto.battle->actions==2 && droneAuto.battle->enemyTurn,"Automatic drone consumes its remaining second attack");
        drone=roundTrip(drone);
        check(drone.attack(droneId,airTargets[1]).ok && find(drone,droneId).attacked &&
            drone.battle->enemyTurn && !drone.attack(droneId,airTargets[2]).ok,"Drone chooses a different second target and cannot attack a third time");
        check(find(drone,airTargets[0]).health==100000-droneDamage && find(drone,airTargets[1]).health==100000-droneDamage,"Both drone attacks deal normal damage");
        drone.tick(5000);
        check(drone.battle->round==2 && !drone.battle->enemyTurn && !find(drone,droneId).attacksThisTurn,"Drone receives two new attacks next turn");
        drone.battle->doubleAttack=true;
        check(drone.attack(droneId,airTargets[0]).ok && drone.battle->lastAttacks[0].damage==droneDamage*2,"Attack potion doubles the first drone hit");
        check(drone.attack(droneId,airTargets[0]).ok && drone.battle->lastAttacks[0].damage==droneDamage*2 && !drone.battle->doubleAttack,"Attack potion also doubles the second hit and expires normally");

        auto carrier = prepared(); auto light=train(carrier,"light_aircraft_carrier");
        auto recon=train(carrier,"aircraft"), fighter=train(carrier,"fighter_aircraft"), attack=train(carrier,"attack_aircraft"),jet=train(carrier,"jet_fighter");
        check(!carrier.embark(jet,light).ok && carrier.embark(recon,light).ok && carrier.embark(fighter,light).ok && !carrier.embark(attack,light).ok,"Light carrier accepts only two eligible aircraft");
        carrier.researchLevels["aircraft"]=2;
        carrier.technologies.insert("naval");
        carrier.technologies.insert("aviation");
        check(carrier.startBattle(std::vector<Id>{light}).ok,"Deploy loaded light carrier");
        const auto seaTargets=enemies(carrier);
        find(carrier,seaTargets.back()).type="aircraft"; find(carrier,seaTargets.back()).domain=Domain::Air;
        const int seaDamage=find(carrier,recon).damage,airDamage=seaDamage+find(carrier,fighter).damage;
        check(carrier.fighterAttackDamage(find(carrier,light),Domain::Naval)==airDamage && carrier.fighterAttackDamage(find(carrier,light),Domain::Air)==airDamage,"Carrier derives domain-specific damage from researched and upgraded aircraft");
        check(carrier.validBattleTargets(recon).empty() && !carrier.attack(recon,seaTargets[0]).ok,"Cargo cannot attack independently");
        check(carrier.attack(light,seaTargets[0]).ok && carrier.battle->lastAttacks.size()==1 && carrier.battle->lastAttacks[0].damage==airDamage && carrier.battle->enemyTurn,"Carrier uses its aircraft once without adding hull damage");
        carrier=roundTrip(carrier);
        carrier.tick(5000);
        check(carrier.attack(light,seaTargets.back()).ok && carrier.battle->lastAttacks[0].damage==airDamage,"All loaded fighters join carrier attacks against ships and aircraft");
        auto empty=prepared(); auto emptyId=train(empty,"light_aircraft_carrier");
        check(empty.startBattle(std::vector<Id>{emptyId}).ok && empty.validBattleTargets(emptyId).empty(),"Empty carriers have no attack");

        auto titan=prepared(); auto titanId=train(titan,"titan_carrier");
        for (auto type : {"aircraft","fighter_aircraft","attack_aircraft","jet_fighter","jet_fighter"}) {
            auto plane=train(titan,type); check(titan.embark(plane,titanId).ok,"Titan accepts five aircraft including jets");
        }
        auto sixth=train(titan,"aircraft");
        check(!titan.embark(sixth,titanId).ok,"Titan rejects a sixth aircraft");
        titan=roundTrip(titan);
        for(int i=1;i<32;++i)titan.completedCampaignLevels.insert(i);
        auto landId=train(titan,"infantry_squad");
        check(titan.startCampaignBattle(32,{titanId,landId}).ok,"Carrier enters campaign");
        for(auto &f:titan.battle->fighters)if(f.enemy)f.health=f.shield=0;
        titan.normalizeBattleTurn();
        check(titan.battle->fighters.size()==titan.campaignLevelDefinition(32).at("rounds")[1].at("enemies").size()+6,"Campaign includes all five cargo snapshots");
        titan=roundTrip(titan);
        auto sea=enemies(titan);
        const auto payload=titan.fighterAttackDamage(find(titan,titanId),Domain::Naval);
        check(payload>0 && titan.attack(titanId,sea[0]).ok && titan.battle->lastAttacks[0].damage==payload,"Campaign carrier attacks with loaded aircraft");
        titan.destroyUnit(titanId,true);
        for(const auto &f:titan.battle->fighters)if(f.carrier==titanId)check(f.health==0,"Sinking destroys carrier aircraft");
        titan.normalizeBattleTurn(); titan=roundTrip(titan);
        check(titan.finishBattle().ok && !titan.findUnit(titanId),"Campaign carrier casualty returns and saves correctly");
        auto legacy=prepared();
        auto carrierId=train(legacy,"light_aircraft_carrier"), planeId=train(legacy,"attack_aircraft"), soldierId=train(legacy,"infantry_squad");
        check(legacy.embark(planeId,carrierId).ok,"Prepare legacy cargo");
        const auto currentConfig=legacy.config;
        auto previous=currentConfig.raw; previous.erase("armyAbilitiesVersion");
        for(auto &u:previous["units"]) {
            if(u.at("id")=="missile_launcher") {u["abilities"]={"area_attack"};u["splashTargets"]=3;u["validTargets"]={"land"};}
            if(u.at("id")=="combat_drone")u["abilities"]={"surface_strike","precision"};
            if(u.at("id")=="titan_carrier") {u["carrierSlots"]=4;u["allowedAircraftTiers"]={1,2,3};}
        }
        legacy.config=Config::parse(previous);
        for(int i=1;i<32;++i)legacy.completedCampaignLevels.insert(i);
        check(legacy.startCampaignBattle(32,{carrierId,soldierId}).ok,"Start historical campaign");
        check(legacy.battle->campaignArmy.size()==2,"Historical campaign omitted cargo");
        auto migrated=decodeSave(currentConfig,encodeSave(legacy));
        check(migrated.battle->campaignArmy.size()==3 && migrated.battle->actions==legacy.battle->actions &&
            migrated.stock==legacy.stock && migrated.completedCampaignLevels==legacy.completedCampaignLevels,"Migration adds committed aircraft while preserving progress and actions");
        for(auto &f:migrated.battle->fighters)if(f.enemy)f.health=f.shield=0;
        migrated.normalizeBattleTurn();
        check(find(migrated,planeId).carrier==carrierId && migrated.fighterAttackDamage(find(migrated,carrierId),Domain::Naval)>0,"Migrated aircraft join the next naval round");
        migrated=roundTrip(migrated);
        std::cout << "PASS global missile splash, two drone actions, save continuity, carrier payload and campaign casualties\n";
    } catch(const std::exception &e) { std::cerr << e.what()<<"\n";return 1; }
}
