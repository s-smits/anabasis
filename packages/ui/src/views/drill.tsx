import { ArrowLeft } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { IssueCallout } from "../components/layout.tsx";
import { Badge, Button, NoSignal } from "../components/primitives.tsx";
import type { Live } from "../live.ts";
import type { Answer, CampaignReading, Tone } from "../models.ts";
import type { Navigation, RouteChange } from "../route.ts";
import { digestText } from "./campaign-data.ts";
import type { Ending as SolveEnding } from "../../../../src/kernel/solve.ts";

// The drill-down the Moves and Tasks panes share: a list whose row opens its detail in place, the list
// hidden rather than pushed above it, and a way back that restores the list and the focus on its row.
// The selection is the URL's (`route.ts`), so the browser's back button is a way back too, and the
// page's Back goes back through the history where the page itself made the entry; a detail opened from
// a link has none, and its Back names the list as a new entry. A level waits for its answer with the
// one before it on screen (`late.ts`).

export interface Toned {
  readonly label: string;
  readonly tone: Tone;
}

/** The searches the page itself entered a detail at, and so may leave through the history. */
const entered = new Set<string>();

const SIDE_LABELS = {
  old: "reference",
  fresh: "new",
  practice: "practice",
  other: "reference again",
} as const;

export function enter(navigation: Navigation, change: RouteChange): void {
  navigation.push(change);
  entered.add(window.location.search);
}

function leave(navigation: Navigation, change: RouteChange): void {
  if (entered.delete(window.location.search)) {
    window.history.back();
    return;
  }
  navigation.push(change);
}

/**
 * Focus as the list and its detail take turns: the detail as it opens, the row it came from as the
 * list returns (rows carry `data-row`). `selected` is what is shown, so focus never lands on a
 * level still being read. No handler owns the turn: `marker`, keyed by it, moves focus from its ref
 * in the commit, before the frame is painted.
 */
export function useDrill(selected: string | null) {
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  // The detail opened last, kept as the render finds it: the row the list returns to.
  const [last, setLast] = useState<string | null>(selected);
  if (selected !== null && selected !== last) setLast(selected);
  const turn = useCallback(
    (marker: HTMLSpanElement | null) => {
      if (marker === null) return;
      if (selected !== null) {
        detail.current?.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      if (last === null) return;
      list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(last)}"]`)?.focus();
    },
    [selected, last],
  );
  const key = selected === null ? `list ${last ?? ""}` : `detail ${selected}`;
  // Wrapped, so that two drills of one pane never set two markers of one key side by side.
  return {
    list,
    detail,
    marker: (
      <span hidden>
        <span key={key} ref={turn} />
      </span>
    ),
  };
}

export function DetailHead({
  navigation,
  back,
  backLabel,
  title,
  kind,
  badges,
  children,
}: {
  navigation: Navigation;
  back: RouteChange;
  backLabel: string;
  title: string;
  kind: string;
  badges?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="ana-detail-head">
      <Button onClick={() => leave(navigation, back)} aria-label={backLabel} title={backLabel}>
        <ArrowLeft size={18} aria-hidden="true" />
      </Button>
      <div className="ana-detail-title">
        <h2>
          <span>{title}</span>
          <small>{kind}</small>
        </h2>
        {children === undefined ? null : <p>{children}</p>}
      </div>
      {badges === undefined ? null : <div className="ana-detail-badges">{badges}</div>}
    </header>
  );
}

export function AnswerIssues({ answer }: { answer: Answer }) {
  return answer.issues.map((issue) => (
    <IssueCallout key={`${issue.source}:${issue.message}`} issue={issue} />
  ));
}

export function Pending<Value>({ live, what }: { live: Live<Value>; what: string }) {
  if (live.error !== null) {
    return (
      <NoSignal title={`${what} could not be read`} tone="bad">
        {live.error}
      </NoSignal>
    );
  }
  return <NoSignal title={`Reading ${what}`}>The detail is loading</NoSignal>;
}

export function endingOf(ending: SolveEnding | null): Toned {
  if (ending === null) return { label: "open", tone: "info" };
  if (ending.outcome === "pass") return { label: "valid", tone: "good" };
  // A flag counts as the flagging side's fail (`submit`, `src/tools/answer.ts`).
  if (ending.outcome === "flagged") return { label: "flagged", tone: "bad" };
  return { label: ending.kind, tone: ending.outcome === "fail" ? "bad" : "warn" };
}

export function EndingBadge({ ending }: { ending: SolveEnding | null }) {
  const { label, tone } = endingOf(ending);
  return <Badge tone={tone}>{label}</Badge>;
}

export function sideLabel(side: keyof typeof SIDE_LABELS): string {
  return SIDE_LABELS[side];
}

export function harnessLabel(reading: Pick<CampaignReading, "names"> | null, digest: string | null): string {
  return digest === null ? "none" : digestText(digest, reading?.names ?? {});
}
