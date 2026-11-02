#include "kingdom/Game.hpp"
#include <algorithm>

namespace kingdom {
namespace {
constexpr std::int64_t StockLimit = 1'000'000'000'000ll;
constexpr std::uint64_t SequenceLimit = 9'007'199'254'740'990ull;
const ShopOffer *findOffer(const Config &config, const std::string &id) {
    for (const auto &offer : config.shopOffers) if (offer.id == id) return &offer;
    return nullptr;
}
struct Exchange {
    int payResource, receiveResource;
    std::int64_t payAmount, receiveAmount;
};
Exchange exchange(const ShopOffer &offer, int quantity) {
    return offer.direction == "buy"
        ? Exchange{4, offer.resourceIndex, offer.gold * quantity, offer.amount * quantity}
        : Exchange{offer.resourceIndex, 4, offer.amount * quantity, offer.gold * quantity};
}
const char *label(int resource) {
    constexpr std::array labels{"Food", "Wood", "Stone", "Metal", "gold"};
    return labels.at(resource);
}
}
Result Game::shopRequirements(const std::string &id, int quantity) const {
    if (config.shopOffers.empty()) return Result::fail("The shop is unavailable");
    const auto *offer = findOffer(config, id);
    if (!offer) return Result::fail("This shop offer is unavailable");
    if (quantity < 1 || quantity > 100) return Result::fail("Choose between 1 and 100 offers");
    if (battle) return Result::fail("Finish the battle before trading");
    if (shopSequence >= SequenceLimit) return Result::fail("Shop trade limit reached");
    const auto trade = exchange(*offer, quantity);
    if (stock[trade.payResource] < trade.payAmount)
        return Result::fail("Not enough " + std::string(label(trade.payResource)));
    if (stock[trade.receiveResource] > StockLimit - 1 - trade.receiveAmount)
        return Result::fail("Your " + std::string(label(trade.receiveResource)) + " stockpile is full");
    return Result::success();
}
Result Game::shopTrade(const std::string &id, int quantity, std::uint64_t expectedSequence) {
    if (expectedSequence != shopSequence) return Result::fail("Shop balance changed. Review the offer and try again");
    const auto allowed = shopRequirements(id, quantity);
    if (!allowed.ok) return allowed;
    const auto &offer = *findOffer(config, id);
    const auto trade = exchange(offer, quantity);
    auto result = Result::success(std::string(offer.direction == "buy" ? "Bought " : "Sold ") +
        std::to_string(offer.amount * quantity) + " " + label(offer.resourceIndex) + " for " +
        std::to_string(offer.gold * quantity) + " gold");
    // All checks and allocations precede the atomic resource and sequence update.
    stock[trade.payResource] -= trade.payAmount;
    stock[trade.receiveResource] += trade.receiveAmount;
    ++shopSequence;
    return result;
}
Json Game::shopOptions() const {
    Json result{{"sequence", shopSequence}, {"available", !battle},
                {"quantities", {1, 5, 10}}, {"offers", Json::array()}};
    for (const auto &offer : config.shopOffers) {
        Json option{{"id", offer.id}, {"direction", offer.direction}, {"resource", offer.resource},
                    {"amount", offer.amount}, {"gold", offer.gold}, {"choices", Json::array()}};
        for (int quantity : {1, 5, 10}) {
            const auto trade = exchange(offer, quantity);
            const auto allowed = shopRequirements(offer.id, quantity);
            option["choices"].push_back({{"quantity", quantity}, {"ok", allowed.ok}, {"reason", allowed.message},
                {"pay", {{"resource", resourceName(trade.payResource)}, {"amount", trade.payAmount}}},
                {"receive", {{"resource", resourceName(trade.receiveResource)}, {"amount", trade.receiveAmount}}}});
        }
        result["offers"].push_back(std::move(option));
    }
    return result;
}
} // namespace kingdom
