import { mkdir, writeFile } from "node:fs/promises";
const out = new URL("../frontend/public/assets/sprites/", import.meta.url);
await mkdir(out, { recursive: true });
const polygon = (points, fill, extra = "") =>
  `<polygon points="${points}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, width = 2) =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
const rect = (x, y, w, h, fill, r = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const ellipse = (x, y, rx, ry, fill) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const definitions = `<defs><linearGradient id="wall" x2="0.8" y2="1"><stop stop-color="#fcdfb1"/><stop offset="1" stop-color="#c4a172"/></linearGradient><linearGradient id="roof" x2="0.3" y2="1"><stop stop-color="#c5734e"/><stop offset="1" stop-color="#82452e"/></linearGradient><linearGradient id="blue" x2="0.6" y2="1"><stop stop-color="#63939c"/><stop offset="1" stop-color="#2f5968"/></linearGradient><linearGradient id="leaf" x2="0.6" y2="1"><stop stop-color="#719b68"/><stop offset="1" stop-color="#264c3e"/></linearGradient></defs>`;
function box(x, y, a, b, h, color = "url(#wall)") {
  return (
    polygon(
      `${x - a},${y - b} ${x},${y} ${x},${y - h} ${x - a},${y - b - h}`,
      color,
    ) +
    polygon(
      `${x},${y} ${x + a},${y - b} ${x + a},${y - b - h} ${x},${y - h}`,
      "#ab8c64",
    ) +
    polygon(
      `${x - a},${y - b - h} ${x},${y - 2 * b - h} ${x + a},${y - b - h} ${x},${y - h}`,
      "#e9d2a5",
    ) +
    line(x - a, y - b, x, y, "#887650", 2) +
    line(x, y, x + a, y - b, "#817052", 2)
  );
}
function roof(x, y, a, b, h, color = "url(#roof)") {
  let points = `${x - a - 5},${y - b - h} ${x},${y - 2 * b - h - 22} ${x + a + 5},${y - b - h} ${x},${y - h + 3}`;
  let s = polygon(points, color, 'stroke="#5d513e" stroke-width="1.3"');
  s += polygon(
    `${x},${y - 2 * b - h - 22} ${x + a + 5},${y - b - h} ${x},${y - h + 3}`,
    "#172a33",
    'opacity=".18"',
  );
  s += line(x - a - 5, y - b - h, x, y - h + 3, "#e4aa72", 2);
  return s;
}
function windows(x, y) {
  let s = "";
  for (let i = 0; i < 3; i++) {
    let xx = x - 38 + i * 11,
      yy = y - 34 + i * 5;
    s += polygon(
      `${xx},${yy} ${xx + 6},${yy + 3} ${xx + 6},${yy + 13} ${xx},${yy + 10}`,
      "#364d45",
    );
    s += line(xx + 3, yy + 3, xx + 3, yy + 10, "#efc875", 1.5);
  }
  return s;
}
function flag(x, y, c = "#c9a556") {
  return (
    line(x, y, x, y - 40, "#715b3d", 2) +
    polygon(
      `${x},${y - 40} ${x + 25},${y - 34} ${x + 20},${y - 26} ${x},${y - 30}`,
      c,
    ) +
    ellipse(x, y - 42, 2, 2, "#e7c876")
  );
}
function cottage(
  x = 96,
  y = 159,
  a = 43,
  b = 22,
  h = 38,
  color = "url(#roof)",
) {
  return (
    box(x, y, a, b, h) +
    windows(x, y) +
    polygon(
      `${x + 8},${y - 5} ${x + 8},${y - 26} ${x + 20},${y - 32} ${x + 20},${y - 11}`,
      "#5e624c",
    ) +
    roof(x, y, a, b, h, color) +
    box(x + 17, y - h - 13, 5, 3, 23, "#c6ad88")
  );
}
const foundation =
  polygon("14,143 96,102 178,143 96,184", "#697e60") +
  polygon("14,143 96,184 96,190 14,149", "#716951") +
  polygon("96,184 178,143 178,149 96,190", "#575b49") +
  polygon("22,143 96,106 170,143 96,180", "#a4ad7c") +
  ellipse(104, 156, 70, 26, "#344d3b44");
async function sprite(name, body, width = 192, height = 200) {
  await writeFile(
    new URL(`${name}.svg`, out),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${definitions}${body}</svg>`,
  );
}
await sprite(
  "house",
  foundation +
    cottage() +
    rect(36, 144, 8, 8, "#728852", 2) +
    ellipse(40, 141, 7, 5, "#668450"),
);
let town =
  foundation +
  box(96, 163, 58, 29, 45) +
  windows(96, 163) +
  roof(96, 163, 58, 29, 45, "url(#blue)");
