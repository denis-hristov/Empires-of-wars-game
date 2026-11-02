import { useEffect, useRef, useState } from "react";
import { BattlePanel, BattleRounds } from "./GamePanels.jsx";
import { Dialog } from "./Dialog.jsx";
import { potionDetails, potionSlots, potionUrl } from "../game/Magic.js";
import "../styles/magic.css";
import { Icon } from "./Icons.jsx";
import { getSpriteArt, spriteUrl } from "../game/SpriteAssets.js";
import { arenaSpriteLayout } from "../game/SpriteLayout.js";
import {
  arenaUrl,
  battleActionPaths,
  battleActionSummary,
  battleDomains,
  fighterTargetAction,
  formationPositions,
} from "../game/BattlePresentation.js";
import "../styles/battle.css";

export function BattleArena({
  state,
  config,
  selected,
  onSelect,
  dispatch,
  onSettings,
}) {
  const b = state.battle;
  const [motion, setMotion] = useState(null);
  const [potionMotion, setPotionMotion] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const committingPotion = useRef(false);
  const previousPotionEvent = useRef(b.potionEvent ?? 0);
  const selectedPotion = b.potionPrompt
    ? state.magic?.options?.find((p) => p.id === b.potionPrompt)
    : null;
  const potion = selectedPotion && potionDetails[selectedPotion.id];
  const potionReason = b.finished
    ? "Battle finished"
    : b.paused
      ? "Resume the battle first"
      : b.enemyTurn
        ? "Wait for your turn"
        : b.animationMs > 0 || motion || potionMotion
          ? "Wait for the combat animation"
          : "";
  useEffect(() => {
    if (previousPotionEvent.current === (b.potionEvent ?? 0)) return;
    previousPotionEvent.current = b.potionEvent ?? 0;
    setPotionMotion({
      type: b.lastPotion,
      targets: b.potionTargets || [],
      event: b.potionEvent,
    });
    const timer = setTimeout(() => setPotionMotion(null), 900);
    return () => clearTimeout(timer);
  }, [b.potionEvent]);
  useEffect(() => {
    committingPotion.current = false;
  }, [b.potionToken]);
  const event = `${b.id}:${b.phaseIndex}:${b.actions}:${b.round}:${b.enemyTurn}:${JSON.stringify(b.lastAttacks)}`;
  const lastEvent = useRef(event);
  useEffect(() => {
    if (lastEvent.current === event) return;
    lastEvent.current = event;
    setMotion(b.lastAttacks.length ? { hits: b.lastAttacks, event } : null);
    const timer = setTimeout(() => setMotion(null), 900);
    return () => clearTimeout(timer);
  }, [event]);
  const allies = b.fighters.filter((f) => !f.enemy && !f.carrier);
  const enemies = b.fighters.filter((f) => f.enemy);
  const ready = allies.filter((f) => f.health > 0 && !f.attacked);
  const actor = ready.find((f) => f.id === selected);
  const manual =
    !b.finished &&
    !b.enemyTurn &&
    !b.automatic &&
    !b.paused &&
    !b.awaitingSelection &&
    !selectedPotion;
  const canAttack = manual && !!actor;
  const healer =
    actor &&
    config.units
      .find((d) => d.id === actor.type)
      ?.abilities?.includes("repair_allies");
  const name = (f) =>
    f.name ||
    (f.type === "raider"
      ? "Raider"
      : config.units.find((d) => d.id === f.type)?.name || f.type);
  const side = b.paused
    ? "Battle paused"
    : b.enemyTurn
      ? "Enemy turn"
      : b.automatic
        ? "Your army is attacking"
        : "Your turn";
  const remaining = b.fighters.filter(
    (f) => !f.carrier && f.enemy === b.enemyTurn && f.health > 0 && !f.attacked,
  ).length;
  const previousHit = b.lastAttacks.at(-1);
  const lastActor = b.fighters.find((f) => f.id === previousHit?.attacker);
  const lastTarget = b.fighters.find((f) => f.id === previousHit?.target);
  const actionPaths = battleActionPaths(
    b.fighters.filter((f) => !f.carrier),
    motion?.hits || [],
  );
  const effectId = `arena-action-${b.id}`;
  const actionSummary = battleActionSummary(
    previousHit,
    lastActor?.enemy,
    lastActor && `${lastActor.enemy ? "Enemy " : ""}${name(lastActor)}`,
    lastTarget && `${lastTarget.enemy ? "Enemy " : ""}${name(lastTarget)}`,
  );
  function team(fighters, enemy) {
    const slots = formationPositions(fighters.length, enemy);
    return fighters.map((f, index) => {
      const layout = arenaSpriteLayout(f.enemyId || f.type);
      const art = getSpriteArt(f.enemyId || f.type);
      const targetAction = canAttack && fighterTargetAction(actor, f);
      const target = targetAction === "BATTLE_ATTACK";
      const healTarget = targetAction === "BATTLE_HEAL";
      const chosen = !enemy && actor?.id === f.id && manual;
      const attack = motion?.hits.some(
        (entry) => entry.attacker === f.id && !(entry.healing > 0),
      );
      const healingAction = motion?.hits.some(
        (entry) => entry.attacker === f.id && entry.healing > 0,
      );
      const hits = motion?.hits.filter((entry) => entry.target === f.id) || [];
      const hit = hits.find((entry) => !(entry.healing > 0));
      const healing = hits.reduce(
        (total, entry) => total + (entry.healing || 0),
        0,
      );
      return (
        <button
          key={f.id}
          type="button"
          className={`arena-fighter ${enemy ? "enemy" : "friendly"} ${chosen ? "selected" : ""} ${target ? "targetable" : ""} ${healTarget ? "healable" : ""} ${f.attacked ? "spent" : ""} ${f.health <= 0 ? "fallen" : ""} ${attack ? "acting" : ""} ${hit ? "under-attack" : ""} ${healingAction ? "healing-ally" : ""}`}
          style={{
            left: `${slots[index].x}%`,
            top: `${slots[index].y}%`,
            zIndex: Math.round(slots[index].y),
            "--art-height": `${layout.height}%`,
            "--art-bottom": `${layout.bottom}%`,
            "--art-base-depth": `${layout.baseDepth}%`,
            "--art-anchor-x": `${layout.anchorX}%`,
            "--art-anchor-y": `${layout.anchorY}%`,
            "--face":
              (art.facing || (f.domain === "air" ? -1 : 1)) * (enemy ? -1 : 1),
            "--lunge": enemy ? "-45px" : "45px",
          }}
          disabled={
            enemy
              ? !target
              : !healTarget && (!manual || f.attacked || f.health <= 0)
          }
          aria-pressed={!enemy ? chosen : undefined}
          aria-label={
            healTarget
              ? `Heal ${name(f)} ${index + 1}, ${f.health} of ${f.maxHealth} health with ${name(actor)}`
              : enemy
                ? `Attack ${name(f)} ${index + 1}, ${f.health} health${actor ? ` with ${name(actor)}` : ""}`
                : `Select ${name(f)} ${index + 1}, ${f.health} health, ${f.attacked ? "already attacked" : "ready"}`
          }
          onClick={() => {
            if (targetAction) {
              dispatch(targetAction, { id: actor.id, target: f.id });
            } else if (!enemy) {
              onSelect(f.id);
            }
          }}
        >
          <span className="arena-unit-ring" />
          {potionMotion?.targets.includes(f.id) && (
            <span
              key={`potion-${potionMotion.event}`}
              className={`arena-potion-impact potion-${potionMotion.type}`}
              aria-hidden="true"
            />
          )}
          {(attack || healingAction) && (
            <span
              className={`arena-action-tag ${healingAction ? "healing" : ""}`}
            >
              {healingAction ? "Healing" : "Attacking"}
            </span>
          )}
          <span
            key={attack || hit || healing ? motion.event : "idle"}
            className={`arena-fighter-motion ${attack ? "attacking" : ""} ${hit ? "taking-hit" : ""} ${healing ? "receiving-heal" : ""}`}
          >
            <img
              className="arena-unit-image"
              src={spriteUrl(f.enemyId || f.type)}
              alt=""
              draggable="false"
            />
            {hit && <span className="arena-impact" />}
            {healing > 0 && <span className="arena-heal-impact" />}
          </span>
          <span className="arena-unit-plate">
            <span className="arena-unit-name">
              {enemy ? `Enemy ${name(f)}` : name(f)} {index + 1}
              {f.carrierSlots > 0 && ` · ${f.aircraftCount}/${f.carrierSlots}`}
              {f.carrier && " · embarked"}
              {!enemy && f.damageByDomain && (
                <small>
                  Sea {f.damageByDomain.naval} · Air {f.damageByDomain.air}
                </small>
              )}
            </span>
            <span
              className="arena-health"
              role="progressbar"
              aria-label={`${name(f)} health`}
              aria-valuemin={0}
              aria-valuemax={f.maxHealth}
              aria-valuenow={f.health}
            >
              <span style={{ width: `${(f.health / f.maxHealth) * 100}%` }} />
              <strong>
                {f.health} / {f.maxHealth}
              </strong>
            </span>
            {f.shield > 0 && (
              <span className="arena-shield">
                Shield {f.shield}
                {f.maxShield > 0 ? ` / ${f.maxShield}` : ""}
              </span>
            )}
            {!enemy &&
              (f.potionShield > 0 || b.doubleAttack) &&
              f.health > 0 && (
                <span className="arena-potion-status">
                  {f.potionShield > 0 && (
                    <span title="Blocks one entire hit without losing HP or existing shield">
                      Shield: 1 hit
                    </span>
                  )}
                  {b.doubleAttack && (
                    <span className="attack-boost">Attack x2</span>
                  )}
                </span>
              )}
            {f.health > 0 && f.stunnedUntilRound >= b.round && (
              <span className="arena-unit-status arena-stunned">
                {f.stunnedUntilRound > b.round
                  ? "Stunned · skips next turn"
                  : "Stunned · skips this turn"}
              </span>
            )}
            {!enemy && (
              <span className="arena-unit-status">
                {f.health <= 0
                  ? "Defeated"
                  : f.attacked
                    ? "Done"
                    : f.attacksPerTurn > 1
                      ? `${f.attacksRemaining} ${f.attacksRemaining === 1 ? "attack" : "attacks"} left`
                      : "Ready"}
              </span>
            )}
          </span>
          {hit && (
            <span key={motion.event} className="arena-damage">
              {hit.missed
                ? "Miss"
                : hit.shieldDamage
                  ? hit.damage > 0
                    ? `${hit.damage} HP · ${hit.shieldDamage} shield`
                    : `−${hit.shieldDamage} shield`
                  : `−${hit.damage}`}
              {hit.stunTurns > 0 && !hit.attackerStunned && (
                <small>Stunned for 1 turn</small>
              )}
            </span>
          )}
          {healing > 0 && (
            <span
              key={`heal-${motion.event}`}
              className="arena-damage arena-healing"
            >
              +{healing} HP
            </span>
          )}
        </button>
      );
    });
  }
  return (
    <section
      className={`battle-arena domain-${b.domain}`}
      style={{ backgroundImage: `url("${arenaUrl(b.domain)}")` }}
      aria-label={`${battleDomains[b.domain]} battle arena`}
    >
      <header className="arena-header">
        <div className="arena-title">
          <span className="eyebrow">
            {b.campaignLevel
              ? `CAMPAIGN / ROUND ${b.phaseIndex + 1} OF ${b.phases.length}`
              : "EMPIRES OF WARS"}
          </span>
          <h1>
            {b.campaignLevel ? `Level ${b.campaignLevel} / ` : ""}
            {battleDomains[b.domain]} arena
          </h1>
        </div>
        <div className="arena-round-status">
          <BattleRounds battle={b} />
          {!b.finished && !b.awaitingSelection && (
            <div
              className={`arena-turn ${b.enemyTurn ? "enemy-turn" : ""}`}
              role="status"
            >
              <strong>{side}</strong>
              <span>
                Turn {b.round} · {remaining}{" "}
                {remaining === 1 ? "attack" : "attacks"} left
              </span>
            </div>
          )}
        </div>
        <button
          className="arena-settings"
          onClick={onSettings}
          aria-label="Battle settings"
        >
          <Icon name="settings" />
        </button>
      </header>
      <div
        className={`arena-field ${Math.max(allies.length, enemies.length) >= 4 ? "large-squad" : ""} ${Math.max(allies.length, enemies.length) > 6 ? "carrier-squad" : ""}`}
        aria-label="Opposing armies"
      >
        {team(allies, false)}
        {team(enemies, true)}
        {actionPaths.length > 0 && (
          <svg
            key={motion.event}
            className="arena-action-paths"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={`${effectId}-attack`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="4"
                markerHeight="4"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="#ffe16a" />
              </marker>
              <marker
                id={`${effectId}-heal`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="4"
                markerHeight="4"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 Z" fill="#8cffb0" />
              </marker>
            </defs>
            {actionPaths.map((path) => (
              <g key={path.key} className={path.healing ? "healing" : "attack"}>
                <line
                  className="arena-action-path"
                  x1={path.from.x}
                  y1={path.from.y}
                  x2={path.to.x}
                  y2={path.to.y}
                  markerEnd={`url(#${effectId}-${path.healing ? "heal" : "attack"})`}
                />
                <circle
                  className="arena-projectile"
                  r="0.65"
                  cx={path.from.x}
                  cy={path.from.y}
                >
                  <animate
                    attributeName="cx"
                    from={path.from.x}
                    to={path.to.x}
                    dur="0.36s"
                    fill="freeze"
                  />
                  <animate
                    attributeName="cy"
                    from={path.from.y}
                    to={path.to.y}
                    dur="0.36s"
                    fill="freeze"
                  />
                </circle>
              </g>
            ))}
          </svg>
        )}
      </div>
      {!b.finished && !b.awaitingSelection && (
        <footer className="arena-command-bar">
          <div className="arena-command-copy">
            <strong>
              {b.paused
                ? "Resume to continue"
                : b.enemyTurn
                  ? "The opponent is choosing its targets"
                  : b.automatic
                    ? "Auto attack is on"
                    : actor
                      ? healer
                        ? `Click a wounded ally to heal up to ${actor.healing || 0} HP, or click an enemy to attack.`
                        : `${name(actor)} selected. Click a highlighted enemy to attack.`
                      : "Choose a ready unit from your army"}
            </strong>
            <span className="arena-action-summary" role="status">
              {actionSummary}
            </span>
          </div>
          <div className="potion-belt" aria-label="Five potion slots">
            {potionSlots(state.magic).map((type, index) => (
              <button
                key={index}
                className={`potion-slot ${type ? "" : "empty"}`}
                disabled={!type || !!potionReason || !!selectedPotion}
                aria-label={
                  type
                    ? `${potionDetails[type].name} potion, slot ${index + 1}`
                    : `Empty potion slot ${index + 1}`
                }
                title={
                  type
                    ? potionReason || `Inspect ${potionDetails[type].name}`
                    : "Brew potions at the Laboratory"
                }
                onClick={() =>
                  dispatch("BATTLE_POTION_SELECT", { potionType: type })
                }
              >
                {type ? (
                  <>
                    <img src={potionUrl(type)} alt="" />
                    <small>{potionDetails[type].shortName}</small>
                  </>
                ) : (
                  <>
                    <span>{index + 1}</span>
                    <small>Empty</small>
                  </>
                )}
              </button>
            ))}
          </div>
          <div className="arena-command-buttons">
            <button
              className="button secondary arena-help"
              onClick={() => {
                dispatch("BATTLE_POTION_CANCEL");
                setHelpOpen(true);
              }}
              title="Battle help"
              aria-label="Battle help"
            >
              <Icon name="info" size={18} />
            </button>
            {!!b.campaignLevel && (
              <button
                className="button secondary"
                onClick={() => dispatch("BATTLE_RETREAT")}
              >
                Retreat
              </button>
            )}
            <button
              className={`button ${b.automatic ? "primary" : "secondary"}`}
              aria-pressed={b.automatic}
              onClick={() => dispatch("BATTLE_AUTO")}
            >
              {b.automatic ? "Take manual control" : "Auto attack"}
            </button>
          </div>
        </footer>
      )}
      {selectedPotion && potion && (
        <Dialog
          title={potion.name}
          className="potion-confirmation"
          onClose={() => dispatch("BATTLE_POTION_CANCEL")}
        >
          <img
            className="potion-confirmation-art"
            src={potionUrl(selectedPotion.id)}
            alt=""
          />
          <p>{potion.description}</p>
          <div className="potion-duration">{potion.duration}</div>
          {!selectedPotion.use.ok && (
            <p className="requirements" role="status">
              {selectedPotion.use.reason}
            </p>
          )}
          <div className="object-dialog-footer">
            <button
              className="button secondary"
              onClick={() => dispatch("BATTLE_POTION_CANCEL")}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={!selectedPotion.use.ok}
              title={selectedPotion.use.reason || "Use one potion"}
              onClick={() => {
                if (committingPotion.current) return;
                committingPotion.current = true;
                const result = dispatch("BATTLE_POTION_USE", {
                  potionType: selectedPotion.id,
                  token: b.potionToken,
                });
                if (!result.ok) committingPotion.current = false;
              }}
            >
              Use potion
            </button>
          </div>
        </Dialog>
      )}
      {helpOpen && (
        <Dialog title="Battle help" onClose={() => setHelpOpen(false)}>
          <p>
            Choose one ready ally, then a highlighted enemy. Each ready unit can
            act once per turn, and Combat Drone and Titan Mech can attack twice.
            A Frigate can heal a highlighted wounded ally instead of attacking.
          </p>
          <p>
            Potions affect your allies in the current round. Inspect a potion
            and confirm to use it. Potions do not use a unit action or end your
            turn. Unused potions stay in storage.
          </p>
          <p>
            Potions are available only during your turn, between completed
            actions. Opening a potion confirmation makes auto attack wait until
            you use or cancel it.
          </p>
        </Dialog>
      )}
      {b.finished && (
        <div className="arena-result">
          <BattlePanel state={state} config={config} dispatch={dispatch} />
        </div>
      )}
    </section>
  );
}
