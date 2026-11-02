#include "kingdom/Game.hpp"
#include <algorithm>
#include <stdexcept>
namespace kingdom {
namespace {
std::uint32_t hash(std::uint32_t x, std::uint32_t y, std::uint32_t seed) {
    auto h = x * 374761393u + y * 668265263u + seed * 2246822519u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return h ^ (h >> 16u);
}
int noise(int x, int y, std::uint32_t seed) {
    constexpr int scale = 5;
    int gx = x / scale, gy = y / scale, fx = x % scale, fy = y % scale;
    auto n = [&](int a, int b) {
        return static_cast<int>(hash(static_cast<std::uint32_t>(a), static_cast<std::uint32_t>(b), seed) %
                                1001);
    };
    int a = n(gx, gy) * (scale - fx) + n(gx + 1, gy) * fx,
        b = n(gx, gy + 1) * (scale - fx) + n(gx + 1, gy + 1) * fx;
    return (a * (scale - fy) + b * fy) / (scale * scale);
}
// Integer interpolation keeps native and WebAssembly terrain identical.
int smoothNoise(int x, int y, int scale, std::uint32_t seed) {
    int gx = x / scale, gy = y / scale;
    auto fade = [scale](int t) {
        t = t * 1000 / scale;
        return t * t / 1000 * (3000 - 2 * t) / 1000;
    };
    int fx = fade(x % scale), fy = fade(y % scale);
    auto sample = [&](int a, int b) { return static_cast<int>(hash(a, b, seed) % 1001); };
    int a = sample(gx, gy) * (1000 - fx) + sample(gx + 1, gy) * fx;
    int b = sample(gx, gy + 1) * (1000 - fx) + sample(gx + 1, gy + 1) * fx;
    return (a * (1000 - fy) + b * fy) / 1000000;
}
int ellipse(int x, int y, int cx, int cy, int rx, int ry, int peak) {
    auto dx = std::int64_t(x - cx), dy = std::int64_t(y - cy);
    return peak - static_cast<int>(dx * dx * 1000 / (rx * rx) + dy * dy * 1000 / (ry * ry));
}
int landscape(int x, int y, const Config &c, std::uint32_t seed) {
    int nx = (x - c.width / 2) * 2000 / c.width;
    int ny = (y - c.height / 2) * 2000 / c.height;
    int u = nx, v = ny;
    switch (hash(1, 0, seed ^ 0x9e3779b9u) % 4) {
    case 1:
        u = ny;
        v = -nx;
        break;
    case 2:
        u = -nx;
        v = -ny;
        break;
    case 3:
        u = -ny;
        v = nx;
        break;
    default:
        break;
    }
    int px = nx + 4000, py = ny + 4000;
    int warpX = (smoothNoise(px, py, 700, seed ^ 0xa511e9b3u) - 500) / 4;
    int warpY = (smoothNoise(px, py, 700, seed ^ 0x63d83595u) - 500) / 4;
    int broad = smoothNoise(px + warpX, py + warpY, 640, seed);
    int medium = smoothNoise(px + warpX, py + warpY, 240, seed ^ 0x85ebca6bu);
    int fine = smoothNoise(px, py, 80, seed ^ 0xc2b2ae35u);
    int variation = ((broad * 4 + medium * 2 + fine) / 7 - 500) * c.noiseAmplitude / 500;
    int drift = static_cast<int>(hash(2, 0, seed) % 241) - 120;
    switch (hash(0, 0, seed ^ 0x9e3779b9u) % 4) {
    case 0: { // A deep bay and warped landforms create coves and headlands.
        int coastX = u + warpX, coastY = v + warpY;
        int height = std::max(ellipse(coastX, coastY, -130, drift, 760, 690, 900),
                              ellipse(coastX, coastY, 300, -180 - drift, 600, 510, 800));
        int bay = ellipse(coastX, coastY, 620, 150 + drift, 380, 350, 900);
        return std::min(height, c.water - bay) + variation;
    }
    case 1: // Mainland reaches one map edge and tapers towards the opposite coast.
        return std::max(ellipse(u, v, -650, drift, 1550, 650, 900),
                        ellipse(u, v, 300, 150 - drift, 700, 400, 700)) +
               variation;
    case 2: {
        int height = ellipse(u, v, 0, 0, 420, 380, 850);
        height = std::max(height, ellipse(u, v, -640, -540 + drift, 300, 280, 850));
        height = std::max(height, ellipse(u, v, 620, -480 - drift, 310, 290, 850));
        height = std::max(height, ellipse(u, v, 400 + drift, 650, 300, 260, 850));
        return height + variation;
    }
    default: {
        // Keep the channel beyond the protected center even on the smallest maps.
        int offset = std::max(360, 6000 / std::min(c.width, c.height) + 140);
        int bend = (smoothNoise(u + 4000, 4000, 600, seed ^ 0x27d4eb2fu) - 500) / 3;
        int width = 90 + smoothNoise(u + 4000, 4000, 400, seed ^ 0x165667b1u) / 20;
        int river = c.water + (std::abs(v - offset - bend) - width) * 5;
        return std::min(850 + variation, river);
    }
    }
}
} // namespace
World World::generate(const Config &c, std::uint32_t seed) {
    World w{c.width, c.height, seed, {}};
    w.generator = c.generator;
    w.tiles.resize(static_cast<std::size_t>(w.width * w.height));
    for (int y = 0; y < w.height; ++y)
        for (int x = 0; x < w.width; ++x) {
            int dx = (x - w.width / 2) * 2000 / w.width, dy = (y - w.height / 2) * 2000 / w.height;
            int radial = 1000 - (dx * dx + dy * dy) / 1000;
            int v = radial + (noise(x, y, seed) - 500) * c.noiseAmplitude / 500 - 200;
            if (c.generator >= 2)
                v = landscape(x, y, c, seed);
            Terrain t = v < c.water ? Terrain::Water : v < c.sand ? Terrain::Sand : Terrain::Grass;
            int detail = static_cast<int>(
                hash(static_cast<std::uint32_t>(x), static_cast<std::uint32_t>(y), seed) % 1000);
            if (t == Terrain::Grass && v > c.forest && detail < 390)
                t = Terrain::Forest;
            if (t == Terrain::Grass && v > c.mountain && detail < 130)
                t = Terrain::Mountain;
            auto shape = hash(0, 0, seed ^ 0x9e3779b9u) % 4;
            bool closedCoast = c.generator == 1 || shape == 0 || shape == 2;
            if (closedCoast && (x == 0 || y == 0 || x == w.width - 1 || y == w.height - 1))
                t = Terrain::Water;
            w.at({x, y}) = {t, 0};
        }
    for (int y = w.height / 2 - 2; y <= w.height / 2 + 2; ++y)
        for (int x = w.width / 2 - 2; x <= w.width / 2 + 2; ++x)
            w.at({x, y}) = {Terrain::Grass, 0};
    return w;
}
bool World::contains(Pos p) const {
    return p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
}
Tile &World::at(Pos p) {
    if (!contains(p))
        throw std::out_of_range("Tile outside map");
    return tiles.at(static_cast<std::size_t>(p.y * width + p.x));
}
const Tile &World::at(Pos p) const {
    if (!contains(p))
        throw std::out_of_range("Tile outside map");
    return tiles.at(static_cast<std::size_t>(p.y * width + p.x));
}
std::vector<Pos> World::neighbors(Pos p) const {
    std::vector<Pos> r;
    for (Pos d : std::array<Pos, 4>{{{0, -1}, {-1, 0}, {1, 0}, {0, 1}}}) {
        Pos n{p.x + d.x, p.y + d.y};
        if (contains(n))
            r.push_back(n);
    }
    return r;
}
} // namespace kingdom
