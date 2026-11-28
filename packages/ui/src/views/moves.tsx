import { type ReactNode, useState } from "react";
import { plural, tallyText } from "../../../../src/meta/text.ts";
import { ExamSide } from "../components/exam-side.tsx";
import { Section } from "../components/layout.tsx";
import { Badge, Button, Card, Disclosure, HashValue } from "../components/primitives.tsx";
import { type Column, Table } from "../components/table.tsx";
import { Trace } from "../components/trace.tsx";
import { detailsOf, type Live, useMove, useSolve } from "../live.ts";
import {
  type CampaignReading,
  type ComparisonBar,
  type ComparisonDetail,
  type MoveDetail,
  type Outcome,
  type ScoredTask,
  type Sensitivity,
  type SessionDetail,
  shortHash,
  type SolveRow,
} from "../models.ts";
import { type Navigation, type PaneProps, useKept } from "../route.ts";
import { useWaited } from "../waited.ts";
import { carriedText, leftOutText, pText } from "./campaign-data.ts";
import { AnswerIssues, DetailHead, endingOf, enter, harnessLabel, Pending, useDrill } from "./drill.tsx";
import { duration, money, percent, time } from "./format.ts";
import { HarnessFiles } from "./inspector.tsx";
import { kindOf, MovesList, standingOf } from "./moves-list.tsx";
import { OUTCOMES } from "./outcome.ts";
import { RulingsCell, rulingLabel, SolveTable } from "./solve-rows.tsx";
import { SolveAnswerView } from "./solve.tsx";

type Level = 0 | 1 | 2;

const NO_AWAITING: ReadonlySet<string> = new Set();
const WIDE = "Table row";
const RULING_KINDS = ["solver-fail", "check-defect", "unclear"] as const;

function rulingsText({ rulings }: Pick<ComparisonBar, "rulings">): string {
  if (rulings.withheld) {
    return `${plural(rulings.ruled, "rejection")} ruled; the kinds stay hidden while any ruling is withheld`;
  }
  return RULING_KINDS.map((kind) => `${String(rulings.kinds[kind])} ${rulingLabel(kind)}`).join(" · ");
}

function SolveChips({ rows, onOpen }: { rows: readonly SolveRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) return <span className="ana-faint">no solve</span>;
  const labels = new Set(rows.map((row) => endingOf(row.ending).label));
  const alike = labels.size === 1 ? endingOf(rows[0]?.ending ?? null) : null;
  const billed = rows.some((row) => row.billed === null)
    ? null
    : rows.reduce((sum, row) => sum + (row.billed ?? 0), 0);
  return (
    <span className="ana-solve-chips">
      {alike === null ? null : (
        <span className={`ana-solve-count ana-solve-count--${alike.tone}`}>
          {`${String(rows.length)} ${alike.label}`}
        </span>
      )}
      {rows.map((row, at) => {
        const { label, tone } = endingOf(row.ending);
        return (
          <button
            key={row.id}
            type="button"
            className={`ana-solve-chip ana-solve-chip--${tone}`}
            data-row={row.id}
            aria-label={`${label}, solve ${row.id}`}
            title={`Open solve ${row.id}`}
            onClick={() => onOpen(row.id)}
          >
            {alike === null ? label : String(at + 1)}
          </button>
        );
      })}
      <span className="ana-faint ana-num">{money(billed)}</span>
    </span>
  );
}

