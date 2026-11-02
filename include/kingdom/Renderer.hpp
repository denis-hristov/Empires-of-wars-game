#pragma once
#include "kingdom/Game.hpp"
#include <SFML/Graphics.hpp>
#include <functional>

namespace kingdom {
struct Button {
    sf::FloatRect bounds;
    std::function<void()> action;
};
class Renderer {
  public:
    Renderer(Game &, const std::filesystem::path &resources, const std::filesystem::path &save,
             const std::string &startupMessage = "");
    int run(bool smoke = false, const std::filesystem::path &screenshot = {});

  private:
    Game &game;
    std::filesystem::path savePath;
    sf::RenderWindow window;
    sf::Font font;
    sf::RenderTexture map;
    sf::RenderTarget *target{};
    std::vector<Button> buttons;
    sf::Vector2f mouse{}, pan{}, dragStart{};
    float zoom{0.78f}, time{};
    bool dragging{}, paused{}, help{};
    Id selected{}, moving{}, selectedFighter{};
    std::string buildType, message;
    float messageTime{};
    int speed{1};
    bool onBattle{};
    sf::Vector2f savedPan{};
    float savedZoom{};
    void draw();
    void drawWorld();
    void drawBattle();
    void drawUI();
    void drawInspector();
    void drawHelp();
    void event(const sf::Event &);
    void click(sf::Vector2f);
    void report(Result);
    void resetSelection();
    sf::Vector2f screen(Pos p) const;
    std::optional<Pos> pick(sf::Vector2f, bool battle = false) const;
    void rect(float x, float y, float w, float h, sf::Color color, float radius = 0);
    void poly(std::initializer_list<sf::Vector2f>, sf::Color);
    void circle(float x, float y, float radius, sf::Color);
    void line(sf::Vector2f, sf::Vector2f, sf::Color, float thickness = 1);
    void text(const std::string &, float x, float y, unsigned size, sf::Color color, bool bold = false);
    float wrap(const std::string &, float x, float y, float width, unsigned size, sf::Color);
    void button(const std::string &, float x, float y, float w, float h, std::function<void()>,
                bool active = false);
    void bar(float x, float y, float w, float ratio, sf::Color);
    void tile(sf::Vector2f, sf::Color, float scale = 1);
    void tree(sf::Vector2f, float scale, int variant);
    void buildingArt(const Building &, sf::Vector2f, float scale, bool icon = false);
    void unitArt(sf::Vector2f, float scale, bool enemy, Domain domain = Domain::Land);
    void resourceIcon(int, float, float, float);
};
} // namespace kingdom
