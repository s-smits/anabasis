import { useState } from "react";
import { Section } from "../components/layout.tsx";
import { TriggerList } from "../components/triggers.tsx";
import { Badge, Button, Card, DataTable, Disclosure, HashValue } from "../components/primitives.tsx";
import type {
  CampaignReading,
  ComparisonBar,
  ComparisonDetail,
  Outcome,
  Sensitivity,
  SolveRow,
  Tally,
} from "../models.ts";
import { shortHash } from "../models.ts";
import type { Navigation } from "../route.ts";
import { leftOutText } from "./campaign-data.ts";
import { AnswerIssues, DetailHead, endingOf, enter, harnessLabel } from "./drill.tsx";
import { duration, money, percent, time } from "./format.ts";
import { kindOf, standingOf } from "./moves-list.tsx";
import { OUTCOMES } from "./outcome.ts";
import { RulingsCell, rulingLabel } from "./solve-rows.tsx";
import { plural } from "../../../../src/meta/text.ts";

/*
 * One comparison: what it was, what its scored tasks came to, and each task's solves on both sides.
 * The outcome split uses the six outcomes of `outcome.ts`, the colours of the Campaign pane's bars,
 * each with its label and count beside it; a legend entry filters the tasks to that outcome. The
 * terms are the ones the comparison fixed before its first solve, and the reader's triggers of the
 * comparison lanes sit collapsed at the foot. The tasks its report left out of the split, disputed,
 * short of solves or withdrawn, are named under it, so that the parts sum to the tasks it fixed. A
 * comparison that has not reported lists the tasks its start fixed with their solves so far, and
 * no outcome. Its rulings go by kind only while none is withheld (`Rulings`).
 */

const RULING_KINDS = ["earned", "check-defect", "unclear"] as const;

/** A tally in words, in the page's order. */
const tallyWords = ({ wins, losses, ties }: Tally): string =>
  `${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied`;

/** A comparison's rulings in words: by kind, or how many were ruled while one is withheld. */
function rulingsText({ rulings }: Pick<ComparisonBar, "rulings">): string {
  if (rulings.withheld) {
    return `${plural(rulings.ruled, "rejection")} ruled; the kinds stay hidden while any ruling is withheld`;
  }
  return RULING_KINDS.map((kind) => `${String(rulings.kinds[kind])} ${rulingLabel(kind)}`).join(" · ");
}

/** A solve as a chip in a scored task's row: its ending in words, opened on a click. The ending
 *  alone would give every chip of a table one of four names, so each is named for its solve too. */
function SolveChips({ rows, onOpen }: { rows: readonly SolveRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) return <span className="ana-faint">no solve</span>;
  return (
    <span className="ana-solve-chips">
      {rows.map((row) => {
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
            {label}
          </button>
        );
      })}
    </span>
  );
}

/** The outcome split as one bar of counts and a legend that filters the tasks. */
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

/** What the comparison read, beside the split: the tally and its test, each side by itself, the
 *  rulings by kind and the reference against itself where it was read. */
