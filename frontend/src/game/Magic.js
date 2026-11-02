import { assetUrl } from "../engine/GameEngine.js";

export const potionTypes = ["heal", "shield", "attack", "revive"];
export const potionDetails = {
  heal: {
    name: "Healing",
    shortName: "Heal",
    file: "spell_mass_heal.png",
    description:
      "Restore every living allied unit in this round to its own maximum HP. Shields stay unchanged. Fallen units are not revived.",
    duration: "Immediate recovery",
  },
  shield: {
    name: "Shield",
    shortName: "Shield",
    file: "spell_mass_shield.png",
    description:
      "Give each living ally a shield that blocks one entire hit, regardless of damage. The hit consumes this shield without reducing HP or existing shields. Reusing restores missing potion shields and never stacks them.",
    duration: "Until absorbed or this round ends",
  },
  attack: {
    name: "Double attack",
    shortName: "Attack x2",
    file: "spell_mass_attack_boost.png",
    description:
      "Double allied Attack for the rest of your current turn, using the normal damage rules. This grants no extra actions and does not double healing or shields. Cannot stack.",
    duration: "Until your current turn ends",
  },
  revive: {
    name: "Revival",
    shortName: "Revive",
    file: "spell_mass_revive.png",
    description:
      "Return every ally defeated in this round to the same position with 50% of its own maximum HP, rounded up, and no shields. Revived units can act from your next turn. Previous rounds are excluded.",
    duration: "Immediate revival; ready next turn",
  },
};
export function potionUrl(type) {
  return assetUrl(`assets/magic/${potionDetails[type].file}`);
}
export function potionSlots(magic) {
  const slots = potionTypes
    .flatMap((type, index) =>
      Array.from(
        { length: Math.max(0, Math.min(5, magic?.potions?.[index] ?? 0)) },
        () => type,
      ),
    )
    .slice(0, 5);
  return Array.from({ length: 5 }, (_, index) => slots[index] ?? null);
}
