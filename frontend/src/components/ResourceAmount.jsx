import { useEffect, useRef, useState } from "react";

const gainDuration = 900;
const format = (value) => value.toLocaleString("en-US");

export function ResourceAmount({ name, value }) {
  const [amount, setAmount] = useState(value);
  const [gaining, setGaining] = useState(false);
  const previous = useRef(value);
  const displayed = useRef(value);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (value === before) return;

    if (value < before) {
      displayed.current = value;
      setAmount(value);
      setGaining(false);
      return;
    }

    setGaining(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayed.current = value;
      setAmount(value);
      const timeout = window.setTimeout(() => setGaining(false), gainDuration);
      return () => window.clearTimeout(timeout);
    }

    const from = displayed.current;
    const started = performance.now();
    let frame;
    const update = (now) => {
      const progress = Math.min(1, Math.max(0, (now - started) / gainDuration));
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      displayed.current = next;
      setAmount(next);
      if (progress < 1) frame = requestAnimationFrame(update);
      else setGaining(false);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <strong
      className={`resource-amount${gaining ? " resource-gaining" : ""}`}
      data-testid={`resource-${name}`}
      aria-label={`${format(value)} ${name === "coins" ? "gold" : name}`}
    >
      <span aria-hidden="true">{format(amount)}</span>
    </strong>
  );
}
