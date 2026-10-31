/**
 * Every draft an Examiner wrote, beside what the gate measured on it, as a CSV a person can read:
 *
 *   bun .claude/skills/examiner-complexity/scripts/exams.ts <log or campaign folder>... > exams.csv
 *   bun .claude/skills/examiner-complexity/scripts/exams.ts --every <log or campaign folder>...
 *
 * `ambition.ts` says how far a campaign got and how each session fared. It does not say what the
 * drafts themselves were, so whether a ladder's words reached the content was read by hand, one log
 * at a time. This reads the content: one row a group of drafts, in the campaign's own order, so
 * reading the file downwards reads the exam forwards and a later session's drafts stand against an
 * earlier one's. The operator asked for that on 31 October, after the first ladder's esp32 arm
 * starved: the question "is this getting harder than five sessions ago" needs the drafts
 * themselves, and needs them without the Examiner's repetitions in the way. Its first reading
 * sharpened the count it was asked about: of 92 gate readings that arm held 4, but 3 of those were
 * the drafted exam's own examples, so its Examiner sessions held 1 of the 89 drafts they wrote.
 *
 * By default the rows are grouped: one a family a session, since an Examiner writes many instances
 * of one family and they vary in size alone. On 31 October both esp32 arms wrote 3 families over 74
 * and 89 drafts, 60 of each from one family, so a row a draft is 20 rows of repetition for every
 * row that says something new. `--every` prints a row a draft for a close read of one session.
 *
 * `chars`, the public input's length, is the one domain-free measure of a draft's content a reader
 * can have without grading it. It says how much a draft holds, never how hard it is, which
 * `grades.ts` grades blind. A longest-list count and a field count were tried on 31 October and
 * dropped: in buffer the longest list is the exam's fixed reagent catalogue of 25 whatever the
 * draft, and the field count was constant within every exam on record. A ladder that raises `chars`
 * and leaves `noroom` where it was has reached the drafts' size and not their method, which is what
 * the esp32 arms showed. Read-only: no event is written and no hidden value is read.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { logOf, referenceAt, STARTS } from "#skills/examiner-complexity/scripts/ambition.ts";
import { runCommand } from "#skills/main/cli.ts";

/** What the gate measured on one draft (`task.gate`), read from the reference's own counts rather
 *  than from the prose it wrote the Examiner, so this reader needs no production change. */
interface Gated {
  /** `ungated` where the draft was still at the gate when the log was read or its campaign stopped. */
  readonly outcome: "held" | "refused" | "ungated";
  /** The reference's valid room solves out of those it ran. Both null where the gate recorded no
   *  reference, as a refusal before the room solves does. */
  readonly valid: number | null;
  readonly solves: number | null;
  /** Whether the author's own answer had passed `try_answer` on the draft's content. */
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

/** What each gate said, by the version it read. A version is its content's digest
 *  (`taskVersion`), so a draft re-put to the gate after a refusal reads under the same key. */
function gatesByVersion(events: readonly LogEvent[]): Map<string, Gated> {
  const gated = new Map<string, Gated>();
  for (const { kind, data } of events) {
    if (kind !== "task.gate" || !isString(data.version)) continue;
    const reference = asRecord(data.reference);
    gated.set(data.version, {
      outcome: data.outcome === "passed" ? "held" : "refused",
      valid: isNumber(reference?.valid) ? reference.valid : null,
      solves: isNumber(reference?.solves) ? reference.solves : null,
      proved: data.proved === true,
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
  await runCommand({ name: "exams", usage, options: { every: "flag" }, positionals: [1, 100] }, (args) => {
    const keep = args.flag("every") ? "every" : "grouped";
    console.log(["campaign", ...COLUMNS].join(","));
    for (const path of args.positionals.map(logOf)) {
      const events = read(path);
      for (const line of csvLines(basename(dirname(path)), draftRows(events, keep))) {
        console.log(line);
      }
    }
  });
}
