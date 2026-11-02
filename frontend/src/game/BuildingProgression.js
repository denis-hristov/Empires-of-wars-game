export function completedBuildingLevel(building) {
  if (!building) return 0;
  return building.completedLevel ?? (building.state === 0 ? 0 : building.level);
}

export function productionIntervalSeconds(production) {
  if (production?.intervalSeconds > 0) return production.intervalSeconds;
  const rate =
    production?.ratePerHour > 0
      ? production.ratePerHour / 3600
      : (production?.ratePerSecond ?? production?.rate ?? 0);
  return rate > 0 ? Math.max(1, Math.round(1 / rate)) : 0;
}

export function upgradeGoldShortage(state, cost) {
  const required = Array.isArray(cost) ? cost[4] : cost?.coins;
  const available = Array.isArray(state.stock)
    ? state.stock[4]
    : state.stock?.coins;
  return Math.max(0, (required ?? 0) - (available ?? 0));
}

export function completedLevelForType(state, type) {
  return state.buildings.reduce(
    (highest, building) =>
      building.type === type
        ? Math.max(highest, completedBuildingLevel(building))
        : highest,
    0,
  );
}

export function researchAcademy(state) {
  const academies = state.buildings.filter(
    (building) => building.type === "academy",
  );
  const active = academies.filter((building) => building.state === 1);
  return (active.length ? active : academies).reduce(
    (best, building) =>
      !best || completedBuildingLevel(building) > completedBuildingLevel(best)
        ? building
        : best,
    null,
  );
}

export function researchProjectDetails(project, config) {
  const definition = project.level
    ? config.units.find((unit) => unit.id === project.type)
    : config.technologies?.find((technology) => technology.id === project.type);
  return {
    name: definition?.name ?? project.type,
    detail: project.level
      ? `Research level ${project.level}`
      : "Legacy technology research",
  };
}

export function buildingLevelCap(config, type, townHallLevel) {
  if (townHallLevel < 1) return 0;
  const limits = config.buildingLimits?.[type];
  if (limits) return limits[Math.min(townHallLevel, limits.length) - 1] ?? 0;
  const definition = config.buildings.find((building) => building.id === type);
  return (
    definition?.levels.filter(
      (level) => level.townHallRequired <= townHallLevel,
    ).length ?? 0
  );
}

export function townHallRequirements(state, config) {
  const level = completedBuildingLevel(
    state.buildings.find((building) => building.type === "townhall"),
  );
  const maximum =
    config.buildings.find((building) => building.id === "townhall")?.levels
      .length ?? 10;
  if (level < 1 || level >= maximum) return [];
  const requirements = [
    ["barracks", level],
    ["farm", buildingLevelCap(config, "farm", level)],
    ["lumberyard", buildingLevelCap(config, "lumberyard", level)],
  ];
  if (level + 1 === 4) requirements.push(["stone", 2]);
  if (level + 1 === 6) requirements.push(["iron", 2]);
  const buildings = requirements.map(([type, required]) => {
    const current = completedLevelForType(state, type);
    return {
      type,
      name:
        config.buildings.find((building) => building.id === type)?.name ?? type,
      required,
      current,
      met: current >= required,
    };
  });
  const requiredPopulation =
    config.buildings.find((building) => building.id === "townhall")?.levels[
      level
    ]?.populationRequired ?? 0;
  if (requiredPopulation > 0) {
    const current =
      state.population?.capacity ??
      state.buildings.reduce((total, building) => {
        const completed = completedBuildingLevel(building);
        const definition = config.buildings.find(
          (entry) => entry.id === building.type,
        );
        return (
          total +
          (completed > 0
            ? (definition?.levels[completed - 1]?.housing ?? 0)
            : 0)
        );
      }, 0);
    buildings.push({
      type: "population",
      name: "Population capacity",
      required: requiredPopulation,
      current,
      met: current >= requiredPopulation,
    });
  }
  return buildings;
}

