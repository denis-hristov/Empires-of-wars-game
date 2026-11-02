#include "kingdom/Renderer.hpp"
#include <iostream>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
#ifdef _WIN32
#include <windows.h>
#endif
namespace fs = std::filesystem;
fs::path executablePath(const char *argv) {
#ifdef __APPLE__
    std::uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::string path(size, '\0');
    _NSGetExecutablePath(path.data(), &size);
    return fs::weakly_canonical(path.c_str());
#elif defined(_WIN32)
    std::wstring path(32768, L'\0');
    auto n = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    path.resize(n);
    return fs::path(path);
#else
    return fs::absolute(argv);
#endif
    (void)argv;
}
int main(int argc, char **argv) {
    try {
        auto executable = executablePath(argv[0]);
        auto resources = executable.parent_path();
#ifdef __APPLE__
        if (resources.filename() == "MacOS")
            resources = resources.parent_path() / "Resources";
#endif
        bool smoke = false;
        fs::path screenshot;
        fs::path save;
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--resources" && i + 1 < argc)
                resources = argv[++i];
            else if (arg == "--smoke")
                smoke = true;
            else if (arg == "--screenshot" && i + 1 < argc)
                screenshot = argv[++i];
            else if (arg == "--save" && i + 1 < argc)
                save = argv[++i];
        }
        if (save.empty()) {
#ifdef _WIN32
            auto base = std::getenv("LOCALAPPDATA");
            save = (base ? fs::path(base) : resources) / "GameKingdom" / "kingdom.save.json";
#elif defined(__APPLE__)
            auto base = std::getenv("HOME");
            save = (base ? fs::path(base) : resources) / "Library" / "Application Support" / "GameKingdom" /
                   "kingdom.save.json";
#else
            auto base = std::getenv("XDG_DATA_HOME");
            auto home = std::getenv("HOME");
            save = (base   ? fs::path(base)
                    : home ? fs::path(home) / ".local/share"
                           : resources) /
                   "GameKingdom" / "kingdom.save.json";
#endif
        }
        auto config = kingdom::Config::load(resources / "config/game.json");
        kingdom::Game game(config);
        game.newGame(config.defaultSeed);
        std::string startupMessage;
        if (!smoke && fs::exists(save)) {
            auto result = game.load(save);
            startupMessage = result.message;
            if (!result.ok)
                std::cerr << result.message << '\n';
        }
        kingdom::Renderer renderer(game, resources, save, startupMessage);
        return renderer.run(smoke, screenshot);
    } catch (const std::exception &e) {
        std::cerr << "Empires of wars: " << e.what() << '\n';
        return 1;
    }
}