function OutcomeSplit({
  detail,
  chosen,
  onChoose,
}: {
  detail: ComparisonDetail;
  chosen: Outcome | null;
  onChoose: (outcome: Outcome | null) => void;
}) {
  const { bar } = detail;
  if (bar.outcomes === null) {
    return (
      <p className="ana-faint">
        No report yet: {String(bar.solved)} of {plural(bar.begun, "solve")} ended.
      </p>
    );
  }
  const counts = bar.outcomes;
  const total = OUTCOMES.reduce((sum, { outcome }) => sum + counts[outcome], 0);
  const left = leftOutText(bar);
  return (
    <div className="ana-split">
      <div
        className="ana-split-bar"
        role="img"
        aria-label={OUTCOMES.map(({ outcome, label }) => `${label} ${String(counts[outcome])}`).join(", ")}
      >
        {OUTCOMES.flatMap(({ outcome, color }) =>
          counts[outcome] === 0
            ? []
            : [
                <span
                  key={outcome}
                  style={{ flexGrow: counts[outcome], background: color }}
                  className={chosen === null || chosen === outcome ? "" : "is-quiet"}
                >
                  {counts[outcome]}
                </span>,
              ],
        )}
      </div>
      <ul className="ana-split-legend">
        {OUTCOMES.map(({ outcome, label, color }) => (
          <li key={outcome}>
            <button
              type="button"
              aria-pressed={chosen === outcome}
              disabled={counts[outcome] === 0}
              onClick={() => onChoose(chosen === outcome ? null : outcome)}
            >
              <span className="ana-swatch" style={{ background: color }} aria-hidden />
              <span>{label}</span>
              <strong className="ana-num">{counts[outcome]}</strong>
            </button>
          </li>
        ))}
      </ul>
      <p className="ana-faint">
        {plural(total, "task")} scored of {String(bar.tasks)} the comparison fixed
        {left === "" ? "" : `; ${left}`}.
      </p>
    </div>
  );
}

