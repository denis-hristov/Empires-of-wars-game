import { useEffect, useRef } from "react";
import { WorldScene } from "./WorldScene.js";
export function GameCanvas({
  world,
  config,
  state,
  selection,
  mode,
  placement,
  battleOptions,
  onPick,
  onHover,
  onSelectionAnchor,
  onReady,
  onError,
}) {
  const host = useRef(null),
    scene = useRef(null),
    latest = useRef({ onPick, onHover, onSelectionAnchor, onReady, onError });
  latest.current = { onPick, onHover, onSelectionAnchor, onReady, onError };
  useEffect(() => {
    const instance = new WorldScene(host.current, {
      onPick: (...args) => latest.current.onPick(...args),
      onHover: (...args) => latest.current.onHover(...args),
      onSelectionAnchor: (...args) =>
        latest.current.onSelectionAnchor?.(...args),
    });
    scene.current = instance;
    let cancelled = false;
    instance
      .init()
      .then(() => {
        if (cancelled) return;
        instance.setWorld(world, config);
        instance.update(state, selection, mode, placement, battleOptions);
        latest.current.onReady(instance);
      })
      .catch((error) => {
        if (!cancelled) latest.current.onError(error);
      });
    return () => {
      cancelled = true;
      instance.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    if (scene.current?.ready) {
      scene.current.setWorld(world, config);
    }
  }, [world, config]);
  useEffect(() => {
    scene.current?.update(state, selection, mode, placement, battleOptions);
  }, [state, selection, mode, placement, battleOptions]);
  return <div ref={host} className="game-canvas" data-testid="game-canvas" />;
}
