#include "kingdom/Game.hpp"
#include <fstream>
namespace kingdom {
Config Config::load(const std::filesystem::path &p) {
    std::ifstream f(p);
    if (!f)
        throw std::runtime_error("Cannot open configuration: " + p.string());
    Json j;
    f >> j;
    return parse(j);
}
} // namespace kingdom
