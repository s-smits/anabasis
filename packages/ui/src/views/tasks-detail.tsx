import { ExamSide } from "../components/exam-side.tsx";
import { Section } from "../components/layout.tsx";
import { Badge, Card, Disclosure, HashValue } from "../components/primitives.tsx";
import { RecordView } from "../components/record.tsx";
import type { CampaignReading, TaskDetail, TaskGrid } from "../models.ts";
import type { Navigation } from "../route.ts";
import { AnswerIssues, DetailHead, enter } from "./drill.tsx";
import { time } from "./format.ts";
import { SolveTable } from "./solve-rows.tsx";
import { countsOf, leftOutWords, outcomeOf } from "./tasks-grid.tsx";

/*
 * One task version: what each comparison came to on it, its text where the tier shows it, and its
 * solves across comparisons and practice. A held-out task's text, its family and its hidden values
 * are the exam side's (the brief of 11 October, section 8); a
 * practice task's text crossed to the Builder already and is shown in either tier.
 */

const STATE_TONES = {
  held: "info",
  released: "neutral",
  refused: "bad",
  disputed: "warn",
  ladder: "info",
} as const;

export function TaskDetailView({
  detail,
  grid,
  reading,
  navigation,
}: {
  detail: TaskDetail;
  /** The grid the task's row stands in, for what each comparison came to on it. */
  grid: TaskGrid;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const { row } = detail;
  const cells = grid.rows.find((each) => each.version === row.version)?.cells ?? [];
  const results = grid.columns.flatMap((column, at) => {
    const cell = cells[at];
    return cell === null || cell === undefined ? [] : [{ column, cell }];
  });
  const awaiting: ReadonlySet<string> = new Set(row.awaitingLabel ? [row.version] : []);
  const exam = detail.tier === "exam";
  return (
    <div className="ana-detail">
      <DetailHead
        navigation={navigation}
        back={{ task: null }}
        backLabel="Back to tasks"
        title={row.id ?? row.version.slice(0, 12)}
        kind="Task"
        badges={
          <>
            <Badge tone={STATE_TONES[row.state]}>{row.state}</Badge>
            {row.awaitingLabel ? <Badge tone="warn">waits for a label</Badge> : null}
            {row.exhausted ? <Badge tone="neutral">exhausted</Badge> : null}
          </>
        }
      >
        <span>
          version <HashValue value={row.version} length={12} />
        </span>
        <span>proposed {time(row.proposedAt)}</span>
      </DetailHead>
      <AnswerIssues answer={detail} />
      <Section title={`In ${String(results.length)} of ${String(grid.columns.length)} comparisons`}>
        {results.length === 0 ? (
          <p className="ana-faint">No comparison has scored this task.</p>
        ) : (
          <ul className="ana-task-results">
            {results.map(({ column, cell }) => {
              const shown =
                "leftOut" in cell
                  ? { label: leftOutWords(cell), color: null, counts: null }
                  : { ...outcomeOf(cell.outcome), counts: countsOf(cell) };
              return (
                <li key={column.id} title={shown.label}>
                  <button
                    type="button"
                    className="ana-row-select"
                    onClick={() =>
                      navigation.push({ pane: "moves", move: column.move, task: null, solve: null })
                    }
                  >
                    {column.id}
                  </button>
                  <span className="ana-outcome">
                    {shown.color === null ? null : (
                      <span className="ana-swatch" style={{ background: shown.color }} aria-hidden />
                    )}
                    {shown.label}
                  </span>
                  {shown.counts === null ? null : <small className="ana-num">{shown.counts}</small>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Task">
        {detail.input === undefined ? (
          <ExamSide what="a held-out task's text" />
        ) : (
          <Card>
            <RecordView key={row.version} value={detail.input} defaultExpanded />
          </Card>
        )}
        {exam ? (
          <Disclosure title="Family and hidden values">
            <dl className="ana-facts">
              <div>
                <dt>Family</dt>
                <dd>{detail.family ?? "not recorded"}</dd>
              </div>
            </dl>
            <RecordView value={detail.hidden ?? null} defaultExpanded />
          </Disclosure>
        ) : null}
      </Section>
      <Section title={`Solves (${String(detail.solves.length)})`}>
        {detail.solves.length === 0 ? (
          <p className="ana-faint">No solve of this task on record.</p>
        ) : (
          <SolveTable
            rows={detail.solves}
            reading={reading}
            tier={detail.tier}
            awaiting={awaiting}
            show={["comparison", "side", "harness", "ruling"]}
            onOpen={(id) => enter(navigation, { solve: id })}
          />
        )}
      </Section>
    </div>
  );
}
