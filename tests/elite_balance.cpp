#include <tuple>
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

Config previousConfig(Config current) {
    auto &raw=current.raw;
    raw.erase("eliteArmyVersion");raw.erase("academyPricingVersion");raw["research"].erase("additionalLevelCostPercent");
    const std::map<std::string,int> damage={{"plasma_tank",180},{"titan_mech",225},{"stealth_cruiser",230}};
    for(auto &u:raw["units"]) {
        const std::string type=u.at("id");
        if(damage.contains(type)) {u["damage"]=damage.at(type);u.erase("enemyBaseDamage");}
        if(type=="titan_mech")u["abilities"]={"energy_shield","periodic_burst"};
        if(type=="stealth_cruiser")u["abilities"]={"stealth"};
        if(type=="phantom_bomber")u["abilities"]={"area_attack","stealth","surface_strike"};
        if(type=="plasma_fighter") {u["abilities"]={"energy_shield","attack_all_air"};u["splashTargets"]=0;u["splashPercent"]=40;u["role"]="Shielded fighter that attacks every opposing aircraft";}
    }
    return Config::parse(raw);
}
int main() {
 try {
    auto base=prepared();
    for(const auto &[type,damage,enemyDamage]:std::vector<std::tuple<std::string,int,int>>{
        {"stealth_cruiser",345,230},{"plasma_tank",360,180},{"titan_mech",506,225}}) {
        check(base.unitDamage(type)==damage && base.config.unit(type).enemyBaseDamage==enemyDamage,"New player attacks preserve enemy baselines");
        base.researchLevels[type]=2;
        check(base.unitDamage(type)==Game::researchStat(damage,2),"Attack buffs compound with Academy research");
    }
    auto titan=prepared();const auto titanId=train(titan,"titan_mech");
    check(titan.startBattle(std::vector<Id>{titanId}).ok,"Titan deploys");const auto titanTargets=enemies(titan);
    check(titan.attack(titanId,titanTargets[0]).ok && !find(titan,titanId).attacked && find(titan,titanId).attacksThisTurn==1,"Titan keeps its second attack");
    titan=roundTrip(titan);auto automatic=titan;automatic.battle->automatic=true;automatic.tick(1000);
    check(automatic.battle->actions==2 && automatic.battle->enemyTurn,"Automatic Titan consumes exactly two attacks");
    check(titan.attack(titanId,titanTargets[1]).ok && find(titan,titanId).attacked && !titan.attack(titanId,titanTargets[2]).ok,"Titan cannot take a third attack");
    titan.tick(5000);
    check(titan.battle->round==2 && !find(titan,titanId).attacked && !find(titan,titanId).attacksThisTurn,"Titan receives both attacks next turn");

    auto plasma=prepared();auto plane=train(plasma,"plasma_fighter");
    check(plasma.startBattle(std::vector<Id>{plane}).ok,"Plasma Fighter deploys");const auto targets=enemies(plasma);
    for(int i=0;i<static_cast<int>(targets.size());++i)find(plasma,targets[i]).pos={7,i};
    find(plasma,targets.back()).type="ship";find(plasma,targets.back()).domain=Domain::Naval;
    const int full=find(plasma,plane).damage;
    check(plasma.attack(plane,targets[0]).ok && plasma.battle->lastAttacks.size()==5,"Plasma hits the full opposing formation across domains and distance");
    for(int i=0;i<5;++i)check(find(plasma,targets[i]).health==100000-(i?full/2:full),"Plasma primary is full and four secondary hits are half");
    plasma=roundTrip(plasma);


    auto cruiser=prepared();auto ship=train(cruiser,"stealth_cruiser");
    check(cruiser.startBattle(std::vector<Id>{ship}).ok,"Cruiser deploys");const auto foes=enemies(cruiser);
    check(cruiser.attack(ship,foes[0]).ok && !find(cruiser,foes[0]).stunnedUntilRound && !cruiser.battle->lastAttacks[0].stunTurns,"Cruiser outgoing attacks no longer stun");
    cruiser.tick(5000);cruiser=roundTrip(cruiser);
    check(cruiser.battle->round==2 && cruiser.battle->lastAttacks[0].attackerStunned,"Incoming enemy hits trigger retaliation");
    for(auto id:foes)check(find(cruiser,id).strikes==1 && find(cruiser,id).stunnedUntilRound==2 && find(cruiser,id).readyRound==3,"Each attacker misses its next turn");
    check(cruiser.attack(ship,foes[0]).ok && cruiser.battle->round==3,"A stunned enemy side skips exactly one full turn");
    for(auto id:foes)check(find(cruiser,id).strikes==1,"Skipped turn cannot produce an enemy attack");
    check(cruiser.attack(ship,foes[0]).ok,"Cruiser acts on the following turn");cruiser.tick(1000);
    check(find(cruiser,foes[0]).strikes==2,"The enemy attacks again after the skipped turn");
    cruiser=roundTrip(cruiser);

    auto bomber=prepared();auto bomberId=train(bomber,"phantom_bomber");
    check(bomber.startBattle(std::vector<Id>{bomberId}).ok,"Bomber deploys");const auto bomberFoes=enemies(bomber);
    for(int i=0;i<5;++i)find(bomber,bomberFoes[i]).pos={7,i};
    check(bomber.attack(bomberId,bomberFoes[2]).ok && bomber.battle->lastAttacks.size()==4,"Bomber keeps its existing area attack");
    for(const auto &hit:bomber.battle->lastAttacks)check(!hit.stunTurns,"Bomber outgoing area damage does not stun");
    bomber.tick(5000);bomber=roundTrip(bomber);
    check(bomber.battle->round==2 && bomber.battle->actions==6,"All five enemies first hit the bomber before being stunned");
    for(auto id:bomberFoes)check(find(bomber,id).stunnedUntilRound==2,"Bomber stuns attackers after receiving their hits");
    auto miss=prepared();const auto missId=train(miss,"stealth_cruiser");
    check(miss.startBattle(std::vector<Id>{missId}).ok,"Miss scenario");const auto missTargets=enemies(miss);
    miss.config.attacksAlwaysHit=false;
    for(auto &d:miss.config.units)if(d.id=="stealth_cruiser")d.accuracy=1;
    Id missed=0;
    for(auto id:missTargets){std::uint64_t roll=missId*6364136223846793005ull+id*1442695040888963407ull+miss.battle->id*31+7919;
        if((roll^(roll>>32))%100>=15){missed=id;break;}}
    check(missed && miss.attack(missId,missed).ok && miss.battle->lastAttacks[0].missed && !miss.battle->lastAttacks[0].stunTurns && !find(miss,missed).stunnedUntilRound,"Misses do not apply stun");

    auto pricing=prepared();const auto academyId=source(pricing,"academy");
    pricing.findBuilding(academyId)->level=9;
    check(pricing.researchCost("plasma_tank")==Stock{3120,10400,4160,1690,0},"Academy9 Plasma Tank first upgrade has an appropriate late-game price");
    pricing.researchLevels["plasma_tank"]=1;
    check(pricing.researchCost("plasma_tank")==Stock{3588,11960,4784,1943,0},"Plasma Tank second upgrade costs 15 percent more");
    pricing.researchLevels["infantry_squad"]=10;
    check(pricing.researchCost("infantry_squad")==Stock{3600,12000,4800,1950,0},"High infantry research is priced comparably to new elite research");
    for(int academyLevel=1;academyLevel<=10;++academyLevel) {
        pricing.findBuilding(academyId)->level=academyLevel;
        for(const auto &d:pricing.config.units) {
            const int cap=pricing.researchLimit(d.id,academyLevel);if(!cap)continue;
            Stock last{};
            for(int rank=0;rank<cap;++rank) {
                pricing.researchLevels[d.id]=rank;const auto cost=pricing.researchCost(d.id);
                check(cost[0]>0 && cost[1]>0,"All research has a positive resource price");
                if(rank)check(cost[0]>last[0] && cost[1]>last[1],"Successive upgrades get more expensive");
                last=cost;
            }
        }
    }
    pricing=prepared();pricing.findBuilding(source(pricing,"academy"))->level=9;
    const auto stock=pricing.stock;const auto cost=pricing.researchCost("plasma_tank");
    check(pricing.startResearch(source(pricing,"academy"),"plasma_tank").ok,"Paid elite research starts");
    for(int n=0;n<5;++n)check(pricing.stock[n]==stock[n]-cost[n],"Only the quoted research price is charged");
    pricing=roundTrip(pricing);

    auto legacy=prepared();const auto currentConfig=legacy.config;legacy.config=previousConfig(legacy.config);
    const auto oldTank=train(legacy,"plasma_tank"),oldTitan=train(legacy,"titan_mech"),oldCruiser=train(legacy,"stealth_cruiser"),oldBomber=train(legacy,"phantom_bomber");
    legacy.researchLevels["plasma_tank"]=2;legacy.researchLevels["titan_mech"]=1;legacy.researchLevels["stealth_cruiser"]=2;
    check(legacy.startResearch(source(legacy,"academy"),"infantry_squad").ok,"Historical paid research starts");
    for(int i=1;i<76;++i)legacy.completedCampaignLevels.insert(i);
    check(legacy.startCampaignBattle(76,{oldTank,oldTitan,oldCruiser,oldBomber}).ok,"Historical campaign starts");
    auto campaignFoes=enemies(legacy);
    find(legacy,oldTank).health-=17;find(legacy,oldTank).shield-=11;
    check(legacy.attack(oldTitan,campaignFoes[0]).ok,"Historical Titan attacks once");
    const auto historical=legacy.serialize();
    auto migrated=decodeSave(currentConfig,encodeSave(legacy));
    check(migrated.stock==legacy.stock && migrated.completedCampaignLevels==legacy.completedCampaignLevels &&
        migrated.research.front().remainingMs==legacy.research.front().remainingMs && migrated.battle->actions==legacy.battle->actions,"Migrations preserve paid progress, clocks and actions");
    check(find(migrated,oldTank).health==find(legacy,oldTank).health && find(migrated,oldTank).shield==find(legacy,oldTank).shield &&
        find(migrated,oldTank).damage==migrated.unitDamage("plasma_tank"),"Migration updates active attack without changing health or shield");
    check(find(migrated,oldTitan).attacked && migrated.attacksPerTurn(find(migrated,oldTitan))==2,"Previously spent Titan action is preserved until next turn");
    for(const auto &f:migrated.battle->fighters)if(f.enemy)check(f.damage==find(legacy,f.id).damage,"Enemy attacks are unchanged by player buffs");
    for(const auto &f:migrated.battle->campaignArmy)if(f.id==oldCruiser)check(f.damage==migrated.unitDamage("stealth_cruiser"),"Future campaign rounds receive the increased cruiser attack");
    check(migrated.serialize().at("battle").at("lastAttacks")==historical.at("battle").at("lastAttacks"),"Historical attack logs are not recalculated");
    auto once=migrated.serialize();once.erase("savedAtUTC");migrated=roundTrip(migrated);auto twice=migrated.serialize();twice.erase("savedAtUTC");
    check(once==twice,"Reopening a migrated save does not repeat the buffs");
    auto forged=historical;for(auto &u:forged["config"]["units"])if(u.at("id")=="plasma_tank")u["damage"]=181;
    bool rejected=false;try{Game::deserialize(currentConfig,forged);}catch(...){rejected=true;}
    check(rejected,"Migration rejects unknown historical damage values");
    std::cout<<"PASS elite attacks, Titan actions, Plasma splash, one-turn stun, Academy prices and strict historical migration\n";
 } catch(const std::exception &e){std::cerr<<e.what()<<"\n";return 1;}
}
