import { withheldWords } from "../components/exam-side.tsx";
import { Badge } from "../components/primitives.tsx";
import { type Column as TableColumn, Table } from "../components/table.tsx";
import {
  type CampaignReading,
  type SolveRow,
  shortHash,
  type Tier,
  type Tone,
  type Withheld,
} from "../models.ts";
import { EndingBadge, endingOf, harnessLabel, sideLabel } from "./drill.tsx";
import { money, seconds } from "./format.ts";
import type { Ruling } from "../../../../src/referee/referee.ts";
import { plural } from "../../../../src/meta/text.ts";

/*
 * Solves as rows: a Builder session's practice solves, a task's solves across comparisons. A row
 * opens the solve's detail. The ruling column says, for a rejection, what the tier lets it say:
 * the Referee's ruling on the exam side, why it is withheld from both tiers where it is (a person's
 * label still to come, or a comparison that has not reported), and otherwise that the exam side
 * holds it.
 */

/** The columns a table may leave out where every row would say the same. */
type Column = "task" | "comparison" | "side" | "harness" | "ruling";

const RULINGS = {
  earned: { label: "earned", tone: "bad" },
  "check-defect": { label: "check defect", tone: "warn" },
  unclear: { label: "unclear", tone: "neutral" },
} as const satisfies Record<Ruling, { readonly label: string; readonly tone: Tone }>;

/** A Referee's ruling as a badge. */
export function RulingBadge({ ruling }: { ruling: Ruling }) {
  return <Badge tone={RULINGS[ruling].tone}>{RULINGS[ruling].label}</Badge>;
}

/** The label of a ruling kind, as the rulings by kind are counted. */
export function rulingLabel(ruling: Ruling): string {
  return RULINGS[ruling].label;
}

/** Whether a solve's answer was rejected by a check, the one ending a ruling is made of. */
export function isRejection(row: SolveRow): boolean {
  return row.ending?.outcome === "fail" && row.ending.kind === "rejected";
}

/** What a rejection's ruling cell says in `tier`, with `withheld` as why its ruling is held back
 *  from both tiers; nothing for a solve that was not rejected. */
function RulingCell({ row, tier, withheld }: { row: SolveRow; tier: Tier; withheld: Withheld }) {
  if (!isRejection(row)) return null;
  if (row.ruling !== undefined) {
    return row.ruling === null ? (
      <span className="ana-faint">not ruled</span>
    ) : (
      <RulingBadge ruling={row.ruling} />
    );
  }
  if (withheld !== null) return <span className="ana-faint">withheld {withheldWords(withheld)}</span>;
  // The exam tier leaves a ruling out only where it is withheld from both tiers.
  if (tier === "exam") return <span className="ana-faint">withheld in either tier</span>;
  return <span className="ana-faint">exam side</span>;
}

/** The rulings of one task's rejections in a comparison: each one on the exam side, and one line
 *  for them all where the tier withholds them or they are withheld from both. */
export function RulingsCell({
  rows,
  tier,
  withheld,
}: {
  rows: readonly SolveRow[];
  tier: Tier;
  withheld: Withheld;
}) {
  const rejected = rows.filter(isRejection);
  if (rejected.length === 0) return <span className="ana-faint">no rejection</span>;
  if (tier === "default" || withheld !== null) {
    const said = withheld === null ? "ruled on the exam side" : `withheld ${withheldWords(withheld)}`;
    return <span className="ana-faint">{`${plural(rejected.length, "rejection")}, ${said}`}</span>;
  }
  return (
    <span className="ana-solve-chips">
      {rejected.map((row) => (
        <RulingCell key={row.id} row={row} tier={tier} withheld={withheld} />
      ))}
    </span>
  );
}

/** Solves as a table (`Table`), sorted and narrowed by ending, side and comparison where the table
 *  shows them. */
export function SolveTable({
  rows,
  reading,
  tier,
  awaiting,
  show,
  onOpen,
}: {
  rows: readonly SolveRow[];
  reading: CampaignReading;
  tier: Tier;
  /** The task versions whose rulings wait for a person's label. */
  awaiting: ReadonlySet<string>;
  show: readonly Column[];
  onOpen: (id: string) => void;
}) {
  const task = (row: SolveRow) => row.taskId ?? shortHash(row.task, 8);
  const comparison = (row: SolveRow) => row.comparison ?? "practice";
  const columns: readonly (TableColumn<SolveRow> & { readonly part?: Column })[] = [
    {
      id: "solve",
      head: "Solve",
      sort: (row) => row.id,
      cell: (row) => (
        <button type="button" className="ana-row-select" data-row={row.id} onClick={() => onOpen(row.id)}>
          {row.id}
        </button>
      ),
    },
    { id: "task", part: "task", head: "Task", className: "ana-mono", sort: task, cell: task },
    {
      id: "comparison",
      part: "comparison",
      head: "Comparison",
      className: "ana-mono",
      sort: comparison,
      choice: comparison,
      cell: comparison,
    },
    {
      id: "side",
      part: "side",
      head: "Side",
      sort: (row) => sideLabel(row.side),
      choice: (row) => sideLabel(row.side),
      cell: (row) => sideLabel(row.side),
    },
    {
      id: "harness",
      part: "harness",
      head: "Harness",
      className: "ana-mono",
      sort: (row) => harnessLabel(reading, row.harness),
      cell: (row) => harnessLabel(reading, row.harness),
    },
    {
      id: "ending",
      head: "Ending",
      sort: (row) => endingOf(row.ending).label,
      choice: (row) => endingOf(row.ending).label,
      cell: (row) => <EndingBadge ending={row.ending} />,
    },
    {
      id: "turns",
      head: "Turns",
      numeric: true,
      sort: (row) => row.turns,
      cell: (row) => row.turns ?? "open",
    },
    { id: "calls", head: "Calls", numeric: true, sort: (row) => row.calls, cell: (row) => row.calls },
    {
      id: "time",
      head: "Time",
      numeric: true,
      sort: (row) => row.seconds,
      cell: (row) => seconds(row.seconds),
    },
    { id: "cost", head: "Cost", numeric: true, sort: (row) => row.billed, cell: (row) => money(row.billed) },
    {
      id: "ruling",
      part: "ruling",
      head: "Ruling",
      cell: (row) => <RulingCell row={row} tier={tier} withheld={awaiting.has(row.task) ? "label" : null} />,
    },
  ];
  return (
    <div className="ana-dense">
      <Table
        label="solves"
        rows={rows}
        columns={columns.filter(({ part }) => part === undefined || show.includes(part))}
        rowKey={(row) => row.id}
        search={(row) => `${row.id} ${task(row)} ${comparison(row)} ${harnessLabel(reading, row.harness)}`}
        placeholder="Search solves by id, task or harness"
      />
    </div>
  );
}
