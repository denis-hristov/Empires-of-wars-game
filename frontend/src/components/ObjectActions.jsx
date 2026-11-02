import { LaboratoryPanel } from "./LaboratoryPanel.jsx";
import { potionDetails, potionUrl } from "../game/Magic.js";
import { Icon } from "./Icons.jsx";
import { Dialog } from "./Dialog.jsx";
import {
  CarrierManagement,
  Inspector,
  ResearchPanel,
  SpriteImage,
  TrainingRoster,
} from "./GamePanels.jsx";
import {
  actionMenuPosition,
  mapObjectActions,
} from "../game/MapObjectActions.js";
import {
  completedBuildingLevel,
  buildingLevelCap,
  productionIntervalSeconds,
  researchUnitCap,
  townHallRequirements,
} from "../game/BuildingProgression.js";

const resourceNames = ["food", "wood", "stone", "iron", "coins"];
const nameOfResource = (resource) =>
  resource === "coins" ? "Gold" : resource[0].toUpperCase() + resource.slice(1);

export function ObjectQuickActions({
  object,
  state,
  anchor,
  onAction,
  onClose,
}) {
  if (!object || !anchor || anchor.key !== object.key) return null;
  const actions = mapObjectActions(object, state);
  return (
    <section
      className="object-actions"
      aria-label={`${object.name} actions`}
      style={actionMenuPosition(anchor, actions.length)}
    >
      <div className="object-actions-title">
        <strong>{object.name}</strong>
        {object.kind === "building" && (
          <span>Level {completedBuildingLevel(object.entity)}</span>
        )}
        <button aria-label="Close object actions" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="object-action-buttons">
        {actions.map((action) => (
          <button
            key={action.id}
            className={`object-action action-${action.id}`}
            disabled={action.disabled}
            title={action.reason || action.label}
            onClick={() => onAction(action.id)}
            aria-label={`${action.label} ${object.name}`}
            aria-haspopup={
              !["collect", "move"].includes(action.id) ? "dialog" : undefined
            }
          >
            {action.value > 0 && (
              <small className="action-count">{action.value}</small>
            )}
            <span className="object-action-icon">
              <Icon name={action.icon} size={28} />
            </span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function UpgradeContent({
  object,
  state,
  config,
  dispatch,
  onClose,
  onOpenAttack,
}) {
  const building = object.entity;
  const level = completedBuildingLevel(building);
  const next = object.definition.levels[level];
  if (!next)
    return (
      <div className="hint-box">
        This building has reached its maximum level.
      </div>
    );
  const current = object.definition.levels[Math.max(0, level - 1)];
  const prerequisites =
    building.type === "townhall" ? townHallRequirements(state, config) : [];
  const unlocks = config.units.filter(
    (unit) => unit.building === building.type && unit.level === level + 1,
  );
  const newLimits =
    building.type === "townhall"
      ? config.buildings
          .filter((definition) => definition.id !== "townhall")
          .map((definition) => ({
            name: definition.name,
            before: buildingLevelCap(config, definition.id, level),
            after: buildingLevelCap(config, definition.id, level + 1),
          }))
          .filter((limit) => limit.after > limit.before)
      : [];
  const cost = building.upgrade.cost || next.cost;
  const price = resourceNames
    .map((resource, index) => ({
      resource,
      required: Array.isArray(cost) ? cost[index] : cost[resource] || 0,
      available: state.stock[index],
    }))
    .filter((row) => row.required > 0);
  const goldShortage = price.some(
    (row) => row.resource === "coins" && row.available < row.required,
  );
  return (
    <div className="upgrade-content">
      <div className="upgrade-scroll">
        <p className="object-dialog-intro">
          Review the appearance, benefits and cost of level {level + 1}.
        </p>
        <div
          className="upgrade-comparison"
          aria-label="Building appearance comparison"
        >
          <div className="upgrade-preview current">
            <span>Current level</span>
            <strong>{level}</strong>
            <SpriteImage type={building.type} level={Math.max(1, level)} />
          </div>
          <span className="upgrade-arrow">
            <Icon name="arrow" size={28} />
          </span>
          <div className="upgrade-preview next">
            <span>Next level</span>
            <strong>{level + 1}</strong>
            <SpriteImage type={building.type} level={level + 1} />
          </div>
        </div>
        <div className="upgrade-summary">
          <span>
            <Icon name="upgrade" size={18} /> Level {level}{" "}
            <Icon name="arrow" size={14} /> {level + 1}
          </span>
          <span>
            <Icon name="time" size={18} /> {next.seconds} seconds
          </span>
        </div>
        <div className="upgrade-details-grid">
          <section className="upgrade-details">
            <h3>What improves</h3>
            {building.production.resource >= 0 && (
              <div className="upgrade-benefit">
                <Icon name={resourceNames[building.production.resource]} />
                <span>
                  1 {resourceNames[building.production.resource]} every{" "}
                  <strong>
                    {productionIntervalSeconds(current)}s →{" "}
                    {productionIntervalSeconds(next)}s
                  </strong>
                  <small>
                    Local storage {current.localCapacity} → {next.localCapacity}
                  </small>
                </span>
              </div>
            )}
            {next.housing > 0 && (
              <div className="upgrade-benefit">
                <Icon name="people" />
                <span>
                  Population capacity
                  <strong>
                    {current.housing} → {next.housing}
                  </strong>
                </span>
              </div>
            )}
            {unlocks.map((unit) => (
              <div className="upgrade-benefit" key={unit.id}>
                <SpriteImage type={unit.id} />
                <span>
                  New unit type {unit.level}
                  <strong>{unit.name}</strong>
                </span>
              </div>
            ))}
            {building.type === "laboratory" && (
              <div className="upgrade-benefit">
                <img
                  src={potionUrl(["heal", "shield", "attack", "revive"][level])}
                  alt=""
                  width="64"
                  height="64"
                />
                <span>
                  New potion
                  <strong>
                    {
                      potionDetails[
                        ["heal", "shield", "attack", "revive"][level]
                      ]?.name
                    }
                  </strong>
                  <small>
                    All previous potions remain available. Shared capacity: 5.
                  </small>
                </span>
              </div>
            )}
            {building.type === "academy" && (
              <div className="upgrade-benefit">
                <Icon name="research" />
                <span>
                  First unit type research limit
                  <strong>
                    {researchUnitCap({ level: 1 }, level)} →{" "}
                    {researchUnitCap({ level: 1 }, level + 1)}
                  </strong>
                  <small>
                    {level + 1 >= 7 ? "Two" : "One"} more research levels for
                    each available unit type. Type {level + 1} can reach
                    research level {level + 1 >= 7 ? 2 : 1} once its military
                    building unlocks it. Each improvement adds 5% to attack,
                    health and abilities based on maximum HP.
                  </small>
                </span>
              </div>
            )}
            {newLimits.map((limit) => (
              <div className="upgrade-limit" key={limit.name}>
                <span>{limit.name}</span>
                <strong>
                  {limit.before || "Locked"} → {limit.after}
                </strong>
              </div>
            ))}
            {!unlocks.length &&
              !newLimits.length &&
              building.production.resource < 0 &&
              !next.housing &&
              building.type !== "academy" && (
                <p>Reach building level {level + 1}.</p>
              )}
          </section>
          <section className="upgrade-details">
            <h3>Upgrade cost</h3>
            <div className="upgrade-costs">
              {price.map((row) => (
                <div
                  key={row.resource}
                  className={`upgrade-cost ${row.available < row.required ? "missing" : "ready"}`}
                >
                  <Icon name={row.resource} size={22} />
                  <span>
                    {nameOfResource(row.resource)}
                    <strong>{row.required.toLocaleString("en-US")}</strong>
                    <small>
                      You have {row.available.toLocaleString("en-US")}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        {!!prerequisites.length && (
          <section className="upgrade-requirements">
            <h3>Upgrade requirements</h3>
            <div>
              {prerequisites.map((requirement) => (
                <span
                  className={requirement.met ? "met" : "unmet"}
                  key={requirement.type}
                >
                  <Icon name={requirement.met ? "check" : "build"} size={16} />
                  {requirement.name} {requirement.required}
                  <small>
                    {requirement.current}/{requirement.required}
                  </small>
                </span>
              ))}
            </div>
          </section>
        )}
        {goldShortage && (
          <div className="hint-box">
            Fight a battle to collect more gold.
            <button className="text-button" onClick={onOpenAttack}>
              Open attack menu
            </button>
          </div>
        )}
      </div>
      <div className="object-dialog-footer">
        {!building.upgrade.ok && (
          <p className="upgrade-footer-reason" role="status">
            <Icon name="info" size={16} />
            {building.upgrade.reason}
          </p>
        )}
        <button className="button secondary" onClick={onClose}>
          Not now
        </button>
        <button
          className="button primary upgrade-confirm"
          disabled={!building.upgrade.ok}
          onClick={() => {
            const result = dispatch("UPGRADE", { id: building.id });
            if (result.ok) onClose();
          }}
        >
          <Icon name="upgrade" size={20} />
          Upgrade to level {level + 1}
        </button>
      </div>
    </div>
  );
}

function TrainingQueue({ building, config, dispatch }) {
  return (
    <section className="dialog-training-queue">
      <div className="label-row">
        <h3>Training queue</h3>
        <strong>
          {building.queue.length} /{" "}
          {
            config.buildings.find(
              (definition) => definition.id === building.type,
            ).queueCapacity
          }
        </strong>
      </div>
      <p>
        Each building trains one unit at a time. Other military buildings can
        train independently.
      </p>
      {building.queue.length ? (
        building.queue.map((task, index) => (
          <div className="queue-row" key={`${task.type}-${index}`}>
            <span>
              {config.units.find((unit) => unit.id === task.type).name}
            </span>
            <strong>
              {task.awaiting
                ? "Waiting for map space"
                : `${Math.ceil(task.remainingMs / 1000)}s`}
            </strong>
            <button
              className="text-button"
              onClick={() =>
                dispatch("CANCEL_TRAINING", { id: building.id, index })
              }
            >
              Cancel and refund
            </button>
          </div>
        ))
      ) : (
        <p>Your next unit is ready to be trained.</p>
      )}
    </section>
  );
}

function ObjectInformation({
  object,
  state,
  config,
  dispatch,
  onSelect,
  onOpenAttack,
  onDismiss,
}) {
  const { kind, entity, definition } = object;
  if (kind === "unit") {
    const dismissal = mapObjectActions(object, state).find(
      (action) => action.id === "dismiss",
    );
    return (
      <>
        <Inspector
          state={state}
          config={config}
          selected={entity.id}
          dispatch={dispatch}
          onSelect={onSelect}
          onOpenAttack={onOpenAttack}
        />
        {dismissal.reason && <p className="requirements">{dismissal.reason}</p>}
        <div className="object-dialog-footer">
          <button
            className="button secondary"
            disabled={dismissal.disabled}
            onClick={onDismiss}
          >
            Dismiss for 20 gold
          </button>
        </div>
      </>
    );
  }
  if (kind === "tree" || kind === "rock")
    return (
      <div className="object-information">
        <div className="information-art">
          <SpriteImage type={kind} />
        </div>
        <p>
          {kind === "tree"
            ? "Clear this tree to receive 20 wood and open the tile for construction. Clearing costs 20 gold."
            : "Rocks mark mountain terrain. Stone and iron mines can use suitable mountain plots. This rock cannot be cleared."}
        </p>
        <div className="stat-line">
          <span>Map position</span>
          <strong>{entity.position.join(", ")}</strong>
        </div>
      </div>
    );
  const level = completedBuildingLevel(entity);
  return (
    <div className="object-information">
      <div className="information-art">
        <SpriteImage type={entity.type} level={Math.max(1, level)} />
      </div>
      <p>{definition.description}</p>
      <div className="information-stats">
        <div className="stat-line">
          <span>Completed level</span>
          <strong>
            {level} / {definition.levels.length}
          </strong>
        </div>
        <div className="stat-line">
          <span>Map footprint</span>
          <strong>{entity.footprint.join("×")} tiles</strong>
        </div>
        <div className="stat-line">
          <span>Status</span>
          <strong>
            {entity.state === 1
              ? "Ready"
              : `${entity.state === 0 ? "Building" : "Upgrading"} · ${Math.ceil(entity.remainingMs / 1000)}s`}
          </strong>
        </div>
        {entity.production.resource >= 0 && (
          <>
            <div className="stat-line">
              <span>Produces</span>
              <strong>
                1 {resourceNames[entity.production.resource]} every{" "}
                {productionIntervalSeconds(entity.production)}s
              </strong>
            </div>
            <div className="stat-line">
              <span>Stored resources</span>
              <strong>
                {entity.stored} / {entity.production.capacity}
              </strong>
            </div>
          </>
        )}
        {entity.housing > 0 && (
          <div className="stat-line">
            <span>Population capacity</span>
            <strong>{entity.housing}</strong>
          </div>
        )}
        {entity.type === "townhall" &&
          config.buildings
            .filter((building) => building.id !== "townhall")
            .map((building) => (
              <div className="stat-line" key={building.id}>
                <span>{building.name} limit</span>
                <strong>
                  {buildingLevelCap(config, building.id, level) || "Locked"}
                </strong>
              </div>
            ))}
      </div>
    </div>
  );
}

export function UnitDismissalContent({ object, state, dispatch, onClose }) {
  const dismissal = mapObjectActions(object, state).find(
    (action) => action.id === "dismiss",
  );
  return (
    <div className="object-information">
      <div className="information-art">
        <SpriteImage type={object.type} />
      </div>
      <p>Release this unit from your army.</p>
      <div className="stat-line">
        <span>You receive</span>
        <strong>20 gold</strong>
      </div>
      <div className="stat-line">
        <span>Population freed</span>
        <strong>{object.definition.people}</strong>
      </div>
      {dismissal.reason && <p className="requirements">{dismissal.reason}</p>}
      <div className="object-dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Keep unit
        </button>
        <button
          className="button primary"
          disabled={dismissal.disabled}
          onClick={() => {
            const result = dispatch("DISMISS_UNIT", { id: object.entity.id });
            if (result.ok) onClose();
          }}
        >
          Dismiss for 20 gold
        </button>
      </div>
    </div>
  );
}

export function ObjectActionDialog({
  object,
  action,
  state,
  config,
  dispatch,
  onClose,
  onSelect,
  onOpenAttack,
  onAction,
}) {
  if (!object) return null;
  const title =
    action === "upgrade"
      ? `Upgrade ${object.name}`
      : action === "train"
        ? `Train at ${object.name}`
        : action === "research"
          ? "Academy research"
          : action === "remove"
            ? "Clear this tree"
            : action === "carrier"
              ? `${object.name} aircraft`
              : action === "dismiss"
                ? `Dismiss ${object.name}`
                : object.name;
  return (
    <Dialog
      title={title}
      onClose={onClose}
      className={`object-dialog object-dialog-${action}`}
    >
      {action === "upgrade" && (
        <UpgradeContent
          object={object}
          state={state}
          config={config}
          dispatch={dispatch}
          onClose={onClose}
          onOpenAttack={onOpenAttack}
        />
      )}
      {action === "train" && (
        <>
          <TrainingQueue
            building={object.entity}
            config={config}
            dispatch={dispatch}
          />
          <TrainingRoster
            building={object.entity}
            state={state}
            config={config}
            dispatch={dispatch}
          />
        </>
      )}
      {action === "potions" && (
        <LaboratoryPanel
          state={state}
          config={config}
          building={object.entity}
          dispatch={dispatch}
        />
      )}
      {action === "research" && (
        <ResearchPanel
          state={state}
          config={config}
          academy={object.entity}
          dispatch={dispatch}
        />
      )}
      {action === "carrier" && (
        <CarrierManagement
          carrier={object.entity}
          state={state}
          config={config}
          dispatch={dispatch}
        />
      )}
      {action === "info" && (
        <ObjectInformation
          object={object}
          state={state}
          config={config}
          dispatch={dispatch}
          onSelect={onSelect}
          onOpenAttack={onOpenAttack}
          onDismiss={() => onAction?.("dismiss")}
        />
      )}
      {action === "dismiss" && object.kind === "unit" && (
        <UnitDismissalContent
          object={object}
          state={state}
          dispatch={dispatch}
          onClose={onClose}
        />
      )}
      {action === "remove" && (
        <div className="object-information">
          <div className="information-art">
            <SpriteImage type="tree" />
          </div>
          <p>Open this tile for construction and receive 20 wood.</p>
          <div className="tree-exchange">
            <span>
              <Icon name="coins" />
              20 gold
            </span>
            <Icon name="arrow" />
            <span>
              <Icon name="wood" />
              20 wood
            </span>
          </div>
          {state.stock[4] < 20 && (
            <div className="hint-box">
              Fight a battle to collect the 20 gold needed to clear this tree.
            </div>
          )}
          <div className="object-dialog-footer">
            <button className="button secondary" onClick={onClose}>
              Keep tree
            </button>
            <button
              className="button primary"
              disabled={state.stock[4] < 20}
              onClick={() => {
                const result = dispatch("CLEAR_TREE", {
                  x: object.entity.position[0],
                  y: object.entity.position[1],
                });
                if (result.ok) onClose();
              }}
            >
              Clear tree
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
