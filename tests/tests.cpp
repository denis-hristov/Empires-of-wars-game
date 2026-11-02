#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include <algorithm>
#include <fstream>
#include <functional>
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
int passed = 0, failed = 0;
void check(bool ok, const std::string &message) {
    if (!ok)
        throw std::runtime_error(message);
}
void test(const std::string &name, const std::function<void()> &body) {
    try {
        body();
        ++passed;
        std::cout << "PASS " << name << '\n';
    } catch (const std::exception &e) {
        ++failed;
        std::cerr << "FAIL " << name << ": " << e.what() << '\n';
    }
}
Config cfg() {
    // Keep historical mechanics covered for the exact save configuration we still migrate.
    // The current progression has its own complete city, economy and research suite.
    auto current = Config::load(KINGDOM_CONFIG);
    return Config::parse(current.raw.at("progressionMigration"));
}
Game fresh() {
    Game g(cfg());
    g.newGame(g.config.defaultSeed);
    return g;
}
Id building(const Game &g, const std::string &type) {
    for (auto &b : g.buildings)
        if (b.type == type)
            return b.id;
    throw std::runtime_error("Missing building");
}
Json snapshot(const Game &g) {
    auto j = g.serialize();
    j.erase("savedAtUTC");
    return j;
}
Pos freeTile(const Game &g, const std::string &type) {
    for (int y = 0; y < g.world.height; ++y)
        for (int x = 0; x < g.world.width; ++x)
            if (g.canPlace(type, {x, y}).ok)
                return {x, y};
    throw std::runtime_error("No free tile");
}
Pos tree(const Game &g) {
    for (int y = 0; y < g.world.height; ++y)
        for (int x = 0; x < g.world.width; ++x)
            if (g.world.at({x, y}).terrain == Terrain::Forest && !g.world.at({x, y}).occupant)
                return {x, y};
    throw std::runtime_error("No free tree");
}
Pos forestPlot(const Game &g) {
    for (int y = 0; y < g.world.height - 1; ++y)
        for (int x = 0; x < g.world.width - 1; ++x) {
            bool valid = true, forest = false;
            for (int dy = 0; dy < 2; ++dy)
                for (int dx = 0; dx < 2; ++dx) {
                    auto tile = g.world.at({x + dx, y + dy});
                    valid &=
                        !tile.occupant && tile.terrain != Terrain::Water && tile.terrain != Terrain::Mountain;
                    forest |= tile.terrain == Terrain::Forest;
                }
            if (valid && forest)
                return {x, y};
        }
    throw std::runtime_error("No forest building plot");
}
void rich(Game &g) {
    g.stock.fill(100000);
}
Id add(Game &g, const std::string &type) {
    rich(g);
    check(g.place(type, freeTile(g, type)).ok, "place " + type);
    Id id = g.buildings.back().id;
    g.tick(g.config.building(type).levels.front().seconds * 1000 + 50);
    return id;
}
void expandHousing(Game &g, int capacity) {
    while (g.housing() < capacity)
        add(g, "house");
}
Game prepared() {
    auto g = fresh();
    add(g, "farm");
    add(g, "lumberyard");
    expandHousing(g, 23);
    add(g, "barracks");
    g.civilian = 18;
    g.stock = g.config.initialStock;
    g.elapsedMs = g.pendingMs = g.settlementRemainder = 0;
    for (auto &b : g.buildings)
        b.stored = b.remainder = 0;
    g.validate();
    return g;
}
void recruit(Game &g, int n) {
    rich(g);
    auto id = building(g, "barracks");
    for (int i = 0; i < n; ++i) {
        check(g.train(id, "infantry").ok, "training");
        g.tick(g.config.unit("infantry").seconds * 1000 + 50);
    }
}
void throws(const std::function<void()> &fn) {
    bool threw = false;
    try {
        fn();
    } catch (const std::exception &) {
        threw = true;
    }
    check(threw, "Expected rejection");
}
Game mixedArmy() {
    std::ifstream file(std::filesystem::path(KINGDOM_CONFIG).parent_path().parent_path() /
                       "tests/fixtures/empires-of-wars-145.save.json");
    Json data;
    file >> data;
    return Game::deserialize(cfg(), data.at("game"));
}
std::vector<Id> squad(const Game &g, std::initializer_list<Domain> domains) {
    std::vector<Id> result;
    std::array<int, 3> counts{};
    for (const auto &u : g.units) {
        auto d = g.config.unit(u.type).domain;
        if (std::find(domains.begin(), domains.end(), d) != domains.end() &&
            ++counts[static_cast<int>(d)] <= 5)
            result.push_back(u.id);
    }
    return result;
}
void decisiveRounds(Game &g, std::initializer_list<Domain> winners) {
    for (auto &f : g.battle->fighters) {
        bool win = std::find(winners.begin(), winners.end(), f.domain) != winners.end();
        f.range = 20;
        f.damage = f.enemy != win ? 10000 : 1;
    }
}
} // namespace
int main() {
    test("All buildings reserve their complete square footprints", [] {
        auto g = fresh();
        for (const auto &d : g.config.buildings) {
            int side = d.id == "townhall" ? 3 : 2;
            check(d.width == side && d.height == side, "configured footprint " + d.id);
        }
        auto hall = g.buildings.front();
        int occupied = 0;
        for (auto tile : g.world.tiles)
            occupied += tile.occupant == hall.id;
        check(occupied == 9, "Town Hall occupies nine cells");
        for (int dy = 0; dy < 3; ++dy)
            for (int dx = 0; dx < 3; ++dx)
                check(!g.canPlace("house", {hall.pos.x + dx, hall.pos.y + dy}).ok, "reserved Hall cells");
        auto id = add(g, "house");
        occupied = 0;
        for (auto tile : g.world.tiles)
            occupied += tile.occupant == id;
        check(occupied == 4, "house reserves four cells");
        auto p = g.findBuilding(id)->pos;
        check(!g.canPlace("farm", {p.x + 1, p.y + 1}).ok, "overlap at far corner rejected");
        g.validate();
    });
    test("New game starts with only a level-1 Town Hall and five settlers", [] {
        auto g = fresh();
        check(g.buildings.size() == 1 && g.buildings.front().type == "townhall" &&
                  g.buildings.front().level == 1 && g.buildings.front().state == State::Active,
              "only the Town Hall is supplied");
        check(g.civilian == 5 && g.population() == 5 && g.housing() == 5 && g.freeHousing() == 0,
              "initial population fills the Town Hall");
        g.tick(120000);
        check(g.population() == 5, "no settlers beyond initial capacity");
        g.validate();
    });
    test("Town Hall provides 5 10 and 15 housing spaces after completed upgrades", [] {
        auto g = fresh();
        rich(g);
        g.stock[0] = 0;
        auto id = building(g, "townhall");
        for (int level = 2; level <= 3; ++level) {
            int previous = g.housing();
            check(g.upgrade(id).ok, "Town Hall upgrade");
            check(g.housing() == previous, "old capacity retained during upgrade");
            g.tick(level * 6000 - 50);
            check(g.housing() == previous, "capacity waits for completion");
            g.tick(50);
            check(g.housing() == level * 5 && g.population() == 5, "completed capacity only");
        }
    });
    test("House provides 2 4 and 8 housing spaces and survives save reload", [] {
        auto g = fresh();
        rich(g);
        g.stock[0] = 0;
        auto hall = building(g, "townhall");
        check(g.upgrade(hall).ok, "unlock house level 3");
        g.tick(12000);
        auto p = freeTile(g, "house");
        check(g.place("house", p).ok, "construct house");
        auto id = g.buildings.back().id;
        check(g.housing() == 10, "unfinished house has no capacity");
        g.tick(6000);
        for (int level = 1; level <= 3; ++level) {
            if (level > 1) {
                auto capacity = g.housing();
                check(g.upgrade(id).ok, "house upgrade");
                check(g.housing() == capacity, "old house capacity stays during upgrade");
                g.tick(level * 6000);
            }
            check(g.housing() == 10 + (2 << (level - 1)), "house housing progression");
            auto loaded = Game::deserialize(cfg(), g.serialize());
            check(loaded.housing() == g.housing() && loaded.population() == 5, "save housing round trip");
            g.validate();
        }
    });
    test("1000 deterministic landscapes and guaranteed 5x5", [] {
        auto c = cfg();
        for (std::uint32_t seed = 0; seed < 1000; ++seed) {
            auto a = World::generate(c, seed), b = World::generate(c, seed);
            check(a.tiles == b.tiles, "determinism");
            for (int y = c.height / 2 - 2; y <= c.height / 2 + 2; ++y)
                for (int x = c.width / 2 - 2; x <= c.width / 2 + 2; ++x)
                    check(a.at({x, y}).terrain == Terrain::Grass && !a.at({x, y}).occupant,
                          "center guarantee");
            Game g(c);
            g.newGame(seed);
            g.validate();
        }
    });
    test("Seeds produce enclosed islands, archipelagos, peninsulas and river mainland", [] {
        auto c = cfg();
        int islands = 0, archipelagos = 0, peninsulas = 0, rivers = 0;
        for (std::uint32_t seed = 0; seed < 1000; ++seed) {
            auto w = World::generate(c, seed);
            std::array<bool, 4> landEdges{};
            for (int x = 0; x < w.width; ++x) {
                landEdges[0] |= w.at({x, 0}).terrain != Terrain::Water;
                landEdges[1] |= w.at({x, w.height - 1}).terrain != Terrain::Water;
            }
            for (int y = 0; y < w.height; ++y) {
                landEdges[2] |= w.at({0, y}).terrain != Terrain::Water;
                landEdges[3] |= w.at({w.width - 1, y}).terrain != Terrain::Water;
            }
            int edgeCount = std::count(landEdges.begin(), landEdges.end(), true);
            std::vector<bool> visited(w.tiles.size());
            int sizeableIslands = 0;
            bool throughRiver = false;
            for (int y = 0; y < w.height; ++y)
                for (int x = 0; x < w.width; ++x) {
                    auto index = y * w.width + x;
                    if (visited[index])
                        continue;
                    bool water = w.at({x, y}).terrain == Terrain::Water;
                    std::vector<Pos> component{{x, y}};
                    visited[index] = true;
                    std::array<bool, 4> edges{};
                    for (std::size_t i = 0; i < component.size(); ++i) {
                        auto p = component[i];
                        edges[0] |= p.y == 0;
                        edges[1] |= p.y == w.height - 1;
                        edges[2] |= p.x == 0;
                        edges[3] |= p.x == w.width - 1;
                        for (auto n : w.neighbors(p)) {
                            auto ni = n.y * w.width + n.x;
                            if (!visited[ni] && (w.at(n).terrain == Terrain::Water) == water) {
                                visited[ni] = true;
                                component.push_back(n);
                            }
                        }
                    }
                    if (!water && component.size() >= 20)
                        ++sizeableIslands;
                    if (water && ((edges[0] && edges[1]) || (edges[2] && edges[3])))
                        throughRiver = true;
                }
            if (edgeCount == 0) {
                if (sizeableIslands > 1)
                    ++archipelagos;
                else
                    ++islands;
            } else if (edgeCount == 4) {
                check(throughRiver, "mainland must contain an unbroken river across the map");
                ++rivers;
            } else
                ++peninsulas;
        }
        check(islands > 100 && archipelagos > 100 && peninsulas > 100 && rivers > 100,
              "all four landscape families must occur frequently");
    });
    test("Protected center and deterministic terrain on small, rectangular and maximum maps", [] {
        for (auto size : std::array<Pos, 5>{{{12, 12}, {12, 48}, {48, 12}, {36, 37}, {128, 128}}}) {
            auto rules = cfg().raw;
            rules["world"]["width"] = size.x;
            rules["world"]["height"] = size.y;
            auto c = Config::parse(rules);
            for (std::uint32_t seed : {0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 0xffffffffu}) {
                Game g(c);
                g.newGame(seed);
                g.validate();
                auto generated = World::generate(c, seed);
                for (std::size_t i = 0; i < generated.tiles.size(); ++i)
                    check(g.world.tiles[i].terrain == generated.tiles[i].terrain, "map size determinism");
                for (int y = c.height / 2 - 2; y <= c.height / 2 + 2; ++y)
                    for (int x = c.width / 2 - 2; x <= c.width / 2 + 2; ++x)
                        check(g.world.at({x, y}).terrain == Terrain::Grass, "protected center");
            }
        }
    });
    test("Legacy generator reproduces the original terrain fingerprint", [] {
        auto c = cfg();
        c.generator = 1;
        auto w = World::generate(c, c.defaultSeed);
        std::uint64_t fingerprint = 14695981039346656037ull;
        for (auto tile : w.tiles) {
            fingerprint ^= static_cast<int>(tile.terrain);
            fingerprint *= 1099511628211ull;
        }
        check(fingerprint == 4968497424167731769ull, "legacy terrain changed");
    });
    test("Extreme water world retains starting land", [] {
        auto c = cfg();
        c.water = 100000;
        c.sand = 200000;
        auto w = World::generate(c, 1);
        check(w.at({0, 0}).terrain == Terrain::Water, "edge water");
        check(w.at({c.width / 2, c.height / 2}).terrain == Terrain::Grass, "center");
    });
    test("Tree removal costs exactly 20 gold and grants 20 wood once", [] {
        auto g = prepared();
        auto p = tree(g);
        auto before = g.stock;
        check(!g.canPlace("house", p).ok, "forest blocks construction");
        check(g.clearTree(p).ok, "cut tree");
        check(g.stock[4] == before[4] - 20 && g.stock[1] == before[1] + 20, "exact exchange");
        for (int i : {0, 2, 3})
            check(g.stock[i] == before[i], "other resources unchanged");
        check(g.world.at(p).terrain == Terrain::Grass && g.clearedTrees.contains(p), "grass replaces tree");
        check(g.world.at(p).terrain == Terrain::Grass, "cleared tile remains buildable ground");
        auto after = snapshot(g);
        auto world = g.world.tiles;
        check(!g.clearTree(p).ok, "cannot harvest twice");
        check(snapshot(g) == after && g.world.tiles == world, "repeated removal is atomic");
        g.validate();
    });
    test("Tree removal rejects invalid occupied and unaffordable tiles atomically", [] {
        auto g = prepared();
        auto p = tree(g);
        g.stock[4] = 19;
        auto before = snapshot(g);
        auto world = g.world.tiles;
        check(!g.clearTree(p).ok, "insufficient gold");
        check(!g.clearTree({-1, 0}).ok, "outside map");
        check(!g.clearTree({g.world.width / 2, g.world.height / 2}).ok, "grass is not a tree");
        check(snapshot(g) == before && g.world.tiles == world, "rejections are atomic");
        g.stock[4] = 20;
        check(g.clearTree(p).ok && g.stock[4] == 0, "exact gold boundary");
        auto plot = forestPlot(g);
        for (int dy = 0; dy < 2; ++dy)
            for (int dx = 0; dx < 2; ++dx)
                if (g.world.at({plot.x + dx, plot.y + dy}).terrain == Terrain::Forest)
                    p = {plot.x + dx, plot.y + dy};
        rich(g);
        check(g.place("lumberyard", plot).ok, "occupied forest setup");
        before = snapshot(g);
        world = g.world.tiles;
        check(!g.clearTree(p).ok, "occupied forest");
        check(snapshot(g) == before && g.world.tiles == world, "occupied tile unchanged");
        p = tree(g);
        g.stock[1] = 1'000'000'000'000ll - 20;
        before = snapshot(g);
        check(!g.clearTree(p).ok && snapshot(g) == before, "wood limit checked before payment");
    });
    test("Tree removal is blocked during battles", [] {
        auto g = prepared();
        auto p = tree(g);
        recruit(g, 1);
        check(g.startBattle().ok, "battle setup");
        auto before = snapshot(g);
        auto world = g.world.tiles;
        check(!g.clearTree(p).ok, "battle blocks terrain change");
        check(snapshot(g) == before && g.world.tiles == world, "battle rejection is atomic");
    });
    test("Cleared trees and buildings survive save reload for both world generators", [] {
        for (int generator : {1, 2}) {
            auto rules = cfg().raw;
            rules["world"]["generatorVersion"] = generator;
            Game g(Config::parse(rules));
            g.newGame(g.config.defaultSeed);
            auto p = forestPlot(g);
            for (int dy = 0; dy < 2; ++dy)
                for (int dx = 0; dx < 2; ++dx)
                    if (g.world.at({p.x + dx, p.y + dy}).terrain == Terrain::Forest)
                        check(g.clearTree({p.x + dx, p.y + dy}).ok, "clear before save");
            check(g.place("house", p).ok, "build on cleared land");
            auto loaded = Game::deserialize(cfg(), g.serialize());
            check(loaded.world.tiles == g.world.tiles, "terrain and occupancy restored");
            check(loaded.clearedTrees == g.clearedTrees && loaded.stock == g.stock,
                  "history and resources restored");
            auto roundTrip = Game::deserialize(cfg(), loaded.serialize());
            check(roundTrip.world.tiles == g.world.tiles, "second round trip");
            loaded.newGame(loaded.config.defaultSeed);
            check(loaded.clearedTrees.empty(), "new game resets tree history");
            check(loaded.world.tiles == fresh().world.tiles, "new game restores generated terrain");
        }
    });
    test("Invalid cleared-tree save records are rejected", [] {
        auto g = fresh();
        auto original = g.serialize();
        auto p = tree(g);
        for (const auto &records :
             {Json{{p.x, p.y}, {p.x, p.y}}, Json{{-1, 0}}, Json{{g.world.width / 2, g.world.height / 2}},
              Json{{p.x + 0.5, p.y}}, Json{{4294967296ull, p.y}}, Json::object()}) {
            auto invalid = original;
            invalid["clearedTrees"] = records;
            throws([&] { Game::deserialize(cfg(), invalid); });
        }
        auto oldSave = Game::deserialize(cfg(), original);
        check(oldSave.clearedTrees.empty() && oldSave.world.tiles == g.world.tiles, "old saves supported");
    });
    test("Invalid placement is atomic", [] {
        auto g = prepared();
        auto before = snapshot(g);
        check(!g.place("farm", {-1, -1}).ok, "outside");
        check(!g.place("house", g.buildings.front().pos).ok, "occupied");
        check(snapshot(g) == before, "no mutation");
    });
    test("Insufficient resources never reserve tiles", [] {
        auto g = prepared();
        g.stock.fill(0);
        auto before = snapshot(g);
        check(!g.place("house", freeTile(g, "house")).ok, "cost");
        check(snapshot(g) == before, "atomic cost");
    });
    test("Valid placement and move update every footprint cell", [] {
        auto g = prepared();
        auto id = add(g, "farm");
        auto old = g.findBuilding(id)->pos;
        auto next = freeTile(g, "farm");
        check(g.moveBuilding(id, next).ok, "move");
        check(!g.world.at(old).occupant, "old released");
        check(g.world.at(next).occupant == id, "new reserved");
        g.validate();
    });
    test("Exactly one protected Town Hall", [] {
        auto g = prepared();
        auto before = snapshot(g);
        check(!g.place("townhall", freeTile(g, "townhall")).ok, "second hall");
        check(snapshot(g) == before, "unchanged");
    });
    test("Production independent of frame partitions", [] {
        auto a = prepared(), b = prepared();
        a.tick(10000);
        for (int i = 0; i < 600; ++i)
            b.tick(i % 3 == 0 ? 16 : 17);
        check(snapshot(a) == snapshot(b), "same elapsed time");
        check(a.findBuilding(building(a, "farm"))->stored == 30, "rate");
    });
    test("Full storage discards overflow and resumes collection", [] {
        auto g = prepared();
        auto id = building(g, "farm");
        g.tick(100000);
        auto b = g.findBuilding(id);
        check(b->stored == 120 && b->remainder == 0, "capacity");
        auto initial = g.stock[0];
        check(g.collect(id).ok, "collect");
        check(g.stock[0] == initial + 120, "exact transfer");
        g.collect(id);
        check(g.stock[0] == initial + 120, "no duplication");
        g.tick(50);
        check(b->stored == 0 && b->remainder == 150000, "no hidden overflow");
    });
    test("Zero production rate is safe", [] {
        auto c = cfg();
        for (auto &b : c.buildings)
            if (b.id == "farm")
                b.levels.front().rate = 0;
        Game g(c);
        g.newGame(1);
        add(g, "farm");
        g.tick(60000);
        check(g.findBuilding(building(g, "farm"))->stored == 0, "zero rate");
    });
    test("Negative elapsed time ignored with diagnostic", [] {
        auto g = prepared();
        auto s = snapshot(g);
        g.tick(-1);
        check(snapshot(g) == s && !g.diagnostics.empty(), "negative dt");
    });
    test("Upgrade pauses production and keeps stored resource", [] {
        auto g = prepared();
        rich(g);
        auto id = building(g, "farm");
        g.tick(1000);
        auto stored = g.findBuilding(id)->stored;
        check(g.upgrade(id).ok, "upgrade");
        g.tick(1000);
        check(g.findBuilding(id)->stored == stored, "paused");
        g.tick(11000);
        check(g.findBuilding(id)->level == 2 && g.findBuilding(id)->stored == stored, "completion");
        g.tick(1000);
        check(g.findBuilding(id)->stored == stored + 6, "new rate");
    });
    test("Town Hall blocks level skip without spending", [] {
        auto g = prepared();
        rich(g);
        auto id = building(g, "house");
        g.upgrade(id);
        g.tick(12000);
        auto before = snapshot(g);
        check(!g.upgrade(id).ok, "limit");
        check(snapshot(g) == before, "atomic limit");
        check(g.upgrade(building(g, "townhall")).ok, "townhall");
        g.tick(12000);
        check(g.upgrade(id).ok, "new level unlocked");
    });
    test("House upgrade keeps old capacity and adds no people", [] {
        auto g = prepared();
        rich(g);
        g.stock[0] = 0;
        auto people = g.population(), capacity = g.housing();
        auto id = building(g, "house");
        g.upgrade(id);
        check(g.housing() == capacity, "old housing stays");
        g.tick(12000);
        check(g.housing() == capacity + 2 && g.population() == people, "capacity only");
    });
    test("Settlement stops exactly at housing limit", [] {
        auto g = prepared();
        g.tick(400000);
        check(g.population() == g.housing(), "full housing");
        auto n = g.population();
        g.tick(60000);
        check(g.population() == n, "no overflow");
        g.validate();
    });
    test("Food gates settlement and supports nonconsuming mode", [] {
        auto g = prepared();
        g.stock[0] = 0;
        g.tick(100000);
        check(g.civilian == 18, "food gate");
        auto c = cfg();
        c.foodCost = 0;
        Game noCost(c);
        noCost.newGame(1);
        add(noCost, "house");
        noCost.civilian = 5;
        auto food = noCost.stock[0];
        noCost.tick(10000);
        check(noCost.civilian > 5 && noCost.stock[0] == food, "nonconsuming mode");
    });
    test("Training reserves civilians then converts on deployment", [] {
        auto g = prepared();
        auto id = building(g, "barracks");
        auto civ = g.civilian;
        g.stock[0] = 15;
        check(g.train(id, "infantry").ok, "training");
        check(g.reserved() == g.config.unit("infantry").people && g.civilian == civ && g.military() == 0, "reservation");
        g.tick(7000);
        check(g.units.size() == 1 && g.civilian == civ - g.config.unit("infantry").people && g.military() == g.config.unit("infantry").people && g.reserved() == 0,
              "conversion");
        check(g.world.at(g.units.front().pos).occupant == g.units.front().id, "physical unit");
        g.validate();
    });
    test("Training insufficient civilians is atomic", [] {
        auto g = prepared();
        g.civilian = 0;
        auto before = snapshot(g);
        check(!g.train(building(g, "barracks"), "infantry").ok, "no people");
        check(snapshot(g) == before, "unchanged");
    });
    test("Training queue capacity enforced", [] {
        auto g = prepared();
        rich(g);
        auto id = building(g, "barracks");
        for (int i = 0; i < 3; ++i)
            check(g.train(id, "infantry").ok, "queue");
        auto before = snapshot(g);
        check(!g.train(id, "infantry").ok, "queue full");
        check(snapshot(g) == before, "no payment");
    });
    test("No deployment space retains paid unit and queue", [] {
        auto g = prepared();
        rich(g);
        auto id = building(g, "barracks");
        g.train(id, "infantry");
        g.train(id, "infantry");
        for (auto &t : g.world.tiles)
            if (!t.occupant)
                t.occupant = 999;
        g.tick(20000);
        check(g.units.empty() && g.findBuilding(id)->queue.size() == 2 &&
                  g.findBuilding(id)->queue.front().awaiting,
              "awaiting");
        check(g.findBuilding(id)->queue.back().remainingMs == 7000, "next queue blocked");
        for (auto &t : g.world.tiles)
            if (t.occupant == 999)
                t.occupant = 0;
        g.tick(50);
        check(g.units.size() == 1 && g.findBuilding(id)->queue.size() == 1, "retry deploy");
        g.validate();
    });
    test("Land units reject water movement", [] {
        auto g = prepared();
        recruit(g, 1);
        auto before = snapshot(g);
        check(!g.moveUnit(g.units.front().id, {0, 0}).ok, "water");
        check(snapshot(g) == before, "unchanged");
    });
    test("Technology research requires academy and applies once", [] {
        auto g = prepared();
        auto id = add(g, "academy");
        check(g.startResearch(id, "infantry_drill").ok, "research");
        auto before = snapshot(g);
        check(!g.startResearch(id, "infantry_drill").ok, "duplicate");
        check(snapshot(g) == before, "no duplicate payment");
        g.tick(12000);
        check(g.technologies.contains("infantry_drill"), "completed");
        check(!g.startResearch(id, "infantry_drill").ok, "cannot repeat");
        recruit(g, 1);
        g.startBattle();
        check(g.battle->fighters.front().damage == 46 && g.battle->fighters.front().maxHealth == 120,
              "modifier exactly once");
    });
    test("Naval unlock requires population building and technology", [] {
        auto g = prepared();
        auto harbor = add(g, "harbor");
        auto why = g.trainingRequirements(harbor, "ship");
        check(why.size() >= 2, "population and tech");
        auto academy = add(g, "academy");
        g.startResearch(academy, "naval");
        g.tick(16000);
        expandHousing(g, 30);
        g.civilian = 30;
        check(g.train(harbor, "ship").ok, "naval unlock");
        g.tick(14000);
        check(!g.units.empty() && g.world.at(g.units.back().pos).terrain == Terrain::Water,
              "ship deployed in water");
        g.validate();
    });
    test("Air unlock and physical deployment", [] {
        auto g = prepared();
        add(g, "house");
        add(g, "house");
        expandHousing(g, 45);
        g.civilian = 45;
        auto academy = add(g, "academy");
        g.upgrade(academy);
        g.tick(12000);
        g.startResearch(academy, "naval");
        g.tick(16000);
        g.startResearch(academy, "aviation");
        g.tick(20000);
        auto base = add(g, "airbase");
        check(g.train(base, "aircraft").ok, "air unlock");
        g.tick(18000);
        check(g.units.back().type == "aircraft" && g.world.at(g.units.back().pos).terrain != Terrain::Water,
              "physical aircraft");
        g.validate();
    });
    test("Captives clamp to exactly 15 available places", [] {
        auto g = prepared();
        g.civilian = g.housing() - 15;
        g.nextBattleId = 2;
        BattleResult result{1, true, {1, 2, 3, 4, 5}, 25};
        check(g.applyReward(result).ok, "reward");
        check(g.civilian == g.housing(), "accept only 15");
        auto s = snapshot(g);
        check(!g.applyReward(result).ok, "duplicate rejected");
        check(snapshot(g) == s, "idempotent");
        g.validate();
    });
    test("Defeat gives no resources or captives", [] {
        auto g = prepared();
        auto s = g.stock;
        auto n = g.civilian;
        g.nextBattleId = 2;
        g.applyReward({1, false, {1, 1, 1, 1, 1}, 20});
        check(s == g.stock && n == g.civilian, "no defeat rewards");
    });
    test("Arena attacks select any enemy and hand over only after all allies act", [] {
        auto g = prepared();
        recruit(g, 2);
        check(g.startBattle().ok, "start");
        auto before = snapshot(g);
        auto id = g.battle->fighters[0].id, second = g.battle->fighters[1].id;
        auto enemy = g.battle->fighters.back().id;
        check(!g.battleMove(id, {2, 0}).ok && !g.endTurn().ok && !g.attack(enemy, id).ok,
              "invalid arena commands");
        g.tick(60000);
        check(snapshot(g) == before, "manual turn and home clock wait");
        check(g.validBattleMoves(id).empty() && g.validBattleTargets(id).size() == 2,
              "all enemies targetable without movement");
        check(g.attack(id, enemy).ok && !g.battle->enemyTurn, "first ally chooses distant enemy");
        before = snapshot(g);
        check(!g.attack(id, enemy).ok && snapshot(g) == before, "one attack per unit");
        check(g.attack(second, enemy).ok && g.battle->enemyTurn, "last ally hands over automatically");
        before = snapshot(g);
        check(!g.attack(second, enemy).ok && snapshot(g) == before, "cannot attack during enemy turn");
        int actions = g.battle->actions;
        g.tick(999);
        check(g.battle->actions == actions, "enemy attack waits");
        g.tick(1);
        check(g.battle->actions == actions + 1 && g.battle->enemyTurn, "one enemy attacks at a time");
        g.tick(1000);
        check(!g.battle->enemyTurn && g.battle->round == 2 && g.battle->actions == actions + 2,
              "next friendly turn follows every enemy");
        check(!g.battle->fighters[0].attacked && !g.battle->fighters[1].attacked, "friendly actions reset");
        g.validate();
    });
    test("Playable manual arena battle wins and pays once", [] {
        auto g = prepared();
        recruit(g, 3);
        g.startBattle();
        for (int turn = 0; turn < 40 && !g.battle->finished; ++turn) {
            std::vector<Id> friends;
            for (auto &f : g.battle->fighters)
                if (!f.enemy && f.health > 0 && !f.attacked)
                    friends.push_back(f.id);
            for (auto id : friends) {
                if (g.battle->finished || g.battle->enemyTurn)
                    break;
                auto targets = g.validBattleTargets(id);
                check(!targets.empty(), "living target available");
                check(g.attack(id, targets.front()).ok, "manual targeted attack");
            }
            if (!g.battle->finished)
                g.tick(2000);
            g.validate();
        }
        check(g.battle->finished && g.battle->victory, "victory achievable");
        auto money = g.stock[4];
        check(g.finishBattle().ok && g.stock[4] == money + g.config.rewards[4], "one payout");
        check(!g.finishBattle().ok, "no duplicate payout");
        g.validate();
    });
    test("Dead units cannot act and casualties reduce military", [] {
        auto g = prepared();
        recruit(g, 1);
        g.startBattle();
        auto id = g.units.front().id;
        g.battle->fighters.front().health = 0;
        g.battle->finished = true;
        g.battle->victory = false;
        check(!g.battleMove(id, {1, 1}).ok && !g.attack(id, g.battle->fighters.back().id).ok, "dead actions");
        g.finishBattle();
        check(g.military() == 0 && g.units.empty(), "loss removed");
        g.validate();
    });
    test("Serialization preserves queues research and fractional production", [] {
        auto g = prepared();
        auto a = add(g, "academy");
        g.startResearch(a, "naval");
        g.train(building(g, "barracks"), "infantry");
        g.collect(building(g, "farm"));
        g.tick(73);
        auto loaded = Game::deserialize(g.config, g.serialize());
        check(snapshot(g) == snapshot(loaded), "exact roundtrip");
        g.tick(20000);
        loaded.tick(20000);
        check(snapshot(g) == snapshot(loaded), "resume deterministic");
    });
    test("Active battle save preserves turn flags and health", [] {
        auto g = prepared();
        recruit(g, 2);
        g.startBattle();
        g.attack(g.battle->fighters.front().id, g.battle->fighters.back().id);
        auto loaded = Game::deserialize(g.config, g.serialize());
        check(snapshot(g) == snapshot(loaded), "battle roundtrip");
    });
    test("Malformed saves reject invalid resources IDs and overlap", [] {
        auto g = prepared();
        auto j = g.serialize();
        j["stock"][0] = -1;
        throws([&] { Game::deserialize(g.config, j); });
        j = g.serialize();
        j["buildings"][1]["position"] = j["buildings"][0]["position"];
        throws([&] { Game::deserialize(g.config, j); });
        j = g.serialize();
        j["schemaVersion"] = 0;
        throws([&] { Game::deserialize(g.config, j); });
        j = g.serialize();
        j["buildings"][0]["id"] = 0;
        throws([&] { Game::deserialize(g.config, j); });
    });
    test("Config rejects negative costs zero capacity and tech cycles", [] {
        auto j = cfg().raw;
        j["buildings"][0]["levels"][0]["cost"]["wood"] = -1;
        throws([&] { Config::parse(j); });
        j = cfg().raw;
        j["buildings"][0]["levels"][0]["localCapacity"] = 0;
        throws([&] { Config::parse(j); });
        j = cfg().raw;
        j["technologies"][0]["prerequisites"] = {"infantry_drill"};
        throws([&] { Config::parse(j); });
    });
    test("Atomic persistence keeps backup and ignores incomplete temp", [] {
        auto g = prepared();
        auto directory = std::filesystem::temp_directory_path() / "kingdom-rule-tests";
        std::filesystem::create_directories(directory);
        auto path = directory / "test.save.json";
        check(g.save(path).ok, "first save");
        auto original = snapshot(g);
        g.tick(1250);
        check(g.save(path).ok, "second save");
        auto latest = snapshot(g);
        {
            std::ofstream f(path.string() + ".tmp");
            f << "incomplete";
        }
        auto loaded = fresh();
        check(loaded.load(path).ok && snapshot(loaded) == latest, "valid main survives temp");
        {
            std::ofstream f(path);
            f << "corrupt";
        }
        check(loaded.load(path).ok && snapshot(loaded) == original, "backup recovery");
        {
            std::ofstream f(path.string() + ".bak");
            f << "corrupt too";
        }
        auto before = snapshot(loaded);
        check(!loaded.load(path).ok && snapshot(loaded) == before, "failed load atomic");
        std::filesystem::remove_all(directory);
    });
    test("Expeditions use land sea air order and skip unselected domains", [] {
        for (auto domains : {std::vector<Domain>{Domain::Land},
                             {Domain::Naval},
                             {Domain::Air},
                             {Domain::Land, Domain::Air},
                             {Domain::Land, Domain::Naval, Domain::Air}}) {
            auto g = mixedArmy();
            std::vector<Id> ids;
            for (auto d : domains) {
                auto chosen = squad(g, {d});
                ids.insert(ids.end(), chosen.begin(), chosen.end());
            }
            std::reverse(ids.begin(), ids.end());
            check(g.startBattle(ids).ok, "mixed squad accepted");
            check(g.battle->phases == domains && g.battle->domain == domains.front(), "fixed domain order");
            g.validate();
        }
    });
    test("Five units per domain allows fifteen but rejects a sixth atomically", [] {
        auto g = mixedArmy();
        auto before = snapshot(g);
        std::vector<Id> six;
        for (auto &u : g.units)
            if (u.type == "infantry" && six.size() < 6)
                six.push_back(u.id);
        check(!g.startBattle(six).ok && snapshot(g) == before, "six land units rejected");
        check(!g.startBattle(std::vector<Id>{six[0], six[0]}).ok && snapshot(g) == before,
              "duplicate rejected");
        for (const auto &type : {"ship", "aircraft"}) {
            Unit sample;
            for (auto &u : g.units)
                if (u.type == type)
                    sample = u;
            int count =
                std::count_if(g.units.begin(), g.units.end(), [&](const auto &u) { return u.type == type; });
            for (; count < 5; ++count) {
                bool found = false;
                for (int y = 0; y < g.world.height && !found; ++y)
                    for (int x = 0; x < g.world.width && !found; ++x) {
                        auto &tile = g.world.at({x, y});
                        bool water = tile.terrain == Terrain::Water;
                        if (tile.occupant ||
                            (std::string(type) == "ship" ? !water
                                                         : water || tile.terrain == Terrain::Mountain))
                            continue;
                        auto u = sample;
                        u.id = g.nextId++;
                        u.pos = {x, y};
                        tile.occupant = u.id;
                        g.units.push_back(u);
                        found = true;
                    }
                check(found, "room for reinforcements");
            }
        }
        g.civilian = 0;
        g.validate();
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval, Domain::Air})).ok, "fifteen accepted");
        check(std::count_if(g.battle->fighters.begin(), g.battle->fighters.end(),
                            [](const auto &f) { return !f.enemy; }) == 15,
              "five per round");
        g.validate();
    });
    test("Automatic arena actions are sequential and saves retain reserves and partial clocks", [] {
        auto g = mixedArmy();
        auto ids = squad(g, {Domain::Land, Domain::Naval, Domain::Air});
        check(g.startBattle(ids, true).ok, "start");
        auto elapsed = g.elapsedMs;
        auto stock = g.stock;
        g.tick(750);
        check(g.battle->actions == 0, "first attack waits");
        auto loaded = decodeSave(cfg(), encodeSave(g));
        g.tick(250);
        loaded.tick(250);
        check(snapshot(g) == snapshot(loaded) && g.battle->actions == 1 && !g.battle->enemyTurn,
              "only first ally attacks");
        check(g.pauseBattle().ok, "pause");
        auto paused = snapshot(g);
        g.tick(10000);
        check(snapshot(g) == paused, "paused clock");
        check(g.pauseBattle().ok, "resume");
        g.tick(1000);
        check(g.battle->actions == 2 && g.battle->lastAttacks.size() == 1, "one more ally attack");
        check(g.elapsedMs == elapsed && g.stock == stock, "home remains paused");
        check(g.automateBattle().ok && !g.battle->automatic, "manual toggle");
        g.validate();
    });
    test("Auto attack preserves each manually used action", [] {
        auto g = mixedArmy();
        auto ids = squad(g, {Domain::Naval});
        check(g.startBattle(ids).ok, "manual start");
        auto first = g.battle->fighters[0].id, second = g.battle->fighters[1].id,
             enemy = g.battle->fighters.back().id;
        check(g.attack(first, enemy).ok && !g.battle->enemyTurn, "first manual action");
        check(g.automateBattle().ok, "enable auto");
        g.tick(1000);
        check(g.battle->lastAttacks.back().attacker == second && g.battle->enemyTurn,
              "auto uses the other ally then yields");
        int actions = g.battle->actions;
        check(g.automateBattle().ok && g.battle->enemyTurn, "disabling auto keeps enemy turn");
        g.tick(1000);
        check(g.battle->actions == actions + 1, "enemy still attacks in manual mode");
        g.validate();
    });
    test("Disabling auto cannot skip the enemy finishing attack", [] {
        auto g = mixedArmy();
        auto ids = squad(g, {Domain::Land});
        ids.resize(1);
        check(g.startBattle(ids, true).ok, "start");
        decisiveRounds(g, {});
        g.tick(1000);
        check(g.battle->enemyTurn, "enemy due");
        check(g.automateBattle().ok && g.battle->enemyTurn && !g.battle->finished,
              "toggle does not perform or skip attack");
        g.tick(1000);
        check(g.battle->finished && !g.battle->victory, "enemy completes defeat");
        g.validate();
        auto loaded = decodeSave(cfg(), encodeSave(g));
        check(snapshot(loaded) == snapshot(g), "finished save");
    });
    test("All three rounds finish, record casualties and pay the majority winner once", [] {
        auto g = mixedArmy();
        auto original = g.units;
        auto ids = squad(g, {Domain::Land, Domain::Naval, Domain::Air});
        check(g.startBattle(ids, true).ok, "start");
        decisiveRounds(g, {Domain::Land, Domain::Air});
        auto stock = g.stock;
        for (int i = 0; i < 20 && !g.battle->finished; ++i) {
            g.tick(1000);
            g.validate();
            auto loaded = decodeSave(cfg(), encodeSave(g));
            check(snapshot(g) == snapshot(loaded), "every phase resumes exactly");
        }
        check(g.battle->finished && g.battle->victory && g.battle->outcomes == std::vector<int>({1, 0, 1}),
              "win two rounds including final air round");
        check(g.finishBattle().ok, "return home");
        for (const auto &u : original) {
            bool lost = u.type == "ship";
            check(bool(g.findUnit(u.id)) != lost, "only naval casualties removed");
            if (std::find(ids.begin(), ids.end(), u.id) == ids.end())
                check(g.findUnit(u.id)->health == u.health, "unselected army preserved");
        }
        for (int i = 0; i < 5; ++i)
            check(g.stock[i] == stock[i] + g.config.rewards[i], "single expedition reward");
        check(!g.finishBattle().ok, "no duplicate reward");
        g.validate();
    });
    test("A tied expedition is a defender victory and sea-only works without land or air", [] {
        auto g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval}), true).ok, "two rounds");
        decisiveRounds(g, {Domain::Land});
        auto stock = g.stock;
        g.tick(20000);
        check(g.battle->finished && !g.battle->draw && !g.battle->victory, "one win each leaves the objective with the defender");
        g.validate();
        check(g.finishBattle().ok && g.stock == stock, "defender victory gives the attacking army no reward");
        g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Naval}), true).ok, "sea only");
        decisiveRounds(g, {Domain::Naval});
        g.tick(10000);
        check(g.battle->finished && g.battle->victory && g.battle->phases.size() == 1 &&
                  g.battle->domain == Domain::Naval,
              "only sea round played");
        g.validate();
    });
    test("A capped expedition withdraws immediately, preserves reserves and pays no rewards", [] {
        auto g = mixedArmy();
        const auto army = g.units;
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval, Domain::Air}), true).ok, "start");
        const auto fighters = g.battle->fighters;
        const auto stock = g.stock;
        const int civilian = g.civilian;
        g.battle->round = 200;
        g.normalizeBattleTurn();
        check(g.battle->finished && g.battle->retreated && !g.battle->victory && !g.battle->draw &&
                  g.battle->phaseIndex == 0 && g.battle->outcomes == std::vector<int>{0},
              "The first blocked round ends the whole expedition as a defeat");
        for (std::size_t i = 0; i < fighters.size(); ++i)
            check(g.battle->fighters[i].health == fighters[i].health &&
                      g.battle->fighters[i].shield == fighters[i].shield,
                  "Resolving a stalemate never invents casualties or consumes shields");
        g.validate();
        auto loaded = Game::deserialize(cfg(), g.serialize());
        check(snapshot(loaded) == snapshot(g), "A partial withdrawn expedition resumes exactly");
        auto premature = g.serialize(); premature["battle"]["round"] = 199;
        throws([&] { Game::deserialize(cfg(), premature); });
        check(loaded.finishBattle().ok && loaded.stock == stock && loaded.civilian == civilian,
              "The attacking side receives neither resources nor captives");
        for (const auto &unit : army)
            check(loaded.findUnit(unit.id) && loaded.findUnit(unit.id)->health == unit.health,
                  "All living troops, including unplayed reserves, return unchanged");
        check(!loaded.finishBattle().ok, "A withdrawn expedition cannot claim a second result");
        loaded.validate();
    });
    test("Historical expedition draws become defeats once and inconsistent winner flags are rejected", [] {
        auto g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval}), true).ok, "start");
        decisiveRounds(g, {Domain::Land});
        g.tick(20000);
        check(g.battle->finished && !g.battle->victory && !g.battle->draw, "Current aggregate tie is a defeat");
        auto historical = g.serialize();
        historical["battle"]["combatVersion"] = 6;
        historical["battle"]["draw"] = true;
        auto loaded = Game::deserialize(cfg(), historical);
        check(snapshot(loaded) == snapshot(g), "The valid old draw changes only its obsolete draw flag");
        for (int reload = 0; reload < 3; ++reload) {
            auto repeated = Game::deserialize(cfg(), loaded.serialize());
            check(snapshot(repeated) == snapshot(loaded), "The historical result migration is idempotent");
            loaded = std::move(repeated);
        }
        auto invalid = historical; invalid["battle"]["draw"] = false;
        throws([&] { Game::deserialize(cfg(), invalid); });
        invalid = historical; invalid["battle"]["victory"] = true;
        throws([&] { Game::deserialize(cfg(), invalid); });
        invalid = historical; invalid["battle"]["combatVersion"] = 7;
        throws([&] { Game::deserialize(cfg(), invalid); });
        const auto stock = loaded.stock;
        check(loaded.finishBattle().ok && loaded.stock == stock && !loaded.finishBattle().ok,
              "Migrating an old draw cannot issue or duplicate a victory reward");
    });
    test("Historical unresolved phases preserve survivors and already decisive victories", [] {
        auto g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval}), true).ok, "start");
        for (auto &fighter : g.battle->fighters)
            if (fighter.phase == Domain::Naval && fighter.enemy) fighter.health = fighter.shield = 0;
        g.battle->finished = g.battle->victory = true;
        g.battle->enemyTurn = false;
        g.battle->pendingMs = 0;
        g.battle->phaseIndex = 1;
        g.battle->domain = Domain::Naval;
        g.battle->outcomes = {-1, 1};
        g.validate();
        auto historical = g.serialize(); historical["battle"]["combatVersion"] = 6;
        auto loaded = Game::deserialize(cfg(), historical);
        check(loaded.battle->victory && !loaded.battle->draw && snapshot(loaded) == snapshot(g),
              "A completed old victory is not revoked because it contains a historical unresolved phase");
        auto repeated = Game::deserialize(cfg(), loaded.serialize());
        check(snapshot(repeated) == snapshot(loaded), "Historical phase records remain saveable under version seven");

        g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Land}), true).ok, "single round");
        g.battle->finished = true;
        g.battle->enemyTurn = false;
        g.battle->pendingMs = 0;
        g.battle->outcomes = {-1};
        g.validate();
        historical = g.serialize();
        historical["battle"]["combatVersion"] = 6;
        historical["battle"]["draw"] = true;
        loaded = Game::deserialize(cfg(), historical);
        check(loaded.battle->finished && !loaded.battle->victory && !loaded.battle->draw &&
                  snapshot(loaded) == snapshot(g), "An old untargetable draw is now a defeat without invented casualties");
        const auto stock = loaded.stock;
        check(loaded.finishBattle().ok && loaded.stock == stock, "Old unresolved phases never create free rewards");
    });
    test("Malformed phase state and cross-domain manual actions are rejected", [] {
        auto g = mixedArmy();
        check(g.startBattle(squad(g, {Domain::Land, Domain::Naval, Domain::Air})).ok, "start");
        auto before = snapshot(g);
        auto future = std::find_if(g.battle->fighters.begin(), g.battle->fighters.end(),
                                   [](const auto &f) { return !f.enemy && f.domain == Domain::Naval; });
        check(!g.battleMove(future->id, {1, 1}).ok && snapshot(g) == before, "cannot move reserves");
        for (auto key : {"phaseIndex", "outcomes", "domain", "phases"}) {
            auto bad = before;
            if (std::string(key) == "phaseIndex")
                bad["battle"][key] = 5;
            if (std::string(key) == "outcomes")
                bad["battle"][key] = Json{1};
            if (std::string(key) == "domain")
                bad["battle"][key] = "naval";
            if (std::string(key) == "phases")
                bad["battle"][key] = Json{"air", "land"};
            throws([&] { Game::deserialize(cfg(), bad); });
        }
    });
    test("Manual enemy turn pauses and resumes with exactly the remaining attacks", [] {
        auto g = mixedArmy();
        auto ids = squad(g, {Domain::Naval});
        check(g.startBattle(ids).ok, "start");
        for (auto id : ids)
            check(g.attack(id, g.validBattleTargets(id).front()).ok, "choose target");
        check(g.battle->enemyTurn, "enemy due");
        g.tick(1000);
        check(g.battle->enemyTurn, "second enemy still pending");
        g.tick(400);
        check(g.pauseBattle().ok, "pause enemy");
        auto paused = snapshot(g);
        g.tick(5000);
        check(snapshot(g) == paused, "enemy pause");
        auto copy = decodeSave(cfg(), encodeSave(g));
        g.pauseBattle();
        copy.pauseBattle();
        g.tick(600);
        copy.tick(600);
        check(snapshot(g) == snapshot(copy) && !g.battle->enemyTurn && g.battle->round == 2,
              "exact enemy resume, no replay");
        g.validate();
    });
    test("Grid battle saves migrate spent attacks into arena turns", [] {
        auto g = mixedArmy();
        auto ids = squad(g, {Domain::Naval});
        g.startBattle(ids);
        g.attack(ids.front(), g.validBattleTargets(ids.front()).front());
        auto old = g.serialize();
        old["battle"]["combatVersion"] = 2;
        auto migrated = Game::deserialize(cfg(), old);
        check(migrated.battle->fighters.front().attacked && !migrated.battle->enemyTurn,
              "spent friendly action preserved");
        check(!migrated.attack(ids.front(), migrated.battle->fighters.back().id).ok,
              "no attack replay after migration");
        for (auto &f : old["battle"]["fighters"])
            if (!f.at("enemy").get<bool>())
                f["attacked"] = true;
        migrated = Game::deserialize(cfg(), old);
        check(migrated.battle->enemyTurn, "fully spent legacy squad yields");
        migrated.validate();
    });
    std::cout << passed << " passed, " << failed << " failed\n";
    return failed ? 1 : 0;
}
