import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons.jsx";
import "../styles/shop.css";

const resources = ["food", "wood", "stone", "iron"];
const names = {
  food: "Food",
  wood: "Wood",
  stone: "Stone",
  iron: "Metal",
  coins: "Gold",
};
const amount = (value) => Number(value ?? 0).toLocaleString("en-US");

export function ShopPanel({
  state,
  dispatch,
  getOffers,
  initialDirection = "buy",
  initialQuantity = 1,
}) {
  const [direction, setDirection] = useState(initialDirection);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [feedback, setFeedback] = useState(null);
  const trading = useRef(false);
  const [quotes, setQuotes] = useState(null);
  useEffect(() => {
    if (!getOffers) return;
    const result = getOffers();
    if (result?.ok) setQuotes(result.shop);
  }, [getOffers, state.revision]);
  const shop = quotes ?? state.shop;
  const offers =
    shop?.offers?.filter((offer) => offer.direction === direction) ?? [];

  function trade(offer, choice) {
    if (trading.current || !choice?.ok) return;
    trading.current = true;
    try {
      const result = dispatch("SHOP_TRADE", {
        offerId: offer.id,
        quantity,
        sequence: state.shop.sequence,
      });
      setFeedback({ ok: result.ok, message: result.message });
      const refreshed = getOffers?.();
      if (refreshed?.ok) setQuotes(refreshed.shop);
    } finally {
      trading.current = false;
    }
  }

  return (
    <section className="shop-panel" aria-label="Resource shop">
      <div className="shop-intro">
        <div className="shop-intro-copy">
          <span className="shop-crest">
            <Icon name="shop" size={30} />
          </span>
          <div>
            <span className="eyebrow">ISLAND MARKET</span>
            <p>
              Stock up for your next move, or turn surplus supplies into gold.
            </p>
          </div>
        </div>
        <div
          className="shop-gold"
          aria-label={`Gold balance ${state.stock[4]}`}
        >
          <Icon name="coins" size={25} />
          <span>
            <small>Your gold</small>
            <strong>{amount(state.stock[4])}</strong>
          </span>
        </div>
      </div>

      <div className="shop-stockpile" aria-label="Your resources">
        {resources.map((resource, index) => (
          <div className={`shop-stock ${resource}`} key={resource}>
            <Icon name={resource} size={22} />
            <span>
              <small>{names[resource]}</small>
              <strong>{amount(state.stock[index])}</strong>
            </span>
          </div>
        ))}
      </div>

      <div className="shop-toolbar">
        <div className="shop-tabs" role="tablist" aria-label="Trade direction">
          {[
            ["buy", "Buy resources"],
            ["sell", "Sell resources"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              id={`shop-${value}-tab`}
              aria-selected={direction === value}
              aria-controls="shop-offers"
              tabIndex={direction === value ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "buy"
                    : event.key === "End"
                      ? "sell"
                      : direction === "buy"
                        ? "sell"
                        : "buy";
                setDirection(next);
                setFeedback(null);
                event.currentTarget.parentElement
                  .querySelector(`#shop-${next}-tab`)
                  ?.focus();
              }}
              onClick={() => {
                setDirection(value);
                setFeedback(null);
              }}
            >
              <Icon name={value === "buy" ? "collect" : "coins"} size={17} />
              {label}
            </button>
          ))}
        </div>
        <div
          className="shop-quantity"
          role="group"
          aria-label="Number of offers"
        >
          <span>Offers</span>
          {(shop?.quantities ?? [1, 5, 10]).map((value) => (
            <button
              key={value}
              aria-label={`${value} ${value === 1 ? "offer" : "offers"}`}
              aria-pressed={quantity === value}
              onClick={() => {
                setQuantity(value);
                setFeedback(null);
              }}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>

      <div
        className="shop-offers"
        id="shop-offers"
        role="tabpanel"
        aria-labelledby={`shop-${direction}-tab`}
      >
        {offers.map((offer) => {
          const choice = offer.choices.find(
            (entry) => entry.quantity === quantity,
          );
          if (!choice) return null;
          const resourceTotal =
            direction === "buy" ? choice.receive.amount : choice.pay.amount;
          return (
            <article className={`shop-offer ${offer.resource}`} key={offer.id}>
              <header>
                <span className="shop-resource-icon">
                  <Icon name={offer.resource} size={27} />
                </span>
                <div>
                  <h3>{names[offer.resource]}</h3>
                  <small>
                    {quantity} {quantity === 1 ? "offer" : "offers"} · Instant
                    exchange
                  </small>
                </div>
              </header>
              <div className="shop-exchange">
                <div>
                  <small>You give</small>
                  <strong>
                    <Icon name={choice.pay.resource} size={18} />
                    {amount(choice.pay.amount)}
                  </strong>
                  <span>{names[choice.pay.resource]}</span>
                </div>
                <Icon name="arrow" size={22} />
                <div>
                  <small>You receive</small>
                  <strong>
                    <Icon name={choice.receive.resource} size={18} />
                    {amount(choice.receive.amount)}
                  </strong>
                  <span>{names[choice.receive.resource]}</span>
                </div>
              </div>
              <button
                className={`button full ${direction === "buy" ? "primary" : "secondary"}`}
                disabled={!choice.ok}
                title={choice.reason || "Complete this exchange"}
                onClick={() => trade(offer, choice)}
              >
                {direction === "buy" ? "Buy" : "Sell"} {amount(resourceTotal)}{" "}
                {names[offer.resource]}
              </button>
              <p
                className={`shop-offer-note ${choice.ok ? "ready" : "unavailable"}`}
              >
                {choice.ok
                  ? `Receive ${amount(choice.receive.amount)} ${names[choice.receive.resource]} immediately`
                  : choice.reason}
              </p>
            </article>
          );
        })}
        {!offers.length && (
          <p className="hint-box">
            {getOffers && !quotes
              ? "Preparing offers…"
              : "The shop is currently unavailable."}
          </p>
        )}
      </div>

      <div
        className={`shop-feedback ${feedback ? (feedback.ok ? "success" : "error") : ""}`}
        role="status"
        aria-live="polite"
      >
        <Icon name={feedback?.ok ? "check" : "info"} size={17} />
        <span>
          {feedback?.message ?? "Completed trades are saved automatically."}
        </span>
      </div>
    </section>
  );
}
