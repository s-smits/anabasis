import { withheldWords } from "../components/exam-side.tsx";
import { Badge, DataTable } from "../components/primitives.tsx";
import {
  type CampaignReading,
  type SolveRow,
  shortHash,
  type Tier,
  type Tone,
  type Withheld,
} from "../models.ts";
import { EndingBadge, harnessLabel, sideLabel } from "./drill.tsx";
import { money, seconds } from "./format.ts";
import type { Ruling } from "../../../../src/review/referee.ts";
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
  return (
    <div className="ana-dense">
      <DataTable>
        <thead>
          <tr>
            <th>Solve</th>
            {show.includes("task") ? <th>Task</th> : null}
            {show.includes("comparison") ? <th>Comparison</th> : null}
            {show.includes("side") ? <th>Side</th> : null}
            {show.includes("harness") ? <th>Harness</th> : null}
            <th>Ending</th>
            <th className="ana-num">Turns</th>
            <th className="ana-num">Calls</th>
            <th className="ana-num">Time</th>
            <th className="ana-num">Cost</th>
            {show.includes("ruling") ? <th>Ruling</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <button
                  type="button"
                  className="ana-row-select"
                  data-row={row.id}
                  onClick={() => onOpen(row.id)}
                >
                  {row.id}
                </button>
              </td>
              {show.includes("task") ? (
                <td className="ana-mono">{row.taskId ?? shortHash(row.task, 8)}</td>
              ) : null}
              {show.includes("comparison") ? (
                <td className="ana-mono">{row.comparison ?? "practice"}</td>
              ) : null}
              {show.includes("side") ? <td>{sideLabel(row.side)}</td> : null}
              {show.includes("harness") ? (
                <td className="ana-mono">{harnessLabel(reading, row.harness)}</td>
              ) : null}
              <td>
                <EndingBadge ending={row.ending} />
              </td>
              <td className="ana-num">{row.turns ?? "open"}</td>
              <td className="ana-num">{row.calls}</td>
              <td className="ana-num">{seconds(row.seconds)}</td>
              <td className="ana-num">{money(row.billed)}</td>
              {show.includes("ruling") ? (
                <td>
                  <RulingCell row={row} tier={tier} withheld={awaiting.has(row.task) ? "label" : null} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
