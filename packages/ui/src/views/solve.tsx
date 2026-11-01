import { ExamSide, RulingWithheld } from "../components/exam-side.tsx";
import { Section } from "../components/layout.tsx";
import { Badge, Card, Code } from "../components/primitives.tsx";
import { RecordView } from "../components/record.tsx";
import { Trace } from "../components/trace.tsx";
import { detailsOf, type Live, useSolve } from "../live.ts";
import type { CampaignReading, SolveDetail } from "../models.ts";
import { shortHash } from "../models.ts";
import type { Navigation, RouteChange } from "../route.ts";
import { AnswerIssues, DetailHead, EndingBadge, harnessLabel, Pending, sideLabel } from "./drill.tsx";
import { money, seconds } from "./format.ts";
import { isRejection, RulingBadge } from "./solve-rows.tsx";

/*
 * One solve: what it was (its task, its side, its harness), how it ended, and its trace, the last
 * step of the drill-down from a campaign. The Moves pane opens it from a session's practice solves
 * and a comparison's scored tasks, the Tasks pane from a task's solves.
 *
 * What the default tier withholds (the brief of 11 October, section 8): a held-out task's trace,
 * the verdict and the ruling. Each place says where it is instead. A ruling also stays hidden on the
 * exam side while its rejection waits for a person's label or its comparison has not reported,
 * which `SolveDetail` says, so that the two absences read apart.
 */

/** Where the detail returns to, and what its way back is called. */
interface Back {
  readonly back: RouteChange;
  readonly backLabel: string;
}

const BY = {
  referee: "the Referee",
  host: "the host, on a verdict that did not repeat",
  label: "a person's label",
} as const;

/** The verdict, as the tier lets it be shown. */
function Verdict({ detail }: { detail: SolveDetail }) {
  if (detail.verdict === undefined) {
    return <ExamSide what="the verdict, with the answer and the checks that refused it" />;
  }
  if (detail.verdict === null) return <p className="ana-faint">No verdict on record</p>;
  const { kind, refusedBy, fault, answer } = detail.verdict;
  return (
    <div className="ana-stack">
      <dl className="ana-facts">
        <div>
          <dt>Verdict</dt>
          <dd>{kind}</dd>
        </div>
        <div>
          <dt>Refused by</dt>
          <dd>
            {refusedBy.length === 0 ? "no check" : refusedBy.map((check) => <Code key={check}>{check}</Code>)}
          </dd>
        </div>
        {fault === null ? null : (
          <div>
            <dt>Fault</dt>
            <dd>{fault}</dd>
          </div>
        )}
        <div>
          <dt>Answer</dt>
          <dd>
            <RecordView value={answer} defaultExpanded />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** The ruling, as the tier and a label still to come let it be shown. */
function RulingPart({ detail }: { detail: SolveDetail }) {
  if (detail.ruling === undefined) {
    if (detail.withheld !== null) return <RulingWithheld why={detail.withheld} />;
    return <ExamSide what="the Referee's ruling and its reason" />;
  }
  if (detail.ruling === null) return <p className="ana-faint">No ruling on record</p>;
  return (
    <div className="ana-stack">
      <p className="ana-ruling-line">
        <RulingBadge ruling={detail.ruling.ruling} />
        <span>by {BY[detail.ruling.by]}</span>
      </p>
      <p className="ana-prose">{detail.ruling.reason}</p>
    </div>
  );
}

/** A solve's detail, from its answer. */
function SolveDetailView({
  detail,
  reading,
  navigation,
  back,
  backLabel,
}: Back & {
  detail: SolveDetail;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const { solve } = detail;
  // Titled by its task and side: a recorded solve's id opens with the campaign's name (the first
  // of buffer-178-opus-zbook runs to 34 characters), so it stands in the line below instead.
  const task = solve.taskId ?? shortHash(solve.task, 8);
  // The Referee rules a rejection inside a comparison only, so a practice solve has no ruling to
  // place, on either side: until 14 October its rejection said the exam side held one.
  const ruled =
    (detail.heldOut && isRejection(solve)) || (detail.ruling !== undefined && detail.ruling !== null);
  const facts = [
    ["Turns", solve.turns === null ? "open" : String(solve.turns)],
    ["Calls", String(solve.calls)],
    ["Time", seconds(solve.seconds)],
    ["Cost", money(solve.billed)],
    ["Solver", `${detail.model ?? "not recorded"}${detail.effort === null ? "" : ` at ${detail.effort}`}`],
    ["Host load", detail.load === null ? "not recorded" : detail.load.toFixed(1)],
  ] as const;
  return (
    <div className="ana-detail">
      <DetailHead
        navigation={navigation}
        back={back}
        backLabel={backLabel}
        title={`${task} · ${sideLabel(solve.side)}`}
        kind="Solve"
        badges={
          <>
            <Badge tone="neutral">{detail.heldOut ? "held-out task" : "practice task"}</Badge>
            <EndingBadge ending={solve.ending} />
          </>
        }
      >
        <button
          type="button"
          className="ana-evidence-link"
          onClick={() => navigation.push({ pane: "tasks", task: solve.task, solve: null })}
        >
          {task}
        </button>
        <span>
          harness {harnessLabel(reading, solve.harness)}
          {solve.comparison === null ? "" : ` · comparison ${solve.comparison}`} ·{" "}
          <span className="ana-num">{solve.id}</span>
        </span>
      </DetailHead>
      <AnswerIssues answer={detail} />
      <dl className="ana-facts ana-facts--row">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={ruled ? "ana-detail-pair" : "ana-stack"}>
        <Card className="ana-detail-card">
          <h3>Verdict</h3>
          <Verdict detail={detail} />
        </Card>
        {ruled ? (
          <Card className="ana-detail-card">
            <h3>Ruling</h3>
            <RulingPart detail={detail} />
          </Card>
        ) : null}
      </div>
      <Section
        title={`Trace${detail.trace === undefined ? "" : ` · ${String(detail.trace.turns.length)} turns`}`}
      >
        {detail.trace === undefined ? (
          <ExamSide what="the trace of a held-out task's solve" />
        ) : (
          <Trace turns={detail.trace.turns} calls={detail.trace.calls} />
        )}
      </Section>
    </div>
  );
}

/** A solve's answer as it stands: the detail it answers, the previous solve's while the next is
 *  read and not yet `late`, and what stands in its place before any or once it is late. */
export function SolveAnswerView({
  live,
  late,
  reading,
  navigation,
  back,
  backLabel,
}: Back & { live: Live<SolveDetail>; late: boolean; reading: CampaignReading; navigation: Navigation }) {
  if (live.data === null || (!live.current && late)) {
    return <Pending live={live} what={`solve ${navigation.route.solve ?? ""}`} />;
  }
  return (
    <SolveDetailView
      detail={live.data}
      reading={reading}
      navigation={navigation}
      back={back}
      backLabel={backLabel}
    />
  );
}

/** The solve the route names, read and shown. */
export function SolveView({
  reading,
  navigation,
  back,
  backLabel,
}: Back & { reading: CampaignReading; navigation: Navigation }) {
  const live = useSolve(detailsOf(reading), navigation.route.solve);
  return (
    <SolveAnswerView
      live={live}
      late
      reading={reading}
      navigation={navigation}
      back={back}
      backLabel={backLabel}
    />
  );
}
