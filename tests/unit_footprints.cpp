#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include "PopulationSetup.hpp"
#include <algorithm>
#include <fstream>
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
void check(bool ok, const std::string &why) { if (!ok) throw std::runtime_error(why); }
Json snapshot(const Game &g) { auto j = g.serialize(); j.erase("savedAtUTC"); return j; }
Id source(const Game &g, const std::string &type) {
    for (const auto &b : g.buildings) if (b.type == type) return b.id;
    throw std::runtime_error("Missing source " + type);
}
Id build(Game &g, const std::string &type) {
    for (int y = 0; y < g.world.height; ++y) for (int x = 0; x < g.world.width; ++x)
        if (g.canPlace(type, {x,y}).ok) {
            check(g.place(type, {x,y}).ok, "Build " + type);
            auto id = g.buildings.back().id;
            g.tick(g.config.building(type).levels.front().seconds * 1000);
            return id;
        }
    throw std::runtime_error("No plot for " + type);
}
Game prepared(Config config) {
    Game g(std::move(config)); g.newGame(7319); g.stock.fill(1000000);
    g.buildings.front().level = 10;
    g.findBuilding(build(g, "house"))->level = 5;
    test_support::population(g,160);
    for (auto type : {"barracks", "harbor", "airbase", "academy"}) g.findBuilding(build(g, type))->level = 10;
    g.validate(); return g;
}
Config previous(const Config &current) {
    auto raw = current.raw; raw.erase("unitFootprintVersion");
    for (auto &u : raw["units"]) u.erase("footprint");
    return Config::parse(raw);
}
bool terrain(const Game &g, const UnitDef &d, Pos p) {
    if (!g.world.contains(p)) return false;
    auto t = g.world.at(p).terrain;
    return d.domain == Domain::Naval ? t == Terrain::Water : t == Terrain::Grass || t == Terrain::Sand;
}
Pos plot(const Game &g, const UnitDef &d) {
    for (int y = 0; y < g.world.height; ++y) for (int x = 0; x < g.world.width; ++x)
        if (g.canPlaceUnit(d, {x,y})) return {x,y};
    throw std::runtime_error("No troop plot for " + d.id);
}
Id add(Game &g, const std::string &type, Pos p) {
    const auto &d = g.config.unit(type);
    check(g.canPlaceUnit(d,p), "Fixture unit has a legal full footprint");
    Unit u; u.id = g.nextId++; u.type = type; u.source = source(g,d.building); u.pos = p; u.health = g.unitHealth(type);
    g.units.push_back(u); g.occupyUnit(u,u.id); return u.id;
}
void occupies(const Game &g, Id id, int expected) {
    check(std::count_if(g.world.tiles.begin(),g.world.tiles.end(),[&](const auto &t){return t.occupant==id;}) == expected,
          "Unit occupies exactly " + std::to_string(expected) + " tiles");
}
void rejected(const Config &config, const Json &j, const std::string &why) {
    bool failed=false; try { Game::deserialize(config,j); } catch (...) { failed=true; }
    check(failed,why);
}
bool adjacent(const Building &b, const BuildingDef &bd, Pos p, const UnitDef &d) {
    return ((p.x+d.width==b.pos.x || p.x==b.pos.x+bd.width) && p.y<b.pos.y+bd.height && p.y+d.height>b.pos.y) ||
           ((p.y+d.height==b.pos.y || p.y==b.pos.y+bd.height) && p.x<b.pos.x+bd.width && p.x+d.width>b.pos.x);
}
void catalogAndPlacement(const Config &config) {
    check(config.units.size()==30,"All thirty troop types have footprints");
    for (const auto &d : config.units) check(d.width==1 && d.height==(d.level>=4?2:1),"Only tiers four through ten expand");
    auto g=prepared(config);
    for (auto type : {"armored_jeep","frigate","jet_fighter"}) {
        const auto &d=g.config.unit(type); auto p=plot(g,d);
        auto second=Pos{p.x,p.y+1};
        g.world.at(second).occupant=g.buildings.front().id;
        check(!g.canPlaceUnit(d,p),"A building in the second cell blocks the whole footprint");
        g.world.at(second).occupant=0;
        auto blocker=add(g,d.domain==Domain::Naval?"ship":"infantry",second);
        check(!g.canPlaceUnit(d,p),"A troop in the second cell blocks placement");
        g.destroyUnit(blocker);
        auto savedTerrain=g.world.at(second).terrain;
        g.world.at(second).terrain=d.domain==Domain::Naval?Terrain::Grass:Terrain::Water;
        check(!g.canPlaceUnit(d,p),"The second cell must have the correct terrain");
        g.world.at(second).terrain=savedTerrain;
        auto id=add(g,type,p); occupies(g,id,2);
        check(g.canPlaceUnit(d,p,id),"A troop can overlap its own footprint when moving");
        auto broken=g; broken.world.at(second).occupant=0;
        bool invalid=false;try{broken.validate();}catch(...){invalid=true;}
        check(invalid,"Validation detects a missing second occupied cell");
        g.destroyUnit(id); occupies(g,id,0);
        check(!g.canPlaceUnit(d,{p.x,g.world.height-1}),"A two-cell troop cannot extend off the map");
    }
    g.validate();
}
void movement(const Config &config) {
    auto g=prepared(config);
    for (auto &tile:g.world.tiles) tile={Terrain::Forest,0};
    for(int y=1;y<=5;++y) for(int x : {1,2,3,7,8,9}) g.world.at({x,y}).terrain=Terrain::Grass;
    for(int x=4;x<=6;++x)g.world.at({x,3}).terrain=Terrain::Grass;
    auto id=add(g,"armored_jeep",{2,2});
    auto before=g.units.front().pos;
    auto unchanged=snapshot(g);
    auto preview=g.canMoveUnit(id,{7,2});
    check(!preview.ok && preview.message=="No clear path" && snapshot(g)==unchanged,"Preview rejects disconnected space without moving or changing occupancy");
    check(!g.moveUnit(id,{7,2}).ok && g.findUnit(id)->pos==before,"A two-cell troop cannot pass through a one-cell-high corridor");
    occupies(g,id,2);
    for(int x=4;x<=6;++x)g.world.at({x,4}).terrain=Terrain::Grass;
    unchanged=snapshot(g);
    check(g.canMoveUnit(id,{7,2}).ok && snapshot(g)==unchanged,"Opening the whole corridor makes the read-only preview valid");
    check(g.moveUnit(id,{7,2}).ok,"The troop crosses after the corridor fits both cells");
    check(!g.world.at(before).occupant && !g.world.at({before.x,before.y+1}).occupant,"Moving frees both original cells");
    occupies(g,id,2);
    check(g.moveUnit(id,{7,3}).ok,"Movement permits overlap with the troop's previous second cell");
    g.destroyUnit(id); occupies(g,id,0);
}
void deployment(const Config &config) {
    for(auto type:{"armored_jeep","frigate","jet_fighter"}) {
        auto g=prepared(config); const auto &d=g.config.unit(type);
        auto producer=source(g,d.building); const auto b=*g.findBuilding(producer); const auto &bd=g.config.building(b.type);
        Pos opening{-1,-1};
        for(int y=0;y<g.world.height;++y)for(int x=0;x<g.world.width;++x)
            if(opening.x<0 && adjacent(b,bd,{x,y},d) && g.canPlaceUnit(d,{x,y})) opening={x,y};
        check(opening.x>=0,"Fixture has a two-cell deployment opening for " + std::string(type));
        auto legal=d.domain==Domain::Naval?Terrain::Water:Terrain::Grass;
        auto blocked=d.domain==Domain::Naval?Terrain::Grass:Terrain::Forest;
        for(auto &tile:g.world.tiles)if(!tile.occupant)tile.terrain=blocked;
        g.world.at(opening).terrain=legal;
        check(g.train(producer,type).ok,"Train a large troop at its source");
        g.tick(d.seconds*1000);
        check(g.units.empty() && g.findBuilding(producer)->queue.front().awaiting,"One empty cell never releases a two-cell troop");
        g.world.at({opening.x,opening.y+1}).terrain=legal;
        g.tick(g.config.stepMs);
        check(g.units.size()==1 && g.findBuilding(producer)->queue.empty(),"Opening both cells deploys the queued troop");
        occupies(g,g.units.front().id,2);
    }
}
void carrier(const Config &config) {
    auto raw=config.raw;
    for(auto &u:raw["units"])if(u["id"]=="attack_aircraft")u["footprint"]={1,2};
    auto g=prepared(Config::parse(raw));
    auto plane=add(g,"attack_aircraft",plot(g,g.config.unit("attack_aircraft")));
    auto ship=add(g,"titan_carrier",plot(g,g.config.unit("titan_carrier")));
    check(g.embark(plane,ship).ok,"A configured carrier accepts a large aircraft");
    occupies(g,plane,0); occupies(g,ship,2);
    auto copy=decodeSave(g.config,encodeSave(g));
    check(copy.findUnit(plane)->carrier==ship,"Embarked aircraft roundtrips without map occupancy");
    check(g.disembark(plane).ok,"A large aircraft disembarks into a two-cell opening");
    occupies(g,plane,2);
    g.destroyUnit(plane); occupies(g,plane,0);
    g.destroyUnit(ship); occupies(g,ship,0); g.validate();
}
void migration(const Config &config) {
    auto g=prepared(previous(config));
    Pos conflict{-1,-1};
    const auto &oldLand=g.config.unit("armored_jeep");
    for(int y=0;y+1<g.world.height;++y)for(int x=0;x<g.world.width;++x)
        if(conflict.x<0 && g.canPlaceUnit(oldLand,{x,y}) && g.world.at({x,y+1}).occupant)conflict={x,y};
    check(conflict.x>=0,"Legacy fixture has an anchor immediately above a building");
    auto land=add(g,"armored_jeep",conflict); g.findUnit(land)->health-=7;
    auto sea=add(g,"frigate",{0,g.world.height-1});
    const auto &oldAir=g.config.unit("jet_fighter"); Pos coast{-1,-1};
    for(int y=0;y+1<g.world.height;++y)for(int x=0;x<g.world.width;++x)
        if(coast.x<0 && g.canPlaceUnit(oldAir,{x,y}) && !terrain(g,oldAir,{x,y+1}))coast={x,y};
    check(coast.x>=0,"Legacy fixture has a mixed-terrain aircraft footprint");
    add(g,"jet_fighter",coast);
    check(g.train(source(g,"barracks"),"infantry").ok,"Retain a paid training queue");
    check(g.startResearch(source(g,"academy"),"infantry").ok,"Retain an active research timer");
    check(g.startBattle(std::vector<Id>{land}).ok,"Retain an active battle during footprint migration");
    auto old=snapshot(g); auto migrated=decodeSave(config,encodeSave(g));
    check(migrated.findUnit(land)->pos!=conflict && migrated.findUnit(sea)->pos.y+1<migrated.world.height,"Expanded troops move away from building collisions and map edges");
    auto expected=old, actual=snapshot(migrated);
    expected.erase("config");actual.erase("config");
    for(auto *state:{&expected,&actual})for(auto &u:(*state)["units"]){u.erase("position");u.erase("reserve");}
    check(expected==actual,"Migration retains IDs, health, stock, source, research, queued payments and battle state");
    check(snapshot(migrated)==snapshot(Game::deserialize(config,g.serialize())),"Nearest legal relocation is deterministic");
    check(snapshot(migrated)==snapshot(decodeSave(config,encodeSave(migrated))),"Migrated current saves roundtrip exactly");
    auto corrupt=old;corrupt["units"][1]["position"]=corrupt["units"][0]["position"];
    rejected(config,corrupt,"An invalid old layout is rejected before migration");
    auto unknown=old;unknown["config"]["units"][0]["cost"]["wood"]=999;
    rejected(config,unknown,"Unknown historical rules are rejected");
    auto current=migrated.serialize();current["units"][0]["position"]={conflict.x,conflict.y};
    rejected(config,current,"A corrupt current two-cell overlap is not silently relocated");
    current=migrated.serialize();current["units"][1]["position"]={0,g.world.height-1};
    rejected(config,current,"A corrupt current footprint beyond the map is rejected");
    current=migrated.serialize();current["units"][2]["position"]={coast.x,coast.y};
    rejected(config,current,"A corrupt current second-cell terrain is rejected");
    for(auto fixture:{"legacy-native.save.json","empires-of-wars-145.save.json","military-army.save.json"}) {
        std::ifstream input(std::filesystem::path(KINGDOM_CONFIG).parent_path().parent_path()/"tests/fixtures"/fixture);
        Json saved;input>>saved;auto result=Game::deserialize(config,saved["game"]);
        check(result.units.size()==saved["game"]["units"].size() && result.buildings.size()==saved["game"]["buildings"].size(),"Every legacy troop and building survives the migration chain");
        if(!saved["game"]["battle"].is_null())check(result.battle && result.battle->id==saved["game"]["battle"]["id"],"A legacy active battle survives migration");
        check(snapshot(result)==snapshot(decodeSave(config,encodeSave(result))),"Legacy migrations produce valid current saves");
    }
}
void noSpace(const Config &config) {
    auto raw=config.raw;
    for(auto &b:raw["buildings"])if(b["id"]=="house")for(auto &l:b["levels"])l["housing"]=1000000;
    for(auto &u:raw["units"])u["people"]=1;
    const auto expanded=Config::parse(raw);auto g=prepared(previous(expanded));
    auto land=plot(g,g.config.unit("armored_jeep"));
    Pos air{-1,-1}, sea=plot(g,g.config.unit("frigate"));
    for(int y=0;y<g.world.height;++y)for(int x=0;x<g.world.width;++x)
        if(air.x<0 && distance(land,{x,y})>3 && g.canPlaceUnit(g.config.unit("jet_fighter"),{x,y}))air={x,y};
    check(air.x>=0,"Separate one-cell anchors for land and air");
    for(int y=0;y<g.world.height;++y)for(int x=0;x<g.world.width;++x) {
        Pos p{x,y};if(p==land || p==air || p==sea || g.world.at(p).occupant)continue;
        for(auto type:{"infantry","ship"})if(g.canPlaceUnit(g.config.unit(type),p)){add(g,type,p);break;}
    }
    auto landId=add(g,"armored_jeep",land), seaId=add(g,"frigate",sea), airId=add(g,"jet_fighter",air);
    check(g.startBattle(std::vector<Id>{landId}).ok,"A crowded historical unit can already be in battle");
    auto migrated=decodeSave(expanded,encodeSave(g));
    for(auto id:{landId,seaId,airId}) {
        check(migrated.findUnit(id) && migrated.findUnit(id)->reserve,"A crowded expanded troop is retained in reserve in every domain");
        occupies(migrated,id,0);
    }
    check(migrated.units.size()==g.units.size() && migrated.battle && migrated.battle->id==g.battle->id,"No-space migration preserves every troop and the active battle");
    check(snapshot(migrated)==snapshot(decodeSave(expanded,encodeSave(migrated))),"No-space reserve units and an active battle roundtrip");
    for(auto id:{landId,seaId,airId}) {
        auto retry=migrated;retry.battle.reset();
        for(auto other:{landId,seaId,airId})if(other!=id)retry.destroyUnit(other);
        const auto &d=retry.config.unit(retry.findUnit(id)->type);auto b=*retry.findBuilding(retry.findUnit(id)->source);
        const auto &bd=retry.config.building(b.type);Pos opening{-1,-1};
        for(int y=0;y+1<retry.world.height;++y)for(int x=0;x<retry.world.width;++x) {
            Pos p{x,y};auto a=retry.world.at(p).occupant,c=retry.world.at({x,y+1}).occupant;
            if(opening.x<0 && adjacent(b,bd,p,d) && terrain(retry,d,p) && terrain(retry,d,{x,y+1}) && retry.findUnit(a) && retry.findUnit(c))opening=p;
        }
        check(opening.x>=0,"A blocked two-cell opening exists beside each source");
        auto first=retry.world.at(opening).occupant,second=retry.world.at({opening.x,opening.y+1}).occupant;
        retry.destroyUnit(first);retry.destroyUnit(second);retry.tick(retry.config.stepMs);
        check(!retry.findUnit(id)->reserve,"Every domain retries deployment once two cells become free");
        occupies(retry,id,2);retry.validate();
    }
}
void currentRules(const Config &config) {
    auto g = prepared(config);
    for (const auto &d : config.units) {
        const int width = d.domain == Domain::Air ? 2 : 1;
        const int height = d.domain == Domain::Naval ? (d.level <= 2 ? 1 : d.level <= 6 ? 2 : 3)
            : d.domain == Domain::Air ? (d.level <= 6 ? 2 : 3) : (d.level < 4 ? 1 : 2);
        check(d.width == width && d.height == height, "Exact current footprint for " + d.id);
        const auto p = plot(g,d);
        for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
            auto cell = Pos{p.x+x,p.y+y};
            g.world.at(cell).occupant = g.buildings.front().id;
            check(!g.canPlaceUnit(d,p), "Every occupied cell blocks the full troop: " + d.id);
            g.world.at(cell).occupant = 0;
        }
        const auto unit = add(g,d.id,p); occupies(g,unit,width*height);
        check(g.canPlaceUnit(d,p,unit),"A troop can move over its own footprint");
        const auto unchanged=snapshot(g);
        check(g.canMoveUnit(unit,p).ok && snapshot(g)==unchanged,"A valid preview preserves every troop and game field");
        check(!g.canMoveUnit(unit,{-1,-1}).ok && snapshot(g)==unchanged,"An invalid preview preserves every troop and game field");
        const auto gold = g.stock[4];
        const auto population = g.military();
        check(g.dismissUnit(unit).ok && !g.findUnit(unit), "Every troop type can be dismissed");
        check(g.stock[4] == gold + 20 && g.military() == population - d.people, "Dismissal grants exactly twenty gold and releases the whole unit population");
        occupies(g,unit,0);
        const auto dismissed = snapshot(g);
        check(!g.dismissUnit(unit).ok && snapshot(g) == dismissed, "Repeated dismissal cannot pay twice");
        const auto producer = source(g,d.building);
        check(g.train(producer,d.id).ok,"Train the first unit in its own building");
        auto before = snapshot(g);
        check(!g.train(producer,d.id).ok && snapshot(g)==before,"A second task cannot enter the same building");
        check(g.cancelTraining(producer,0).ok,"Cancel releases the single training slot");
    }
    g.validate();
}
void dismissals(const Config &config) {
    auto g = prepared(config);
    const auto carrier = add(g,"titan_carrier",plot(g,g.config.unit("titan_carrier")));
    const auto plane = add(g,"aircraft",plot(g,g.config.unit("aircraft")));
    check(g.embark(plane,carrier).ok, "Prepare a carrier with an aircraft");
    auto unchanged = snapshot(g);
    check(!g.dismissUnit(carrier).ok && snapshot(g) == unchanged, "A loaded carrier cannot dismiss its aircraft accidentally");
    auto gold = g.stock[4];
    check(g.dismissUnit(plane).ok && g.findUnit(carrier) && g.stock[4] == gold + 20, "An embarked plane can be dismissed without changing its carrier");
    check(g.dismissUnit(carrier).ok && g.stock[4] == gold + 40, "An empty carrier can be dismissed for twenty gold");
    const auto reserve = add(g,"jet_fighter",plot(g,g.config.unit("jet_fighter")));
    g.occupyUnit(*g.findUnit(reserve),0);
    g.findUnit(reserve)->reserve = true;
    check(g.dismissUnit(reserve).ok && !g.findUnit(reserve), "A reserve unit can be dismissed without map occupancy");
    const auto soldier = add(g,"infantry",plot(g,g.config.unit("infantry")));
    g.stock[4] = 1'000'000'000'000ll - 20;
    unchanged = snapshot(g);
    check(!g.dismissUnit(soldier).ok && snapshot(g) == unchanged, "A full gold stockpile rejects dismissal atomically");
    g.stock[4] = 1'000'000'000'000ll - 21;
    check(g.dismissUnit(soldier).ok && g.stock[4] == 1'000'000'000'000ll - 1, "The exact maximum legal stockpile can accept the payment");
    const auto battleUnit = add(g,"infantry",plot(g,g.config.unit("infantry")));
    check(g.startBattle(std::vector<Id>{battleUnit}).ok, "Prepare a battle before dismissal");
    unchanged = snapshot(g);
    check(!g.dismissUnit(battleUnit).ok && snapshot(g) == unchanged, "Dismissal is unavailable throughout a battle");
    g.validate();
}

}
int main() {
    try {
        const auto config=Config::load(KINGDOM_CONFIG);
        auto historical = config.raw;
        historical["unitFootprintVersion"] = 1;
        for (auto &unit : historical["units"]) unit["footprint"] = config.raw.at("unitFootprintMigration").at(unit.at("id").get<std::string>());
        historical.erase("unitFootprintMigration");
        const auto prior = Config::parse(historical);
        catalogAndPlacement(prior);movement(prior);deployment(prior);carrier(prior);migration(prior);noSpace(prior);
        currentRules(config);
        dismissals(config);
        std::cout<<"PASS all-domain two-cell footprints, full-clearance paths, deployment, cleanup, strict saves and lossless migrations\n";
        return 0;
    } catch(const std::exception &e){std::cerr<<e.what()<<'\n';return 1;}
}
