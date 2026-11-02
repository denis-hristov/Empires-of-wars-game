import { assetUrl } from "../engine/GameEngine.js";
export const battleDomains = { land: "Land", naval: "Sea", air: "Air" };
export const arenaFiles = {
  land: "ground_battle_arena.svg",
  naval: "lake_battle_arena.svg",
  air: "fsky_battle_arena.svg",
};
export function arenaUrl(domain) {
  return assetUrl(`assets/arenas/${arenaFiles[domain]}`);
}
export function fighterTargetAction(actor, fighter) {
  if (!actor || fighter.health <= 0) return null;
  if (fighter.enemy)
    return actor.validTargets?.includes(fighter.id) ? "BATTLE_ATTACK" : null;
  return actor.validHealTargets?.includes(fighter.id) ? "BATTLE_HEAL" : null;
}
export function battleActionSummary(
  hit,
  enemy = false,
  attackerName,
  targetName,
) {
  if (!hit)
    return "Use every available attack. Combat Drone and Titan Mech can attack twice per turn.";
  const side = attackerName || (enemy ? "Enemy unit" : "Your unit");
  if (hit.healing > 0)
    return targetName
      ? `${side} healed ${targetName} for ${hit.healing} HP.`
      : `${side} restored ${hit.healing} HP.`;
  if (hit.missed) return `${side} missed${targetName ? ` ${targetName}` : ""}.`;
  const stun =
    hit.stunTurns > 0
      ? hit.attackerStunned
        ? ` ${side} is stunned and will miss its next turn.`
        : " Target is stunned for one turn."
      : "";
  if (hit.shieldDamage > 0 && hit.damage === 0)
    return `${side} dealt ${hit.shieldDamage} shield damage${targetName ? ` to ${targetName}` : ""}. Health was protected.${stun}`;
  return `${side} dealt ${hit.damage} damage${hit.shieldDamage ? ` and ${hit.shieldDamage} shield damage` : ""}${targetName ? ` to ${targetName}` : ""}.${stun}`;
}
export function battleActionPaths(fighters, hits) {
  const positions = new Map();
  for (const enemy of [false, true]) {
    const team = fighters.filter((fighter) => !!fighter.enemy === enemy);
    const slots = formationPositions(team.length, enemy);
    team.forEach((fighter, index) =>
      positions.set(fighter.id, {
        x: slots[index].x,
        y: Math.max(0, slots[index].y - 12),
      }),
    );
  }
  return hits.flatMap((hit, index) => {
    const from = positions.get(hit.attacker),
      to = positions.get(hit.target);
    if (!from || !to || hit.attacker === hit.target) return [];
    return [
      {
        key: `${hit.attacker}:${hit.target}:${index}`,
        from,
        to,
        healing: hit.healing > 0,
      },
    ];
  });
}
export function unitAbilityDetails(definition) {
  const descriptions = [];
  const abilities = definition.abilities || [];
  if (definition.damageMatchesAttack && !definition.carrierSlots)
    descriptions.push(
      "Your direct hit deals the shown Attack to an unshielded enemy, up to its remaining HP.",
    );
  if (abilities.includes("self_repair"))
    descriptions.push(
      `After each enemy turn, heals itself for ${definition.healing ?? 0} HP (${definition.healingPercent ?? 50}% of maximum HP). At full health, heals a wounded ally instead.`,
    );
  if (abilities.includes("repair_allies"))
    descriptions.push(
      `Choose to attack or heal a wounded ally for ${definition.healing ?? 0} HP (${definition.healingPercent ?? 45}% of maximum HP). Healing uses this unit's action.`,
    );
  if (definition.shieldPercent > 0)
    descriptions.push(
      `Starts battle with ${definition.shield} shield (${definition.shieldPercent}% of maximum HP).`,
    );
  if (definition.shield > 0 || definition.shieldPercent > 0)
    descriptions.push(
      "While a shield remains, a hit damages only the shield. Health can be damaged by later hits after it breaks.",
    );
  if (abilities.includes("attack_all_splash"))
    descriptions.push(
      "Hits the chosen enemy at full Attack and every other enemy at 50% Attack, anywhere in the formation.",
    );
  if (abilities.includes("stun_on_hit"))
    descriptions.push(
      "Every successful hit stuns the target for one turn, including hits absorbed by a shield. Repeated hits refresh the stun without adding extra turns.",
    );
  if (abilities.includes("stun_attackers"))
    descriptions.push(
      "When an enemy hits this unit, the attacker is stunned and misses its next turn. Hits absorbed by shields also trigger this ability; stuns do not stack.",
    );
  if (abilities.includes("two_attacks"))
    descriptions.push(
      "Can attack twice per turn. Choose the same enemy or a different target for each attack.",
    );
  if (abilities.includes("carry_aircraft"))
    descriptions.push(
      `Carries up to ${definition.carrierSlots} aircraft. All loaded aircraft attack ships and aircraft together through the carrier. Attack is the sum of their attacks. An empty carrier cannot attack.`,
    );
  if (abilities.includes("attack_all_air"))
    descriptions.push(
      "Each attack also hits every opposing aircraft at full damage.",
    );
  if (abilities.includes("attack_all"))
    descriptions.push("Each attack hits all opposing units at full damage.");
  if (definition.healingPercent > 0 || definition.shieldPercent > 0)
    descriptions.push("Academy health research also improves this ability.");
  const remaining = abilities.filter(
    (ability) =>
      ![
        "self_repair",
        "repair_allies",
        "attack_all",
        "attack_all_air",
        "attack_all_splash",
        "two_attacks",
        "stun_on_hit",
        "stun_attackers",
        "carry_aircraft",
      ].includes(ability) &&
      !(
        definition.damageMatchesAttack &&
        [
          "anti_infantry",
          "air_superiority",
          "surface_strike",
          "periodic_burst",
          "first_strike",
        ].includes(ability)
      ),
  );
  if (remaining.length)
    descriptions.push(
      remaining.map((ability) => ability.replaceAll("_", " ")).join(" · "),
    );
  return descriptions;
}
export function formationPositions(count, enemy = false) {
  const formations = {
    1: [[29, 58]],
    2: [
      [27, 30],
      [31, 80],
    ],
    3: [
      [24, 30],
      [36, 53],
      [24, 78],
    ],
    4: [
      [22, 30],
      [38, 30],
      [22, 80],
      [38, 80],
    ],
    5: [
      [18, 30],
      [30, 55],
      [42, 30],
      [18, 80],
      [42, 80],
    ],
    6: [
      [18, 30],
      [30, 30],
      [42, 30],
      [18, 80],
      [30, 80],
      [42, 80],
    ],
  };
  const expanded = Array.from({ length: count }, (_, index) => [
    10 + (index % 5) * 7.5,
    18 + Math.floor(index / 5) * (65 / Math.max(1, Math.ceil(count / 5) - 1)),
  ]);
  return (formations[count] || expanded).map(([x, y]) => ({
    x: enemy ? 100 - x : x,
    y,
  }));
}
