import { Info, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Issue, Tone } from "../models.ts";
import { Card } from "./primitives.tsx";
import { hasText } from "../../../../src/meta/text.ts";

/** One issue: its message first, and the log or path it came from behind an (i), since that matters
 *  to whoever repairs a log and not to whoever reads the page (operator, 30 October). */
export function IssueCallout({ issue, onDismiss }: { issue: Issue; onDismiss?: () => void }) {
  const [where, setWhere] = useState(false);
  return (
    <Callout tone={issue.level === "error" ? "bad" : "warn"}>
      <span>
        {issue.message.charAt(0).toUpperCase() + issue.message.slice(1)}
        {where ? <small className="ana-callout-source">{issue.source}</small> : null}
      </span>
      <span className="ana-callout-tools">
        <button
          type="button"
          className="ana-callout-tool"
          aria-label="Where this comes from"
          aria-expanded={where}
          title={issue.source}
          onClick={() => setWhere(!where)}
        >
          <Info aria-hidden="true" />
        </button>
        {onDismiss === undefined ? null : (
          <button type="button" className="ana-callout-tool" aria-label="Dismiss" onClick={onDismiss}>
            <X aria-hidden="true" />
          </button>
        )}
      </span>
    </Callout>
  );
}

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
