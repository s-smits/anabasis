/**
 * Tabulates Examiner task proposals beside their admission gate readings as CSV: `exams.ts
 * [--every] <log or campaign folder>... > exams.csv`.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { referenceAt, STARTS } from "#skills/examiner-complexity/scripts/ambition.ts";
import { runCommand } from "#skills/main/cli.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** What the gate measured on one draft (`task.gate`), from the reference's own counts rather than
 *  the prose it wrote the Examiner. */
interface Gated {
  readonly outcome: "held" | "refused" | "ungated";
  readonly valid: number | null;
  readonly solves: number | null;
  readonly proved: boolean;
}

interface Draft extends Gated {
  readonly session: string;
  readonly reference: string;
  readonly family: string;
  readonly chars: number;
  readonly title: string;
}

export interface DraftRow {
  readonly session: string;
  readonly reference: string;
  readonly family: string;
  readonly drafts: number;
  readonly held: number;
  readonly refused: number;
  /** The ceiling, where only the objective could have left room (`informative`,
   *  `src/kernel/compare.ts`): what starved supply looks like. */
  readonly noroom: number;
  /** The scale's other end: such a draft leaves room only on the author's own proved answer. */
  readonly none: number;
  readonly proved: number;
  readonly chars: number;
  readonly title: string;
}

const UNGATED: Gated = { outcome: "ungated", valid: null, solves: null, proved: false };

const COLUMNS = [
  "session",
  "reference",
  "family",
  "drafts",
  "held",
  "refused",
  "noroom",
  "none",
  "proved",
  "chars",
  "title",
] as const satisfies readonly (keyof DraftRow)[];
export const EXAMS_HEADER = ["campaign", ...COLUMNS].join(",");

/** A version is its content's digest (`taskVersion`), so a draft re-put to the gate after a refusal
 *  reads under the same key. */
function gatesByVersion(events: readonly LogEvent[]): Map<string, Gated> {
  const feasible = new Set(
    events.flatMap(({ kind, data }) => (kind === "task.feasible" ? [data.version] : [])),
  );
  const gated = new Map<string, Gated>();
  for (const { kind, data } of events) {
    if (kind !== "task.gate" || !isString(data.version)) continue;
    const reference = asRecord(data.reference);
    gated.set(data.version, {
      outcome: data.outcome === "passed" ? "held" : "refused",
      valid: isNumber(reference?.valid) ? reference.valid : null,
      solves: isNumber(reference?.solves) ? reference.solves : null,
      proved: feasible.has(data.version),
    });
  }
  return gated;
}

/** A pack's task, a carried one and the drafted exam's own examples (`ex-001` on) are left out:
 *  their proposals name no session and hold no content. */
function draftsOf(events: readonly LogEvent[]): Draft[] {
  const gated = gatesByVersion(events);
  const sessions = new Map(
    events.flatMap((event, index) =>
      STARTS.has(event.kind) && isString(event.data.session)
        ? [[event.data.session, referenceAt(events, index)] as const]
        : [],
    ),
  );
  return proposalsOf(events).flatMap(({ version, family, session, task }) => {
    if (task === null || session === null || task.publicInput === null) return [];
    const title = asRecord(task.publicInput)?.title;
    return [
      {
        session,
        reference: sessions.get(session) ?? "starter",
        family: family ?? task.family,
        chars: JSON.stringify(task.publicInput).length,
        title: isString(title) ? title : (family ?? task.family),
        ...(gated.get(version) ?? UNGATED),
      },
    ];
  });
}

export function draftRows(events: readonly LogEvent[], keep: "grouped" | "every"): DraftRow[] {
  const groups = new Map<string, [Draft, ...Draft[]]>();
  for (const [nth, draft] of draftsOf(events).entries()) {
    const key = keep === "every" ? String(nth) : `${draft.session}\u0000${draft.family}`;
    const group = groups.get(key);
    groups.set(key, group === undefined ? [draft] : [...group, draft]);
  }
  return [...groups.values()].map((drafts) => {
    const [first] = drafts;
    const count = (of: (draft: Draft) => boolean) => drafts.filter(of).length;
    // The middle length, since one outsized draft would move a mean of a family's instances.
    const lengths = drafts.map(({ chars }) => chars).toSorted((a, b) => a - b);
    return {
      session: first.session,
      reference: first.reference,
      family: first.family,
      drafts: drafts.length,
      held: count(({ outcome }) => outcome === "held"),
      refused: count(({ outcome }) => outcome === "refused"),
      noroom: count(
        ({ outcome, valid, solves }) => outcome === "refused" && valid !== null && valid === solves,
      ),
      none: count(({ valid }) => valid === 0),
      proved: count(({ proved }) => proved),
      chars: lengths[Math.floor(lengths.length / 2)] ?? first.chars,
      title: first.title,
    };
  });
}

/** A title is an Examiner's own prose, so it is quoted and its quotes doubled. */
function field(value: string | number): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvLines(campaign: string, rows: readonly DraftRow[]): string[] {
  return rows.map((row) => [campaign, ...COLUMNS.map((column) => row[column])].map(field).join(","));
}

if (import.meta.main) {
  const usage = "exams.ts [--every] <log or campaign folder>...";
  await runCommand(
    { name: "exams", usage, options: { every: "flag" }, positionals: [1, 100] },
    async (args) => {
      const keep = args.flag("every") ? "every" : "grouped";
      console.log(EXAMS_HEADER);
      for (const path of await Promise.all(args.positionals.map((named) => logAcross(named)))) {
        const events = read(path);
        for (const line of csvLines(basename(dirname(path)), draftRows(events, keep))) {
          console.log(line);
        }
      }
    },
  );
}
