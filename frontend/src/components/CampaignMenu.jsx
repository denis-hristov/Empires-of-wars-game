import { spriteUrl } from "../game/SpriteAssets.js";
import {
  autoSelectCampaignArmy,
  campaignArmyCandidates,
  campaignArmyDomains,
  campaignDomainLimit,
  replaceCampaignDomainSelection,
} from "../game/CampaignArmy.js";

const domainTroops = { land: "land troops", naval: "ships", air: "aircraft" };
const troopBadges = { land: "Land troops", naval: "Ships", air: "Aircraft" };
const levelKinds = {
  ordinary: "Battle",
  boss: "Boss battle",
  double_boss: "Double boss",
  ai: "AI encounter",
  final: "Final battle",
};

function DomainSquad({ domain, candidates, selectedIds, onChange }) {
  const selected = candidates
    .filter(({ unit }) => selectedIds.includes(unit.id))
    .map(({ unit }) => unit.id);
  return (
    <section className="squad-domain" aria-label={troopBadges[domain]}>
      <div className="squad-summary">
        <strong>
          Choose {domainTroops[domain]} ({selected.length}/{campaignDomainLimit}
          )
        </strong>
        <button
          className="text-button"
          disabled={!selected.length}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      </div>
      {!candidates.length && (
        <div className="hint-box">
          No {domainTroops[domain]} available. Train them at the{" "}
          {domain === "land"
            ? "Barracks"
            : domain === "naval"
              ? "Harbor"
              : "Airbase"}{" "}
          before attacking.
        </div>
      )}
      <div className="squad-list">
        {candidates.map(({ unit, definition }) => {
          const checked = selected.includes(unit.id);
          return (
            <label
              className={`squad-card ${checked ? "selected" : ""}`}
              key={unit.id}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && selected.length >= campaignDomainLimit}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((id) => id !== unit.id)
                      : [...selected, unit.id],
                  )
                }
              />
              <img src={spriteUrl(unit.type)} alt="" draggable="false" />
              <span>
                <strong>
                  {definition.name} #{unit.id}
                </strong>
                <small>
                  {unit.health} / {unit.maxHealth ?? definition.health} HP
                </small>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function CampaignMenu({ state, config, squad, setSquad, onAttack }) {
  const currentLevel = state.campaign?.currentLevel ?? 1;
  const campaign = config.campaign;
  const level =
    campaign.levels.find((entry) => entry.battleId === currentLevel) ||
    campaign.levels[0];
  const completed = state.campaign?.completedLevels || [];
  const progressionLocked = level.battleId > currentLevel;
  const townHallLocked = state.townHallLevel < level.requiredTH;
  const locked = progressionLocked || townHallLocked;
  const domains = campaignArmyDomains(level);
  const candidates = campaignArmyCandidates(state, config, domains);
  const groups = domains.map((domain) => {
    const units = candidates.filter((entry) => entry.domain === domain);
    return {
      domain,
      candidates: units,
      selected: units
        .filter(({ unit }) => squad.includes(unit.id))
        .map(({ unit }) => unit.id),
    };
  });
  const missingDomains = groups.filter((group) => !group.selected.length);
  const ready = groups.every(
    (group) =>
      group.selected.length > 0 && group.selected.length <= campaignDomainLimit,
  );
  return (
    <div className="attack-menu campaign-menu">
      <div className="campaign-progress">
        <span className="eyebrow">CAMPAIGN</span>
        <strong>
          {completed.length} / {campaign.levels.length} conquered
        </strong>
        <progress
          value={completed.length}
          max={campaign.levels.length}
          aria-label="Campaign progress"
        />
      </div>
      {state.campaign?.completed && (
        <div className="hint-box">
          Campaign complete. All {campaign.levels.length} levels conquered.
        </div>
      )}
      <div className="campaign-level-heading">
        <h3>Level {level.battleId}</h3>
        <span>{levelKinds[level.type] || "Battle"}</span>
      </div>
      <div className="campaign-level-meta" aria-label="Battle requirements">
        <span>
          {level.rounds.length} {level.rounds.length === 1 ? "round" : "rounds"}
        </span>
        {domains.map((domain) => (
          <span key={domain}>{troopBadges[domain]}</span>
        ))}
      </div>
      {locked ? (
        <div className="hint-box" role="status">
          {progressionLocked
            ? `Win level ${level.battleId - 1} before attacking this level.`
            : `Upgrade Town Hall to level ${level.requiredTH} to unlock this battle.`}
        </div>
      ) : (
        <>
          <button
            className="button secondary full campaign-auto-select"
            disabled={!candidates.length}
            onClick={() =>
              setSquad(autoSelectCampaignArmy(state, config, domains))
            }
          >
            Auto select
          </button>
          <p className="muted">
            Selects the 5 strongest available units of each required type, or
            all available if fewer.
          </p>
          {groups.map((group) => (
            <DomainSquad
              key={group.domain}
              domain={group.domain}
              candidates={group.candidates}
              selectedIds={squad}
              onChange={(selectedIds) =>
                setSquad(
                  replaceCampaignDomainSelection(
                    squad,
                    group.candidates.map(({ unit }) => unit.id),
                    selectedIds,
                  ),
                )
              }
            />
          ))}
          {missingDomains.length > 0 && (
            <p className="muted" role="status">
              Choose at least 1 unit for:{" "}
              {missingDomains
                .map((group) => domainTroops[group.domain])
                .join(", ")}
              .
            </p>
          )}
        </>
      )}
      <button
        className="button primary full"
        disabled={locked || !ready}
        onClick={() =>
          onAttack(
            groups.flatMap((group) => group.selected),
            [],
            level.battleId,
          )
        }
      >
        Attack level {level.battleId}
      </button>
      <p className="muted">
        Choose 1 to 5 units of each required type before attacking. This army is
        fixed for every round. Surviving units keep their remaining health. Win
        every round to unlock the next level. A defeat keeps you on this level.
      </p>
    </div>
  );
}
