import { useRef, useState } from "react";
import { Cost, SpriteImage } from "./GamePanels.jsx";
import { completedBuildingLevel } from "../game/BuildingProgression.js";
import { potionDetails, potionUrl } from "../game/Magic.js";
import "../styles/magic.css";

export function LaboratoryPanel({ state, config, building, dispatch }) {
  const level = completedBuildingLevel(building);
  const magic = state.magic;
  const [removal, setRemoval] = useState(null);
  const removing = useRef(false);
  return (
    <section className="laboratory-panel" aria-label="Laboratory potions">
      <div className="laboratory-overview">
        <SpriteImage type="laboratory" level={Math.max(1, level)} />
        <div>
          <span className="eyebrow">ALCHEMY WORKSHOP</span>
          <h3>Laboratory level {level} / 4</h3>
          <p>
            Prepare your army for the next battle. Choose any mix of unlocked
            potions.
          </p>
          <strong className="potion-capacity" role="status">
            Storage {magic?.used ?? 0} / 5
          </strong>
          {!!magic?.brewing?.length && (
            <small>Includes {magic.brewing.length} brewing</small>
          )}
        </div>
      </div>
      <div className="laboratory-potions">
        {(magic?.options ?? []).map((potion) => {
          const detail = potionDetails[potion.id];
          const locked = level < potion.level;
          return (
            <article
              key={potion.id}
              className={`laboratory-potion ${locked ? "locked" : ""}`}
            >
              <img src={potionUrl(potion.id)} alt="" />
              <div className="laboratory-potion-copy">
                <div className="label-row">
                  <h3>{detail.name}</h3>
                  <strong>Owned {potion.count}</strong>
                </div>
                <p>{detail.description}</p>
                <small>{detail.duration}</small>
                <div className="laboratory-potion-action">
                  <span>
                    <Cost cost={potion.cost} />{" "}
                    <small>
                      {potion.seconds ? `${potion.seconds}s` : "Instant"}
                    </small>
                  </span>
                  <div className="laboratory-potion-buttons">
                    <button
                      className="button secondary potion-remove"
                      disabled={!potion.remove?.ok}
                      title={
                        potion.remove?.reason ||
                        "Remove one potion and receive 20 gold"
                      }
                      aria-label={`Remove one ${detail.name} potion for 20 gold`}
                      onClick={() =>
                        setRemoval({
                          type: potion.id,
                          sequence: magic.sequence,
                        })
                      }
                    >
                      Remove for +20 gold
                    </button>
                    <button
                      className="button primary"
                      disabled={!potion.brew.ok}
                      title={potion.brew.reason || `Brew ${detail.name}`}
                      onClick={() =>
                        dispatch("BREW_POTION", {
                          id: building.id,
                          potionType: potion.id,
                        })
                      }
                    >
                      {locked ? `Laboratory ${potion.level}` : "Brew potion"}
                    </button>
                  </div>
                </div>
                {removal?.type === potion.id && (
                  <div
                    className="potion-removal-confirmation"
                    role="group"
                    aria-label={`Remove ${detail.name} potion`}
                  >
                    <p>
                      Remove one {detail.name} potion and receive 20 gold? This
                      frees one storage space.
                    </p>
                    <div className="laboratory-potion-buttons">
                      <button
                        className="button secondary"
                        onClick={() => setRemoval(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button primary"
                        disabled={!potion.remove?.ok}
                        title={
                          potion.remove?.reason ||
                          "Confirm removal of one potion"
                        }
                        onClick={() => {
                          if (removing.current) return;
                          removing.current = true;
                          try {
                            const result = dispatch("REMOVE_POTION", {
                              id: building.id,
                              potionType: potion.id,
                              sequence: removal.sequence,
                            });
                            if (result.ok) setRemoval(null);
                          } finally {
                            removing.current = false;
                          }
                        }}
                      >
                        Confirm removal
                      </button>
                    </div>
                    {!potion.remove?.ok && (
                      <p className="requirements" role="status">
                        {potion.remove?.reason}
                      </p>
                    )}
                  </div>
                )}
                {!potion.remove?.ok &&
                  potion.count > 0 &&
                  removal?.type !== potion.id && (
                    <p className="requirements">{potion.remove?.reason}</p>
                  )}
                {!potion.brew.ok && (
                  <p className="requirements">{potion.brew.reason}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!!magic?.brewing?.length && (
        <section className="laboratory-queue" aria-label="Potion brewing queue">
          <h3>Brewing queue</h3>
          {magic.brewing.map((task, index) => (
            <div className="stat-line" key={`${task.type}-${index}`}>
              <span>{potionDetails[task.type].name}</span>
              <strong>
                {index === 0
                  ? `${Math.ceil(task.remainingMs / 1000)}s`
                  : "Queued"}
              </strong>
            </div>
          ))}
        </section>
      )}
      <p className="laboratory-note">
        Unused potions stay in storage between battles. Remove one ready potion
        to free a space and receive 20 gold. Potions are used from the five
        slots at the bottom of the battle arena.
      </p>
    </section>
  );
}
