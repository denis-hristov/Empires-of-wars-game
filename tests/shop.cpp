#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include <iostream>
#include <stdexcept>
using namespace kingdom;
namespace {
void check(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
Game fresh(const Config &config) { Game g(config); g.newGame(config.defaultSeed); g.stock.fill(1'000'000); return g; }
Json stable(const Game &g) { auto j = g.serialize(); j.erase("savedAtUTC"); return j; }
}
int main() {
    try {
        const auto config = Config::load(KINGDOM_CONFIG);
        check(config.shopOffers.size() == 8, "Four resources can be bought and sold");
        for (const auto &offer : config.shopOffers) {
            auto g = fresh(config); const auto before = g.stock;
            check(g.shopTrade(offer.id, 5, g.shopSequence).ok, "Every buy and sell offer succeeds in bulk");
            auto expected = before;
            const int sign = offer.direction == "buy" ? 1 : -1;
            expected[offer.resourceIndex] += sign * offer.amount * 5;
            expected[4] -= sign * offer.gold * 5;
            check(g.stock == expected && g.shopSequence == 1, "Only the two exchanged resources and replay sequence change");
            const auto once = stable(g);
            check(!g.shopTrade(offer.id, 5, 0).ok && stable(g) == once, "A duplicate exchange never spends twice");
            auto loaded = decodeSave(config, encodeSave(g));
            check(stable(loaded) == once && !loaded.shopTrade(offer.id, 5, 0).ok, "Inventory and replay protection persist together");
        }
        auto invalid = fresh(config); const auto unchanged = stable(invalid);
        for (int quantity : {-1, 0, 101})
            check(!invalid.shopTrade("buy_food", quantity, 0).ok && stable(invalid) == unchanged, "Invalid quantity never mutates the game");
        check(!invalid.shopTrade("free_gold", 1, 0).ok && stable(invalid) == unchanged, "Unknown offers cannot create resources");
        invalid.stock[4] = 99;
        const auto poor = stable(invalid);
        check(!invalid.shopTrade("buy_food", 1, 0).ok && stable(invalid) == poor, "Insufficient gold never removes or awards resources");
        invalid.stock[0] = 999;
        const auto scarce = stable(invalid);
        check(!invalid.shopTrade("sell_food", 1, 0).ok && stable(invalid) == scarce, "Cannot sell unowned resources");
        constexpr std::int64_t limit = 1'000'000'000'000ll;
        for (const auto &offer : config.shopOffers) {
            auto g = fresh(config);
            const int receive = offer.direction == "buy" ? offer.resourceIndex : 4;
            const auto amount = offer.direction == "buy" ? offer.amount : offer.gold;
            g.stock[receive] = limit - amount;
            const auto before = stable(g);
            check(!g.shopTrade(offer.id, 1, 0).ok && stable(g) == before, "Overflow rejects the complete exchange");
            --g.stock[receive];
            check(g.shopTrade(offer.id, 1, 0).ok && g.stock[receive] == limit - 1, "The largest legal resulting stockpile is accepted");
        }
        auto exchange = fresh(config); const auto before = exchange.stock;
        check(exchange.shopTrade("buy_wood", 1, 0).ok && exchange.shopTrade("sell_wood", 1, 1).ok, "Exchange works in both directions");
        check(exchange.stock[1] == before[1] && exchange.stock[4] == before[4] - 50, "A buy and sell cycle never generates free gold");
        exchange.battle.emplace(); const auto battleStock = exchange.stock;
        check(!exchange.shopTrade("buy_food", 1, 2).ok && exchange.stock == battleStock && exchange.shopSequence == 2, "Trading is unavailable during a battle");
        exchange.battle.reset(); exchange.shopSequence = 9'007'199'254'740'990ull;
        check(!exchange.shopTrade("buy_food", 1, exchange.shopSequence).ok, "Sequence cannot overflow");
        auto oldRules = config.raw; oldRules.erase("shop");
        auto old = fresh(Config::parse(oldRules));
        auto migrated = decodeSave(config, encodeSave(old));
        auto oldState = stable(old), currentState = stable(migrated);
        oldState.erase("config"); currentState.erase("config");
        check(oldState == currentState && migrated.shopSequence == 0, "Old saves gain the shop without free resources or changed progress");
        const auto quoted = stable(migrated);
        check(migrated.shopOptions().at("offers").size() == 8 && stable(migrated) == quoted, "Shop previews never consume inventory");
        migrated.newGame(config.defaultSeed);
        check(migrated.shopSequence == 0 && migrated.stock == config.initialStock, "A new island resets the shop sequence and resources");
        for (const auto field : {"gold", "amount"}) {
            auto bad = config.raw; bad["shop"]["offers"][0][field] = 0;
            bool rejected = false; try { Config::parse(bad); } catch (...) { rejected = true; }
            check(rejected, "Invalid prices are rejected");
        }
        auto bad = config.raw; bad["shop"]["offers"][4]["gold"] = 101;
        bool rejected = false; try { Config::parse(bad); } catch (...) { rejected = true; }
        check(rejected, "A profitable infinite exchange loop is rejected");
        std::cout << "Shop offers, atomic exchanges, stock limits and persistence passed\n";
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