function Readings({ detail, reading }: { detail: ComparisonDetail; reading: CampaignReading }) {
  const { bar } = detail;
  const facts = [
    ["Tally", bar.tally === null ? "none" : tallyText(bar.tally)],
    ["Sign test", bar.p === null ? "not made" : `${pText(bar.p)} at level ${String(bar.level)}`],
    ...(bar.carried === null
      ? []
      : ([
          ["Won on", carriedText(bar.carried.won)],
          ["Lost on", carriedText(bar.carried.lost)],
        ] as const)),
    [
      "Valid, reference",
      bar.valid === null
        ? "no report"
        : `${String(bar.valid.old.valid)} of ${plural(bar.valid.old.solves, "solve")}`,
    ],
    [
      "Valid, new",
      bar.valid === null
        ? "no report"
        : `${String(bar.valid.fresh.valid)} of ${plural(bar.valid.fresh.solves, "solve")}`,
    ],
    ...(bar.sets === null
      ? []
      : ([
          ["Active eval tasks", `${tallyText(bar.sets.frontier.tally)} · ${pText(bar.sets.frontier.p)}`],
          [
            "Older regression tasks",
            bar.sets.retained === "unmeasured"
              ? "unmeasured (no older regression tasks were scored)"
              : tallyText(bar.sets.retained),
          ],
        ] as const)),
    ["Rulings", rulingsText(bar)],
    ...(bar.noise === null
      ? []
      : ([["Reference A/A control", `${tallyText(bar.noise.tally)} · ${pText(bar.noise.p)}`]] as const)),
  ] as const;
  const { terms } = detail;
  const termFacts = [
    ["Rollouts per arm", String(terms.solves)],
    ["Dollar cap", money(terms.cap)],
    ["Model turns", terms.modelTurns === null ? "unlimited" : String(terms.modelTurns)],
    ["Objective", terms.objective === null ? "none" : `${terms.objective.direction} is better`],
    ["Starter Pack", harnessLabel(reading, terms.starter)],
    ["Host load", bar.load === null ? "not recorded" : bar.load.toFixed(1)],
    ["Scheduler trigger", bar.named === null ? "not recorded" : `${bar.named.code} · ${bar.named.why}`],
    ["Prediction", terms.prediction ?? "none"],
  ] as const;
  return (
    <>
      <dl className="ana-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <Disclosure title="Pre-registered comparison terms">
        <dl className="ana-facts">
          {termFacts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </>
  );
}

function sensitivityFacts(seen: Sensitivity): (readonly [string, string])[] {
  const { frontier, informative, overlap, billed, noise, families } = seen;
  return [
    ...(frontier === null
      ? []
      : ([
          ["Untied in the test", plural(frontier.untied, "task")],
          [
            "80% power detectable win rate",
            frontier.detectable === null
              ? "none: too few untied tasks"
              : `the new harness wins ${percent(frontier.detectable)} of them`,
          ],
          ["False-promotion rate per attempt", percent(frontier.falseRate)],
        ] as const)),
    ...(families === null || frontier === null || frontier.untied === 0
      ? []
      : ([
          [
            "Families",
            `the largest of ${String(families.count)} ${families.count === 1 ? "family" : "families"} holds ${String(families.largest)} of them`,
          ],
        ] as const)),
    ...(informative === null
      ? []
      : ([
          [
            "Informative tasks",
            `${String(informative.old)} for the reference, ${String(informative.fresh)} for the new`,
          ],
        ] as const)),
    ["Tied with no valid answer", plural(seen.unsolved, "task")],
    ["Flagged as malformed", plural(seen.flagged, "task")],
    ...(seen.points === null
      ? []
      : ([
          [
            "Points to the new",
            `validity ${String(seen.points.validity)}, objective ${String(seen.points.objective)}`,
          ],
        ] as const)),
    ...(overlap === null
      ? []
      : ([[`Shared with ${overlap.with}`, `${plural(overlap.tasks, "task")} both scored`]] as const)),
    ...(billed === null
      ? []
      : ([["Billed a solve", `${money(billed.old)} reference, ${money(billed.fresh)} new`]] as const)),
    ...(noise === null
      ? []
      : ([
          ["Reference flips between its solves", percent(noise.flips)],
          [
            "A/A step detected four times in five",
            noise.detectable === null
              ? "none: too few untied tasks"
              : `one half wins ${percent(noise.detectable)}`,
          ],
        ] as const)),
  ];
}

function scoredColumns(detail: ComparisonDetail, navigation: Navigation): readonly Column<ScoredTask>[] {
  const openSolve = (id: string) => enter(navigation, { solve: id });
  const outcomeOf = (task: ScoredTask) => OUTCOMES.find((each) => each.outcome === task.outcome);
  const solves = (task: ScoredTask) => [...task.old, ...task.fresh];
  return [
    {
      id: "task",
      head: "Task",
      sort: (task) => task.taskId ?? task.task,
      cell: (task) => (
        <button
          type="button"
          className="ana-row-select"
          title="Open the task"
          onClick={() => navigation.push({ pane: "tasks", task: task.task, solve: null })}
        >
          {task.taskId ?? shortHash(task.task, 8)}
        </button>
      ),
    },
    {
      id: "outcome",
      head: "Outcome",
      sort: (task) => outcomeOf(task)?.label ?? null,
      choice: (task) => outcomeOf(task)?.label ?? "no report yet",
      cell: (task) => {
        const outcome = outcomeOf(task);
        return outcome === undefined ? (
          <span className="ana-faint">no report yet</span>
        ) : (
          <span className="ana-outcome">
            <span className="ana-swatch" style={{ background: outcome.color }} aria-hidden />
            {outcome.label}
          </span>
        );
      },
    },
    {
      id: "carried",
      head: "Carried by",
      sort: (task) => task.carried,
      choice: (task) => task.carried ?? "none",
      chooser: "Measure",
      cell: (task) => task.carried ?? <span className="ana-faint">none</span>,
    },
    {
      id: "old",
      head: "Reference solves",
      sort: (task) => task.old.filter(({ ending }) => ending?.outcome === "pass").length,
      cell: (task) => <SolveChips rows={task.old} onOpen={openSolve} />,
    },
    {
      id: "fresh",
      head: "New solves",
      sort: (task) => task.fresh.filter(({ ending }) => ending?.outcome === "pass").length,
      cell: (task) => <SolveChips rows={task.fresh} onOpen={openSolve} />,
    },
    {
      id: "rulings",
      head: "Rulings",
      className: "ana-rulings-cell",
      cell: (task) => <RulingsCell rows={solves(task)} tier={detail.tier} withheld={task.withheld} />,
    },
  ];
}

function ComparisonDetailView({
  detail,
  reading,
  navigation,
}: {
  detail: ComparisonDetail;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const [chosen, setChosen] = useKept<Outcome | null>("comparison.outcome", null);
  const { move, terms } = detail;
  const standing = standingOf(move);
  const tasks = detail.tasks.filter((task) => chosen === null || task.outcome === chosen);
  const named = detail.bar.outcomes === null ? "Tasks fixed" : "Scored tasks";
  return (
    <div className="ana-detail">
      <DetailHead
        navigation={navigation}
        back={{ move: null }}
        backLabel="Back to moves"
        title={move.id}
        kind={kindOf(move, reading)}
        badges={<Badge tone={standing.tone}>{standing.label}</Badge>}
      >
        {harnessLabel(reading, terms.fresh)} against the reference {harnessLabel(reading, terms.old)}
        {terms.setting === null ? null : (
          <>
            {" · setting "}
            <HashValue value={terms.setting} length={8} />
          </>
        )}{" "}
        · started {time(move.startedAt)} · ran {duration(move.startedAt, move.endedAt)} · {money(move.billed)}
      </DetailHead>
      <AnswerIssues answer={detail} />
      <div className="ana-detail-pair">
        <Card className="ana-detail-card">
          <h3>Outcome split</h3>
          <OutcomeSplit detail={detail} chosen={chosen} onChoose={setChosen} />
        </Card>
        <Card className="ana-detail-card">
          <h3>Reading</h3>
          <Readings detail={detail} reading={reading} />
        </Card>
      </div>
      {detail.sensitivity === null ? null : (
        <Card className="ana-detail-card">
          <h3>What the test could see</h3>
          <dl className="ana-facts">
            {sensitivityFacts(detail.sensitivity).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <Section
        title={`${named} (${String(tasks.length)}${chosen === null ? "" : ` of ${String(detail.tasks.length)}`})`}
        aside={chosen === null ? null : <Button onClick={() => setChosen(null)}>Show every task</Button>}
      >
        <div className="ana-dense">
          <Table
            label="tasks"
            rows={tasks}
            columns={scoredColumns(detail, navigation)}
            rowKey={(task) => task.task}
            search={(task) => `${task.taskId ?? ""} ${task.task}`}
            placeholder="Search tasks by id or version"
          />
        </div>
      </Section>
    </div>
  );
}

function factsOf(detail: SessionDetail, reading: CampaignReading): (readonly [string, ReactNode])[] {
  const { move } = detail;
  const common = [
    ["Turns", String(move.turns)],
    ["Last wrote", time(move.last)],
    [WIDE, move.named === null ? "not recorded" : `${move.named.code} · ${move.named.why}`],
  ] as const;
  if (move.step === "examiner") {
    return [
      ["Proposed", String(move.proposed)],
      ["Held out", String(move.held)],
      ["Refused", String(move.refused)],
      ...common,
    ];
  }
  const harness = (digest: string | null) =>
    digest !== null && digest in reading.names ? (
      harnessLabel(reading, digest)
    ) : (
      <HashValue value={digest} length={8} />
    );
  const left = move.changed ? harness(move.harness) : "the harness as it was";
  return [
    ["Parent", harness(move.parent)],
    ["Left", move.ended === null ? "nothing yet" : left],
    ["Practice solves", String(move.practiceSolves)],
    ["Failed", String(move.fails)],
    ...common,
  ];
}

function SessionDetailView({
  detail,
  reading,
  navigation,
}: {
  detail: SessionDetail;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const { move } = detail;
  const standing = standingOf(move);
  const kind = move.step === "builder" ? "Builder session" : "Examiner session";
  const left = move.step === "builder" && move.changed ? move.harness : null;
  const parent = move.step === "builder" ? move.parent : null;
  return (
    <div className="ana-detail">
      <DetailHead
        navigation={navigation}
        back={{ move: null }}
        backLabel="Back to moves"
        title={move.id}
        kind={kind}
        badges={<Badge tone={standing.tone}>{standing.label}</Badge>}
      >
        started {time(move.startedAt)} · ran {duration(move.startedAt, move.endedAt)} · {money(move.billed)}
      </DetailHead>
      <AnswerIssues answer={detail} />
      <dl className="ana-facts ana-facts--row">
        {factsOf(detail, reading).map(([label, value]) => (
          <div key={label} className={label === WIDE ? "is-wide" : undefined}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {left === null ? null : (
        <Section
          title="The harness it left"
          aside={
            parent === null ? null : (
              <Button
                onClick={() => navigation.push({ harness: left, diff: parent, file: null, event: null })}
              >
                Compare with {harnessLabel(reading, parent)}
              </Button>
            )
          }
        >
          <Card>
            <HarnessFiles
              of={detailsOf(reading)}
              digest={left}
              current={navigation.route.file}
              navigation={navigation}
            />
          </Card>
        </Section>
      )}
      {move.step === "builder" ? (
        <Section title={`Practice solves (${String(detail.solves.length)})`}>
          {detail.solves.length === 0 ? (
            <p className="ana-faint">No practice solves recorded</p>
          ) : (
            <SolveTable
              rows={detail.solves}
              reading={reading}
              tier={detail.tier}
              awaiting={NO_AWAITING}
              show={["task"]}
              onOpen={(id) => enter(navigation, { solve: id })}
            />
          )}
        </Section>
      ) : null}
      <Section
        title={
          detail.turns === undefined
            ? "Turns and calls"
            : `Turns and calls · ${String(detail.turns.length)} turns`
        }
      >
        {detail.turns === undefined ? (
          <ExamSide what="an Examiner session's turns and calls" />
        ) : (
          <Trace turns={detail.turns} calls={detail.calls ?? []} />
        )}
      </Section>
    </div>
  );
}

function levelOf(move: number | null, solve: string | null): Level {
  if (solve !== null) return 2;
  return move === null ? 0 : 1;
}

function MoveView({
  live,
  late,
  reading,
  navigation,
}: {
  live: Live<MoveDetail>;
  late: boolean;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  if (live.data === null || (!live.current && late)) {
    const named = reading.moves.find((move) => move.index === navigation.route.move)?.id ?? "";
    return <Pending live={live} what={`move ${named}`} />;
  }
  if (live.data.kind === "session") {
    return <SessionDetailView detail={live.data} reading={reading} navigation={navigation} />;
  }
  return <ComparisonDetailView detail={live.data} reading={reading} navigation={navigation} />;
}

export function MovesPane({ reading, navigation }: PaneProps) {
  const { move, solve } = navigation.route;
  const of = detailsOf(reading);
  const moveLive = useMove(of, move);
  const solveLive = useSolve(of, solve);
  const asked = levelOf(move, solve);
  const arrived = asked === 0 || (asked === 1 ? moveLive.current : solveLive.current);
  const late = useWaited(arrived ? null : `${String(move)} ${solve ?? ""}`);
  const [before, setBefore] = useState<Level | null>(null);
  const kept = before === null || before >= asked ? asked : before;
  const shown = arrived || late || (kept === 1 && move === null) ? asked : kept;
  if (shown !== before) setBefore(shown);
  const solveKey = solve === null ? null : `solve:${solve}`;
  const outer = useDrill(shown === 0 ? null : move === null ? solveKey : String(move));
  const inner = useDrill(shown === 2 ? solve : null);
  const named = reading.moves.find((each) => each.index === move)?.id ?? "the move";
  const busy = arrived ? undefined : true;
  return (
    <Section title="Moves">
      <div ref={outer.list} hidden={shown !== 0} aria-busy={busy}>
        <MovesList reading={reading} onOpen={(index) => enter(navigation, { move: index })} />
      </div>
      {move === null ? null : (
        <div
          ref={outer.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label={`Move ${named}`}
          aria-busy={busy}
          hidden={shown !== 1}
        >
          <div ref={inner.list}>
            <MoveView live={moveLive} late={late} reading={reading} navigation={navigation} />
          </div>
        </div>
      )}
      {solve === null ? null : (
        <div
          ref={inner.detail}
          className="ana-drill"
          tabIndex={-1}
          aria-label={`Solve ${solve}`}
          aria-busy={busy}
          hidden={shown !== 2}
        >
          <SolveAnswerView
            live={solveLive}
            late={late}
            reading={reading}
            navigation={navigation}
            back={{ solve: null }}
            backLabel={move === null ? "Back to moves" : `Back to ${named}`}
          />
        </div>
      )}
      {outer.marker}
      {inner.marker}
    </Section>
  );
}
