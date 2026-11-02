#pragma once
#include <array>
#include <cstdint>
#include <filesystem>
#include <map>
#include <nlohmann/json.hpp>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace kingdom {
using Json = nlohmann::json;
using Id = std::uint64_t;
using Stock = std::array<std::int64_t, 5>;
inline constexpr std::int64_t Micro = 1'000'000;
inline constexpr int PotionRemovalGold = 20;
inline constexpr int MaximumResearchLevel = 14;
enum class Terrain { Water, Sand, Grass, Forest, Mountain };
enum class State { Construction, Active, Upgrading };
enum class Domain { Land, Naval, Air };
struct Pos {
    int x{}, y{};
    auto operator<=>(const Pos &) const = default;
};
struct Tile {
    Terrain terrain{Terrain::Water};
    Id occupant{};
    bool operator==(const Tile &) const = default;
};
struct Level {
    Stock cost{};
    int seconds{}, townHall{1}, population{}, housing{}, rate{}, capacity{}, ratePerHour{};
};
struct BuildingDef {
    std::string id, name, description;
    int width{1}, height{1}, resource{-1}, coastal{}, queue{1};
    std::vector<Terrain> terrain;
    std::vector<Level> levels;
};
struct UnitDef {
    std::string id, name, building, technology;
    Domain domain{};
    Stock cost{};
    int level{1}, population{}, people{1}, seconds{}, health{}, damage{}, defense{}, range{}, movement{};
    int width{1}, height{1};
    int enemyBaseHealth{}, enemyBaseDamage{};
    std::string role, armorClass{"light"}, damageType{"ballistic"}, assetPath, projectile, effect;
    std::vector<Domain> validTargets;
    std::vector<std::string> abilities;
    std::map<std::string, int> damageMultipliers;
    int attackCooldown{1}, accuracy{100}, evasion{}, detection{}, targetWeight{100}, shield{},
        armorPenetration{}, splashTargets{}, splashPercent{40}, burstEvery{}, burstMultiplier{175}, carrierSlots{};
    std::vector<int> allowedAircraftTiers;
};
struct TechDef {
    std::string id, name;
    Domain domain{};
    Stock cost{};
    int academy{1}, seconds{}, damage{}, health{};
    std::vector<std::string> prerequisites;
};
struct ShopOffer {
    std::string id, direction, resource;
    int resourceIndex{};
    std::int64_t amount{}, gold{};
};
struct EnemyAttackAdjustment {
    int percent{100};
    bool bossOnly{false};
};
struct Config {
    Json raw;
    int width{}, height{}, generator{1}, stepMs{}, initialPopulation{}, settlementSeconds{}, foodCost{};
    int water{}, sand{}, forest{}, mountain{}, noiseAmplitude{};
    std::uint32_t defaultSeed{};
    Stock initialStock{}, rewards{};
    int battleWidth{}, battleHeight{}, enemies{}, enemyHealth{}, enemyDamage{}, enemyDefense{}, enemyRange{},
        enemyMovement{}, captives{}, maxArmy{};
    int enemyAttackPercent{100};
    int enemyStatPercent{100};
    int enemyStatPasses{1};
    std::vector<int> enemyStatAdjustments;
    int bossHealthPercent{100}, bossAttackPercent{100};
    std::vector<EnemyAttackAdjustment> enemyAttackAdjustments;
    std::vector<int> enemyHealthAdjustments;
    bool enemySingleTarget{false};
    bool shieldBreakStopsDamage{false};
    bool attacksAlwaysHit{false};
    bool playerDamageMatchesAttack{false};
    bool playerArmorEnabled{true};
    std::set<std::string> enemiesWithoutAttackBonuses;
    std::set<std::string> enemiesWithoutDamageMultipliers;
    std::vector<std::pair<int, int>> foodRates;
    std::vector<int> townHallLimits;
    std::vector<BuildingDef> buildings;
    std::vector<UnitDef> units;
    std::vector<TechDef> technologies;
    std::vector<ShopOffer> shopOffers;
    bool destroyEmbarkedAircraft{true};
    std::vector<int> enemyTierOffsets;
    static Config load(const std::filesystem::path &path);
    static Config parse(Json json);
    const BuildingDef &building(const std::string &id) const;
    const UnitDef &unit(const std::string &id) const;
    const TechDef &tech(const std::string &id) const;
};
struct World {
    int width{}, height{};
    std::uint32_t seed{};
    std::vector<Tile> tiles;
    int generator{1};
    static World generate(const Config &, std::uint32_t seed);
    bool contains(Pos p) const;
    Tile &at(Pos p);
    const Tile &at(Pos p) const;
    std::vector<Pos> neighbors(Pos p) const;
};
struct Training {
    std::string type;
    std::int64_t remainingMs{};
    bool awaiting{};
    std::optional<Stock> paidCost;
};
struct Building {
    Id id{};
    std::string type;
    Pos pos{};
    int level{1};
    State state{State::Active};
    std::int64_t remainingMs{}, stored{}, remainder{};
    std::vector<Training> queue;
};
struct Unit {
    Id id{}, source{};
    std::string type;
    Pos pos{};
    int health{};
    Id carrier{};
    bool reserve{};
};
struct Research {
    std::string type;
    Id academy{};
    std::int64_t remainingMs{};
    int level{};
};
struct Brewing {
    std::string type;
    std::int64_t remainingMs{};
};
struct Fighter {
    Id id{};
    std::string type;
    bool enemy{};
    Pos pos{};
    int health{}, maxHealth{}, damage{}, defense{}, range{}, movement{};
    bool moved{}, attacked{};
    Domain domain{Domain::Land};
    Domain phase{Domain::Land};
    Id carrier{};
    int shield{}, readyRound{1}, strikes{}, attacksThisTurn{};
    std::string enemyId, name, assetPath;
    int potionShield{}, defeatedPhase{-1}, stunnedUntilRound{};
};
struct BattleHit {
    Id attacker{}, target{};
    int damage{};
    int shieldDamage{};
    bool missed{};
    int healing{}, stunTurns{};
    bool attackerStunned{};
};
struct Battle {
    Id id{};
    int round{1};
    bool finished{}, victory{};
    std::vector<Fighter> fighters;
    Domain domain{Domain::Land};
    std::vector<Domain> phases{Domain::Land};
    int phaseIndex{};
    std::vector<int> outcomes;
    bool draw{}, automatic{}, enemyTurn{}, paused{};
    std::int64_t pendingMs{};
    int actions{};
    std::vector<BattleHit> lastAttacks;
    int campaignLevel{};
    bool awaitingSelection{}, retreated{};
    std::vector<Fighter> campaignArmy;
    bool doubleAttack{};
    std::int64_t animationMs{};
    std::string potionPrompt, lastPotion;
    std::uint64_t potionToken{}, potionEvent{};
    std::vector<Id> potionTargets;
};
struct BattleResult {
    Id id{};
    bool victory{};
    Stock rewards{};
    int captives{};
};
struct Result {
    bool ok{};
    std::string message;
    static Result success(std::string message = "");
    static Result fail(std::string message);
};
class Game {
  public:
    explicit Game(Config config);
    Config config;
    World world;
    Stock stock{};
    int civilian{};
    Id nextId{1}, nextBattleId{1};
    std::int64_t elapsedMs{}, settlementRemainder{}, pendingMs{};
    std::vector<Building> buildings;
    std::vector<Unit> units;
    std::vector<Research> research;
    std::array<int, 4> potions{};
    std::vector<Brewing> brewing;
    std::uint64_t potionSequence{}, shopSequence{};
    std::map<std::string, int> researchLevels;
    std::map<std::string, int> preservedResearchLevels;
    bool legacyProgression{};
    int legacyHousingCapacity{};
    int preservedArmyPopulation{};
    std::set<std::string> technologies;
    std::set<Id> appliedRewards;
    std::set<int> completedCampaignLevels;
    std::set<Pos> clearedTrees;
    std::optional<Battle> battle;
    std::vector<std::string> diagnostics;
    void newGame(std::uint32_t seed);
    void tick(std::int64_t elapsedMilliseconds);
    int housing() const;
    int military() const;
    int reserved() const;
    int population() const;
    int freeHousing() const;
    int townHallLevel() const;
    int buildingLimit(const std::string &) const;
    int completedLevel(const std::string &) const;
    Result buildingRequirements(const std::string &) const;
    bool progression() const;
    int researchLevel(const std::string &) const;
    int researchLimit(const std::string &, int academyLevel) const;
    int researchAcademyLevel(const std::string &, int targetLevel) const;
    static int researchStat(int baseStat, int level);
    static double researchBonusPercent(int level);
    int unitHealth(const std::string &) const;
    int unitDamage(const std::string &) const;
    int enemyAttackDamage(int baseDamage) const;
    int adjustedEnemyAttack(int damage, bool boss = false) const;
    int enemyMaxHealth(int baseHealth) const;
    int adjustedEnemyHealth(int health) const;
    int enemyStatValue(int baseStat) const;
    int unitShield(const std::string &, int maxHealth, int research = -1) const;
    int maxBattleShield(const Fighter &) const;
    int unitHealing(const std::string &, int maxHealth) const;
    Stock researchCost(const std::string &) const;
    int researchSeconds(const std::string &) const;
    const Level &level(const Building &) const;
    Building *findBuilding(Id);
    const Building *findBuilding(Id) const;
    Unit *findUnit(Id);
    const Unit *findUnit(Id) const;
    bool affordable(const Stock &) const;
    Result canPlace(const std::string &, Pos, Id ignore = 0) const;
    bool canPlaceUnit(const UnitDef &, Pos, Id ignore = 0) const;
    void occupyUnit(const Unit &, Id occupant);
    Result place(const std::string &, Pos);
    Result moveBuilding(Id, Pos);
    Result canMoveUnit(Id, Pos) const;
    Result moveUnit(Id, Pos);
    Result dismissUnit(Id);
    Result shopRequirements(const std::string &offer, int quantity) const;
    Result shopTrade(const std::string &offer, int quantity, std::uint64_t expectedSequence);
    Json shopOptions() const;
    Result upgradeRequirements(Id) const;
    Result upgrade(Id);
    Result collect(Id);
    Result clearTree(Pos);
    Result train(Id, const std::string &);
    Result cancelTraining(Id, int);
    Result embark(Id aircraft, Id carrier);
    Result disembark(Id aircraft);
    void destroyUnit(Id, bool combat = false);
    std::vector<std::string> trainingRequirements(Id, const std::string &) const;
    Result researchRequirements(Id, const std::string &) const;
    Result startResearch(Id, const std::string &);
    Result startBattle(const std::optional<std::vector<Id>> &selectedUnits = std::nullopt,
                       bool automatic = false, const std::map<Id, Domain> &airMissions = {});
    int campaignCurrentLevel() const;
    const Json &campaignLevelDefinition(int) const;
    Result startCampaignBattle(int level, const std::vector<Id> &selectedUnits = {}, bool automatic = false);
    Result deployCampaignRound(const std::vector<Id> &selectedUnits);
    Result retreatBattle();
    Result battleMove(Id, Pos);
    Result attack(Id, Id);
    Result heal(Id, Id);
    int potionIndex(const std::string &) const;
    int potionCount() const;
    Result brewRequirements(Id, const std::string &) const;
    Result brew(Id, const std::string &);
    Result removePotionRequirements(Id, const std::string &) const;
    Result removePotion(Id, const std::string &, std::uint64_t expectedSequence);
    Result potionRequirements(const std::string &) const;
    Result selectPotion(const std::string &);
    Result cancelPotion();
    Result usePotion(const std::string &, std::uint64_t token);
    void clearPotionEffects();
    void validateMagic() const;
    Result endTurn();
    Result finishBattle();
    Result pauseBattle();
    Result automateBattle();
    std::vector<Pos> validBattleMoves(Id) const;
    std::vector<Id> validBattleTargets(Id) const;
    std::vector<Id> validBattleHealTargets(Id) const;
    void normalizeBattleTurn();
    int attacksPerTurn(const Fighter &) const;
    int fighterAttackDamage(const Fighter &, std::optional<Domain> target = std::nullopt) const;
    int carrierAttackDamage(Id, std::optional<Domain> target = std::nullopt) const;
    void addCampaignAircraft();
    Result applyReward(const BattleResult &);
    Result save(const std::filesystem::path &) const;
    Result load(const std::filesystem::path &);
    Json serialize(bool includePersistence = true) const;
    static Game deserialize(Config, const Json &);
    void validate(bool legacySubmarineTargeting = false) const;

  private:
    void step();
    void pay(const Stock &);
    void occupy(const Building &, Id);
    std::optional<Pos> deployment(const Building &, const UnitDef &) const;
    bool unitTerrain(const UnitDef &, Pos) const;
    bool battleCanFight(bool submarinesDetectSubmerged = true) const;
    void checkBattle();
    void tickBattle(std::int64_t);
    void automaticTurn();
    Fighter campaignEnemyFighter(int levelNumber, int phaseIndex, int index) const;
    int campaignEnemyShield(int levelNumber, int phaseIndex, const Fighter &) const;
    void deployCampaignPhase();
    void syncCampaignArmy();
    void migrateCampaignArmy();
    void migrateEarlyLandCampaign();
    void returnCampaignRound();
    void validateCampaignBattle() const;
};
std::string domainName(Domain);
Domain domainFromName(const std::string &);
std::string resourceName(int index);
std::string costText(const Stock &);
int distance(Pos a, Pos b);
} // namespace kingdom
