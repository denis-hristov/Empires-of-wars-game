import { useEffect, useRef } from "react";
import { Icon } from "./Icons.jsx";

export function Dialog({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.querySelector("button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [title]);
  function keydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab") return;
    const elements = [
      ...ref.current.querySelectorAll(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex='0']",
      ),
    ].filter((element) => element.getClientRects().length);
    const first = elements[0],
      last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={keydown}
      >
        <div className="title-row modal-heading">
          <div>
            <span className="eyebrow">EMPIRES OF WARS</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close menu"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
