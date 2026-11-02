import { useState } from "react";
import { ResourceAmount } from "./ResourceAmount.jsx";
import { CampaignMenu } from "./CampaignMenu.jsx";
import {
  battleDomains,
  unitAbilityDetails,
} from "../game/BattlePresentation.js";
import { Icon } from "./Icons.jsx";
import { spriteUrl } from "../game/SpriteAssets.js";
import { mapFootprint } from "../game/UnitFootprint.js";
import {
  buildingLevelCap,
  completedBuildingLevel,
  productionIntervalSeconds,
  researchAcademy,
  researchedStat,
  researchProjectDetails,
  researchUnitDefinition,
  researchUnitCap,
  townHallRequirements,
  upgradeGoldShortage,
} from "../game/BuildingProgression.js";
export const resources = ["food", "wood", "stone", "iron", "coins"];
export function SpriteImage({ type, level = 1, ...props }) {
  return (
    <img src={spriteUrl(type, level)} alt="" draggable="false" {...props} />
  );
}
export function Cost({ cost }) {
  const entries = Array.isArray(cost)
    ? cost.map((value, index) => [resources[index], value])
    : Object.entries(cost || {});
  return (
    <span className="cost">
      {entries
        .filter(([, value]) => value > 0)
        .map(([resource, value]) => (
          <span key={resource} title={`${value} ${resource}`}>
            <Icon name={resource} size={13} />
            {value}
          </span>
        ))}
    </span>
  );
}
export function ResourcePanel({ state, hidden = false }) {
  return (
    <aside
      className="resource-panel"
      aria-label="Resources and population"
      hidden={hidden}
    >
      {resources.map((name, i) => (
        <div className={`resource-row ${name}`} key={name}>
          <Icon name={name} size={19} />
          <span>{name === "coins" ? "gold" : name}</span>
          <ResourceAmount name={name} value={state.stock[i]} />
        </div>
      ))}
      <div className="resource-row population-row">
        <Icon name="people" size={19} />
        <span title="Completed Town Hall and Houses provide population capacity for the army and Town Hall upgrades">
          Population
        </span>
        <strong
          title={`${state.population.military} in service, ${state.population.reserved} in training`}
        >
          {state.population.military + state.population.reserved}
          <em> / {state.population.capacity}</em>
        </strong>
      </div>
    </aside>
  );
}

