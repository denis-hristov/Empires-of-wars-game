#include "kingdom/Game.hpp"
#include "kingdom/SaveCodec.hpp"
#include <fstream>
#include <stdexcept>
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif
namespace kingdom {
namespace {
void ensure(bool ok, const std::string &why) {
    if (!ok)
        throw std::runtime_error(why);
}
void replace(const std::filesystem::path &from, const std::filesystem::path &to) {
#ifdef _WIN32
    if (!MoveFileExW(from.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
        throw std::runtime_error("Atomic replacement failed");
#else
    std::filesystem::rename(from, to);
    int fd = open(to.parent_path().c_str(), O_RDONLY);
    if (fd >= 0) {
        fsync(fd);
        close(fd);
    }
#endif
}
void syncFile(const std::filesystem::path &path) {
#ifdef _WIN32
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    ensure(h != INVALID_HANDLE_VALUE, "Cannot sync save");
    bool ok = FlushFileBuffers(h) != 0;
    CloseHandle(h);
    ensure(ok, "Cannot flush save");
#else
    int fd = open(path.c_str(), O_RDWR);
    ensure(fd >= 0, "Cannot sync save");
    int result = fsync(fd);
    close(fd);
    ensure(result == 0, "Cannot flush save");
#endif
}
std::string readSave(const std::filesystem::path &path) {
    ensure(std::filesystem::file_size(path) < 16 * 1024 * 1024, "Save file too large");
    std::ifstream f(path);
    ensure(bool(f), "Cannot open save");
    return std::string(std::istreambuf_iterator<char>(f), {});
}
} // namespace
Result Game::save(const std::filesystem::path &path) const {
    try {
        validate();
        if (!path.parent_path().empty())
            std::filesystem::create_directories(path.parent_path());
        auto temp = path;
        temp += ".tmp";
        auto backup = path;
        backup += ".bak";
        auto envelope = encodeSave(*this);
        {
            std::ofstream f(temp, std::ios::binary | std::ios::trunc);
            ensure(bool(f), "Cannot create save");
            f << envelope;
            f.flush();
            ensure(bool(f), "Cannot write save");
        }
        syncFile(temp);
        if (std::filesystem::exists(path)) {
            bool valid = false;
            try {
                decodeSave(config, readSave(path));
                valid = true;
            } catch (const std::exception &) {
            }
            if (valid) {
                auto bt = backup;
                bt += ".tmp";
                std::filesystem::copy_file(path, bt, std::filesystem::copy_options::overwrite_existing);
                syncFile(bt);
                replace(bt, backup);
            }
        }
        replace(temp, path);
        return Result::success("Game saved");
    } catch (const std::exception &e) {
        return Result::fail(std::string("Save failed: ") + e.what());
    }
}
Result Game::load(const std::filesystem::path &path) {
    try {
        auto candidate = decodeSave(config, readSave(path));
        *this = std::move(candidate);
        return Result::success("Game loaded");
    } catch (const std::exception &e) {
        auto error = std::string(e.what());
        try {
            auto backup = path;
            backup += ".bak";
            auto candidate = decodeSave(config, readSave(backup));
            *this = std::move(candidate);
            return Result::success("Backup save restored");
        } catch (const std::exception &) {
        }
        return Result::fail("Cannot load save: " + error);
    }
}
} // namespace kingdom