for (const x of [48, 144])
  town +=
    box(x, 145, 18, 10, 64, "#e4cda5") +
    rect(x - 4, 100, 6, 14, "#405c5b", 3) +
    roof(x, 145, 20, 10, 64, "url(#blue)");
town +=
  box(96, 120, 23, 13, 56) +
  roof(96, 120, 24, 13, 56, "url(#blue)") +
  flag(96, 24) +
  polygon("87,159 87,139 96,134 105,139 105,159 96,164", "#495849");
await sprite("townhall", town);
let farm = foundation;
for (let i = 0; i < 7; i++) {
  let x = 24 + i * 12;
  farm += line(x, 139, x + 51, 164, "#766748", 7);
  for (let j = 0; j < 5; j++) {
    let xx = x + j * 10,
      yy = 138 + j * 5;
    farm +=
      line(xx, yy, xx, yy - 10, "#d4ad59", 2) +
      line(xx, yy - 5, xx - 3, yy - 9, "#e2c16a", 2) +
      line(xx, yy - 3, xx + 3, yy - 7, "#e2c16a", 2);
  }
}
farm += cottage(111, 119, 34, 18, 31);
await sprite("farm", farm);
let lumber = foundation + cottage(93, 151, 42, 22, 40, "url(#blue)");
for (let i = 0; i < 5; i++) {
  let x = 33 + i * 11;
  lumber +=
    line(x, 158, x + 29, 172, "#765233", 12) +
    ellipse(x + 29, 172, 6, 6, "#d1ac72") +
    ellipse(x + 29, 172, 3, 3, "#8d673f");
}
await sprite("lumberyard", lumber);
for (const type of ["stone", "iron"]) {
  let body = foundation;
  for (let i = 0; i < 5; i++) {
    let x = 47 + i * 23,
      y = 150 - (i % 2) * 13;
    body +=
      polygon(
        `${x - 21},${y} ${x - 15},${y - 42} ${x + 3},${y - 62} ${x + 21},${y - 17} ${x + 16},${y + 8}`,
        type === "iron" ? "#718c88" : "#a3b0a0",
      ) +
      polygon(
        `${x + 3},${y - 62} ${x + 21},${y - 17} ${x + 16},${y + 8} ${x - 1},${y - 9}`,
        type === "iron" ? "#4a686b" : "#788d82",
      );
  }
  body +=
    rect(77, 127, 39, 38, "#314542", 15) +
    line(72, 124, 121, 124, "#aa8050", 8) +
    line(75, 125, 75, 165, "#986f43", 6) +
    line(118, 125, 118, 165, "#986f43", 6) +
    line(86, 163, 75, 180, "#737d72", 3) +
    line(106, 163, 99, 185, "#737d72", 3);
  await sprite(type, body);
}
await sprite(
  "barracks",
  foundation +
    cottage(96, 157, 53, 25, 34, "url(#blue)") +
    flag(143, 112, "#ad6f4e") +
    line(49, 151, 62, 130, "#586b68", 3) +
    line(62, 154, 49, 131, "#586b68", 3),
);
await sprite(
  "academy",
  foundation +
    box(96, 164, 52, 27, 51) +
    windows(96, 161) +
    roof(96, 164, 53, 27, 51, "url(#blue)") +
    box(96, 118, 21, 12, 40) +
    ellipse(96, 65, 22, 12, "#5f8691") +
    polygon("74,65 96,37 118,65", "#668f9a") +
    flag(96, 37) +
    rect(90, 132, 11, 22, "#435f5a", 5),
);
let dock = foundation;
for (let i = 0; i < 10; i++)
  dock += line(
    24 + i * 11,
    143 - i * 3,
    70 + i * 11,
    165 - i * 3,
    "#b28b55",
    7,
  );
