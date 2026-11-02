import { completedBuildingLevel } from "./BuildingProgression.js";

export function mapObject(state, selection, config) {
  if (!selection) return null;
  if (selection.kind === "tree" || selection.kind === "rock")
    return {
      kind: selection.kind,
      entity: selection,
      type: selection.kind,
      name: selection.kind === "tree" ? "Tree" : "Rock",
      key: `${selection.kind}:${selection.position.join(":")}`,
    };
  const building = state.buildings.find((item) => item.id === selection);
  const unit = state.units.find((item) => item.id === selection);
  const entity = building || unit;
  if (!entity) return null;
  const definition = (building ? config.buildings : config.units).find(
    (item) => item.id === entity.type,
  );
  if (!definition) return null;
  return {
    kind: building ? "building" : "unit",
    entity,
    definition,
    type: entity.type,
    name: definition.name,
    key: `${building ? "building" : "unit"}:${entity.id}`,
  };
}

export function mapObjectActions(object, state) {
  if (!object) return [];
  const actions = [{ id: "info", label: "Info", icon: "info" }];
  const { entity, definition, kind } = object;
  if (kind === "building") {
    const level = completedBuildingLevel(entity);
    const maximum = level >= definition.levels.length;
    actions.push({
      id: "upgrade",
      label: maximum ? "Max level" : "Upgrade",
      icon: "upgrade",
      disabled: maximum || entity.state === 0,
      reason: maximum
        ? "Maximum level reached"
        : entity.state === 0
          ? "Finish construction first"
          : "",
    });
    if (entity.production.resource >= 0)
      actions.push({
        id: "collect",
        label: "Collect",
        icon: "collect",
        value: entity.stored,
        disabled: !entity.stored,
        reason: entity.stored ? "" : "No resources ready to collect",
      });
    if (entity.training.length)
      actions.push({
        id: "train",
        label: "Train",
        icon: "people",
        value: entity.queue.length || undefined,
      });
    if (entity.type === "laboratory")
      actions.push({
        id: "potions",
        label: "Potions",
        icon: "potion",
        value: state.magic?.used,
      });
    if (entity.type === "academy")
      actions.push({ id: "research", label: "Research", icon: "research" });
    const busy =
      entity.state !== 1 ||
      entity.queue.length > 0 ||
      (entity.type === "laboratory" &&
        (state.magic?.brewing?.length ?? 0) > 0) ||
      state.research.some((project) => project.academy === entity.id);
    actions.push({
      id: "move",
      label: "Move",
      icon: "move",
      disabled: busy,
      reason: busy ? "Finish active tasks before moving this building" : "",
    });
  } else if (kind === "unit") {
    actions.push({
      id: "move",
      label: "Move",
      icon: "move",
      disabled: !!entity.carrier || entity.reserve,
      reason: entity.carrier
        ? "Unload this aircraft first"
        : entity.reserve
          ? "Waiting for deployment space"
          : "",
    });
    if (definition.carrierSlots > 0)
      actions.push({ id: "carrier", label: "Aircraft", icon: "army" });
    const dismissalReason = state.battle
      ? "Finish the battle first"
      : state.units.some((unit) => unit.carrier === entity.id)
        ? "Unload this carrier's aircraft before dismissing it"
        : state.stock[4] >= 1_000_000_000_000 - 20
          ? "Your gold stockpile cannot accept 20 gold"
          : "";
    actions.push({
      id: "dismiss",
      label: "Dismiss",
      icon: "dismiss",
      value: 20,
      disabled: !!dismissalReason,
      reason: dismissalReason,
    });
  } else if (kind === "tree") {
    actions.push({ id: "remove", label: "Clear", icon: "clear" });
  }
  return actions;
}

export function actionMenuPosition(anchor, actionCount) {
  const width = Math.max(1, anchor.width);
  const menuWidth = Math.min(width - 24, Math.max(192, actionCount * 82 + 24));
  return {
    left: width / 2,
    bottom: width < 760 ? 130 : 20,
    width: menuWidth,
  };
}
