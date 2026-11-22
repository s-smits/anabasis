/**
 * Tabulates Examiner task proposals alongside their admission gate readings as CSV.
 *
 *   bun .claude/skills/examiner-complexity/scripts/exams.ts <log or campaign folder>... > exams.csv
 *   bun .claude/skills/examiner-complexity/scripts/exams.ts --every <log or campaign folder>...
 *
 * By default, groups proposals by `(session, family)` in campaign order (or prints one row per
 * proposal under `--every`), reporting proposal count, held and refused counts, ceiling refusals
 * where every reference room solve was valid (`noroom`), zero-valid drafts (`none`), proved author
 * answers (`proved`), median JSON public-input length (`chars`), and the first draft's title.
 * Read-only and public-side: writes no events and reads no hidden values.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { referenceAt, STARTS } from "#skills/examiner-complexity/scripts/ambition.ts";
import { runCommand } from "#skills/main/cli.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

/** What the gate measured on one draft (`task.gate`), read from the reference's own counts rather
 *  than from the prose it wrote the Examiner, so this reader needs no production change. */
interface Gated {
  /** `ungated` where the draft was still at the gate when the log was read or its campaign stopped. */
  readonly outcome: "held" | "refused" | "ungated";
  /** The reference's valid room solves out of those it ran. Both null where the gate recorded no
   *  reference, as a refusal before the room solves does. */
  readonly valid: number | null;
  readonly solves: number | null;
  /** Whether an author's answer passed on the task (`task.feasible`). An older gate also wrote a
   *  `proved` key of its own, which no reader reads. */
  readonly proved: boolean;
}

/** One draft: what the Examiner wrote and what the gate made of it. */
interface Draft extends Gated {
  readonly session: string;
  readonly reference: string;
  readonly family: string;
  readonly chars: number;
  readonly title: string;
}

/** One row of the CSV: a group of drafts, or a single draft under `--every`. */
export interface DraftRow {
  readonly session: string;
  readonly reference: string;
  readonly family: string;
  readonly drafts: number;
  readonly held: number;
  /** Drafts the gate refused; with `held` and those still at the gate they make up `drafts`. */
  readonly refused: number;
  /** Of `refused`, those with the reference valid in every room solve it ran: the ceiling, where only
   *  the objective could have left room (`informative`, `src/kernel/compare.ts`). This is what
   *  starved supply looks like, so the reader states it rather than leaving it to be worked out. */
  readonly noroom: number;
  /** Drafts the reference answered validly in no room solve, the scale's other end: such a draft
   *  leaves room only on the author's own proved answer. */
  readonly none: number;
  readonly proved: number;
  /** The public input's length as JSON, median over the group. */
  readonly chars: number;
  /** The first draft's `title`, where its public input states one, else its family. */
  readonly title: string;
}

const UNGATED: Gated = { outcome: "ungated", valid: null, solves: null, proved: false };

/** The CSV's columns after the campaign's name, in `DraftRow`'s own terms, so the header and every
 *  line are spelled once. */
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
/** The CSV's header. */
export const EXAMS_HEADER = ["campaign", ...COLUMNS].join(",");

/** What each gate said, by the version it read. A version is its content's digest
 *  (`taskVersion`), so a draft re-put to the gate after a refusal reads under the same key. */
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

/** Every draft an Examiner session wrote, in the order it proposed them. A pack's task, a carried
 *  one and the drafted exam's own examples (`ex-001` on) are left out: their proposals name no
 *  session and hold no content, though the gate reads the examples and `ambition.ts` counts them. */
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

/** One row a group of drafts, or a row a draft where `keep` is `every`. A group is one family
 *  within one session, in the order its first draft was proposed. */
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

/** One CSV field. A title is an Examiner's own prose, so it is quoted and its quotes doubled. */
function field(value: string | number): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The CSV's lines for one campaign, without the header. */
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
