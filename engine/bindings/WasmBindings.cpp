#include "kingdom/Engine.hpp"
#include <emscripten/bind.h>
EMSCRIPTEN_BINDINGS(empires_engine) {
    emscripten::class_<kingdom::Engine>("Engine")
        .constructor<>()
        .function("init", &kingdom::Engine::init)
        .function("dispatch", &kingdom::Engine::dispatch)
        .function("getState", &kingdom::Engine::getState)
        .function("getWorld", &kingdom::Engine::getWorld)
        .function("tick", &kingdom::Engine::tick)
        .function("save", &kingdom::Engine::save)
        .function("load", &kingdom::Engine::load)
        .function("version", &kingdom::Engine::version);
}