dock += cottage(90, 133, 35, 18, 37, "url(#blue)") + flag(145, 146);
dock +=
  polygon("111,168 143,153 171,164 149,180 129,181", "#775439") +
  polygon("117,166 143,158 163,164 146,174", "#c4a371");
await sprite("harbor", dock);
await sprite(
  "airbase",
  foundation +
    polygon("26,151 102,113 164,144 88,181", "#566c66") +
    line(44, 150, 139, 145, "#d4caa5", 3) +
    box(108, 135, 44, 22, 29, "#b8c2b0") +
    roof(108, 135, 45, 22, 29, "url(#blue)") +
    polygon("112,135 112,114 135,103 135,123", "#3c5856") +
    polygon(
      "46,163 66,151 69,134 74,151 98,157 76,161 70,169 65,164",
      "#ded7ba",
    ),
);
let tree =
  ellipse(48, 127, 27, 11, "#203e3544") + rect(45, 88, 7, 40, "#7b6547");
for (let i = 0; i < 4; i++) {
  let y = 12 + i * 22,
    a = 17 + i * 6;
  tree +=
    polygon(
      `${48},${y} ${48 + a},${y + 42} 48,${y + 50} ${48 - a},${y + 42}`,
      "url(#leaf)",
    ) + line(48 - a + 6, y + 39, 48, y + 46, "#84a071", 1.5);
}
await sprite("tree", tree, 96, 144);
await sprite(
  "rock",
  ellipse(48, 57, 31, 12, "#203e3544") +
    polygon("14,53 25,27 48,10 70,24 83,55 51,69", "#a5b3a4") +
    polygon("48,10 70,24 83,55 51,69 44,43", "#768e85") +
    polygon("25,27 48,10 56,24 45,20 38,33", "#dce0c5"),
  96,
  80,
);
for (const type of ["infantry", "raider"]) {
  let c = type === "raider" ? "#b87658" : "#5c8697";
  await sprite(
    type,
    ellipse(48, 102, 16, 7, "#233f3644") +
      line(43, 100, 43, 82, "#344a48", 6) +
      line(53, 100, 53, 82, "#344a48", 6) +
      rect(36, 61, 24, 26, c, 5) +
      line(48, 63, 48, 86, "#d2b678", 2) +
      ellipse(48, 51, 10, 12, "#e2bd89") +
      ellipse(48, 42, 12, 7, c) +
      rect(36, 42, 24, 7, c, 2) +
      line(64, 57, 64, 94, "#716047", 4) +
      line(64, 52, 64, 62, "#c4cbc1", 3),
    96,
    112,
  );
}
await sprite(
  "ship",
  ellipse(96, 147, 70, 20, "#324e4644") +
    polygon("22,126 114,87 178,122 115,166 55,160", "#78583a") +
    polygon("35,123 113,97 163,123 113,150 61,146", "#c09c65") +
    box(96, 130, 27, 15, 34, "#d4c7a4") +
    line(107, 95, 107, 35, "#74654b", 3) +
    polygon("110,36 110,94 159,89", "#eee5c7") +
    flag(80, 97),
  192,
  180,
);
await sprite(
  "aircraft",
  ellipse(96, 127, 65, 15, "#233f3644") +
    polygon(
      "20,111 78,91 92,47 100,42 107,90 176,108 178,118 105,109 105,141 95,151 84,142 84,109 20,121",
      "#d9d4b6",
    ) +
    line(95, 52, 95, 139, "#8ba1a0", 6) +
    ellipse(96, 86, 8, 15, "#537786"),
  192,
  170,
);
await writeFile(
  new URL("../crest.svg", out),
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#173538"/><path d="M13 20l11 10 8-18 8 18 11-10-4 29H17z" fill="#d8b771"/><path d="M19 53h26" stroke="#d8b771" stroke-width="3"/></svg>',
);
console.log("Created 16 original SVG sprite assets.");
