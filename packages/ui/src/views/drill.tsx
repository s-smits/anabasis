import { ArrowLeft } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Callout } from "../components/layout.tsx";
import { Badge, Button, NoSignal } from "../components/primitives.tsx";
import type { Live } from "../live.ts";
import type { Answer, CampaignReading, Tone } from "../models.ts";
import { shortHash } from "../models.ts";
import type { Navigation, RouteChange } from "../route.ts";
import type { Ending as SolveEnding } from "../../../../src/kernel/solve.ts";

/*
 * The drill-down the Moves and Tasks panes share (the brief of 11 October, section 7): a list whose
 * row opens its detail in place, the list hidden rather than pushed above it, and a way back that
 * restores the list and the focus on the row, as v1's task view did (`views/cases.tsx` at 5bc9988).
 *
 * v1 kept the selection in component state. Here it is the URL's (`route.ts`), so the browser's back
 * button is a way back too, and the page's own Back button goes back through the history where the
 * page itself made the entry, so that the two never disagree about where "back" is. A detail opened
 * from a link has no such entry, and its Back button names the list as a new one.
 */

/** A label and the tone it is drawn in. */
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

/** Open a detail: a new history entry the page may later leave by going back. */
export function enter(navigation: Navigation, change: RouteChange): void {
  navigation.push(change);
  entered.add(window.location.search);
}

/** Leave a detail for its list: back through the history where the page entered it, else a new
 *  entry that names the list. */
function leave(navigation: Navigation, change: RouteChange): void {
  if (entered.delete(window.location.search)) {
    window.history.back();
    return;
  }
  navigation.push(change);
}

/**
 * Focus as the list and its detail take turns: the detail when one opens, and the row it was
 * opened from when the list returns. Rows carry `data-row` with their key.
 */
export function useDrill(selected: string | null) {
  const list = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (selected !== null) {
      last.current = selected;
      detail.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const origin = last.current;
    if (origin === null) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(origin)}"]`);
    row?.focus();
  }, [selected]);
  return { list, detail };
}

/** The head of a detail: the way back, the title with what it is, its badges, and one line. */
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
  /** The route change that returns to the list. */
  back: RouteChange;
  backLabel: string;
  title: string;
  kind: string;
  badges?: ReactNode;
  /** The one qualifying line under the title. */
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

/** The issues an answer carries: shown, never swallowed. */
export function AnswerIssues({ answer }: { answer: Answer }) {
  return answer.issues.map((issue) => (
    <Callout key={`${issue.source}:${issue.message}`} tone={issue.level === "error" ? "bad" : "warn"}>
      {issue.source}: {issue.message}
    </Callout>
  ));
}

/** What stands in a detail's place while its answer is not the one asked for. */
export function Pending<Value>({ live, what }: { live: Live<Value>; what: string }) {
  if (live.error !== null) {
    return (
      <NoSignal title={`${what} could not be read`} tone="bad">
        {live.error}
      </NoSignal>
    );
  }
  return <NoSignal title={`Reading ${what}`}>The detail is loading.</NoSignal>;
}

/** How a solve ended, as a badge says it: a valid answer, a fail by its kind, or a non-result. */
export function endingOf(ending: SolveEnding | null): Toned {
  if (ending === null) return { label: "open", tone: "info" };
  if (ending.outcome === "pass") return { label: "valid", tone: "good" };
  // A flag counts as the flagging side's fail (`submit`, `src/solve/answer.ts`).
  if (ending.outcome === "flagged") return { label: "flagged", tone: "bad" };
  return { label: ending.kind, tone: ending.outcome === "fail" ? "bad" : "warn" };
}

export function EndingBadge({ ending }: { ending: SolveEnding | null }) {
  const { label, tone } = endingOf(ending);
  return <Badge tone={tone}>{label}</Badge>;
}

/** Where a solve stood, in the Terms' words. */
export function sideLabel(side: keyof typeof SIDE_LABELS): string {
  return SIDE_LABELS[side];
}

/** A harness as a reader knows it: the starter by name, any other by a short digest. */
export function harnessLabel(
  reading: Pick<CampaignReading, "starter"> | null,
  digest: string | null,
): string {
  if (digest === null) return "none";
  if (digest === reading?.starter) return "starter";
  return shortHash(digest, 8);
}