export function researchUnitCap(definition, academyLevel = 10) {
  const academy = Math.max(0, Math.min(10, academyLevel));
  return (
    Math.max(0, academy - definition.level + 1) +
    Math.max(0, academy - Math.max(7, definition.level) + 1)
  );
}

export function researchBonusPercent(level) {
  const rank = BigInt(Math.max(0, Math.min(14, Math.trunc(level || 0))));
  const numerator = 21n ** rank;
  const denominator = 20n ** rank;
  return (
    Number(
      ((numerator - denominator) * 10000n + denominator / 2n) / denominator,
    ) / 100
  );
}

export function researchedStat(base, level) {
  const rank = BigInt(Math.max(0, Math.min(14, Math.trunc(level || 0))));
  return Number((BigInt(base) * 21n ** rank) / 20n ** rank);
}

export function researchUnitDefinition(state, definition) {
  const catalog = state.unitCatalog?.find((unit) => unit.id === definition.id);
  const researchLevel =
    state.researchLevels?.[definition.id] ?? catalog?.researchLevel ?? 0;
  const baseHealth =
    catalog?.baseHealth ?? definition.baseHealth ?? definition.health;
  const baseDamage =
    catalog?.baseDamage ?? definition.baseDamage ?? definition.damage;
  const health =
    catalog?.effectiveHealth ??
    definition.effectiveHealth ??
    researchedStat(baseHealth, researchLevel);
  const researchedDamage =
    catalog?.effectiveDamage ??
    definition.effectiveDamage ??
    researchedStat(baseDamage, researchLevel);
  const technologyDamageBonus =
    catalog?.technologyDamageBonus ?? definition.technologyDamageBonus ?? 0;
  const damage = researchedDamage + technologyDamageBonus;
  const healingPercent =
    catalog?.healingPercent ??
    definition.healingPercent ??
    (definition.abilities?.includes("self_repair")
      ? 50
      : definition.abilities?.includes("repair_allies")
        ? 45
        : 0);
  const shieldPercent =
    catalog?.shieldPercent ??
    definition.shieldPercent ??
    (definition.abilities?.includes("energy_shield") &&
    definition.id === "heavy_infantry"
      ? 50
      : definition.abilities?.includes("energy_shield") &&
          definition.id === "attack_submarine"
        ? 100
        : 0);
  const baseShield =
    catalog?.baseShield ??
    (shieldPercent
      ? Math.floor((baseHealth * shieldPercent) / 100)
      : (definition.shield ?? 0));
  const shield =
    catalog?.effectiveShield ??
    definition.effectiveShield ??
    (shieldPercent
      ? Math.floor((health * shieldPercent) / 100)
      : researchedStat(baseShield, researchLevel));
  const baseHealing =
    catalog?.baseHealing ?? Math.floor((baseHealth * healingPercent) / 100);
  const healing =
    catalog?.effectiveHealing ??
    definition.effectiveHealing ??
    Math.floor((health * healingPercent) / 100);
  return {
    ...definition,
    damageMatchesAttack:
      catalog?.damageMatchesAttack ?? definition.damageMatchesAttack ?? false,
    healingPercent,
    shieldPercent,
    baseShield,
    shield,
    shieldBonus: shield - baseShield,
    baseHealing,
    healing,
    healingBonus: healing - baseHealing,
    researchLevel,
    researchMaxLevel: catalog?.researchMaxLevel ?? researchUnitCap(definition),
    academyResearchLimit:
      catalog?.academyResearchLimit ??
      researchUnitCap(
        definition,
        completedLevelForType({ buildings: state.buildings ?? [] }, "academy"),
      ),
    baseHealth,
    baseDamage,
    health,
    damage,
    healthBonus: catalog?.researchHealthBonus ?? health - baseHealth,
    technologyDamageBonus,
    damageBonus:
      (catalog?.researchDamageBonus ?? researchedDamage - baseDamage) +
      technologyDamageBonus,
    researchBonusPercent:
      catalog?.researchBonusPercent ?? researchBonusPercent(researchLevel),
  };
}
