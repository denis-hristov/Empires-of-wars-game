// The supplied PNG pixels are preserved. Bounds ignore barely visible edge halos.
// Each ground plane is fitted to the isometric footprint without stretching.
const definitions = {
  townhall: {
    file: "town_hall",
    bounds: [
      [12, 74, 1247, 1173],
      [6, 51, 1252, 1198],
      [30, 51, 1251, 1201],
      [40, 89, 1225, 1195],
      [42, 43, 1224, 1217],
      [49, 39, 1220, 1214],
      [31, 34, 1230, 1232],
      [21, 38, 1239, 1228],
      [21, 50, 1233, 1231],
      [29, 46, 1230, 1222],
    ],
  },
  house: {
    file: "house",
    bounds: [
      [145, 131, 1155, 1089],
      [112, 103, 1192, 1118],
      [103, 91, 1198, 1150],
      [43, 134, 1207, 1155],
      [52, 103, 1225, 1194],
    ],
  },
  farm: {
    file: "farm",
    bounds: [
      [119, 187, 1167, 1062],
      [65, 133, 1217, 1159],
      [44, 126, 1219, 1174],
      [42, 68, 1216, 1200],
      [39, 94, 1213, 1206],
    ],
  },
  lumberyard: {
    file: "lumberyard",
    bounds: [
      [114, 156, 1131, 1052],
      [36, 98, 1219, 1147],
      [53, 109, 1204, 1160],
      [42, 114, 1214, 1146],
      [37, 97, 1231, 1150],
    ],
  },
  stone: {
    file: "stone_mine",
    bounds: [
      [100, 134, 1172, 1047],
      [64, 115, 1235, 1109],
      [15, 110, 1243, 1164],
      [26, 93, 1251, 1186],
      [27, 98, 1249, 1182],
    ],
  },
  iron: {
    file: "iron_mine",
    bounds: [
      [68, 197, 1192, 1005],
      [58, 185, 1202, 1038],
      [47, 173, 1217, 1081],
      [43, 164, 1220, 1129],
      [53, 112, 1207, 1179],
    ],
  },
  barracks: {
    file: "barracks",
    bounds: [
      [25, 38, 1231, 1181],
      [12, 53, 1244, 1161],
      [18, 74, 1240, 1175],
      [12, 72, 1245, 1175],
      [20, 40, 1243, 1178],
      [24, 58, 1236, 1211],
      [26, 62, 1242, 1216],
      [12, 64, 1244, 1229],
      [12, 60, 1247, 1227],
      [11, 50, 1242, 1220],
    ],
  },
  academy: {
    file: "academy",
    bounds: [
      [61, 128, 1202, 1070],
      [47, 71, 1240, 1126],
      [56, 79, 1226, 1166],
      [49, 28, 1229, 1219],
      [32, 30, 1227, 1213],
      [19, 36, 1244, 1194],
      [35, 50, 1220, 1205],
      [15, 46, 1238, 1223],
      [24, 49, 1234, 1217],
      [32, 50, 1235, 1239],
    ],
  },
  harbor: {
    file: "harbor",
    bounds: [
      [87, 47, 1190, 1202],
      [40, 54, 1215, 1197],
      [58, 89, 1213, 1199],
      [37, 99, 1227, 1185],
      [26, 87, 1237, 1201],
      [21, 60, 1242, 1201],
      [10, 61, 1242, 1214],
      [16, 60, 1239, 1211],
      [17, 61, 1240, 1213],
      [23, 59, 1233, 1214],
    ],
  },
  laboratory: {
    file: "magic_laboratory",
    size: [1024, 1024],
    bounds: [
      [78, 26, 961, 944],
      [61, 15, 1010, 1011],
      [59, 4, 1005, 1002],
      [70, 18, 987, 1012],
    ],
  },
  airbase: {
    file: "air_base",
    bounds: [
      [86, 202, 1178, 1012],
      [19, 178, 1238, 1093],
      [24, 174, 1234, 1112],
      [29, 107, 1236, 1117],
      [26, 104, 1238, 1126],
      [20, 103, 1242, 1156],
      [23, 97, 1237, 1180],
      [17, 72, 1236, 1191],
      [22, 73, 1231, 1200],
      [18, 57, 1233, 1222],
    ],
  },
};

export const buildingArtwork = {};
for (const [type, definition] of Object.entries(definitions)) {
  definition.bounds.forEach((bounds, index) => {
    const [left, top, right, bottom] = bounds;
    const width = right - left;
    const file = `${definition.file}_${String(index + 1).padStart(2, "0")}.png`;
    buildingArtwork[`${type}:${index + 1}`] = {
      file,
      path: `assets/buildings/${file}`,
      size: definition.size || [1254, 1254],
      level: index + 1,
      bounds,
      base: [width, width / 2],
      ground: [(left + right) / 2, bottom - width / 4],
      top,
    };
  });
}

export function buildingSpriteKey(type, level = 1) {
  if (buildingArtwork[type]) return type;
  const definition = definitions[type];
  if (!definition) return type;
  const completed = Number.isFinite(Number(level))
    ? Math.floor(Number(level))
    : 1;
  return `${type}:${Math.max(1, Math.min(definition.bounds.length, completed))}`;
}

export function completedBuildingSpriteKey(building) {
  return buildingSpriteKey(
    building.type,
    building.completedLevel ?? building.level,
  );
}

export function buildingVisualScale(type, level = 1) {
  const art = buildingArtwork[buildingSpriteKey(type, level)];
  return art ? 0.5 * 1.05 ** (art.level - 1) : 1;
}