function Readings({ detail, reading }: { detail: ComparisonDetail; reading: CampaignReading }) {
  const { bar } = detail;
  const facts = [
    [
      "Tally",
      bar.tally === null
        ? "none"
        : `${String(bar.tally.wins)} won, ${String(bar.tally.losses)} lost, ${String(bar.tally.ties)} tied`,
    ],
    ["Sign test", bar.p === null ? "not made" : `p ${bar.p.toFixed(3)} at level ${String(bar.level)}`],
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
          [
            "Frontier, where the step is read",
            `${tallyWords(bar.sets.frontier.tally)} · p ${bar.sets.frontier.p.toFixed(3)}`,
          ],
          [
            "Retained, where a step may not lose more than it wins",
            bar.sets.retained === "unmeasured"
              ? "unmeasured: no retained task was tallied, which is not no loss"
              : tallyWords(bar.sets.retained),
          ],
        ] as const)),
    ["Rulings", rulingsText(bar)],
    ...(bar.noise === null
      ? []
      : ([
          [
            "Reference against itself",
            `${String(bar.noise.tally.wins)} won, ${String(bar.noise.tally.losses)} lost · p ${bar.noise.p.toFixed(3)}`,
          ],
        ] as const)),
  ] as const;
  const { terms } = detail;
  const termFacts = [
    ["Solves a side", String(terms.solves)],
    ["Dollar cap", money(terms.cap)],
    ["Model turns", terms.modelTurns === null ? "unlimited" : String(terms.modelTurns)],
    ["Objective", terms.objective === null ? "none" : `${terms.objective.direction} is better`],
    ["Starter", harnessLabel(reading, terms.starter)],
    ["Host load", bar.load === null ? "not recorded" : bar.load.toFixed(1)],
    ["Table row", bar.named === null ? "not recorded" : `${bar.named.code} · ${bar.named.why}`],
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
      <Disclosure title="Terms fixed before the first solve">
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

/** What the report says beside its test of what the test could see, as label and value: how much
 *  a step has to be to show, what an attempt risks, and what the tally's counts hide. */
function sensitivityFacts(seen: Sensitivity): (readonly [string, string])[] {
  const { frontier, informative, overlap, billed, noise, families } = seen;
  return [
    ...(frontier === null
      ? []
      : ([
          ["Untied in the test", plural(frontier.untied, "task")],
          [
            "A step one reading detects four times in five",
            frontier.detectable === null
              ? "none: too few untied tasks"
              : `the new harness wins ${percent(frontier.detectable)} of them`,
          ],
          ["False promotion an attempt", percent(frontier.falseRate)],
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
            `validity ${String(seen.points.validity)}, objective ${String(seen.points.objective)}, bill ${String(seen.points.bill)}`,
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

export function ComparisonDetailView({
  detail,
  reading,
  navigation,
}: {
  detail: ComparisonDetail;
  reading: CampaignReading;
  navigation: Navigation;
}) {
  const [chosen, setChosen] = useState<Outcome | null>(null);
  const { move, terms } = detail;
  const standing = standingOf(move);
  const tasks = detail.tasks.filter((task) => chosen === null || task.outcome === chosen);
  const openSolve = (id: string) => enter(navigation, { solve: id });
  const labelOf = (outcome: Outcome | null) => OUTCOMES.find((each) => each.outcome === outcome);
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
          <DataTable>
            <thead>
              <tr>
                <th>Task</th>
                <th>Outcome</th>
                <th>Reference solves</th>
                <th>New solves</th>
                <th>Rulings</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const outcome = labelOf(task.outcome);
                return (
                  <tr key={task.task}>
                    <td>
                      <button
                        type="button"
                        className="ana-row-select"
                        title="Open the task"
                        onClick={() => navigation.push({ pane: "tasks", task: task.task, solve: null })}
                      >
                        {task.taskId ?? shortHash(task.task, 8)}
                      </button>
                    </td>
                    <td>
                      {outcome === undefined ? (
                        <span className="ana-faint">no report yet</span>
                      ) : (
                        <span className="ana-outcome">
                          <span className="ana-swatch" style={{ background: outcome.color }} aria-hidden />
                          {outcome.label}
                        </span>
                      )}
                    </td>
                    <td>
                      <SolveChips rows={task.old} onOpen={openSolve} />
                    </td>
                    <td>
                      <SolveChips rows={task.fresh} onOpen={openSolve} />
                    </td>
                    <td className="ana-rulings-cell">
                      <RulingsCell
                        rows={[...task.old, ...task.fresh]}
                        tier={detail.tier}
                        withheld={task.withheld}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </div>
      </Section>
      <Disclosure title={`The reader's triggers (${String(detail.triggers.length)})`}>
        <TriggerList triggers={detail.triggers} none="No trigger fired for this comparison." />
      </Disclosure>
    </div>
  );
}
