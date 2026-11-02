#include "kingdom/Game.hpp"
#include <algorithm>
#include <functional>
#include <stdexcept>

namespace kingdom {
namespace {
void require(bool test, const std::string &message) {
    if (!test)
        throw std::runtime_error("Config: " + message);
}
int number(const Json &j, const char *key, int min = 0, int max = 1'000'000) {
    require(j.at(key).is_number_integer(), std::string(key) + " must be an integer");
    auto n = j.at(key).get<std::int64_t>();
    require(n >= min && n <= max, std::string(key) + " out of range");
    return static_cast<int>(n);
}
Stock stockFrom(const Json &j) {
    Stock s{};
    const std::array<std::string, 5> keys{"food", "wood", "stone", "iron", "coins"};
    require(j.is_object(), "resource object required");
    for (auto it = j.begin(); it != j.end(); ++it)
        require(std::find(keys.begin(), keys.end(), it.key()) != keys.end(), "unknown resource");
    for (std::size_t i = 0; i < keys.size(); ++i)
        if (j.contains(keys[i]))
            s[i] = number(j, keys[i].c_str());
    return s;
}
Domain domain(const std::string &d) {
    if (d == "land")
        return Domain::Land;
    if (d == "naval")
        return Domain::Naval;
    if (d == "air")
        return Domain::Air;
    throw std::runtime_error("Config: invalid domain");
}
Terrain terrain(const std::string &t) {
    if (t == "water")
        return Terrain::Water;
    if (t == "sand")
        return Terrain::Sand;
    if (t == "grass")
        return Terrain::Grass;
    if (t == "forest")
        return Terrain::Forest;
    if (t == "mountain")
        return Terrain::Mountain;
    throw std::runtime_error("Config: invalid terrain");
}
template <class T> const T &lookup(const std::vector<T> &list, const std::string &id) {
    auto it = std::find_if(list.begin(), list.end(), [&](auto &d) { return d.id == id; });
    if (it == list.end())
        throw std::runtime_error("Unknown definition: " + id);
    return *it;
}
} // namespace
Config Config::parse(Json j) {
    Config c;
    c.raw = j;
    if (j.contains("magic")) {
        const auto &magic = j.at("magic");
        require(number(magic, "capacity", 5, 5) == 5, "potion capacity must be five");
        require(magic.at("balancePending").is_boolean(), "invalid magic balance status");
        const std::array<std::string, 4> potionIds{"heal", "shield", "attack", "revive"};
        require(magic.at("potions").is_array() && magic.at("potions").size() == 4, "exactly four potions required");
        for (int i = 0; i < 4; ++i) {
            const auto &p = magic.at("potions").at(i);
            require(p.at("id") == potionIds[i] && number(p, "level", 1, 4) == i + 1, "invalid potion unlock");
            require(p.at("name").is_string(), "missing potion name");
            stockFrom(p.at("cost"));
            number(p, "seconds", 0, 86400);
        }
    }

    require(number(j, "schemaVersion") == 1, "unsupported schema");
    if (j.contains("combatRulesVersion")) number(j, "combatRulesVersion", 2, 2);
    auto w = j.at("world");
    c.width = number(w, "width", 12, 128);
    c.height = number(w, "height", 12, 128);
    c.generator = number(w, "generatorVersion", 1, 2);
    c.defaultSeed = w.at("seed").get<std::uint32_t>();
    c.water = number(w, "waterThreshold");
    c.sand = number(w, "sandThreshold");
    c.forest = number(w, "forestThreshold");
    c.mountain = number(w, "mountainThreshold");
    c.noiseAmplitude = number(w, "noiseAmplitude", 0, 1000);
    require(c.water < c.sand && c.sand < c.forest && c.forest < c.mountain,
            "terrain thresholds must increase");
    c.stepMs = number(j.at("simulation"), "stepMs", 1, 100);
    require(1000 % c.stepMs == 0, "stepMs must divide 1000");
    auto p = j.at("population");
    c.initialPopulation = number(p, "initial");
    c.settlementSeconds = number(p, "settlementSeconds", 1, 3600);
    c.foodCost = number(p, "foodPerSettler");
    int previous = -1;
    for (auto &row : p.at("foodRateTable")) {
        int minimum = number(row, "minimum"), rate = number(row, "percent", 0, 1000);
        require(minimum > previous, "food curve must be sorted");
        previous = minimum;
        c.foodRates.emplace_back(minimum, rate);
    }
    require(!c.foodRates.empty(), "food curve missing");
    c.initialStock = stockFrom(j.at("initialResources"));
    c.townHallLimits = j.at("townHallLimits").get<std::vector<int>>();
    require(!c.townHallLimits.empty(), "town hall limits missing");
    std::set<std::string> ids;
    for (auto &b : j.at("buildings")) {
        BuildingDef d;
        d.id = b.at("id");
        d.name = b.at("name");
        d.description = b.at("description");
        require(ids.insert(d.id).second, "duplicate building");
        d.width = b.at("footprint").at(0);
        d.height = b.at("footprint").at(1);
        require(d.width > 0 && d.width <= 4 && d.height > 0 && d.height <= 4, "invalid footprint");
        d.coastal = number(b, "coastalNeighbors", 0, 8);
        d.queue = number(b, "queueCapacity", 1, 20);
        if (!b.at("resource").is_null()) {
            std::vector<std::string> names{"food", "wood", "stone", "iron", "coins"};
            auto it = std::find(names.begin(), names.end(), b.at("resource").get<std::string>());
            require(it != names.end(), "invalid production resource");
            d.resource = static_cast<int>(it - names.begin());
        }
        for (auto &t : b.at("terrain"))
            d.terrain.push_back(terrain(t));
        require(!d.terrain.empty(), "missing terrain");
        for (auto &l : b.at("levels")) {
            Level x;
            x.cost = stockFrom(l.at("cost"));
            x.seconds = number(l, "seconds");
            x.townHall = number(l, "townHallRequired", 1, 20);
            x.population = number(l, "populationRequired");
            x.housing = number(l, "housing");
            x.rate = number(l, "ratePerSecond", 0, 10000);
            x.ratePerHour = l.contains("ratePerHour") ? number(l, "ratePerHour", 0, 36'000'000) : 0;
            x.capacity = number(l, "localCapacity");
            require(d.resource < 0 || x.capacity > 0, "production capacity must be positive");
            if (!d.levels.empty())
                require(x.capacity >= d.levels.back().capacity && x.housing >= d.levels.back().housing,
                        "capacity cannot decrease");
            d.levels.push_back(x);
        }
        require(!d.levels.empty() && d.levels.size() <= 20, "invalid levels");
        c.buildings.push_back(d);
    }
    for (auto id : {"townhall", "house", "farm", "lumberyard", "barracks", "academy"})
        c.building(id);
    require(c.townHallLimits.size() == c.building("townhall").levels.size(), "town hall limits length");
    for (std::size_t i = 0; i < c.townHallLimits.size(); ++i)
        require(c.townHallLimits[i] >= 1 && c.townHallLimits[i] <= 20 &&
                    (!i || c.townHallLimits[i] >= c.townHallLimits[i - 1]),
                "invalid town hall limit");
    for (auto &d : c.buildings)
        for (std::size_t i = 0; i < d.levels.size(); ++i) {
            require(d.levels[i].townHall <= static_cast<int>(c.townHallLimits.size()),
                    "unreachable town hall requirement");
            if (d.id == "townhall")
                require(d.levels[i].townHall <= static_cast<int>(std::max<std::size_t>(1, i)),
                        "circular town hall progression");
            else
                require(static_cast<int>(i + 1) <= c.townHallLimits.back(), "unreachable building level");
        }
    ids.clear();
    for (auto &t : j.at("technologies")) {
        TechDef d;
        d.id = t.at("id");
        d.name = t.at("name");
        d.domain = domain(t.at("domain"));
        require(ids.insert(d.id).second, "duplicate technology");
        d.cost = stockFrom(t.at("cost"));
        d.academy = number(t, "academyLevel", 1, static_cast<int>(c.building("academy").levels.size()));
        d.seconds = number(t, "seconds");
        d.damage = number(t, "damageBonus");
        d.health = number(t, "healthBonus");
        d.prerequisites = t.at("prerequisites").get<std::vector<std::string>>();
        c.technologies.push_back(d);
    }
    std::set<std::string> visiting, done;
    std::function<void(const std::string &)> visit = [&](const std::string &id) {
        if (done.contains(id))
            return;
        require(visiting.insert(id).second, "technology cycle");
        for (auto &pre : c.tech(id).prerequisites)
            visit(pre);
        visiting.erase(id);
        done.insert(id);
    };
    for (auto &t : c.technologies)
        visit(t.id);
    ids.clear();
    for (auto &u : j.at("units")) {
        UnitDef d;
        d.id = u.at("id");
        d.name = u.at("name");
        d.building = u.at("building");
        d.domain = domain(u.at("domain"));
        require(ids.insert(d.id).second, "duplicate unit");
        d.level = number(u, "level", 1, static_cast<int>(c.building(d.building).levels.size()));
        if (u.contains("footprint")) {
            const auto &footprint = u.at("footprint");
            require(footprint.is_array() && footprint.size() == 2 &&
                        footprint.at(0).is_number_integer() && footprint.at(1).is_number_integer(),
                    "invalid unit footprint");
            d.width = footprint.at(0).get<int>();
            d.height = footprint.at(1).get<int>();
            require(d.width >= 1 && d.width <= 4 && d.height >= 1 && d.height <= 4,
                    "invalid unit footprint");
        }
        d.population = number(u, "populationRequired");
        d.people = number(u, "people", 1, 1000);
        d.seconds = number(u, "seconds");
        d.technology = u.at("technology");
        if (!d.technology.empty())
            c.tech(d.technology);
        d.cost = stockFrom(u.at("cost"));
        d.health = number(u, "health", 1, 10000);
        d.damage = number(u, "damage", 1, 10000);
        d.enemyBaseHealth = u.contains("enemyBaseHealth") ? number(u, "enemyBaseHealth", 1, 10000) : d.health;
        d.enemyBaseDamage = u.contains("enemyBaseDamage") ? number(u, "enemyBaseDamage", 1, 10000) : d.damage;
        d.defense = number(u, "defense", 0, 10000);
        d.range = number(u, "range", 1, 20);
        d.movement = number(u, "movement", 1, 20);
        d.role = u.value("role", "Standard combat unit");
        d.armorClass = u.value("armorClass", "light");
        d.damageType = u.value("damageType", "ballistic");
        d.assetPath = u.value("assetPath", "assets/sprites/" + domainName(d.domain) + ".svg");
        d.projectile = u.value("projectile", "bullet");
        d.effect = u.value("effect", "impact");
        if (u.contains("validTargets"))
            for (const auto &target : u.at("validTargets"))
                d.validTargets.push_back(domain(target));
        else
            d.validTargets.push_back(d.domain);
        require(!d.validTargets.empty(), "unit needs valid targets");
        d.abilities = u.value("abilities", std::vector<std::string>{});
        auto optionalNumber = [&](const char *key, int fallback, int min, int max) {
            return u.contains(key) ? number(u, key, min, max) : fallback;
        };
        d.attackCooldown = optionalNumber("attackCooldown", 1, 1, 10);
        d.accuracy = optionalNumber("accuracy", 100, 1, 200);
        d.evasion = optionalNumber("evasion", 0, 0, 80);
        d.detection = optionalNumber("detection", 0, 0, 100);
        d.targetWeight = optionalNumber("targetWeight", 100, 1, 100);
        d.shield = optionalNumber("shield", 0, 0, 10000);
        d.armorPenetration = optionalNumber("armorPenetration", 0, 0, 100);
        d.splashTargets = optionalNumber("splashTargets", 0, 0, 30);
        d.splashPercent = optionalNumber("splashPercent", 40, 1, 100);
        d.burstEvery = optionalNumber("burstEvery", 0, 0, 20);
        d.burstMultiplier = optionalNumber("burstMultiplier", 175, 100, 1000);
        d.carrierSlots = optionalNumber("carrierSlots", 0, 0, 5);
        d.allowedAircraftTiers = u.value("allowedAircraftTiers", std::vector<int>{});
        require(!d.carrierSlots || (d.domain == Domain::Naval && !d.allowedAircraftTiers.empty()),
                "invalid aircraft carrier");
        for (int tier : d.allowedAircraftTiers)
            require(tier >= 1 && tier <= 4, "carrier aircraft must be tier 1 to 4");
        if (u.contains("damageMultipliers")) {
            require(u.at("damageMultipliers").is_object(), "invalid damage multipliers");
            for (auto it = u.at("damageMultipliers").begin(); it != u.at("damageMultipliers").end(); ++it)
                d.damageMultipliers[it.key()] = number(u.at("damageMultipliers"), it.key().c_str(), 1, 1000);
        }
        c.units.push_back(d);
    }
    c.unit("infantry");
    if (j.contains("unitFootprintVersion"))
        require(number(j, "unitFootprintVersion", 1, 2) <= 2, "unsupported unit footprints");
    if (j.contains("earlyLandCampaignVersion"))
        require(number(j, "earlyLandCampaignVersion", 1, 1) == 1, "unsupported early land campaign version");
    if (j.contains("campaignProgressionVersion"))
        require(number(j, "campaignProgressionVersion", 1, 1) == 1, "unsupported campaign progression version");
    if (j.contains("heavyUnitAttackVersion"))
        require(number(j, "heavyUnitAttackVersion", 1, 1) == 1, "unsupported heavy unit attack version");
    if (j.contains("campaignShieldRulesVersion"))
        require(number(j, "campaignShieldRulesVersion", 1, 1) == 1, "unsupported campaign shield rules");
    if (j.contains("finalLandBossBalanceVersion"))
        number(j, "finalLandBossBalanceVersion", 1, 1);
    if (j.contains("campaignFinalAttackVersion"))
        require(number(j, "campaignFinalAttackVersion", 1, 1) == 1, "unsupported campaign final attack rules");
    if (j.contains("campaignAttackAdjustmentsVersion"))
        require(number(j, "campaignAttackAdjustmentsVersion", 1, 1) == 1, "unsupported campaign attack adjustments");
    if (j.contains("enemySubmarineMultiplierVersion"))
        require(number(j, "enemySubmarineMultiplierVersion", 1, 1) == 1, "unsupported enemy submarine multipliers");
    if (j.contains("enemyAttackBonusesVersion"))
        require(number(j, "enemyAttackBonusesVersion", 1, 1) == 1, "unsupported enemy attack bonuses");
    if (j.contains("enemyAirBalanceVersion"))
        require(number(j, "enemyAirBalanceVersion", 1, 1) == 1, "unsupported enemy air balance");
    if (j.contains("unitAbilityVersion"))
        require(number(j, "unitAbilityVersion", 1, 1) == 1, "unsupported unit abilities");
    if (j.contains("trainingVersion"))
        require(number(j, "trainingVersion", 1, 1) == 1, "unsupported training rules");
    if (j.contains("progressionVersion")) {
        require(number(j, "progressionVersion", 1, 1) == 1, "unsupported progression");
        require(j.at("buildingLimits").is_object(), "building limits missing");
        for (const auto &d : c.buildings) {
            if (d.id == "townhall") continue;
            const auto &limits = j.at("buildingLimits").at(d.id);
            require(limits.is_array() && limits.size() == c.townHallLimits.size(), "building limits length");
            int previousLimit = 0;
            for (std::size_t i = 0; i < limits.size(); ++i) {
                require(limits[i].is_number_integer(), "invalid building limit");
                int limit = limits[i].get<int>();
                require(limit >= previousLimit && limit <= static_cast<int>(d.levels.size()), "invalid building limit");
                previousLimit = limit;
                for (int level = 1; level <= limit; ++level)
                    require(d.levels[level - 1].townHall <= static_cast<int>(i + 1), "inconsistent building unlock");
            }
            require(previousLimit == static_cast<int>(d.levels.size()), "unreachable building level");
        }
        auto &research = j.at("research");
        if (j.value("academyPricingVersion", 0) >= 1)
            number(research, "additionalLevelCostPercent", 1, 100);
        if (j.contains("academyResearchVersion"))
            require(number(j, "academyResearchVersion", 1, 1) == 1, "unsupported Academy research rules");
        const int maximum = j.value("academyResearchVersion", 0) == 1 ? MaximumResearchLevel : 10;
        require(number(research, "maxLevel", maximum, maximum) == maximum, "research cap");
        require(number(research, "bonusPercentPerLevel", 5, 5) == 5, "research bonus");
        require(research.at("baseCosts").size() == static_cast<std::size_t>(maximum), "research costs length");
        for (const auto &cost : research.at("baseCosts")) stockFrom(cost);
        for (const char *domain : {"land", "naval", "air"}) number(research.at("secondsByDomain"), domain, 1, 86'400);
    }
    if (j.contains("shop")) {
        const auto &shop = j.at("shop");
        require(number(shop, "version", 1, 1) == 1, "unsupported shop version");
        const auto &offers = shop.at("offers");
        require(offers.is_array() && offers.size() == 8, "shop requires buy and sell offers for four resources");
        std::set<std::string> offerIds;
        std::map<std::pair<int, std::string>, ShopOffer> pairs;
        for (const auto &offer : offers) {
            ShopOffer parsed;
            parsed.id = offer.at("id").get<std::string>();
            parsed.direction = offer.at("direction");
            parsed.resource = offer.at("resource");
            require(!parsed.id.empty() && parsed.id.size() <= 64 && offerIds.insert(parsed.id).second, "invalid or duplicate shop offer");
            require(parsed.direction == "buy" || parsed.direction == "sell", "invalid shop direction");
            parsed.resourceIndex = -1;
            for (int resource = 0; resource < 4; ++resource)
                if (parsed.resource == resourceName(resource)) parsed.resourceIndex = resource;
            require(parsed.resourceIndex >= 0, "invalid shop resource");
            parsed.amount = number(offer, "amount", 1, 1'000'000);
            parsed.gold = number(offer, "gold", 1, 1'000'000);
            require(pairs.emplace(std::pair{parsed.resourceIndex, parsed.direction}, parsed).second, "duplicate shop direction for resource");
            c.shopOffers.push_back(parsed);
        }
        for (int resource = 0; resource < 4; ++resource) {
            require(pairs.contains({resource, "buy"}) && pairs.contains({resource, "sell"}), "missing shop offer pair");
            const auto &buy = pairs.at({resource, "buy"}), &sell = pairs.at({resource, "sell"});
            require(buy.gold * sell.amount >= sell.gold * buy.amount, "shop offers cannot generate gold by repeated exchanges");
        }
    }
    auto bt = j.at("battle");
    c.battleWidth = number(bt, "width", 6, 20);
    c.battleHeight = number(bt, "height", 4, 20);
    c.maxArmy = number(bt, "maxArmy", 1, c.battleHeight);
    c.enemies = number(bt, "enemies", 1, c.battleHeight);
    c.enemyHealth = number(bt, "enemyHealth", 1, 10000);
    c.enemyDamage = number(bt, "enemyDamage", 1, 10000);
    c.enemyAttackPercent = bt.contains("enemyAttackPercent") ? number(bt, "enemyAttackPercent", 1, 100) : 100;
    c.enemyStatPercent = bt.contains("enemyStatPercent") ? number(bt, "enemyStatPercent", 1, 100) : 100;
    c.enemyStatPasses = bt.contains("enemyStatPasses") ? number(bt, "enemyStatPasses", 1, 10) : 1;
    c.bossHealthPercent = bt.contains("bossHealthPercent") ? number(bt, "bossHealthPercent", 1, 100) : 100;
    c.bossAttackPercent = bt.contains("bossAttackPercent") ? number(bt, "bossAttackPercent", 1, 100) : 100;
    if (bt.contains("enemyHealthAdjustments")) {
        const auto &adjustments = bt.at("enemyHealthAdjustments");
        require(adjustments.is_array() && adjustments.size() <= 20, "invalid enemy health adjustments");
        for (const auto &percent : adjustments) {
            require(percent.is_number_integer() && percent >= 1 && percent <= 100, "invalid enemy health adjustment");
            c.enemyHealthAdjustments.push_back(percent.get<int>());
        }
    }
    if (bt.contains("enemyAttackAdjustments")) {
        const auto &adjustments = bt.at("enemyAttackAdjustments");
        require(adjustments.is_array() && adjustments.size() <= 20, "invalid enemy attack adjustments");
        for (const auto &adjustment : adjustments) {
            require(adjustment.is_object() && adjustment.size() == 2 && adjustment.contains("bossOnly") &&
                        adjustment.at("bossOnly").is_boolean(), "invalid enemy attack adjustment");
            c.enemyAttackAdjustments.push_back({number(adjustment, "percent", 1, 100),
                                               adjustment.at("bossOnly").get<bool>()});
        }
    }
    if (bt.contains("enemyStatAdjustments")) {
        const auto &adjustments = bt.at("enemyStatAdjustments");
        require(adjustments.is_array() && adjustments.size() <= 10, "invalid enemy stat adjustments");
        for (const auto &percent : adjustments) {
            require(percent.is_number_integer() && percent >= 1 && percent <= 100, "invalid enemy stat adjustment");
            c.enemyStatAdjustments.push_back(percent.get<int>());
        }
    }
    require(!bt.contains("enemySingleTarget") || bt.at("enemySingleTarget").is_boolean(), "enemySingleTarget must be a boolean");
    c.enemySingleTarget = bt.value("enemySingleTarget", false);
    require(!bt.contains("shieldBreakStopsDamage") || bt.at("shieldBreakStopsDamage").is_boolean(),
            "shieldBreakStopsDamage must be a boolean");
    c.shieldBreakStopsDamage = bt.value("shieldBreakStopsDamage", false);
    require(!bt.contains("attacksAlwaysHit") || bt.at("attacksAlwaysHit").is_boolean(),
            "attacksAlwaysHit must be a boolean");
    c.attacksAlwaysHit = bt.value("attacksAlwaysHit", false);
    require(!bt.contains("playerDamageMatchesAttack") || bt.at("playerDamageMatchesAttack").is_boolean(),
            "playerDamageMatchesAttack must be a boolean");
    c.playerDamageMatchesAttack = bt.value("playerDamageMatchesAttack", false);
    require(!bt.contains("playerArmorEnabled") || bt.at("playerArmorEnabled").is_boolean(),
            "playerArmorEnabled must be a boolean");
    c.playerArmorEnabled = bt.value("playerArmorEnabled", true);
    c.enemyDefense = number(bt, "enemyDefense");
    c.enemyRange = number(bt, "enemyRange", 1, 20);
    c.enemyMovement = number(bt, "enemyMovement", 1, 20);
    c.captives = number(bt, "captives");
    c.rewards = stockFrom(bt.at("rewards"));
    c.destroyEmbarkedAircraft = bt.value("destroyEmbarkedAircraft", true);
    c.enemyTierOffsets = bt.value("enemyTierOffsets", std::vector<int>{});
    require(c.enemyTierOffsets.size() <= 10, "invalid enemy tier offsets");
    for (int offset : c.enemyTierOffsets)
        require(offset >= -9 && offset <= 9, "invalid enemy tier offset");
    require(j.at("startingBuildings").is_array() && j.at("startingBuildings").size() < 26,
            "invalid starting buildings");
    if (j.contains("campaign")) {
        const auto &campaign = j.at("campaign");
        require(number(campaign, "version", 1, 1) == 1, "unsupported campaign");
        require(number(campaign, "maxAlliesPerRound", 5, 5) == 5, "campaign squad size");
        const auto &enemies = campaign.at("enemies");
        require(enemies.is_array() && !enemies.empty() && enemies.size() <= 150, "invalid campaign enemies");
        std::map<std::string, Domain> enemyDomains;
        for (const auto &enemy : enemies) {
            auto id = enemy.at("id").get<std::string>();
            auto arena = domain(enemy.at("domain"));
            require(!id.empty() && enemyDomains.emplace(id, arena).second, "duplicate campaign enemy");
            if (enemy.contains("damageMultipliers")) {
                require(enemy.at("damageMultipliers").is_boolean(), "invalid enemy damage multipliers");
                if (!enemy.at("damageMultipliers").get<bool>()) c.enemiesWithoutDamageMultipliers.insert(id);
            }
            if (enemy.contains("attackBonuses")) {
                require(enemy.at("attackBonuses").is_boolean(), "invalid enemy attack bonuses");
                if (!enemy.at("attackBonuses").get<bool>()) c.enemiesWithoutAttackBonuses.insert(id);
            }
            require(c.unit(enemy.at("unitType")).domain == arena, "campaign enemy combat type domain");
            auto kind = enemy.at("kind").get<std::string>();
            require(kind == "ordinary" || kind == "boss" || kind == "ai", "invalid campaign enemy kind");
            number(enemy, "tier", 1, 10);
            require(enemy.at("name").is_string() && enemy.at("assetPath").is_string(), "invalid campaign enemy display");
        }
        const auto &levels = campaign.at("levels");
        require(levels.is_array() && !levels.empty() && levels.size() <= 150, "invalid campaign levels");
        int expected = 1;
        for (const auto &level : levels) {
            require(number(level, "battleId", expected, expected) == expected, "campaign levels must be sequential");
            ++expected;
            number(level, "requiredTH", 1, static_cast<int>(c.townHallLimits.size()));
            if (level.contains("enemyTH")) {
                require(j.value("campaignProgressionVersion", 0) == 1, "campaign progression version required");
                number(level, "enemyTH", 1, static_cast<int>(c.townHallLimits.size()));
            }
            stockFrom(level.at("rewards"));
            const auto &rounds = level.at("rounds");
            require(rounds.is_array() && !rounds.empty() && rounds.size() <= 15, "invalid campaign rounds");
            for (const auto &round : rounds) {
                auto arena = domain(round.at("domain"));
                const auto &squad = round.at("enemies");
                require(squad.is_array() && !squad.empty() && squad.size() <= 5, "invalid campaign enemy slots");
                if (round.contains("unshieldedEnemies")) {
                    require(j.value("campaignShieldRulesVersion", 0) == 1, "campaign shield rules version required");
                    const auto &unshielded = round.at("unshieldedEnemies");
                    require(unshielded.is_array() && unshielded.size() <= squad.size(), "invalid unshielded campaign enemies");
                    std::set<std::string> unique;
                    for (const auto &id : unshielded) {
                        require(id.is_string() && std::find(squad.begin(), squad.end(), id) != squad.end(), "unshielded campaign enemy has no matching slot");
                        require(unique.insert(id.get<std::string>()).second, "duplicate unshielded campaign enemy");
                    }
                }
                if (round.contains("enemyFinalHealthPercents")) {
                    require(j.value("finalLandBossBalanceVersion", 0) == 1, "campaign final health version required");
                    const auto &percents = round.at("enemyFinalHealthPercents");
                    require(percents.is_object(), "invalid campaign final health adjustments");
                    for (auto it = percents.begin(); it != percents.end(); ++it) {
                        require(std::find(squad.begin(), squad.end(), Json(it.key())) != squad.end(),
                                "campaign final health adjustment has no matching enemy");
                        number(percents, it.key().c_str(), 1, 100);
                    }
                }
                if (round.contains("enemyFinalAttackPercents")) {
                    require(j.value("campaignFinalAttackVersion", 0) == 1, "campaign final attack version required");
                    const auto &percents = round.at("enemyFinalAttackPercents");
                    require(percents.is_object(), "invalid campaign final attack adjustments");
                    for (auto it = percents.begin(); it != percents.end(); ++it) {
                        require(std::find(squad.begin(), squad.end(), Json(it.key())) != squad.end(),
                                "campaign final attack adjustment has no matching enemy");
                        number(percents, it.key().c_str(), 1, 100);
                    }
                }
                if (round.contains("enemyAttackPercents")) {
                    const auto &percents = round.at("enemyAttackPercents");
                    require(percents.is_object(), "invalid campaign attack adjustments");
                    for (auto it = percents.begin(); it != percents.end(); ++it) {
                        require(std::find(squad.begin(), squad.end(), Json(it.key())) != squad.end(),
                                "campaign attack adjustment has no matching enemy");
                        number(percents, it.key().c_str(), 1, 100);
                    }
                }
                for (const auto &enemy : squad) {
                    auto id = enemy.get<std::string>();
                    require(enemyDomains.contains(id) && enemyDomains.at(id) == arena, "campaign round has wrong-domain enemy");
                }
            }
        }
    }
    return c;
}
const BuildingDef &Config::building(const std::string &id) const {
    return lookup(buildings, id);
}
const UnitDef &Config::unit(const std::string &id) const {
    return lookup(units, id);
}
const TechDef &Config::tech(const std::string &id) const {
    return lookup(technologies, id);
}
Result Result::success(std::string m) {
    return {true, std::move(m)};
}
Result Result::fail(std::string m) {
    return {false, std::move(m)};
}
int distance(Pos a, Pos b) {
    return std::abs(a.x - b.x) + std::abs(a.y - b.y);
}
std::string resourceName(int i) {
    static const std::array<std::string, 5> n{"food", "wood", "stone", "iron", "coins"};
    return n.at(static_cast<std::size_t>(i));
}
std::string costText(const Stock &s) {
    std::string out;
    for (int i = 0; i < 5; ++i)
        if (s[i]) {
            if (!out.empty())
                out += " · ";
            out += std::to_string(s[i]) + " " + resourceName(i);
        }
    return out.empty() ? "Free" : out;
}
} // namespace kingdom
