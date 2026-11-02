#pragma once
#include "Game.hpp"
#include <memory>
namespace kingdom {
class Engine {
  public:
    std::string init(const std::string &);
    std::string dispatch(const std::string &);
    std::string getState() const;
    std::string getWorld() const;
    std::string tick(int milliseconds);
    std::string save() const;
    std::string load(const std::string &);
    std::string version() const;

  private:
    std::unique_ptr<Game> game;
    std::optional<Config> newGameConfig;
    std::uint64_t revision{};
    std::string result(const Result &, const std::string &code = "RULE_REJECTED") const;
    void requireGame() const;
};
} // namespace kingdom