export function BattleRounds({ battle }) {
  return (
    <div className="battle-rounds" aria-label="Expedition rounds">
      {battle.phases.map((domain, index) => (
        <div
          key={`${domain}-${index}`}
          className={`battle-round ${index === battle.phaseIndex && !battle.finished ? "active" : ""}`}
        >
          <span>
            Round {index + 1} · {battleDomains[domain]}
          </span>
          <strong>
            {index < battle.outcomes.length
              ? battle.outcomes[index] === 1
                ? "Won"
                : "Lost"
              : battle.finished
                ? "Not fought"
                : index === battle.phaseIndex
                  ? battle.awaitingSelection
                    ? "Preparing round"
                    : "In progress"
                  : "Waiting"}
          </strong>
        </div>
      ))}
    </div>
  );
}
export function AttackMenu(props) {
  return props.config.campaign ? (
    <CampaignMenu {...props} />
  ) : (
    <ExpeditionMenu {...props} />
  );
}
function ExpeditionMenu({ state, config, squad, setSquad, onAttack }) {
  const [missions, setMissions] = useState({});
  const eligible = state.units.filter(
    (u) => u.health > 0 && !u.carrier && !u.reserve,
  );
  const phaseFor = (u) =>
    missions[u.id] || config.units.find((d) => d.id === u.type)?.domain;
  const selected = eligible
    .filter((u) => squad.includes(u.id))
    .map((u) => u.id);
  const limit = state.battleUnitLimit ?? 5;
  const group = (domain) => eligible.filter((u) => phaseFor(u) === domain);
  return (
    <div className="attack-menu">
      <p>
        Choose up to {limit} units for each round. Land, then sea, then air.
        Rounds without selected units are skipped. Assign aircraft to surface
        support or air patrol. Embarked aircraft join their carrier
        automatically.
      </p>
      <div className="squad-summary">
        <strong>{selected.length} selected</strong>
        <button
          className="text-button"
          disabled={!eligible.length}
          onClick={() =>
            setSquad(
              selected.length
                ? []
                : Object.keys(battleDomains).flatMap((domain) =>
                    group(domain)
                      .slice(0, limit)
                      .map((u) => u.id),
                  ),
            )
          }
        >
          {selected.length ? "Clear selection" : "Select squads"}
        </button>
      </div>
      {Object.entries(battleDomains).map(([domain, name], index) => {
        const units = group(domain),
          count = units.filter((u) => selected.includes(u.id)).length;
        return (
          <section className="squad-domain" key={domain}>
            <h3>
              Round {index + 1} · {name}{" "}
              <small>
                {count} / {limit}
              </small>
            </h3>
            {!units.length && (
              <p className="muted">
                No units available. This round will be skipped.
              </p>
            )}
            <div className="squad-list">
              {units.map((u) => {
                const def = researchUnitDefinition(
                    state,
                    config.units.find((d) => d.id === u.type),
                  ),
                  checked = selected.includes(u.id);
                return (
                  <label
                    className={`squad-card ${checked ? "selected" : ""}`}
                    key={u.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && count >= limit}
                      onChange={() =>
                        setSquad(
                          checked
                            ? selected.filter((id) => id !== u.id)
                            : [...selected, u.id],
                        )
                      }
                    />
                    <SpriteImage type={u.type} />
                    <span>
                      <strong>
                        {def.name} #{u.id}
                      </strong>
                      <small>
                        {u.health} / {u.maxHealth ?? def.health} HP
                        {u.carrierSlots > 0 &&
                          ` · ${u.aircraftCount}/${u.carrierSlots} aircraft`}
                      </small>
                      {def.domain === "air" && (
                        <select
                          aria-label={`Mission for ${def.name} #${u.id}`}
                          value={phaseFor(u)}
                          onChange={(e) =>
                            setMissions({ ...missions, [u.id]: e.target.value })
                          }
                        >
                          {Object.entries(battleDomains)
                            .filter(
                              ([phase]) =>
                                def.validTargets?.includes(phase) ||
                                phase === "air",
                            )
                            .map(([phase, title]) => (
                              <option
                                key={phase}
                                value={phase}
                                disabled={
                                  phase !== phaseFor(u) &&
                                  group(phase).filter((a) =>
                                    selected.includes(a.id),
                                  ).length >= limit
                                }
                              >
                                {title} {phase === "air" ? "patrol" : "support"}
                              </option>
                            ))}
                        </select>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
      {!eligible.length && (
        <div className="hint-box">
          Train infantry, ships or aircraft before starting an expedition.
        </div>
      )}
      <button
        className="button primary full"
        disabled={!selected.length}
        onClick={() =>
          onAttack(
            selected,
            selected
              .filter((id) => missions[id])
              .map((id) => ({ id, phase: missions[id] })),
          )
        }
      >
        Start expedition <Icon name="arrow" size={18} />
      </button>
      <p className="muted">
        Your side starts each round. Use manual turns or enable Auto attack
        during battle. Win more rounds than the enemy to claim the reward. If
        the armies are tied or cannot finish the fight, the defenders win.
      </p>
    </div>
  );
}
export function BuildMenu({ state, config, mode, onBuild, filter, setFilter }) {
  const categories = {
    All: () => true,
    Economy: (b) => b.resource !== null,
    Community: (b) => ["house", "academy"].includes(b.id),
    Military: (b) =>
      ["barracks", "harbor", "airbase", "laboratory"].includes(b.id),
  };
  return (
    <section className="build-dock" aria-label="Construction menu">
      <div className="dock-heading">
        <div>
          <span className="eyebrow">SHAPE YOUR EMPIRE</span>
          <h2>Build something lasting.</h2>
        </div>
        <div className="filters">
          {Object.keys(categories).map((name) => (
            <button
              key={name}
              className={filter === name ? "active" : ""}
              onClick={() => setFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <p className="progression-note">
        Build as many as you need, with one Academy and one Laboratory per
        island. Town Hall {state.townHallLevel} controls the available building
        types and level caps. Each new building starts at level 1.
      </p>
      <div className="build-cards">
        {config.buildings
          .filter((b) => b.id !== "townhall" && categories[filter](b))
          .map((b) => {
            const option = state.buildOptions?.[b.id];
            const cap =
              option?.cap ??
              buildingLevelCap(config, b.id, state.townHallLevel);
            const disabled = option ? !option.ok : cap === 0;
            const reason =
              option?.reason ||
              (cap === 0
                ? `Requires Town Hall ${b.levels[0].townHallRequired}`
                : "");
            return (
              <button
                className={`build-card ${mode?.buildingType === b.id ? "selected" : ""}`}
                key={b.id}
                onClick={() => onBuild(b.id)}
                aria-label={`Build ${b.name}`}
                disabled={disabled}
                title={reason}
              >
                <SpriteImage type={b.id} />
                <span className="card-info">
                  <strong>{b.name}</strong>
                  <small className="build-level-limit">
                    Built{" "}
                    {
                      state.buildings.filter(
                        (building) => building.type === b.id,
                      ).length
                    }
                    {" · "}Town Hall level cap {cap} / {b.levels.length}
                  </small>
                  <Cost cost={option?.cost ?? b.levels[0].cost} />
                  {disabled && (
                    <small className="build-requirement">{reason}</small>
                  )}
                </span>
                <span className="card-plus">+</span>
              </button>
            );
          })}
      </div>
    </section>
  );
}
function Progress({ value, max }) {
  return (
    <div className="progress-track">
      <span
        style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }}
      />
    </div>
  );
}
function UnitStat({ label, value, base, bonus }) {
  const improved = Number.isFinite(base) && Number.isFinite(bonus) && bonus > 0;
  return (
    <span className={improved ? "unit-stat-researched" : undefined}>
      {label}{" "}
      {improved ? (
        <span
          className="unit-stat-expression"
          aria-label={`${label}: ${base} base + ${bonus} improvements = ${value} total`}
        >
          <span>{base}</span>
          <span className="unit-stat-bonus">+ {bonus}</span>
          <span>=</span>
          <strong>{value}</strong>
        </span>
      ) : (
        <strong>{value}</strong>
      )}
    </span>
  );
}
function UnitDetails({ def }) {
  const abilities = unitAbilityDetails(def);
  return (
    <div className="unit-details">
      <p>{def.role}</p>
      <div className="unit-stat-grid">
        <UnitStat
          label="HP"
          value={def.health}
          base={def.baseHealth}
          bonus={def.healthBonus}
        />
        <UnitStat
          label="Attack"
          value={
            def.carrierSlots > 0 && !def.damageByDomain
              ? "Loaded aircraft"
              : def.damage
          }
          base={def.carrierSlots > 0 ? undefined : def.baseDamage}
          bonus={def.carrierSlots > 0 ? undefined : def.damageBonus}
        />
        <UnitStat
          label="Shield"
          value={def.shield || 0}
          base={def.baseShield}
          bonus={def.shieldBonus}
        />
        {def.healing > 0 && (
          <UnitStat
            label="Healing"
            value={def.healing}
            base={def.baseHealing}
            bonus={def.healingBonus}
          />
        )}
      </div>
      <small>
        Targets:{" "}
        {(def.validTargets || [def.domain])
          .map((d) => battleDomains[d])
          .join(", ")}
      </small>
      {abilities.length ? (
        abilities.map((detail) => <small key={detail}>{detail}</small>)
      ) : (
        <small>No special ability</small>
      )}
    </div>
  );
}
export function ResearchPanel({
  state,
  config,
  dispatch,
  academy: selectedAcademy,
}) {
  const [domain, setDomain] = useState("land");
  const academy = selectedAcademy ?? researchAcademy(state);
  const academyLevel = completedBuildingLevel(academy);
  const running = state.research[0];
  if (!academy) {
    return (
      <div className="hint-box">
        Build an Academy after reaching Town Hall 2 to research individual unit
        types. Each type starts at research level 0.
      </div>
    );
  }
  const options = (academy.researchOptions ?? []).filter((option) =>
    config.units.some(
      (unit) => unit.id === option.type && unit.domain === domain,
    ),
  );
  return (
    <section className="research-roster" aria-label="Unit research">
      <div className="label-row">
        <h3>Unit research</h3>
        <strong>Academy {academyLevel} / 10</strong>
      </div>
      <p className="progression-note">
        Each Academy level unlocks one research level per available unit type.
        Academy levels 7 through 10 unlock two each. Academy {academyLevel}{" "}
        allows type 1 up to research{" "}
        {researchUnitCap({ level: 1 }, academyLevel)}. Its Barracks, Harbor or
        Air Base must unlock the unit first. Each research level adds 5% to the
        already improved attack and health. Healing and shields based on maximum
        HP grow with the unit's health.
      </p>
      {config.academyPricingVersion >= 1 && (
        <p className="progression-note">
          Prices scale with Academy level and troop tier. Each completed
          research level adds {config.research.additionalLevelCostPercent}% of
          the base price for that type.
        </p>
      )}
      <div className="research-queue-status" role="status">
        <Icon name="research" size={17} />
        <span>
          <strong>
            {running ? "Research queue occupied" : "Research queue available"}
          </strong>
          {state.research.length ? (
            state.research.map((project) => {
              const details = researchProjectDetails(project, config);
              return (
                <small key={`${project.academy}-${project.type}`}>
                  {details.name} · {details.detail} ·{" "}
                  {Math.ceil(project.remainingMs / 1000)}s remaining
                </small>
              );
            })
          ) : (
            <small>One research project at a time across the city.</small>
          )}
        </span>
      </div>
      <div className="filters research-domains" aria-label="Research category">
        {Object.entries(battleDomains).map(([id, name]) => (
          <button
            key={id}
            className={domain === id ? "active" : ""}
            aria-pressed={domain === id}
            onClick={() => setDomain(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {options.map((option) => {
        const unit = config.units.find(
          (definition) => definition.id === option.type,
        );
        const current = researchUnitDefinition(state, {
          ...unit,
          researchLevel: option.level,
        });
        const currentHealth = option.currentHealth ?? current.health;
        const currentDamage = option.currentDamage ?? current.damage;
        const nextLevel = Math.min(10, option.nextLevel ?? option.level + 1);
        const nextHealth =
          option.nextHealth ?? researchedStat(unit.health, nextLevel);
        const nextDamage =
          option.nextDamage ?? researchedStat(unit.damage, nextLevel);
        const active = running?.type === unit.id;
        const maximum = option.maxLevel ?? researchUnitCap(unit);
        const academyLimit =
          option.academyLimit ?? researchUnitCap(unit, academyLevel);
        const done = option.level >= maximum;
        return (
          <section className="research-card" key={unit.id}>
            <div className="unit-summary">
              <SpriteImage type={unit.id} />
              <div>
                <h3>{unit.name}</h3>
                <small>
                  Unit type {unit.level} · Research {option.level}
                  {option.level <= maximum
                    ? ` / ${maximum}`
                    : " · previous rules"}
                </small>
                <small>
                  Current Academy limit {academyLimit} · Maximum {maximum}
                </small>
                <small>+{option.bonusPercent}% attack and health</small>
                <small>
                  HP {currentHealth}
                  {!done && ` → ${nextHealth}`}
                </small>
                <small>
                  {unit.carrierSlots > 0
                    ? "Attack depends on loaded aircraft"
                    : `Attack ${currentDamage}${!done ? ` → ${nextDamage}` : ""}`}
                </small>
                {unitAbilityDetails(current).map((detail) => (
                  <small key={detail}>{detail}</small>
                ))}
                {option.currentHealing > 0 && (
                  <small>
                    Healing {option.currentHealing} HP
                    {!done && ` → ${option.nextHealing} HP`}
                  </small>
                )}
                {option.currentShield > 0 && (
                  <small>
                    Shield {option.currentShield}
                    {!done && ` → ${option.nextShield}`}
                  </small>
                )}
              </div>
            </div>
            {option.level > academyLimit && option.preservedLevel > 0 && (
              <p className="progression-note">
                Previously paid research is retained. New improvements follow
                the current Academy limits.
              </p>
            )}
            {!done && (
              <>
                <div className="stat-line research-next-level">
                  <span>
                    Research {option.nextLevel} · +{option.nextBonusPercent}%
                    total
                  </span>
                  <strong>{option.seconds}s</strong>
                </div>
                <Cost cost={option.cost} />
              </>
            )}
            <button
              className="button secondary full"
              disabled={!option.ok}
              title={option.reason}
              onClick={() =>
                dispatch("RESEARCH", { id: academy.id, unitType: unit.id })
              }
            >
              {done
                ? "Research complete"
                : active
                  ? `${Math.ceil(running.remainingMs / 1000)}s remaining`
                  : `Research level ${option.nextLevel}`}
            </button>
            {!option.ok && !done && !active && (
              <p className="requirements">{option.reason}</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
export function TrainingRoster({ building, state, config, dispatch }) {
  const unlocked = [];
  const future = [];
  const sizes = [];
  for (const unit of config.units.filter(
    (unit) => unit.building === building.type,
  )) {
    const footprint = unit.footprint || [1, 1];
    const previous = sizes.at(-1);
    if (previous && previous.footprint.join() === footprint.join())
      previous.last = unit.level;
    else sizes.push({ first: unit.level, last: unit.level, footprint });
  }
  for (const option of building.training) {
    const def = config.units.find((unit) => unit.id === option.type);
    (def.level <= completedBuildingLevel(building) ? unlocked : future).push(
      option,
    );
  }
  const card = (option) => (
    <TrainingCard
      key={option.type}
      option={option}
      building={building}
      state={state}
      config={config}
      dispatch={dispatch}
    />
  );
  return (
    <section className="training-roster" aria-label="Unit training">
      <div className="label-row">
        <h3>Unlocked unit types</h3>
        <strong>
          {unlocked.length} / {building.training.length}
        </strong>
      </div>
      <p className="muted">
        Building level {completedBuildingLevel(building)} unlocks unit types 1
        to {completedBuildingLevel(building)}. Earlier types remain trainable.
        Each type has its own research level.{" "}
        {sizes.map((size) => (
          <span key={size.first}>
            Types {size.first}
            {size.last > size.first ? ` to ${size.last}` : ""} occupy{" "}
            {size.footprint.join("×")} tiles.{" "}
          </span>
        ))}
      </p>
      {unlocked.map(card)}
      {future.length > 0 && (
        <details className="training-future">
          <summary>Next unlocks ({future.length})</summary>
          {future.map(card)}
        </details>
      )}
    </section>
  );
}
function TrainingCard({ option, building, state, config, dispatch }) {
  const d = researchUnitDefinition(
    state,
    config.units.find((u) => u.id === option.type),
  );
  const queued = building.queue.filter((q) => q.type === d.id).length;
  const ready = state.units.filter(
    (u) => u.type === d.id && u.source === building.id,
  ).length;
  const locked = completedBuildingLevel(building) < d.level;
  const status = locked
    ? "Locked"
    : queued
      ? "Training"
      : ready
        ? "Ready"
        : "Available";
  return (
    <section className={`training-card ${locked ? "unit-locked" : ""}`}>
      <div className="unit-summary">
        <SpriteImage type={d.id} />
        <div>
          <h3>{d.name}</h3>
          <small>
            Unit type {d.level} · {status}
            {ready > 0 ? ` · ${ready} ready` : ""}
          </small>
          <small>
            {d.people} population · {d.seconds} seconds
          </small>
          <small>Map space {(d.footprint || [1, 1]).join("×")} tiles</small>
          <small>
            Research {d.researchLevel}
            {d.researchLevel <= d.researchMaxLevel
              ? ` / ${d.researchMaxLevel}`
              : " · previous rules"}
            {" · "}+{d.researchBonusPercent ?? 0}% attack and health
          </small>
        </div>
      </div>
      <UnitDetails def={d} />
      <Cost cost={d.cost} />
      {option.requirements.length > 0 && (
        <p className="requirements">{option.requirements.join(". ")}</p>
      )}
      <button
        className="button primary full"
        disabled={option.requirements.length > 0}
        title={option.requirements.join(". ")}
        onClick={() => dispatch("TRAIN", { id: building.id, unitType: d.id })}
      >
        Train {d.name}
      </button>
    </section>
  );
}
export function CarrierManagement({ carrier, state, config, dispatch }) {
  const def = config.units.find((d) => d.id === carrier.type);
  const aboard = state.units.filter((u) => u.carrier === carrier.id);
  const available = state.units.filter((u) => {
    const d = config.units.find((d) => d.id === u.type);
    return (
      !u.carrier &&
      u.health > 0 &&
      d.domain === "air" &&
      def.allowedAircraftTiers.includes(d.level)
    );
  });
  return (
    <section className="carrier-management">
      <h3>
        Aircraft {aboard.length}/{def.carrierSlots}
      </h3>
      <p>
        {def.carrierSlots - aboard.length} free slots. Supported aircraft:{" "}
        {config.units
          .filter(
            (d) =>
              d.domain === "air" && def.allowedAircraftTiers.includes(d.level),
          )
          .map((d) => d.name)
          .join(", ")}
        .
      </p>
      {carrier.damageByDomain && (
        <p>
          Attack against ships: {carrier.damageByDomain.naval}. Attack against
          aircraft: {carrier.damageByDomain.air}. Each attack uses the loaded
          aircraft together.
        </p>
      )}
      {aboard.map((u) => (
        <div className="carrier-aircraft" key={u.id}>
          <SpriteImage type={u.type} />
          <span>
            {config.units.find((d) => d.id === u.type).name} #{u.id}
          </span>
          <button
            className="text-button"
            onClick={() => dispatch("DISEMBARK_AIRCRAFT", { id: u.id })}
          >
            Unload
          </button>
        </div>
      ))}
      {available.map((u) => (
        <div className="carrier-aircraft" key={u.id}>
          <SpriteImage type={u.type} />
          <span>
            {config.units.find((d) => d.id === u.type).name} #{u.id}
          </span>
          <button
            className="text-button"
            disabled={aboard.length >= def.carrierSlots}
            onClick={() =>
              dispatch("EMBARK_AIRCRAFT", { id: u.id, carrier: carrier.id })
            }
          >
            Board
          </button>
        </div>
      ))}
      {!available.length && (
        <small>Train eligible aircraft at the Air Base.</small>
      )}
    </section>
  );
}

export function Inspector({
  state,
  config,
  selected,
  mode,
  placement,
  dispatch,
  setMode,
  onSelect,
  onOpenAttack,
}) {
  const building = state.buildings.find((b) => b.id === selected),
    unit = state.units.find((u) => u.id === selected);
  const chosen =
    mode?.type === "build"
      ? config.buildings.find((b) => b.id === mode.buildingType)
      : building
        ? config.buildings.find((b) => b.id === building.type)
        : null;
  if (mode?.type === "build" || mode?.type === "move")
    return (
      <aside className="inspector">
        <div className="inspector-heading">
          <span className="eyebrow">
            {mode.type === "build" ? "NEW CONSTRUCTION" : "RELOCATE BUILDING"}
          </span>
          <h2>{chosen?.name || "Move building"}</h2>
        </div>
        <div className="building-portrait">
          <SpriteImage type={chosen?.id || "house"} />
        </div>
        <p>{chosen?.description}</p>
        {mode.type === "build" && (
          <>
            <Cost cost={chosen.levels[0].cost} />
            <div className="stat-line">
              <span>Construction time</span>
              <strong>{chosen.levels[0].seconds}s</strong>
            </div>
          </>
        )}
        <div
          className={`hint-box ${placement?.ok === false ? "error" : ""}`}
          role="status"
        >
          {placement?.ok === false
            ? placement.message
            : "Choose a green tile on the map to confirm placement."}
        </div>
        <button className="button secondary full" onClick={() => setMode(null)}>
          Cancel placement <kbd>Esc</kbd>
        </button>
      </aside>
    );
  if (selected?.kind === "tree") {
    const [x, y] = selected.position;
    const affordable = state.stock[4] >= 20;
    return (
      <aside className="inspector">
        <span className="eyebrow">CLEAR LAND</span>
        <h2>Tree</h2>
        <div className="building-portrait">
          <SpriteImage type="tree" />
        </div>
        <p>
          Cut down this tree to collect wood and make room for construction.
        </p>
        <div className="stat-line">
          <span>Cost</span>
          <strong>20 gold</strong>
        </div>
        <div className="stat-line">
          <span>You receive</span>
          <strong>20 wood</strong>
        </div>
        <button
          className="button primary full"
          disabled={!affordable}
          onClick={() => dispatch("CLEAR_TREE", { x, y })}
        >
          Cut down tree
        </button>
        {!affordable && (
          <div className="hint-box">
            You need 20 gold to cut down this tree.
          </div>
        )}
      </aside>
    );
  }
  if (unit) {
    const def = researchUnitDefinition(
      state,
      config.units.find((d) => d.id === unit.type),
    );
    return (
      <aside className="inspector">
        <span className="eyebrow">YOUR ARMY</span>
        <h2>{def.name}</h2>
        <div className="building-portrait">
          <SpriteImage type={def.id} />
        </div>
        <div className="stat-line">
          <span>Health</span>
          <strong>
            {unit.health} / {unit.maxHealth ?? def.health}
          </strong>
        </div>
        <Progress value={unit.health} max={unit.maxHealth ?? def.health} />
        <UnitDetails
          def={
            unit.damageByDomain
              ? {
                  ...def,
                  damage: unit.damage,
                  damageByDomain: unit.damageByDomain,
                }
              : def
          }
        />
        <div className="stat-line">
          <span>Map footprint</span>
          <strong>{mapFootprint(unit).join("×")} tiles</strong>
        </div>
        <div className="stat-line">
          <span>Unit type / Research level</span>
          <strong>
            {def.level} / {def.researchLevel}
          </strong>
        </div>
        <p className="progression-note">
          Research bonus: +{def.researchBonusPercent ?? 0}% attack and health.
        </p>
        {unit.carrier && (
          <div className="hint-box">
            Aboard carrier #{unit.carrier}.{" "}
            <button
              className="text-button"
              onClick={() => onSelect(unit.carrier)}
            >
              Inspect carrier
            </button>
            <button
              className="button secondary full"
              onClick={() => dispatch("DISEMBARK_AIRCRAFT", { id: unit.id })}
            >
              Return to Air Base
            </button>
          </div>
        )}
        {unit.reserve && (
          <p className="requirements">
            Waiting for enough free map space near its training building.
          </p>
        )}
        {def.carrierSlots > 0 && (
          <CarrierManagement
            carrier={unit}
            state={state}
            config={config}
            dispatch={dispatch}
          />
        )}
        <div className="hint-box">
          {unit.carrier
            ? "Unload this aircraft before moving it or selecting an independent mission."
            : "Use the Move action, then select a reachable clear destination."}
        </div>
        <div className="stat-line">
          <span>Population used</span>
          <strong>{def.people}</strong>
        </div>
      </aside>
    );
  }
  if (!building)
    return (
      <aside className="inspector">
        <span className="eyebrow">A WORLD OF POSSIBILITY</span>
        <h2>Your story starts here.</h2>
        <p>
          Select a building to manage production, train your army or plan an
          upgrade.
        </p>
        <div className="hint-box">
          Begin with a Farm and Lumberyard for resources, Houses for population
          capacity, and a Barracks for your first unit. Town Hall upgrades
          require population capacity and completed buildings, and unlock more
          buildings and higher level limits.
        </div>
        <h3>Island overview</h3>
        <div className="stat-line">
          <span>Population capacity</span>
          <strong>{state.population.capacity}</strong>
        </div>
        {state.population.military + state.population.reserved >
          state.population.capacity && (
          <div className="hint-box">
            Your existing army is preserved. Build or upgrade Houses to add
            population capacity before training more troops.
          </div>
        )}
        <div className="stat-line">
          <span>Town Hall</span>
          <strong>{state.townHallLevel} / 10</strong>
        </div>
        <div className="stat-line">
          <span>Army population</span>
          <strong>{state.population.military}</strong>
        </div>
        <div className="stat-line">
          <span>Reserved for training</span>
          <strong>{state.population.reserved}</strong>
        </div>
        <div className="stat-line">
          <span>Available army capacity</span>
          <strong>{state.population.free}</strong>
        </div>
      </aside>
    );
  const completedLevel = completedBuildingLevel(building),
    next = chosen.levels[completedLevel],
    cap =
      building.townHallCap ??
      buildingLevelCap(config, building.type, state.townHallLevel),
    goldShortage = next ? upgradeGoldShortage(state, next.cost) : 0,
    prerequisites =
      building.type === "townhall" ? townHallRequirements(state, config) : [];
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span className="eyebrow">ISLAND MANAGEMENT</span>
        <div className="title-row">
          <h2>{chosen.name}</h2>
          <span className="level-badge">
            LVL {completedLevel} / {chosen.levels.length}
          </span>
        </div>
      </div>
      <div
        className={`building-portrait ${building.state !== 1 ? "constructing" : ""}`}
      >
        <SpriteImage type={building.type} level={Math.max(1, completedLevel)} />
        <span className="portrait-shadow" />
      </div>
      <p>{chosen.description}</p>
      {building.type !== "townhall" && (
        <div className="stat-line">
          <span>Town Hall {state.townHallLevel} level cap</span>
          <strong>
            {cap} / {chosen.levels.length}
          </strong>
        </div>
      )}
      {building.type === "townhall" && (
        <section
          className="building-cap-list"
          aria-label="Building level limits"
        >
          <h3>Current building limits</h3>
          {config.buildings
            .filter((definition) => definition.id !== "townhall")
            .map((definition) => {
              const currentCap = buildingLevelCap(
                config,
                definition.id,
                completedLevel,
              );
              const nextCap = next
                ? buildingLevelCap(config, definition.id, completedLevel + 1)
                : currentCap;
              return (
                <div className="stat-line" key={definition.id}>
                  <span>{definition.name}</span>
                  <strong>
                    {currentCap === 0 ? "Locked" : currentCap}
                    {nextCap > currentCap && (
                      <small> → {nextCap} next level</small>
                    )}
                  </strong>
                </div>
              );
            })}
          <p className="progression-note">
            New limits apply when the Town Hall upgrade completes. Other
            buildings still need separate upgrades.
          </p>
        </section>
      )}
      {building.state !== 1 ? (
        <div className="hint-box">
          <strong>
            {building.state === 0
              ? "Under construction"
              : "Upgrade in progress"}
          </strong>
          <span>
            {Math.ceil(building.remainingMs / 1000)} seconds remaining
          </span>
        </div>
      ) : (
        <>
          {building.production.resource >= 0 && (
            <section className="storage-card">
              <div className="label-row">
                <span className="eyebrow">LOCAL STORAGE</span>
                <span className="rate">
                  +1 every {productionIntervalSeconds(building.production)}s
                </span>
              </div>
              <div className="storage-amount">
                <Icon
                  name={resources[building.production.resource]}
                  size={24}
                />
                <strong>
                  {building.stored}
                  <em> / {building.production.capacity}</em>
                </strong>
                <span
                  className={`status-dot ${building.production.full ? "full" : ""}`}
                />
              </div>
              <Progress
                value={building.stored}
                max={building.production.capacity}
              />
              <small>
                {building.production.full
                  ? "Storage full. Production is waiting."
                  : "Automatically producing resources."}
              </small>
              <button
                className="button primary full"
                disabled={!building.stored}
                onClick={() => dispatch("COLLECT", { id: building.id })}
              >
                Collect {resources[building.production.resource]}
                <Icon name="arrow" size={18} />
              </button>
            </section>
          )}
          {building.housing > 0 && (
            <div className="highlight-stat">
              <Icon name="people" size={28} />
              <strong>{building.housing}</strong>
              <span>population capacity</span>
            </div>
          )}
          {building.queue.length > 0 && (
            <section>
              <h3>
                Training queue{" "}
                <span className="count">{building.queue.length}</span>
              </h3>
              {building.queue.map((q, i) => (
                <div className="queue-row" key={i}>
                  <span>{config.units.find((u) => u.id === q.type).name}</span>
                  <strong>
                    {q.awaiting
                      ? "Needs space"
                      : `${Math.ceil(q.remainingMs / 1000)}s`}
                  </strong>
                  <button
                    className="text-button"
                    onClick={() =>
                      dispatch("CANCEL_TRAINING", { id: building.id, index: i })
                    }
                    aria-label={`Cancel training ${i + 1}`}
                  >
                    Cancel and refund
                  </button>
                </div>
              ))}
            </section>
          )}
          {building.training.length > 0 && (
            <TrainingRoster
              key={building.id}
              building={building}
              state={state}
              config={config}
              dispatch={dispatch}
            />
          )}
          {building.type === "academy" && (
            <ResearchPanel
              state={state}
              config={config}
              dispatch={dispatch}
              academy={building}
            />
          )}
          <div className="upgrade-section">
            {next ? (
              <>
                <div className="label-row">
                  <h3>Upgrade to level {completedLevel + 1}</h3>
                  <small>{next.seconds}s</small>
                </div>
                {prerequisites.length > 0 && (
                  <ul
                    className="upgrade-prerequisites"
                    aria-label="Town Hall upgrade requirements"
                  >
                    {prerequisites.map((requirement) => (
                      <li
                        key={requirement.type}
                        className={requirement.met ? "met" : "unmet"}
                      >
                        <span>
                          {requirement.name}{" "}
                          {requirement.type !== "population" && "level "}
                          {requirement.required}
                        </span>
                        <strong>
                          {requirement.current} / {requirement.required}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
                {next.housing > 0 && (
                  <p className="progression-note">
                    Next capacity: {next.housing} population.
                  </p>
                )}
                {productionIntervalSeconds(next) > 0 && (
                  <p className="progression-note">
                    Next production: 1 {resources[building.production.resource]}{" "}
                    every {productionIntervalSeconds(next)}{" "}
                    {productionIntervalSeconds(next) === 1
                      ? "second"
                      : "seconds"}
                    .
                  </p>
                )}
                <Cost cost={next.cost} />
                <button
                  className="button secondary full"
                  disabled={!building.upgrade.ok}
                  title={building.upgrade.reason}
                  onClick={() => dispatch("UPGRADE", { id: building.id })}
                >
                  Upgrade building <Icon name="arrow" size={16} />
                </button>
                {!building.upgrade.ok && (
                  <p className="requirements">{building.upgrade.reason}</p>
                )}
                {goldShortage > 0 && (
                  <div className="hint-box" role="status">
                    <strong>Fight a battle to collect gold.</strong>
                    <span>
                      You need {goldShortage} more gold for this upgrade.
                    </span>
                    {onOpenAttack && (
                      <button
                        className="button secondary full"
                        onClick={onOpenAttack}
                      >
                        Open attack menu <Icon name="army" size={16} />
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>Maximum level reached.</p>
            )}
            <button
              className="text-button"
              disabled={
                building.queue.length > 0 ||
                state.research.some((r) => r.academy === building.id)
              }
              onClick={() => setMode({ type: "move", id: building.id })}
            >
              Move building
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
export function BattlePanel({ state, config, selected, onSelect, dispatch }) {
  const battle = state.battle;
  const campaignLevel = config.campaign?.levels.find(
    (level) => level.battleId === battle.campaignLevel,
  );
  if (battle.finished)
    return (
      <aside className="inspector battle-result">
        <span className="eyebrow">
          {campaignLevel
            ? `LEVEL ${battle.campaignLevel} ${battle.victory ? "CONQUERED" : "UNFINISHED"}`
            : "EXPEDITION COMPLETE"}
        </span>
        <Icon name="army" size={54} />
        <h2>
          {battle.victory
            ? "A victory for your empire."
            : "The enemy won this battle."}
        </h2>
        <BattleRounds battle={battle} />
        <p>
          {battle.victory
            ? campaignLevel
              ? battle.campaignLevel === config.campaign.levels.length
                ? "Every round won. Your campaign is complete."
                : `Every round won. Claim your rewards to unlock level ${Math.max(state.campaign?.currentLevel ?? 1, battle.campaignLevel + 1)}.`
              : "Your army won more rounds. Claim the spoils and welcome new settlers."
            : campaignLevel
              ? `Level ${battle.campaignLevel} remains unfinished. Rebuild your army and try again.`
              : battle.retreated
                ? "Your army could not defeat the defenders and retreated. Surviving units return to the island."
                : "Your surviving units return to the island. No reward this time."}
        </p>
        {battle.victory && (
          <>
            <Cost cost={campaignLevel?.rewards || config.battle.rewards} />
            {!campaignLevel && (
              <>
                <div className="stat-line">
                  <span>Captives</span>
                  <strong>{config.battle.captives}</strong>
                </div>
                <small>Only available housing spaces can be filled.</small>
              </>
            )}
          </>
        )}
        <button
          className="button primary full"
          onClick={() => dispatch("BATTLE_FINISH")}
        >
          {battle.victory ? "Claim rewards" : "Return to island"}
        </button>
      </aside>
    );
  return null;
}

export function ActivityPanel({ state, config, onSelect }) {
  const activities = [
    ...state.buildings
      .filter((b) => b.state !== 1)
      .map((b) => ({
        id: b.id,
        name: config.buildings.find((d) => d.id === b.type).name,
        detail: b.state === 0 ? "Construction" : "Upgrade",
        time: b.remainingMs,
      })),
    ...state.buildings
      .filter((b) => b.queue.length)
      .map((b) => ({
        id: b.id,
        name: "Training",
        detail: config.buildings.find((d) => d.id === b.type).name,
        time: b.queue[0].remainingMs,
      })),
    ...state.research.map((r) => ({
      id: r.academy,
      ...researchProjectDetails(r, config),
      time: r.remainingMs,
    })),
  ];
  if (!activities.length) return null;
  return (
    <div className="activity-panel">
      <span className="eyebrow">IN PROGRESS</span>
      {activities.slice(0, 3).map((a, i) => (
        <button key={i} onClick={() => onSelect(a.id)}>
          <span>
            {a.name}
            <small>{a.detail}</small>
          </span>
          <strong>{Math.ceil(a.time / 1000)}s</strong>
        </button>
      ))}
      {activities.length > 3 && (
        <small>+{activities.length - 3} more tasks</small>
      )}
    </div>
  );
}
