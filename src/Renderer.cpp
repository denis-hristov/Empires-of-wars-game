#include "kingdom/Renderer.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <sstream>

namespace kingdom {
namespace {
const sf::Color Ink{31, 49, 49}, Muted{119, 134, 123}, Cream{242, 238, 218}, Paper{253, 250, 234},
    Gold{211, 171, 79}, Green{63, 113, 85}, Night{25, 49, 50}, Ocean{42, 104, 116};
sf::Color shade(sf::Color c, float f) {
    return {static_cast<std::uint8_t>(std::clamp(c.r * f, 0.f, 255.f)),
            static_cast<std::uint8_t>(std::clamp(c.g * f, 0.f, 255.f)),
            static_cast<std::uint8_t>(std::clamp(c.b * f, 0.f, 255.f)), c.a};
}
std::uint32_t visualHash(int x, int y) {
    auto h = static_cast<std::uint32_t>(x) * 374761393u + static_cast<std::uint32_t>(y) * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return h ^ (h >> 16);
}
} // namespace
Renderer::Renderer(Game &g, const std::filesystem::path &resources, const std::filesystem::path &save,
                   const std::string &startupMessage)
    : game(g), savePath(save), window(sf::VideoMode({1440, 900}), "Empires of wars", sf::Style::Default),
      font(resources / "assets/fonts/NotoSans.ttf"), map({1080, 650}) {
    window.setFramerateLimit(60);
    window.setMinimumSize(sf::Vector2u{1000, 625});
    target = &window;
    selected = game.buildings.front().id;
    event(sf::Event::Resized{window.getSize()});
    map.setSmooth(true);
    message = startupMessage.empty() ? "Welcome. Your empire begins here." : startupMessage;
    messageTime = startupMessage.empty() ? 8 : 20;
}
void Renderer::rect(float x, float y, float w, float h, sf::Color c, float radius) {
    if (w <= 0 || h <= 0)
        return;
    radius = std::min(radius, std::min(w, h) * .5f);
    if (radius <= 0) {
        sf::RectangleShape shape({w, h});
        shape.setPosition({x, y});
        shape.setFillColor(c);
        target->draw(shape);
        return;
    }
    sf::ConvexShape shape(36);
    std::size_t index = 0;
    const std::array<sf::Vector2f, 4> centers{{{x + w - radius, y + radius},
                                               {x + w - radius, y + h - radius},
                                               {x + radius, y + h - radius},
                                               {x + radius, y + radius}}};
    for (int corner = 0; corner < 4; ++corner)
        for (int step = 0; step < 9; ++step) {
            float angle = (-90.f + corner * 90.f + step * 90.f / 8.f) * 3.14159265f / 180.f;
            shape.setPoint(index++, centers[static_cast<std::size_t>(corner)] +
                                        sf::Vector2f{std::cos(angle) * radius, std::sin(angle) * radius});
        }
    shape.setFillColor(c);
    target->draw(shape);
}
void Renderer::circle(float x, float y, float r, sf::Color c) {
    sf::CircleShape s(r, 20);
    s.setOrigin({r, r});
    s.setPosition({x, y});
    s.setFillColor(c);
    target->draw(s);
}
void Renderer::poly(std::initializer_list<sf::Vector2f> points, sf::Color c) {
    sf::ConvexShape p(points.size());
    std::size_t i = 0;
    for (auto v : points)
        p.setPoint(i++, v);
    p.setFillColor(c);
    target->draw(p);
}
void Renderer::line(sf::Vector2f a, sf::Vector2f b, sf::Color c, float thick) {
    sf::RectangleShape r({std::hypot(b.x - a.x, b.y - a.y), thick});
    r.setPosition(a);
    r.setRotation(sf::radians(std::atan2(b.y - a.y, b.x - a.x)));
    r.setFillColor(c);
    target->draw(r);
}
void Renderer::text(const std::string &s, float x, float y, unsigned size, sf::Color color, bool bold) {
    sf::Text t(font, sf::String::fromUtf8(s.begin(), s.end()), size);
    t.setPosition({x, y});
    t.setFillColor(color);
    if (bold)
        t.setStyle(sf::Text::Bold);
    target->draw(t);
}
float Renderer::wrap(const std::string &s, float x, float y, float width, unsigned size, sf::Color c) {
    std::istringstream in(s);
    std::string word, row;
    float lineY = y;
    while (in >> word) {
        std::string next = row.empty() ? word : row + " " + word;
        sf::Text t(font, sf::String::fromUtf8(next.begin(), next.end()), size);
        if (t.getLocalBounds().size.x > width && !row.empty()) {
            text(row, x, lineY, size, c);
            lineY += static_cast<float>(size) + 7;
            row = word;
        } else
            row = next;
    }
    if (!row.empty()) {
        text(row, x, lineY, size, c);
        lineY += static_cast<float>(size) + 7;
    }
    return lineY;
}
void Renderer::button(const std::string &label, float x, float y, float w, float h,
                      std::function<void()> action, bool active) {
    sf::FloatRect bounds{{x, y}, {w, h}};
    bool hover = bounds.contains(mouse);
    rect(x, y, w, h, active ? Green : hover ? sf::Color(224, 224, 199) : sf::Color(230, 229, 209), 7);
    text(label, x + 13, y + (h - 20) / 2 - 1, 14, active ? Paper : Ink, true);
    buttons.push_back({bounds, std::move(action)});
}
void Renderer::bar(float x, float y, float w, float ratio, sf::Color c) {
    rect(x, y, w, 5, {215, 220, 199}, 2);
    rect(x, y, w * std::clamp(ratio, 0.f, 1.f), 5, c, 2);
}
sf::Vector2f Renderer::screen(Pos p) const {
    int cx = game.battle ? game.config.battleWidth / 2 : game.world.width / 2,
        cy = game.battle ? game.config.battleHeight / 2 : game.world.height / 2;
    float tw = game.battle ? 106.f : 54.f, th = tw * .5f;
    return {540.f + (p.x - cx - p.y + cy) * tw * .5f * zoom + pan.x,
            305.f + (p.x - cx + p.y - cy) * th * .5f * zoom + pan.y};
}
std::optional<Pos> Renderer::pick(sf::Vector2f p, bool battleMode) const {
    float tw = battleMode ? 106.f : 54.f, th = tw * .5f;
    int cx = battleMode ? game.config.battleWidth / 2 : game.world.width / 2,
        cy = battleMode ? game.config.battleHeight / 2 : game.world.height / 2;
    float a = (p.x - 540 - pan.x) / (tw * .5f * zoom), b = (p.y - 305 - pan.y) / (th * .5f * zoom);
    int gx = static_cast<int>(std::floor((a + b) * .5f)) + cx,
        gy = static_cast<int>(std::floor((b - a) * .5f)) + cy;
    for (int y = gy - 1; y <= gy + 1; ++y)
        for (int x = gx - 1; x <= gx + 1; ++x) {
            Pos cell{x, y};
            auto c = screen(cell);
            float diamond = std::abs(p.x - c.x) / (tw * .5f * zoom) + std::abs(p.y - c.y) / (th * .5f * zoom);
            if (diamond <= 1.f) {
                if (battleMode) {
                    if (x >= 0 && y >= 0 && x < game.config.battleWidth && y < game.config.battleHeight)
                        return cell;
                } else if (game.world.contains(cell))
                    return cell;
            }
        }
    return std::nullopt;
}
void Renderer::tile(sf::Vector2f p, sf::Color c, float s) {
    float a = 27 * s, b = 13.5f * s;
    poly({{p.x, p.y - b}, {p.x + a, p.y}, {p.x, p.y + b}, {p.x - a, p.y}}, c);
}
void Renderer::tree(sf::Vector2f p, float s, int variant) {
    p.y -= 2 * s;
    poly({{p.x - 12 * s, p.y},
          {p.x + 10 * s, p.y - 3 * s},
          {p.x + 24 * s, p.y + 4 * s},
          {p.x + 1 * s, p.y + 8 * s}},
         {29, 68, 49, 80});
    rect(p.x - 2 * s, p.y - 19 * s, 4 * s, 20 * s, {104, 75, 48});
    float h = (38 + variant % 3 * 7) * s;
    for (int i = 0; i < 3; ++i) {
        float top = p.y - h + i * 10 * s, half = (11 + i * 4) * s;
        poly({{p.x, top}, {p.x + half, top + 24 * s}, {p.x, top + 28 * s}, {p.x - half, top + 24 * s}},
             i % 2 ? sf::Color{42, 99, 69} : sf::Color{49, 114, 76});
        poly({{p.x, top}, {p.x + half, top + 24 * s}, {p.x, top + 28 * s}}, {37, 88, 65});
    }
}
void Renderer::buildingArt(const Building &b, sf::Vector2f p, float s, bool icon) {
    auto &d = game.config.building(b.type);
    float w = (d.width == 2 ? 31.f : 20.f) * s, h = (d.height == 2 ? 16.f : 11.f) * s;
    auto box = [&](sf::Vector2f q, float a, float z, float height, sf::Color color) {
        poly({{q.x - a, q.y - z}, {q.x, q.y}, {q.x, q.y - height}, {q.x - a, q.y - z - height}},
             shade(color, .81f));
        poly({{q.x, q.y}, {q.x + a, q.y - z}, {q.x + a, q.y - z - height}, {q.x, q.y - height}},
             shade(color, .65f));
        poly({{q.x - a, q.y - z - height},
              {q.x, q.y - 2 * z - height},
              {q.x + a, q.y - z - height},
              {q.x, q.y - height}},
             color);
    };
    auto roof = [&](sf::Vector2f q, float a, float z, float height, sf::Color color) {
        poly({{q.x - a - 3 * s, q.y - z - height},
              {q.x, q.y - 2 * z - height - 15 * s},
              {q.x + a + 3 * s, q.y - z - height},
              {q.x, q.y - height + 2 * s}},
             color);
        poly({{q.x, q.y - 2 * z - height - 15 * s},
              {q.x + a + 3 * s, q.y - z - height},
              {q.x, q.y - height + 2 * s}},
             shade(color, .73f));
    };
    auto flag = [&](float x, float y, sf::Color color) {
        line({x, y}, {x, y - 29 * s}, {214, 199, 153}, 2 * s);
        poly({{x, y - 29 * s}, {x + 15 * s, y - 25 * s}, {x, y - 19 * s}}, color);
    };
    poly({{p.x - w - 7 * s, p.y - 5 * s},
          {p.x, p.y - h * 2 - 5 * s},
          {p.x + w + 10 * s, p.y},
          {p.x + 10 * s, p.y + 13 * s}},
         {18, 54, 43, 80});
    if (b.type == "farm") {
        for (int i = 0; i < 5; ++i) {
            float xx = p.x - 30 * s + i * 10 * s;
            poly({{xx, p.y - 13 * s},
                  {xx + 5 * s, p.y - 16 * s},
                  {xx + 26 * s, p.y - 3 * s},
                  {xx + 20 * s, p.y}},
                 {119, 95, 49});
            for (int j = 0; j < 3; ++j) {
                float x = xx + 4 * s + j * 8 * s, y = p.y - 12 * s + j * 4 * s;
                line({x, y}, {x, y - 7 * s}, {218, 190, 87}, 2 * s);
            }
        }
        sf::Vector2f q{p.x + 11 * s, p.y - 12 * s};
        box(q, 13 * s, 7 * s, 18 * s, {221, 182, 124});
        roof(q, 13 * s, 7 * s, 18 * s, {181, 99, 61});
    } else if (b.type == "townhall") {
        box(p, w, h, 27 * s, {216, 210, 172});
        roof({p.x, p.y - 1 * s}, w, h, 27 * s, {77, 124, 129});
        for (float side : {-1.f, 1.f}) {
            sf::Vector2f q{p.x + side * 24 * s, p.y - 12 * s};
            box(q, 10 * s, 6 * s, 40 * s, {231, 219, 176});
            roof(q, 11 * s, 6 * s, 40 * s, {60, 112, 121});
        }
        box({p.x, p.y - 22 * s}, 13 * s, 7 * s, 49 * s, {233, 222, 178});
        roof({p.x, p.y - 22 * s}, 14 * s, 7 * s, 49 * s, {67, 124, 130});
        flag(p.x, p.y - 84 * s, Gold);
        poly({{p.x - 5 * s, p.y - 2 * s},
              {p.x - 5 * s, p.y - 18 * s},
              {p.x + 3 * s, p.y - 15 * s},
              {p.x + 3 * s, p.y + 1 * s}},
             {72, 83, 70});
    } else if (b.type == "house") {
        box(p, w, h, 20 * s, {234, 217, 173});
        roof(p, w, h, 20 * s, {187, 107, 69});
        rect(p.x - 11 * s, p.y - 24 * s, 5 * s, 7 * s, {252, 213, 124});
        poly({{p.x + 4 * s, p.y - 4 * s},
              {p.x + 4 * s, p.y - 15 * s},
              {p.x + 10 * s, p.y - 18 * s},
              {p.x + 10 * s, p.y - 7 * s}},
             {100, 91, 64});
        box({p.x + 8 * s, p.y - 29 * s}, 3 * s, 2 * s, 13 * s, {201, 191, 157});
    } else if (b.type == "lumberyard") {
        box(p, w, h, 19 * s, {179, 146, 93});
        roof(p, w, h, 19 * s, {74, 104, 92});
        for (int i = 0; i < 3; ++i) {
            line({p.x - 21 * s + i * 5 * s, p.y - 2 * s}, {p.x - 7 * s + i * 5 * s, p.y + 5 * s},
                 {111, 78, 45}, 5 * s);
            circle(p.x - 7 * s + i * 5 * s, p.y + 5 * s, 2 * s, {218, 184, 122});
        }
    } else if (b.type == "barracks") {
        box(p, w, h, 16 * s, {209, 199, 157});
        roof(p, w, h, 16 * s, {74, 107, 118});
        flag(p.x + 15 * s, p.y - 35 * s, {203, 157, 71});
        line({p.x - 8 * s, p.y - 6 * s}, {p.x - 8 * s, p.y - 21 * s}, {88, 82, 65}, 3 * s);
    } else if (b.type == "stone" || b.type == "iron") {
        auto c = b.type == "stone" ? sf::Color{147, 157, 143} : sf::Color{113, 132, 126};
        poly({{p.x - w, p.y - 4 * s},
              {p.x - 7 * s, p.y - 44 * s},
              {p.x + 8 * s, p.y - 35 * s},
              {p.x + w, p.y - 9 * s},
              {p.x, p.y + 4 * s}},
             c);
        poly({{p.x - 7 * s, p.y - 44 * s},
              {p.x + 8 * s, p.y - 35 * s},
              {p.x + w, p.y - 9 * s},
              {p.x, p.y + 4 * s}},
             shade(c, .7f));
        rect(p.x - 4 * s, p.y - 19 * s, 14 * s, 17 * s, {40, 60, 56}, 5 * s);
        line({p.x - 8 * s, p.y - 19 * s}, {p.x + 13 * s, p.y - 19 * s}, {186, 150, 95}, 4 * s);
    } else if (b.type == "academy") {
        box(p, w, h, 31 * s, {232, 220, 182});
        roof(p, w, h, 31 * s, {89, 118, 139});
        box({p.x, p.y - 20 * s}, 8 * s, 4 * s, 31 * s, {226, 211, 165});
        roof({p.x, p.y - 20 * s}, 8 * s, 4 * s, 31 * s, {87, 112, 132});
        for (int i = 0; i < 3; ++i)
            rect(p.x - 16 * s + i * 5 * s, p.y - 29 * s, 2 * s, 12 * s, {145, 151, 130});
    } else if (b.type == "harbor") {
        box(p, w + 5 * s, h + 2 * s, 4 * s, {159, 124, 77});
        for (int i = 0; i < 4; ++i)
            line({p.x - 21 * s + i * 10 * s, p.y - 11 * s}, {p.x + i * 10 * s, p.y}, {111, 86, 56}, 1 * s);
        box({p.x - 3 * s, p.y - 8 * s}, 12 * s, 6 * s, 20 * s, {219, 199, 151});
        roof({p.x - 3 * s, p.y - 8 * s}, 12 * s, 6 * s, 20 * s, {62, 113, 123});
        flag(p.x + 18 * s, p.y - 11 * s, Gold);
    } else if (b.type == "airbase") {
        box(p, w, h, 3 * s, {101, 118, 110});
        line({p.x - 22 * s, p.y - 14 * s}, {p.x + 14 * s, p.y + 2 * s}, {227, 212, 162}, 2 * s);
        box({p.x + 5 * s, p.y - 15 * s}, 21 * s, 12 * s, 22 * s, {179, 186, 166});
        roof({p.x + 5 * s, p.y - 15 * s}, 21 * s, 12 * s, 22 * s, {84, 112, 113});
    }
    if (!icon && b.state != State::Active) {
        for (float x : {-w, w}) {
            line({p.x + x, p.y}, {p.x + x, p.y - 44 * s}, {206, 174, 105}, 2 * s);
        }
        line({p.x - w, p.y - 32 * s}, {p.x + w, p.y - 32 * s}, {206, 174, 105}, 2 * s);
    }
}
void Renderer::unitArt(sf::Vector2f p, float s, bool enemy, Domain domain) {
    if (domain == Domain::Naval) {
        poly({{p.x - 19 * s, p.y - 5 * s},
              {p.x + 4 * s, p.y - 14 * s},
              {p.x + 23 * s, p.y - 4 * s},
              {p.x, p.y + 8 * s}},
             {173, 129, 77});
        rect(p.x - 4 * s, p.y - 19 * s, 9 * s, 17 * s, {224, 214, 167});
        return;
    }
    if (domain == Domain::Air) {
        poly({{p.x - 26 * s, p.y - 2 * s},
              {p.x - 3 * s, p.y - 8 * s},
              {p.x, p.y - 27 * s},
              {p.x + 5 * s, p.y - 8 * s},
              {p.x + 28 * s, p.y + 2 * s},
              {p.x + 3 * s, p.y + 2 * s},
              {p.x, p.y + 10 * s},
              {p.x - 3 * s, p.y + 1 * s}},
             {223, 218, 177});
        return;
    }
    circle(p.x, p.y, 9 * s, {18, 51, 43, 100});
    line({p.x - 3 * s, p.y}, {p.x - 3 * s, p.y - 12 * s}, {49, 67, 64}, 3 * s);
    line({p.x + 3 * s, p.y}, {p.x + 3 * s, p.y - 12 * s}, {49, 67, 64}, 3 * s);
    rect(p.x - 6 * s, p.y - 23 * s, 12 * s, 13 * s, enemy ? sf::Color{162, 79, 59} : sf::Color{68, 108, 135},
         3 * s);
    circle(p.x, p.y - 28 * s, 5 * s, {224, 186, 130});
    rect(p.x - 6 * s, p.y - 33 * s, 12 * s, 5 * s, enemy ? sf::Color{130, 69, 55} : sf::Color{53, 83, 100},
         2 * s);
    line({p.x + 9 * s, p.y - 10 * s}, {p.x + 9 * s, p.y - 29 * s}, {97, 86, 61}, 2 * s);
}
void Renderer::resourceIcon(int i, float x, float y, float s) {
    if (i == 0) {
        line({x, y + 10 * s}, {x, y - 11 * s}, Gold, 2 * s);
        for (int k = 0; k < 3; ++k) {
            poly({{x, y - k * 5 * s}, {x - 7 * s, y - k * 5 * s - 6 * s}, {x - 2 * s, y - k * 5 * s - 7 * s}},
                 Gold);
            poly({{x, y - k * 5 * s}, {x + 7 * s, y - k * 5 * s - 6 * s}, {x + 2 * s, y - k * 5 * s - 7 * s}},
                 shade(Gold, .9f));
        }
    } else if (i == 1) {
        line({x - 6 * s, y + 6 * s}, {x + 6 * s, y - 7 * s}, {139, 100, 61}, 10 * s);
        circle(x - 6 * s, y + 6 * s, 5 * s, {197, 159, 99});
        circle(x - 6 * s, y + 6 * s, 2 * s, {143, 103, 62});
    } else if (i == 2 || i == 3) {
        poly({{x - 10 * s, y + 5 * s},
              {x - 6 * s, y - 6 * s},
              {x + 3 * s, y - 10 * s},
              {x + 11 * s, y + 1 * s},
              {x + 4 * s, y + 10 * s}},
             i == 2 ? sf::Color{151, 161, 145} : sf::Color{91, 123, 127});
        poly({{x - 6 * s, y - 6 * s}, {x + 3 * s, y - 10 * s}, {x + 11 * s, y + 1 * s}, {x, y + 2 * s}},
             i == 2 ? sf::Color{188, 192, 172} : sf::Color{140, 164, 163});
    } else {
        circle(x, y, 10 * s, Gold);
        circle(x, y, 7 * s, {232, 196, 107});
        text("K", x - 4 * s, y - 9 * s, static_cast<unsigned>(12 * s), {153, 113, 52}, true);
    }
}
void Renderer::drawWorld() {
    target = &map;
    map.clear(Ocean);
    for (int y = 0; y < 650; y += 70)
        for (int x = 0; x < 1080; x += 90) {
            float drift = std::sin(time * .5f + x) * 3;
            line({float(x) + drift, float(y)}, {float(x + 18) + drift, float(y) - 2}, {64, 126, 135}, 1);
        }
    auto hover = pick({mouse.x, mouse.y - 84});
    for (int sum = 0; sum < game.world.width + game.world.height - 1; ++sum)
        for (int x = 0; x < game.world.width; ++x) {
            int y = sum - x;
            if (y < 0 || y >= game.world.height)
                continue;
            Pos cell{x, y};
            auto &t = game.world.at(cell);
            auto p = screen(cell);
            if (p.x < -100 || p.x > 1180 || p.y < -100 || p.y > 800)
                continue;
            auto h = visualHash(x, y);
            float s = zoom;
            if (t.terrain == Terrain::Water) {
                bool coast = false;
                for (auto n : game.world.neighbors(cell))
                    if (game.world.at(n).terrain != Terrain::Water)
                        coast = true;
                if (coast) {
                    tile(p, {61, 132, 137}, s);
                    if (h % 3 == 0)
                        line({p.x - 9 * s, p.y}, {p.x + 9 * s, p.y - 2 * s}, {135, 185, 170, 150}, s);
                }
                continue;
            }
            sf::Color color =
                t.terrain == Terrain::Sand ? sf::Color{211, 198, 140} : sf::Color{131, 165, 104};
            if (t.terrain == Terrain::Forest)
                color = {106, 145, 92};
            if (t.terrain == Terrain::Mountain)
                color = {130, 150, 109};
            color = shade(color, .94f + float(h % 13) / 100.f);
            auto south = Pos{x + 1, y}, east = Pos{x, y + 1};
            if (!game.world.contains(south) || game.world.at(south).terrain == Terrain::Water)
                poly({{p.x + 27 * s, p.y},
                      {p.x, p.y + 13.5f * s},
                      {p.x, p.y + 20 * s},
                      {p.x + 27 * s, p.y + 7 * s}},
                     {157, 139, 91});
            if (!game.world.contains(east) || game.world.at(east).terrain == Terrain::Water)
                poly({{p.x - 27 * s, p.y},
                      {p.x, p.y + 13.5f * s},
                      {p.x, p.y + 20 * s},
                      {p.x - 27 * s, p.y + 7 * s}},
                     {179, 157, 102});
            tile(p, color, s);
            if (!t.occupant && h % 5 == 0 && t.terrain == Terrain::Grass) {
                line({p.x, p.y}, {p.x - 2 * s, p.y - 4 * s}, {104, 139, 83}, s);
                line({p.x + 3 * s, p.y}, {p.x + 5 * s, p.y - 3 * s}, {104, 139, 83}, s);
            }
        }
    for (auto &b : game.buildings) {
        auto &d = game.config.building(b.type);
        if (b.id == selected || b.id == moving)
            for (int y = 0; y < d.height; ++y)
                for (int x = 0; x < d.width; ++x)
                    tile(screen({b.pos.x + x, b.pos.y + y}), {244, 221, 138, 155}, zoom);
    }
    if (hover && mouse.x < 1080 && mouse.y >= 84 && mouse.y < 734) {
        std::string type = buildType;
        if (moving && game.findBuilding(moving))
            type = game.findBuilding(moving)->type;
        if (!type.empty()) {
            auto &d = game.config.building(type);
            bool valid = game.canPlace(type, *hover, moving).ok;
            for (int y = 0; y < d.height; ++y)
                for (int x = 0; x < d.width; ++x)
                    tile(screen({hover->x + x, hover->y + y}),
                         valid ? sf::Color{170, 219, 133, 190} : sf::Color{218, 102, 78, 190}, zoom);
        } else
            tile(screen(*hover), {245, 231, 172, 65}, zoom);
    }
    struct Item {
        int depth;
        int kind;
        Id id;
        Pos pos;
    };
    std::vector<Item> items;
    for (int y = 0; y < game.world.height; ++y)
        for (int x = 0; x < game.world.width; ++x) {
            auto &t = game.world.at({x, y});
            if (!t.occupant && (t.terrain == Terrain::Forest || t.terrain == Terrain::Mountain))
                items.push_back({(x + y) * 2, 0, 0, {x, y}});
        }
    for (auto &b : game.buildings) {
        auto &d = game.config.building(b.type);
        items.push_back({(b.pos.x + b.pos.y + d.width + d.height - 2) * 2 + 1, 1, b.id, b.pos});
    }
    for (auto &u : game.units)
        items.push_back({(u.pos.x + u.pos.y) * 2 + 1, 2, u.id, u.pos});
    std::stable_sort(items.begin(), items.end(), [](auto &a, auto &b) { return a.depth < b.depth; });
    for (auto &item : items) {
        auto p = screen(item.pos);
        if (p.x < -100 || p.x > 1180 || p.y < -100 || p.y > 800)
            continue;
        if (item.kind == 0) {
            if (game.world.at(item.pos).terrain == Terrain::Forest)
                tree(p, zoom, static_cast<int>(visualHash(item.pos.x, item.pos.y) % 3));
            else {
                poly({{p.x - 20 * zoom, p.y},
                      {p.x - 2 * zoom, p.y - 41 * zoom},
                      {p.x + 22 * zoom, p.y - 2 * zoom},
                      {p.x, p.y + 8 * zoom}},
                     {144, 156, 137});
                poly({{p.x - 2 * zoom, p.y - 41 * zoom},
                      {p.x + 22 * zoom, p.y - 2 * zoom},
                      {p.x, p.y + 8 * zoom}},
                     {110, 130, 116});
                poly({{p.x - 9 * zoom, p.y - 24 * zoom},
                      {p.x - 2 * zoom, p.y - 41 * zoom},
                      {p.x + 7 * zoom, p.y - 26 * zoom}},
                     {222, 221, 188});
            }
        } else if (item.kind == 1) {
            auto &b = *game.findBuilding(item.id);
            auto &d = game.config.building(b.type);
            auto far = screen({b.pos.x + d.width - 1, b.pos.y + d.height - 1});
            p = {(p.x + far.x) * .5f, (p.y + far.y) * .5f + 7 * zoom};
            buildingArt(b, p, zoom);
            if (b.stored > 0) {
                float yy = p.y - (b.type == "townhall" ? 109 : 65) * zoom;
                rect(p.x - 22, yy, 44, 23, b.stored >= game.level(b).capacity ? Gold : Paper, 8);
                resourceIcon(d.resource, p.x - 11, yy + 12, .45f);
                text(std::to_string(b.stored), p.x - 2, yy + 2, 11, Ink, true);
            }
            if (b.state != State::Active) {
                int total =
                    b.state == State::Construction
                        ? game.level(b).seconds
                        : game.config.building(b.type).levels.at(static_cast<std::size_t>(b.level)).seconds;
                bar(p.x - 23, p.y + 12, 46, 1 - float(b.remainingMs) / float(std::max(1, total) * 1000),
                    Gold);
            }
            if (!b.queue.empty()) {
                bar(p.x - 23, p.y + 18, 46,
                    1 - float(b.queue.front().remainingMs) /
                            float(std::max(1, game.config.unit(b.queue.front().type).seconds) * 1000),
                    {107, 163, 190});
            }
        } else {
            auto &u = *game.findUnit(item.id);
            if (u.id == selected)
                tile(p, {242, 214, 125, 160}, zoom);
            unitArt(p, zoom, false, game.config.unit(u.type).domain);
        }
    }
    map.display();
    target = &window;
    sf::Sprite sprite(map.getTexture());
    sprite.setPosition({0, 84});
    window.draw(sprite);
}
void Renderer::drawBattle() {
    target = &map;
    map.clear({55, 88, 78});
    for (int y = 0; y < game.config.battleHeight; ++y)
        for (int x = 0; x < game.config.battleWidth; ++x) {
            auto p = screen({x, y});
            tile(p, (x + y) % 2 ? sf::Color{137, 162, 108} : sf::Color{146, 170, 117}, 106.f / 54.f * zoom);
        }
    auto selectedIt = std::find_if(game.battle->fighters.begin(), game.battle->fighters.end(),
                                   [&](auto &f) { return f.id == selectedFighter; });
    if (selectedIt != game.battle->fighters.end() && selectedIt->health > 0) {
        auto &f = *selectedIt;
        for (int y = 0; y < game.config.battleHeight; ++y)
            for (int x = 0; x < game.config.battleWidth; ++x)
                if (!f.moved && distance(f.pos, {x, y}) <= f.movement)
                    tile(screen({x, y}), {196, 219, 152, 70}, 106.f / 54.f * zoom);
        tile(screen(f.pos), {246, 217, 114, 200}, 106.f / 54.f * zoom);
    }
    auto hover = pick({mouse.x, mouse.y - 84}, true);
    if (hover && mouse.x < 1080)
        tile(screen(*hover), {244, 235, 188, 100}, 106.f / 54.f * zoom);
    auto fighters = game.battle->fighters;
    std::sort(fighters.begin(), fighters.end(),
              [](auto &a, auto &b) { return a.pos.x + a.pos.y < b.pos.x + b.pos.y; });
    for (auto &f : fighters) {
        auto p = screen(f.pos);
        if (f.health <= 0) {
            line({p.x - 7, p.y - 5}, {p.x + 7, p.y + 5}, {94, 113, 84}, 3);
            line({p.x + 7, p.y - 5}, {p.x - 7, p.y + 5}, {94, 113, 84}, 3);
            continue;
        }
        unitArt(p, 1.5f * zoom, f.enemy);
        bar(p.x - 22, p.y - 62, 44, float(f.health) / float(f.maxHealth),
            f.enemy ? sf::Color{183, 89, 65} : sf::Color{229, 197, 112});
        text(std::to_string(f.health), p.x - 10, p.y - 82, 12, Paper, true);
        if (f.moved && f.attacked)
            circle(p.x, p.y + 10, 3, Gold);
    }
    map.display();
    target = &window;
    sf::Sprite sprite(map.getTexture());
    sprite.setPosition({0, 84});
    window.draw(sprite);
}
void Renderer::drawInspector() {
    const float x = 1104, w = 312;
    float y = 113;
    if (game.battle) {
        text("EXPEDITION  /  01", x, y, 11, Muted, true);
        text("Stone Coast", x, y + 28, 25, Ink, true);
        y += 82;
        if (game.battle->finished) {
            text(game.battle->victory ? "Victory" : "Defeat", x, y, 30,
                 game.battle->victory ? Green : sf::Color{165, 75, 55}, true);
            y += 52;
            if (game.battle->victory) {
                y = wrap("The island is safe. Claim your resources and welcome new settlers.", x, y, w, 15,
                         Muted) +
                    18;
                for (int i = 0; i < 5; ++i) {
                    resourceIcon(i, x + 10, y + 12, .7f);
                    text("+" + std::to_string(game.config.rewards[i]) + " " + resourceName(i), x + 34, y, 17,
                         Ink);
                    y += 35;
                }
                text("Captives: " + std::to_string(game.config.captives), x, y + 8, 17, Ink, true);
            } else
                wrap("Your army suffered losses. Develop the island and train a new squad.", x, y, w, 16, Muted);
            button(
                game.battle->victory ? "Claim rewards" : "Return to island", x, 660, w, 46,
                [this] {
                    report(game.finishBattle());
                    resetSelection();
                },
                true);
            return;
        }
        text("Round " + std::to_string(game.battle->round) + " · Your turn", x, y, 20, Green, true);
        y += 43;
        y = wrap("Select a friendly unit. Click a free tile to move or an enemy to attack.", x, y, w,
                 14, Muted) +
            18;
        for (auto &f : game.battle->fighters)
            if (!f.enemy && f.health > 0) {
                button(
                    "Infantry  " + std::to_string(f.health) + " / " + std::to_string(f.maxHealth), x, y, w, 40,
                    [this, id = f.id] { selectedFighter = id; }, selectedFighter == f.id);
                y += 45;
                text(std::string(f.moved ? "Movement used" : "Can move") + " · " +
                         (f.attacked ? "Attack used" : "Can attack"),
                     x + 4, y, 11, Muted);
                y += 26;
            }
        button("End turn  [Space]", x, 660, w, 46, [this] { report(game.endTurn()); }, true);
        return;
    }
    std::string type = buildType;
    if (moving && game.findBuilding(moving))
        type = game.findBuilding(moving)->type;
    if (!type.empty()) {
        auto &d = game.config.building(type);
        text(moving ? "MOVE BUILDING" : "NEW BUILDING", x, y, 11, Muted, true);
        text(d.name, x, y + 29, 25, Ink, true);
        y += 86;
        y = wrap(d.description, x, y, w, 15, Muted) + 25;
        if (!moving) {
            text("REQUIRED RESOURCES", x, y, 11, Muted, true);
            y += 30;
            for (int i = 0; i < 5; ++i)
                if (d.levels.front().cost[i]) {
                    resourceIcon(i, x + 12, y + 12, .7f);
                    text(std::to_string(d.levels.front().cost[i]) + " " + resourceName(i), x + 36, y, 17,
                         Ink);
                    y += 34;
                }
            text("Build time: " + std::to_string(d.levels.front().seconds) + " seconds", x, y + 10, 14, Muted);
            y += 60;
        }
        y = wrap("Choose a location. Green tiles indicate a valid placement.", x, y, w, 15, Green) +
            18;
        if (auto p = pick({mouse.x, mouse.y - 84}); p) {
            auto r = game.canPlace(type, *p, moving);
            if (!r.ok)
                wrap(r.message, x, y, w, 14, {169, 78, 54});
        }
        button("Cancel  [Esc]", x, 660, w, 42, [this] {
            buildType.clear();
            moving = 0;
        });
        return;
    }
    if (auto u = game.findUnit(selected)) {
        auto &d = game.config.unit(u->type);
        text("YOUR ARMY", x, y, 11, Muted, true);
        text(d.name, x, y + 29, 25, Ink, true);
        text("Health: " + std::to_string(u->health) + " / " + std::to_string(d.health), x, y + 85, 17, Ink);
        bar(x, y + 124, w, float(u->health) / d.health, Green);
        wrap("Click a reachable free tile to move this unit.", x, y + 155, w, 15, Muted);
        return;
    }
    auto b = game.findBuilding(selected);
    if (!b) {
        text("YOUR ISLAND", x, y, 11, Muted, true);
        text("Build your legacy.", x, y + 32, 25, Ink, true);
        wrap("Select a building on the map or start construction from the menu below.", x, y + 90, w, 16, Muted);
        return;
    }
    auto &d = game.config.building(b->type);
    auto &l = game.level(*b);
    text("ISLAND MANAGEMENT", x, y, 11, Muted, true);
    text(d.name, x, y + 28, 25, Ink, true);
    rect(x + 244, y + 30, 68, 27, {226, 227, 201}, 5);
    text("Level " + std::to_string(b->level), x + 253, y + 34, 12, Green, true);
    y += 83;
    y = wrap(d.description, x, y, w, 14, Muted) + 18;
    if (b->state != State::Active) {
        text(b->state == State::Construction ? "Under construction" : "Upgrading", x, y, 17, Green, true);
        text(std::to_string((b->remainingMs + 999) / 1000) + " seconds remaining", x, y + 30, 14, Muted);
        return;
    }
    if (d.resource >= 0) {
        text("LOCAL STORAGE", x, y, 11, Muted, true);
        y += 24;
        resourceIcon(d.resource, x + 12, y + 17, .8f);
        text(std::to_string(b->stored) + " / " + std::to_string(l.capacity), x + 38, y, 25, Ink, true);
        text("+" + std::to_string(l.rate) + " / sec", x + 238, y + 8, 13, Muted);
        y += 42;
        bar(x, y, w, float(b->stored) / std::max(1, l.capacity), b->stored >= l.capacity ? Gold : Green);
        y += 19;
        text(b->stored >= l.capacity ? "Storage is full. Collect your resources."
                                     : "Production runs automatically",
             x, y, 12, Muted);
        y += 29;
        button(
            "Collect " + resourceName(d.resource) + "  [C]", x, y, w, 42,
            [this, id = b->id] { report(game.collect(id)); }, true);
        y += 62;
    }
    if (b->type == "house") {
        text(std::to_string(l.housing) + " housing spaces", x, y, 24, Green, true);
        y += 48;
    }
    if (b->type == "townhall") {
        text("PROGRESSION", x, y, 11, Muted, true);
        y += 26;
        text("Buildings up to level " +
                 std::to_string(game.config.townHallLimits.at(static_cast<std::size_t>(b->level - 1))),
             x, y, 18, Ink, true);
        y += 37;
    }
    for (auto &u : game.config.units)
        if (u.building == b->type) {
            text(u.name, x, y, 19, Ink, true);
            y += 30;
            y = wrap(costText(u.cost) + " · " + std::to_string(u.seconds) + " sec", x, y, w, 12, Muted) + 9;
            auto why = game.trainingRequirements(b->id, u.id);
            for (auto &reason : why)
                y = wrap(reason, x, y, w, 12, {166, 100, 62}) + 1;
            button(
                "Train " + u.name, x, y, w, 40,
                [this, id = b->id, type = u.id] { report(game.train(id, type)); }, why.empty());
            y += 53;
            for (auto &q : b->queue) {
                text(q.awaiting ? "Waiting for deployment space"
                                : game.config.unit(q.type).name + " · " +
                                      std::to_string((q.remainingMs + 999) / 1000) + " sec",
                     x, y, 13, Muted);
                y += 25;
            }
        }
    if (b->type == "academy") {
        for (auto &t : game.config.technologies) {
            bool done = game.technologies.contains(t.id);
            bool running = false;
            std::int64_t remaining = 0;
            for (auto &r : game.research)
                if (r.type == t.id) {
                    running = true;
                    remaining = r.remainingMs;
                }
            text(t.name, x, y, 16, Ink, true);
            y += 26;
            text(done      ? "Researched"
                 : running ? "Remaining: " + std::to_string((remaining + 999) / 1000) + " sec"
                           : "Academy level " + std::to_string(t.academy),
                 x, y, 12, Muted);
            y += 23;
            if (!done && !running) {
                y = wrap(costText(t.cost), x, y, w, 11, Muted) + 6;
                button(
                    "Research", x, y, w, 33,
                    [this, id = b->id, type = t.id] { report(game.startResearch(id, type)); }, true);
                y += 44;
            } else
                y += 8;
        }
    }
    y = std::max(y, 550.f);
    if (b->level < static_cast<int>(d.levels.size())) {
        auto &next = d.levels.at(static_cast<std::size_t>(b->level));
        y = wrap(costText(next.cost), x, y, w, 11, Muted) + 7;
        button("Upgrade to level " + std::to_string(b->level + 1), x, y, w, 39,
               [this, id = b->id] { report(game.upgrade(id)); });
        y += 48;
    } else {
        text("Maximum level", x, y, 13, Green);
        y += 29;
    }
    if (y < 690)
        button("Move building", x, y, w, 36, [this, id = b->id] {
            moving = id;
            buildType.clear();
        });
}
void Renderer::drawUI() {
    target = &window;
    rect(0, 0, 1440, 84, Night);
    rect(0, 81, 1440, 3, Gold);
    poly({{26, 30}, {31, 40}, {39, 26}, {47, 40}, {52, 30}, {50, 52}, {28, 52}}, Gold);
    text("EMPIRES", 67, 16, 14, {187, 204, 184}, true);
    text("OF WARS", 65, 32, 26, Paper, true);
    for (int i = 0; i < 5; ++i) {
        float x = 260.f + i * 145.f;
        resourceIcon(i, x, 40, 1);
        text(resourceName(i), x + 23, 15, 11, {164, 191, 180});
        text(std::to_string(game.stock[i]), x + 23, 33, 23, Paper, true);
    }
    line({1005, 20}, {1005, 64}, {65, 86, 77});
    text("POPULATION", 1030, 15, 11, {164, 191, 180});
    text(std::to_string(game.population()) + " / " + std::to_string(game.housing()), 1030, 33, 23, Paper,
         true);
    text("Civilians " + std::to_string(game.civilian) + "   Army " + std::to_string(game.military()), 1195, 26,
         12, {200, 214, 193});
    text("Free housing " + std::to_string(game.freeHousing()), 1195, 45, 12, {156, 186, 170});
    rect(1080, 84, 360, 816, Paper);
    rect(1079, 84, 1, 816, {30, 67, 64, 100});
    rect(22, 104, 215, 64, {25, 55, 53, 225}, 9);
    text(game.battle ? "MILITARY EXPEDITION" : "ISLAND  /  " + std::to_string(game.world.seed), 38, 115, 10,
         {177, 206, 185}, true);
    text(game.battle ? "Stone Coast" : "New beginnings", 38, 134, 20, Paper, true);
    button("?", 1018, 104, 40, 36, [this] { help = !help; });
    button("+", 1018, 150, 40, 36, [this] { zoom = std::min(1.6f, zoom + .1f); });
    button("−", 1018, 192, 40, 36, [this] { zoom = std::max(.4f, zoom - .1f); });
    button("Center", 962, 650, 96, 33, [this] {
        pan = {};
        zoom = game.battle ? 1.f : .78f;
    });
    if (!game.battle) {
        rect(22, 660, 610, 47, {25, 55, 53, 220}, 7);
        text("Right-drag to pan  ·  Scroll to zoom  ·  Click to select", 37, 674, 12, {225, 232, 206});
    }
    drawInspector();
    rect(0, 734, 1080, 166, Cream);
    text(game.battle ? "TACTICAL MAP" : "CONSTRUCTION", 24, 748, 11, Muted, true);
    text(game.battle ? "One move and one attack per unit per turn."
                     : "Choose a building and an empty location on your island.",
         220, 748, 12, Muted);
    if (!game.battle) {
        int n = 0;
        for (auto &d : game.config.buildings) {
            if (d.id == "townhall")
                continue;
            float x = 20.f + n * 116.f;
            sf::FloatRect bounds{{x, 777}, {108, 91}};
            bool active = buildType == d.id, hover = bounds.contains(mouse);
            rect(x, 777, 108, 91,
                 active  ? sf::Color{206, 219, 179}
                 : hover ? sf::Color{232, 232, 205}
                         : Paper,
                 8);
            Building sample;
            sample.type = d.id;
            sample.level = 1;
            buildingArt(sample, {x + 54, 829}, .62f, true);
            text(d.name, x + 7, 845, d.name.size() > 25 ? 10 : 11, Ink, true);
            buttons.push_back({bounds, [this, type = d.id] {
                                   buildType = type;
                                   moving = 0;
                                   selected = 0;
                               }});
            ++n;
        }
    } else {
        int friendly = 0, enemy = 0;
        for (auto &f : game.battle->fighters)
            if (f.health > 0) {
                if (f.enemy)
                    ++enemy;
                else
                    ++friendly;
            }
        text("Your squad: " + std::to_string(friendly), 27, 794, 22, Green, true);
        text("Enemies: " + std::to_string(enemy), 325, 794, 22, {162, 83, 58}, true);
        text("Island production is paused during battle.", 27, 842, 13, Muted);
    }
    text("EMPIRES OF WARS  ·  CLASSIC EDITION", 24, 882, 9, Muted, true);
    text("Local game  /  Prototype balance", 771, 881, 10, Muted);
    if (!game.battle) {
        button("Begin expedition", 1104, 744, 312, 46, [this] { report(game.startBattle()); }, true);
    }
    button("Save  [F5]", 1104, 804, 150, 36, [this] { report(game.save(savePath)); });
    button("Load  [F9]", 1266, 804, 150, 36, [this] {
        auto r = game.load(savePath);
        report(r);
        if (r.ok)
            resetSelection();
    });
    button(paused ? "Resume" : "Pause", 1104, 850, 150, 32, [this] { paused = !paused; });
    button(std::to_string(speed) + "x speed", 1266, 850, 150, 32, [this] { speed = speed == 1 ? 3 : 1; });
    if (messageTime > 0 && !message.empty()) {
        rect(240, 101, 690, 68, {243, 239, 218, 245}, 9);
        wrap(message, 257, 113, 655, 14, Ink);
    }
    if (paused) {
        rect(440, 370, 200, 58, {27, 52, 48, 235}, 10);
        text("PAUSED", 492, 382, 25, Paper, true);
    }
    if (help)
        drawHelp();
}
void Renderer::drawHelp() {
    buttons.clear();
    rect(0, 84, 1440, 816, {13, 34, 34, 170});
    rect(350, 175, 740, 534, Paper, 15);
    text("Your first island", 388, 204, 31, Ink, true);
    text("Five steps to your first victory", 388, 253, 16, Muted);
    const std::array<std::string, 5> steps{"Collect food from your Farm and wood from your Lumberyard.",
                                           "Build houses. Free housing and food attract settlers.",
                                           "Select the Barracks and train 3 infantry for your first expedition.",
                                           "In battle, select a unit, move it and attack a nearby enemy.",
                                           "End your turn, defeat the enemies and claim your reward."};
    float y = 302;
    for (std::size_t i = 0; i < steps.size(); ++i) {
        circle(405, y + 14, 15, Green);
        text(std::to_string(i + 1), 400, y + 3, 15, Paper, true);
        wrap(steps[i], 437, y, 600, 15, Ink);
        y += 58;
    }
    text("F5 save   ·   F9 load   ·   Esc cancel   ·   Space end turn", 389, 610, 12, Muted);
    button("Let's begin", 388, 647, 664, 40, [this] { help = false; }, true);
}
void Renderer::draw() {
    buttons.clear();
    if (bool(game.battle) != onBattle) {
        if (game.battle) {
            savedPan = pan;
            savedZoom = zoom;
            pan = {};
            zoom = 1.f;
            selectedFighter = 0;
            for (auto &f : game.battle->fighters)
                if (!f.enemy) {
                    selectedFighter = f.id;
                    break;
                }
        } else {
            pan = savedPan;
            zoom = savedZoom;
        }
        onBattle = bool(game.battle);
    }
    window.clear(Night);
    if (game.battle)
        drawBattle();
    else
        drawWorld();
    drawUI();
    window.display();
}
void Renderer::report(Result r) {
    message = r.message;
    messageTime = 6;
}
void Renderer::resetSelection() {
    selected = game.buildings.empty() ? 0 : game.buildings.front().id;
    moving = 0;
    buildType.clear();
    selectedFighter = 0;
}
void Renderer::click(sf::Vector2f p) {
    for (auto it = buttons.rbegin(); it != buttons.rend(); ++it)
        if (it->bounds.contains(p)) {
            auto action = it->action;
            action();
            return;
        }
    if (help || p.x >= 1080 || p.y < 84 || p.y >= 734)
        return;
    auto cell = pick({p.x, p.y - 84}, bool(game.battle));
    if (!cell)
        return;
    if (game.battle) {
        if (game.battle->finished)
            return;
        for (auto &f : game.battle->fighters)
            if (f.pos == *cell && f.health > 0) {
                if (f.enemy)
                    report(game.attack(selectedFighter, f.id));
                else
                    selectedFighter = f.id;
                return;
            }
        report(game.battleMove(selectedFighter, *cell));
        return;
    }
    if (!buildType.empty()) {
        auto r = game.place(buildType, *cell);
        report(r);
        if (r.ok) {
            selected = game.buildings.back().id;
            buildType.clear();
        }
        return;
    }
    if (moving) {
        auto r = game.moveBuilding(moving, *cell);
        report(r);
        if (r.ok) {
            selected = moving;
            moving = 0;
        }
        return;
    }
    auto occupant = game.world.at(*cell).occupant;
    if (occupant) {
        selected = occupant;
        return;
    }
    if (game.findUnit(selected)) {
        report(game.moveUnit(selected, *cell));
        return;
    }
    selected = 0;
}
void Renderer::event(const sf::Event &e) {
    if (e.is<sf::Event::Closed>()) {
        auto r = game.save(savePath);
        if (!r.ok)
            std::cerr << r.message << '\n';
        window.close();
    }
    if (auto r = e.getIf<sf::Event::Resized>()) {
        sf::View view({720, 450}, {1440, 900});
        float aspect = float(r->size.x) / float(r->size.y), desired = 1.6f;
        if (aspect > desired)
            view.setViewport({{(1 - desired / aspect) / 2, 0}, {desired / aspect, 1}});
        else
            view.setViewport({{0, (1 - aspect / desired) / 2}, {1, aspect / desired}});
        window.setView(view);
    }
    if (auto m = e.getIf<sf::Event::MouseMoved>()) {
        mouse = window.mapPixelToCoords(m->position);
        if (dragging) {
            pan += mouse - dragStart;
            dragStart = mouse;
        }
    }
    if (auto m = e.getIf<sf::Event::MouseButtonPressed>()) {
        mouse = window.mapPixelToCoords(m->position);
        if (m->button == sf::Mouse::Button::Left)
            click(mouse);
        else if (m->button == sf::Mouse::Button::Right && mouse.x < 1080 && mouse.y >= 84 && mouse.y < 734) {
            dragging = true;
            dragStart = mouse;
        }
    }
    if (auto m = e.getIf<sf::Event::MouseButtonReleased>(); m && m->button == sf::Mouse::Button::Right)
        dragging = false;
    if (auto wheel = e.getIf<sf::Event::MouseWheelScrolled>();
        wheel && mouse.x < 1080 && mouse.y >= 84 && mouse.y < 734) {
        float previous = zoom;
        zoom = std::clamp(zoom + wheel->delta * .07f, .4f, 1.6f);
        sf::Vector2f anchor{mouse.x - 540, mouse.y - 84 - 305};
        pan = anchor - (anchor - pan) * (zoom / previous);
    }
    if (auto key = e.getIf<sf::Event::KeyPressed>()) {
        using K = sf::Keyboard::Key;
        if (key->code == K::Escape) {
            help = false;
            buildType.clear();
            moving = 0;
        }
        if (key->code == K::F5)
            report(game.save(savePath));
        if (key->code == K::F9) {
            auto r = game.load(savePath);
            report(r);
            if (r.ok)
                resetSelection();
        }
        if (key->code == K::C && !game.battle)
            report(game.collect(selected));
        if (key->code == K::Space) {
            if (game.battle)
                report(game.endTurn());
            else
                paused = !paused;
        }
        if (key->code == K::H)
            help = !help;
    }
}
int Renderer::run(bool smoke, const std::filesystem::path &screenshot) {
    sf::Clock clock;
    std::int64_t residualUs = 0;
    int frames = 0;
    while (window.isOpen()) {
        while (auto e = window.pollEvent())
            event(*e);
        if (!window.isOpen())
            break;
        auto dt = clock.restart();
        time += dt.asSeconds();
        messageTime = std::max(0.f, messageTime - dt.asSeconds());
        if (!paused && !help) {
            residualUs += std::min<std::int64_t>(dt.asMicroseconds(), 250000) * speed;
            auto ms = residualUs / 1000;
            residualUs %= 1000;
            game.tick(ms);
        }
        draw();
        ++frames;
        if (smoke && frames == 8) {
            if (!screenshot.empty()) {
                sf::Texture capture(window.getSize());
                capture.update(window);
                if (!capture.copyToImage().saveToFile(screenshot))
                    return 2;
            }
            game.validate();
            window.close();
        }
    }
    return 0;
}
} // namespace kingdom
