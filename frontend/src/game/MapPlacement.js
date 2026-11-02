export function placementPreview(engine, state, mode, tile) {
  if (!engine || !mode || !tile) return null;
  if (mode.type === "move-unit")
    return engine.dispatch({
      type: "CAN_MOVE_UNIT",
      payload: { id: mode.id, ...tile },
    });
  const buildingType =
    mode.type === "build"
      ? mode.buildingType
      : state.buildings.find((building) => building.id === mode.id)?.type;
  return engine.dispatch({
    type: "CAN_BUILD",
    payload: {
      buildingType,
      ...tile,
      ...(mode.type === "move" ? { id: mode.id } : {}),
    },
  });
}
