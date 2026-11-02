import { researchUnitDefinition } from "./BuildingProgression.js";

export const campaignDomainLimit = 5;

export function campaignArmyDomains(level) {
  return [...new Set(level.rounds.map((round) => round.domain))];
}

export function campaignArmyCandidates(state, config, domains) {
  const required = new Set(domains);
  const definitions = new Map(
    config.units.map((definition) => [
      definition.id,
      researchUnitDefinition(state, definition),
    ]),
  );
  const bonuses = new Map();
  for (const technology of config.technologies ?? []) {
    if (!state.technologies?.includes(technology.id)) continue;
    const bonus = bonuses.get(technology.domain) ?? { health: 0, damage: 0 };
    bonus.health += technology.healthBonus ?? 0;
    bonus.damage += technology.damageBonus ?? 0;
    bonuses.set(technology.domain, bonus);
  }
  return state.units.flatMap((unit) => {
    const definition = definitions.get(unit.type);
    if (
      unit.health <= 0 ||
      unit.carrier ||
      unit.reserve ||
      !definition ||
      !required.has(definition.domain)
    ) {
      return [];
    }
    const bonus = bonuses.get(definition.domain);
    const maxHealth = unit.maxHealth ?? definition.health;
    const health = Math.min(unit.health, maxHealth) + (bonus?.health ?? 0);
    const damage =
      unit.damage != null
        ? unit.damage + (unit.damageByDomain ? 0 : (bonus?.damage ?? 0))
        : definition.damage +
          (definition.technologyDamageBonus ? 0 : (bonus?.damage ?? 0));
    const defense =
      config.battle?.playerArmorEnabled === false
        ? 0
        : (unit.defense ?? definition.defense ?? 0);
    const shield = unit.shield ?? definition.shield ?? 0;
    const accuracy = config.battle?.attacksAlwaysHit
      ? 100
      : (unit.accuracy ?? definition.accuracy ?? 100);
    const cooldown = Math.max(
      1,
      unit.attackCooldown ?? definition.attackCooldown ?? 1,
    );
    // Compare sustained damage and current durability before the first round.
    const attacks = definition.abilities?.includes("two_attacks") ? 2 : 1;
    const power =
      ((damage * attacks * accuracy) / (100 * cooldown)) *
      (health + shield) *
      (1 + defense / 100);
    return [{ unit, definition, domain: definition.domain, power }];
  });
}

export function autoSelectCampaignArmy(state, config, domains) {
  const candidates = campaignArmyCandidates(state, config, domains);
  return domains.flatMap((domain) =>
    candidates
      .filter((entry) => entry.domain === domain)
      .sort(
        (a, b) =>
          b.power - a.power ||
          b.definition.level - a.definition.level ||
          String(a.unit.id).localeCompare(String(b.unit.id), "en", {
            numeric: true,
          }),
      )
      .slice(0, campaignDomainLimit)
      .map((entry) => entry.unit.id),
  );
}

export function replaceCampaignDomainSelection(squad, domainIds, selectedIds) {
  const ids = new Set(domainIds);
  return [...squad.filter((id) => !ids.has(id)), ...selectedIds];
}
