#include "kingdom/Engine.hpp"
#include <fstream>
#include <iostream>
int main(int argc, char **argv) {
    std::ifstream input(EMPIRES_CONFIG);
    std::string config{std::istreambuf_iterator<char>(input), {}};
    kingdom::Engine engine;
    engine.init(config);
    if (argc > 1) {
        std::ifstream saved(argv[1]);
        std::string bytes{std::istreambuf_iterator<char>(saved), {}};
        auto loaded = kingdom::Json::parse(engine.load(bytes));
        if (!loaded.at("ok")) { std::cerr << loaded.dump(); return 1; }
        engine.dispatch(R"({"type":"BATTLE_START","payload":{"automatic":true}})");
        for (int i = 0; i < 4000; ++i) engine.tick(250);
        std::cout << kingdom::Json{{"world", kingdom::Json::parse(engine.getWorld())}, {"state", kingdom::Json::parse(engine.getState())}}.dump();
        return 0;
    }
    for (int i = 0; i < 40; ++i)
        engine.tick(250);
    auto state = kingdom::Json::parse(engine.getState());
    auto id = state["buildings"][0]["id"];
    engine.dispatch(kingdom::Json{{"type", "COLLECT"}, {"payload", {{"id", id}}}}.dump());
    std::cout << kingdom::Json{{"world", kingdom::Json::parse(engine.getWorld())},
                               {"state", kingdom::Json::parse(engine.getState())}}
                     .dump();
}
