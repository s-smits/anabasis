import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { useRef, useState } from "react";
import type { Tone } from "../models.ts";
import { shortHash } from "../models.ts";
import { hasText } from "../../../../src/meta/text.ts";

/** How long a copied hash says so before it shows the hash again. */
const COPIED_MS = 1_400;

export function Badge({
  tone = "neutral",
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={`ana-badge ana-badge--${tone} ${className}`} {...props}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ana-card ${className}`}>{children}</div>;
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`ana-button ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="ana-code">{children}</code>;
}

/** Copy the full hash on click, or reveal it when clipboard access fails. */
export function HashValue({
  value,
  length = 20,
  absent = "not recorded",
}: {
  value: string | null | undefined;
  length?: number;
  absent?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "revealed">("idle");
  // The copy that says "copied" sets the time it says so for; a second copy within it restarts it.
  const shown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copied = () => {
    clearTimeout(shown.current);
    setState("copied");
    shown.current = setTimeout(() => setState("idle"), COPIED_MS);
  };
  if (!hasText(value)) return <code className="ana-code">{absent}</code>;
  const short = shortHash(value, length);
  if (short === value) return <code className="ana-code">{value}</code>;
  return (
    <button
      type="button"
      className={`ana-code ana-hash is-${state}`}
      title={value}
      aria-label={state === "revealed" ? `Copy ${value}` : `Copy full hash ${value}`}
      onClick={() => {
        // A page served over plain HTTP, and every browser older than the API, has no clipboard.
        // The DOM types promise one, so the fact belongs in the annotation.
        const clipboard: Clipboard | undefined = navigator.clipboard;
        if (clipboard === undefined) {
          setState((current) => (current === "revealed" ? "idle" : "revealed"));
          return;
        }
        void clipboard
          .writeText(value)
          .then(copied, () => setState((current) => (current === "revealed" ? "idle" : "revealed")));
      }}
    >
      {state === "copied" ? "copied" : state === "revealed" ? value : short}
    </button>
  );
}

/** State what is missing and explain why, where known. */
export function NoSignal({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`ana-nosignal ana-nosignal--${tone}`}>
      <span aria-hidden className="ana-nosignal-rule" />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="ana-disclosure" {...(defaultOpen ? { open: true } : {})}>
      <summary>
        <span className="ana-caret" aria-hidden>
          ›
        </span>
        {title}
      </summary>
      <div className="ana-disclosure-body">{children}</div>
    </details>
  );
}
