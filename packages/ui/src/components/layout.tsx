import type { ReactNode } from "react";
import type { Tone } from "../models.js";
import { Card } from "./primitives.js";
import { hasText } from "../../../../src/meta/text.ts";

/** A callout for a statement that qualifies the panel beside it. */
export function Callout({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <div className={`ana-callout ana-callout--${tone}`}>{children}</div>;
}

export function Section({
  title,
  children,
  aside,
  className,
}: {
  title?: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  // A `ReactNode` prop is absent or explicitly `null` for the same reason, and both mean no aside.
  const hasAside = aside !== undefined && aside !== null;
  return (
    <section className={className === undefined ? "ana-section" : `ana-section ${className}`}>
      {hasText(title) || hasAside ? (
        <div className="ana-section-head">
          {hasText(title) ? <h2>{title}</h2> : null}
          {hasAside ? <div className="ana-section-aside">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="ana-metric-grid">{children}</div>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
}) {
  const hasDetail = detail !== undefined && detail !== null;
  return (
    <Card className={`ana-metric ana-metric--${tone}`}>
      <span aria-hidden className="ana-metric-tick" />
      <div className="ana-metric-label">{label}</div>
      <div className="ana-metric-value">{value}</div>
      {hasDetail ? <div className="ana-metric-detail">{detail}</div> : null}
    </Card>
  );
}
