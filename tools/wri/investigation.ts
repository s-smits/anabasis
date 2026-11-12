/**
 * What a whole-run investigation is made of once the log has been read: which lanes open, the
 * prompt each session is given, and whether a report has the shape the synthesis can use. Nothing
 * here touches a file; `tools/wri/wri.ts` does the reading and the writing.
 *
 * What every open lane shares (the shared instructions, the overview, what is already counted, the
 * catalogue's stance and the report's form) is one file a session reads once (`sharedPrompt`), and
 * an open lane's prompt carries its question, its own triggers whole, the predictions that name it
 * and where its report goes. Until 10 November each prompt carried the shared part too: of one
 * prompt's 60 thousand characters 56 thousand were shared, 20 thousand of those the solve ids of one
 * lane's triggers, and two sessions given 12 and 14 such prompts both compacted before their last
 * lanes. An isolated lane's prompt stands alone and carries the campaigns' rows, the hard rules, the
 * deterministic rows, its own triggers, the lane and the reporting rules: it is told neither the
 * operator's question nor what any other lane was started by, because it freezes its result before
 * it reads anything that could lead it. A blind lane's carries the campaigns' rows and the hard rules
 * alone: on 8 November lane 27 was handed the orientation, row F's readings and every trigger, and
 * said its grades were sighted.
 *
 * An investigation reads one campaign or several as equals, and each lane reads every one of them.
 * Until 21 October one campaign was under review and the others were peers that only lane 27 read
 * beside it: the final investigation of four stopped Opus campaigns then ran 40 sessions, ten lanes
 * a campaign, and found the crashed Examiner session after a promotion four times over, while a
 * defect one campaign held alone was read by the ten sessions of that campaign only. Now every
 * finding says on its `Seen in:` line which campaigns show it.
 */
import { basename, dirname, join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { type Lane, section } from "./catalogue.ts";
import { TRIGGERS, type Trigger } from "./folds.ts";
import type { Overview } from "./read.ts";

interface Selection {
  /** Lanes that open together, each with the shared instructions. */
  readonly open: readonly Lane[];
  /** Lanes that run alone. */
  readonly isolated: readonly Lane[];
  /** Isolated lanes whose trigger fired and which were not asked for: each waits on another lane. */
  readonly waiting: readonly Lane[];
}

/** A campaign under review, with the overview its log reads into. */
export interface Campaign {
  readonly name: string;
  readonly log: string;
  readonly overview: Overview;
}

export interface Report {
  readonly lane: number;
  readonly state: "ok" | "missing" | "invalid";
  readonly faults: readonly string[];
  readonly verdict: string | null;
  readonly findings: number;
  /** How the report resolves each prediction it names, by id. */
  readonly resolved: Readonly<Record<string, Resolution>>;
}

interface SharedParts {
  /** The shared instructions as the primary edited them. */
  readonly shared: string;
  readonly campaigns: readonly Campaign[];
  /** The whole catalogue, for its stance and its owner table. */
  readonly catalogue: string;
  readonly owners: readonly string[];
  /** What each derived file answers and how large it stands (`derivedMap`, `tools/wri/derive.ts`);
   *  "" where no folder was derived. */
  readonly derived?: string;
}

interface PromptParts extends SharedParts {
  readonly lane: Lane;
  /** Where the session writes its report. */
  readonly report: string;
  /** Where the part every open lane shares is written (`sharedPrompt`). */
  readonly common: string;
  /** The campaigns' climbs side by side, for a lane that reads them; "" where one campaign is read. */
  readonly climb?: string;
}

const CAMPAIGN_HEADING = "Campaigns under review";
const RULES_HEADING = "Hard rules";
const TOOLS_HEADING = "Tools a lane runs";
const VERDICTS = ["finding", "no finding", "could not read", "omitted"] as const;
/** A row of the prediction table the prior state holds, and the lanes it names. */
interface Prediction {
  readonly id: string;
  readonly lanes: readonly number[];
  /** The table's header line and this row's, as the primary wrote them. */
  readonly head: string;
  readonly row: string;
}

/** What a report's second line says until its lane is read; `reportOf` holds it as unfinished. */
const PENDING = "pending";
const RESOLUTIONS = ["held", "falsified", "unreached"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const PREDICTION = "Prediction";
/** A trigger's detail past this many characters is cut in the part every lane reads, and stands
 *  whole in its own lane's prompt: seven `WINS` lines of lane 16 were 20 of the 56 thousand
 *  characters each lane's prompt shared on 10 November. */
const DETAIL = 300;
const FIELDS = ["Observation:", "Cause:", "Owner:", "Reverses if:", "Decision:"] as const;
const SEEN = "Seen in:";
/**
 * The derived file (`READERS`, `tools/wri/derive.ts`) that holds the rows a trigger counted, where one
 * does. A trigger prints a count and at most a few ids, and the sessions of 3 to 10 November went
 * from that line to a query of their own over the log for rows a file already held.
 */
export const ROWS = {
  "REFUSALS BY CHECK": "checks",
  "CONTROL COVERAGE": "checks",
  "CHECKER READ WITH FAULTS": "checks",
  "REFUSED UNREAD": "rejections",
  "CHECK DEFECT RULED": "rejections",
  "RULED UNCLEAR": "rejections",
  "SET ASIDE AND UNSETTLED": "rejections",
  "SETTLED BY HAND": "rejections",
  "EARNED WITHOUT A PROBE": "rejections",
  "EXAM DRAFTED": "drafted",
  "SUPPLY THIN": "draw",
  "GATE REFUSED": "exams",
  "TIED TASKS": "pairs",
  "TIES BETWEEN VALID ANSWERS": "pairs",
  "MARGINS INSIDE THE NOISE": "pairs",
  "REFERENCE AGAINST ITSELF": "pairs",
  "OUTCOMES BY SESSION": "aim",
  "HARNESS CHANGED": "versions",
  "TOOLS EDITED": "versions",
  "TOOLS CALLED": "calls",
  "TOOL CALLS ERRED": "calls",
  "NO PRACTICE": "practice",
  "PRACTICE FAILS": "practice",
  "FINAL BYTES NEVER PRACTISED": "practice",
  "STEP CARRIERS": "scores",
  "NOTHING SCORED": "readings",
  "CUT BY ITS CAP": "readings",
  "SET SHORT": "readings",
  "PROMOTION UNCONFIRMED": "starter-reads",
  "CHAIN AGAINST THE STARTER": "starter-reads",
  CHAIN: "climb",
  "AFTER THE PROMOTION": "epoch-spend",
  "SPEND LED BY A ROLE": "epoch-spend",
  "MISSES AT A LIMIT": "budget",
  "HOST LOADED": "budget",
  "LOAD MOVED": "budget",
  "BUILDER COMPACTED": "compactions",
  "SERVED ANOTHER MODEL": "degradations",
  "HOST CODE MOVED": "source",
  LAUNCHES: "launches",
  "ENDED AND WENT ON": "launches",
} satisfies Partial<Record<keyof typeof TRIGGERS, string>>;

/** A lane's file stem: `07` for lane 7. */
export function stem(lane: number): string {
  return String(lane).padStart(2, "0");
}

/** Where lane `lane`'s report is written in the investigation `out`, the one owner of its name. */
export const reportPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-report.md`);

/** `1-4,7` as the lane numbers it names. */
export function numbersOf(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number);
    if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to)) {
      throw new Error(`--lanes ${spec}: ${part} is no lane or range of lanes`);
    }
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });
}

/** Where the campaign of a stored log that is gone stands now, among the runs a reader reads: `retire`
 *  moves a closed run into the archive, and a log read at its old path is an empty history. On 10
 *  November 23 of 58 investigations named such a log (43 of 190), so `lanes` refused an isolated lane
 *  as untriggered and `collect` and `synthesis` read a campaign with no trigger. */
export function movedTo(log: string, held: readonly { name: string; path: string }[]): string {
  const name = basename(dirname(log));
  const run = held.find((each) => each.name === name);
  if (run === undefined) {
    throw new Error(`${log} is gone, and no worktree or archive holds a campaign ${name}`);
  }
  return run.path;
}

/**
 * The lanes one build opens. With none named: every lane a trigger started and every standing lane,
 * and no isolated lane, since each of those waits on what another lane found. Named lanes open as
 * named, but an isolated lane never without its trigger.
 */
export function selected(
  lanes: readonly Lane[],
  triggers: readonly Trigger[],
  named: readonly number[] | null,
): Selection {
  const started = new Set(triggers.map((trigger) => trigger.lane));
  const unknown = (named ?? []).filter((number) => !lanes.some((lane) => lane.number === number));
  if (unknown.length > 0) throw new Error(`no lane ${unknown.join(", ")} in the catalogue`);
  const asked = (lane: Lane) =>
    named === null
      ? !lane.isolated && (lane.standing || started.has(lane.number))
      : named.includes(lane.number);
  const picked = lanes.filter(asked);
  const idle = picked.filter((lane) => lane.isolated && !started.has(lane.number));
  if (idle.length > 0) {
    throw new Error(
      `lane ${idle.map((lane) => lane.number).join(", ")} runs only on its trigger, and the log fired none`,
    );
  }
  return {
    open: picked.filter((lane) => !lane.isolated),
    isolated: picked.filter((lane) => lane.isolated),
    waiting: lanes.filter((lane) => lane.isolated && started.has(lane.number) && !picked.includes(lane)),
  };
}

/** The sum of the lanes' importance. */
export const weightOf = (lanes: readonly Lane[]) => lanes.reduce((sum, lane) => sum + lane.importance, 0);
const heavierFirst = (one: readonly Lane[], other: readonly Lane[]) => weightOf(other) - weightOf(one);

/**
 * Groups of lanes packed into `count` sessions, or one a lane where there are fewer: each group,
 * heaviest first by the sum of its lanes' importance, joins the lightest session so far. The
 * groups start as whole labels, and while the sessions are fewer than they could be or the lightest
 * weighs under three quarters of the heaviest, the heaviest group of several lanes is halved,
 * alternating its lanes by importance (operator, 9 November: about four groups of roughly equal
 * weight, every lane in exactly one; on 1 November a label was never split, and the climb label,
 * a third of the catalogue's weight, left the lightest of four sessions over its 29 open lanes at
 * 0.64 of the heaviest).
 */
function packed(groups: readonly Lane[][], count: number): Lane[][] {
  const sessions = Array.from({ length: Math.min(count, groups.length) }, (): Lane[] => []);
  for (const group of groups.toSorted(heavierFirst)) {
    sessions
      .reduce((lightest, each) => (weightOf(each) < weightOf(lightest) ? each : lightest))
      .push(...group);
  }
  const weights = sessions.map(weightOf);
  const even =
    sessions.length === Math.min(count, groups.flat().length) &&
    Math.min(...weights) >= 0.75 * Math.max(...weights);
  const [heavy] = groups.filter((group) => group.length > 1).toSorted(heavierFirst);
  if (even || heavy === undefined) return sessions;
  const split = heavy.toSorted((one, other) => other.importance - one.importance);
  const half = (parity: number) => split.filter((_, index) => index % 2 === parity);
  return packed([...groups.filter((group) => group !== heavy), half(0), half(1)], count);
}

/**
 * Lanes packed into sessions (`packed`), an isolated lane a session of its own. Within a session
 * the lanes run in number order, a blind lane first: on 7 November the blind grading lane, read
 * after three lanes of its session, said its grades were not blind.
 */
export function sessionsOf(lanes: readonly Lane[], count: number): Lane[][] {
  const open = lanes.filter((lane) => !lane.isolated);
  const labels = [...new Set(open.map((lane) => lane.label))].map((label) =>
    open.filter((lane) => lane.label === label),
  );
  return [
    ...packed(labels, count).map((each) =>
      each.toSorted((one, other) => Number(other.blind) - Number(one.blind) || one.number - other.number),
    ),
    ...lanes.filter((lane) => lane.isolated).map((lane) => [lane]),
  ];
}

/** The `## ` sections of the shared instructions an author left blank. A comment is no text. */
export function blankSections(shared: string): string[] {
  const text = shared.replaceAll(/<!--[\s\S]*?-->/g, "");
  return [...text.matchAll(/^## (.+)$/gm)].flatMap(([, heading = ""]) =>
    section(text, heading) === "" ? [heading] : [],
  );
}

/**
 * The rows of every table of the shared instructions whose header names an `id` and a `lanes`
 * column: the predictions a release cycle lists under the prior state, each with the lanes that
 * recount it. On 10 November the table went whole into every prompt and was owed by none: of the 42
 * pairs of a lane and a prediction naming it, five sessions' reports named 14 and two sessions' 13,
 * and both sessions said afterwards that they had not read the table as work.
 */
function predictionsOf(shared: string): Prediction[] {
  const cellsOf = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const found: Prediction[] = [];
  let head: { line: string; id: number; lanes: number } | null = null;
  for (const line of shared.replaceAll(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const cells = line.startsWith("|") ? cellsOf(line) : null;
    if (cells === null || head === null) {
      const [id, lanes] = [cells?.indexOf("id") ?? -1, cells?.indexOf("lanes") ?? -1];
      head = id >= 0 && lanes >= 0 ? { line, id, lanes } : null;
      continue;
    }
    const id = cells[head.id] ?? "";
    // The rule under the header names no prediction.
    if (id === "" || /^[-: ]+$/u.test(id)) continue;
    const lanes = (cells[head.lanes] ?? "").split(",").map(Number);
    found.push({ id, lanes: lanes.filter((lane) => lane > 0), head: head.line, row: line });
  }
  return found;
}

/** The predictions `lane` resolves: none for a lane that freezes or grades before it reads a result. */
const owedBy = (lane: Lane, shared: string) =>
  lane.isolated || lane.blind ? [] : predictionsOf(shared).filter(({ lanes }) => lanes.includes(lane.number));

/** The predictions section of a lane's prompt, or nothing where no row names the lane. */
function predicting(owed: readonly Prediction[]): string[] {
  const [first] = owed;
  if (first === undefined) return [];
  return [
    "## Predictions this lane resolves",
    `The prior state names this lane on the ${owed.length === 1 ? "row" : "rows"} below. Recount each from the log, whatever else the lane finds, and give each one line under \`## Predictions\` in your report: \`${PREDICTION} <id>: <${RESOLUTIONS.join(" | ")}>\`, then two counts: how often the row's trigger occurred in the log, and how often the event its mechanism writes followed. A row whose trigger never came is unreached, and one held on a mechanism that ran and moved no reading says so; the collector refuses a report that leaves a row out.`,
    [first.head, first.head.replaceAll(/[^|]+/g, " --- "), ...owed.map(({ row }) => row)].join("\n"),
  ];
}

/** Where a lane's report goes and how it opens. A report's second line was to be its verdict from
 *  the start, so sessions wrote one they did not hold yet ("provisional", 4 November) or said
 *  afterwards that the early line could not be honest (10 November). */
function opening(lane: Lane, report: string): string[] {
  return [
    "## Your report",
    `Write your report to \`${report}\`. Before you read anything for this lane, open it with the two lines below; then replace the second and append each finding as it settles, so a session that is stopped still leaves its work.`,
    ["```", `# Lane ${String(lane.number)}: ${lane.title}`, `Verdict: ${PENDING}`, "```"].join("\n"),
  ];
}

/** A finished report's form under `heading`, its first line, and the rules its collector holds it
 *  to; an open lane's adds what only it may do and owes. */
function form(
  heading: string,
  owners: readonly string[],
  names: readonly string[],
  lane: "open" | "alone",
): string[] {
  const several = names.length > 1;
  const open = lane === "open";
  return [
    [
      "```",
      heading,
      `Verdict: <${VERDICTS.join(" | ")}>, then one sentence`,
      "",
      "## Findings",
      "",
      "### <one line naming the finding>",
      "Observation: what the log or the bytes show, cited by event kind, solve id, the first eight characters of a version or digest, check id and count",
      "Cause: what you infer from it, apart from the observation",
      "Owner: exactly one owner",
      "Reverses if: the observation that would reverse the finding",
      "Decision: what it changes for the operator",
      ...(several
        ? [`${SEEN} ${names.map((name) => `${name} <shows | absent | cannot show>`).join(", ")}`]
        : []),
      "",
      "## Checked",
      "With a verdict of no finding, which leaves Findings empty: what you checked and found sound, in sentences without the five fields",
      "",
      ...(open
        ? [
            "## Predictions",
            `${PREDICTION} <id>: <${RESOLUTIONS.join(" | ")}>, then how often its trigger occurred and how often its event followed; a line for each row the lane's prompt hands it, and no section where it hands none`,
            "",
          ]
        : []),
      "## Not read",
      "What you could not read, and why.",
      "```",
    ].join("\n"),
    ...(open
      ? [
          // The operator, 3 November 2026: a session should follow a problem where it leads and
          // write only the lanes that matter for these runs (`docs/backlog/wri-free-lanes.md`).
          "Where a lane's evidence leads past its question, follow it, and write what you find in that lane's report with the same fields. Where a lane matters less for these campaigns, at the point their logs have reached, than the other lanes your session was given, you may leave it unread: write only the heading and `Verdict: omitted`, then one sentence why (its question does not arise here, the primary's section already settles it, or another of your lanes covers it).",
        ]
      : []),
    `Each of the ${several ? "six" : "five"} fields starts a line of its own, as above: the collector counts them by the line's first word, and a finding written as one paragraph is refused (abl175-new's lane 11, 13 October).`,
    `An owner is one of: ${owners.map((owner) => `\`${owner}\``).join(", ")}. Name the file beside \`host\` and a prompt owner.`,
    "You read and you report. Write no file but your report, and scratch in a temporary directory of your own, never under the campaign's folder or the checkout. Start no solve, no session, no round and no check run; `wri.ts grade` is the one exception, and only where your lane names it. Reply with the report's path and one line per finding.",
  ];
}

/** Each campaign's triggers that `pick` keeps, under its rows unless `rows` is false and under its
 *  name where several are read; "" where no trigger is kept and no row asked for. `cut` shortens a
 *  long trigger line (`DETAIL`). */
function holds(
  campaigns: readonly Campaign[],
  pick: (trigger: Trigger) => boolean,
  { rows: withRows = true, cut = false } = {},
): string {
  return campaigns
    .flatMap(({ name, log, overview: { rows, triggers } }) => {
      const fired = triggers.filter(pick).map(({ name: trigger, lane, detail }) => {
        const said =
          cut && detail.length > DETAIL
            ? `${detail.slice(0, DETAIL)} [cut at ${String(DETAIL)} of ${String(detail.length)} characters; whole in lane ${String(lane)}'s prompt]`
            : detail;
        return `${trigger} (lane ${String(lane)}): ${said}`;
      });
      if (!withRows && fired.length === 0) return [];
      const block = [
        "```",
        ...(withRows
          ? [
              ...rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]),
              "",
            ]
          : []),
        ...fired,
        "```",
      ].join("\n");
      return [campaigns.length === 1 ? block : `### ${name}\n\nLog: \`${log}\`\n\n${block}`];
    })
    .join("\n\n");
}

/**
 * What a lane owes where several campaigns are read: each read first-hand, and each finding triaged
 * against the others. The operator's word of 21 October: read every campaign as an equal, and for
 * everything found on one, look whether the others show it.
 */
function equalsSection(campaigns: readonly Campaign[]): string[] {
  if (campaigns.length === 1) return [];
  const names = campaigns.map(({ name }) => `\`${name}\``).join(", ");
  return [
    "## Every campaign is under review",
    [
      `This investigation reads ${String(campaigns.length)} campaigns as equals: ${names}. Read your lane on each one first-hand, from its own log, its traces and its states. No campaign stands in for another, and no other session's reading stands in for yours: start where your lane has the most to read, and read the traces of each campaign yourself.`,
      `Triage everything you find on one campaign against each of the others: does it occur there, is it absent, or can that campaign not show it, and why. Write the answer on the finding's \`${SEEN}\` line, naming every campaign once. A finding one campaign holds alone is still a finding: say what that campaign has that the others lack.`,
      "Take the time this needs. A lane read whole on every campaign is worth more than one read quickly on one.",
    ].join("\n\n"),
  ];
}

/**
 * What an open lane can lean on, and that it may read past it. The operator, 10 November 2026: the
 * helpers are to spare a session its plumbing without narrowing what it sees. The 265 lane
 * transcripts mined that day show sessions rebuilding by hand what a derived file already held,
 * since no prompt said what each file answers (`slice.ts` ran in none of the 107 sessions of 3 to
 * 10 November), while the findings vetting confirmed often came from one trace or one state read
 * whole, which no table prints. So the files and tools are named as counts already made, and the
 * last paragraph says that the record behind them stays open.
 */
function counted(derived: string, catalogue: string): string[] {
  const tools = section(catalogue, TOOLS_HEADING);
  return [
    "## What is already counted, and what is not",
    [
      "The derived files and the tools below call the host's own folds, the code that decided the run, so a count one of them prints is not yours to rebuild: cite it by file. Recount one only where you doubt the fold itself, and report a reader that miscounts as a finding whose owner is `host`.",
      ...(derived.trim() === "" ? [] : [derived.trim()]),
      ...(tools === "" ? [] : [`### ${TOOLS_HEADING}`, tools]),
      "A table holds what its author thought to count. Every event in a log, every kept state, the check program and every source file are yours to read, and a query of your own is right wherever no file or tool answers: your lane's question says where to start, not where to stop. Where a count looks odd, or one solve does what no column names, open what lies behind it and read it whole, a trace from its first turn to its last. What you notice there and cannot place under your lane is still worth a line under `## Findings` or `## Not read`.",
    ].join("\n\n"),
  ];
}

/** The climb side by side, for the lane that reads it, or what to do where one campaign is read. */
function climbSection(climb: string): string[] {
  return [
    "## The campaigns side by side",
    climb.trim() === ""
      ? "One campaign is under review: say which other campaign would settle what one cannot."
      : climb.trim(),
  ];
}

/**
 * Which of the triggers a lane starts from fired, and on which campaign. The lane's body names every
 * one it can start from, and a session read a name there as a trigger the log had fired: buffer-a's
 * lane 14 on 11 October reported `NEVER CHECKED` false, which the reader had never fired. `rows`
 * names the derived file behind a trigger (`ROWS`), and is empty for a lane handed no derived file.
 */
function firedLine(
  lane: Lane,
  campaigns: readonly Campaign[],
  rows: Readonly<Record<string, string>>,
): string {
  const names = Object.entries(TRIGGERS).flatMap(([name, number]) => (number === lane.number ? [name] : []));
  const list = (each: readonly string[]) => each.map((name) => `\`${name}\``).join(", ");
  const on = campaigns.flatMap(({ name, overview: { triggers } }) => {
    const fired = names.filter((each) => triggers.some((trigger) => trigger.name === each));
    return fired.length === 0 ? [] : [{ name, fired }];
  });
  const quiet = names.filter((each) => !on.some(({ fired }) => fired.includes(each)));
  // Only a trigger that fired has rows to point at.
  const files = new Map<string, string[]>();
  for (const name of names.filter((each) => !quiet.includes(each))) {
    const file = rows[name];
    if (file !== undefined) files.set(file, [...(files.get(file) ?? []), name]);
  }
  const one = campaigns.length === 1;
  return [
    on.length === 0
      ? `None of these triggers fired on ${one ? "this campaign" : "any campaign under review"}: the lane is open because its question stands whenever a harness was compared.`
      : `Fired ${on.map(({ name, fired }) => `on ${one ? "this campaign" : `\`${name}\``}: ${list(fired)}`).join("; ")}.`,
    ...(quiet.length === 0
      ? []
      : [`Not fired: ${list(quiet)}. Read each as the logs' silence on it, not as a lead.`]),
    ...(files.size === 0
      ? []
      : [
          `A trigger's line is a count; the rows it counted are in each campaign's derived folder: ${[...files].map(([file, of]) => `\`${file}.txt\` (${list(of)})`).join(", ")}.`,
        ]),
  ].join(" ");
}

const sessionOf = (campaigns: readonly Campaign[]) =>
  `You are one session of a whole-run investigation of ${campaigns.length === 1 ? "an Anabasis campaign" : "several Anabasis campaigns"}.`;

/** The part every open lane shares, which a session reads once: the shared instructions, the
 *  overview with long trigger lines cut, what is already counted, the catalogue's stance and the
 *  report's form. */
export function sharedPrompt({ shared, campaigns, catalogue, owners, derived = "" }: SharedParts): string {
  const names = campaigns.map(({ name }) => name);
  return [
    "# What every open lane of this investigation shares",
    `${sessionOf(campaigns)} Other sessions read other lanes; you read yours. This file is the same for every open lane: read it whole once, before your first open lane, and not again.`,
    shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim(),
    "## What the logs hold",
    "The rows are the primary reviewer's and are settled. A trigger says a lane has something to read and never what the answer is. A long trigger line is cut here and stands whole in its own lane's prompt.",
    holds(campaigns, () => true, { cut: true }),
    ...counted(derived, catalogue),
    ...equalsSection(campaigns),
    "## Who holds which pen",
    section(catalogue, "Who holds which pen"),
    "## How the catalogue is read",
    section(catalogue, "How the catalogue is read"),
    "## Every lane's report",
    "Each lane's prompt says where its report goes and gives its first two lines. Once the lane is read, the report has this form:",
    ...form("# Lane <number>: <the lane's title>", owners, names, "open"),
  ].join("\n\n");
}

/** One lane's prompt: whole for a lane that runs alone or grades blind, and for an open lane its own
 *  part, which names the shared one at `common`. */
export function lanePrompt({
  lane,
  shared,
  campaigns,
  catalogue,
  owners,
  report,
  common,
  climb = "",
  derived = "",
}: PromptParts): string {
  const alone = lane.isolated || lane.blind;
  const clean = shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim();
  const mine = (trigger: Trigger) => trigger.lane === lane.number;
  const fired = alone ? "" : holds(campaigns, mine, { rows: false });
  const names = campaigns.map(({ name }) => name);
  return [
    `# Lane ${String(lane.number)}: ${lane.title}`,
    ...(alone
      ? [
          lane.isolated
            ? `${sessionOf(campaigns)} Your lane runs alone: you are given no other lane's report and you open none.`
            : `${sessionOf(campaigns)} Other sessions read other lanes; you read yours.`,
          `## ${CAMPAIGN_HEADING}`,
          section(clean, CAMPAIGN_HEADING),
          `## ${RULES_HEADING}`,
          section(clean, RULES_HEADING),
          ...(lane.blind ? [] : ["## What the logs hold", holds(campaigns, mine)]),
          ...equalsSection(campaigns),
          "## Who holds which pen",
          section(catalogue, "Who holds which pen"),
          "## How the catalogue is read",
          section(catalogue, "How the catalogue is read"),
        ]
      : [
          `${sessionOf(campaigns)} What every open lane shares (the question, the campaigns, the hard rules, what is already counted and the report's form) is in \`${common}\`: read it whole once in your session, before your first open lane, and not again. Everything below is this lane's alone.`,
        ]),
    "## Your lane",
    `**${String(lane.number)}. ${lane.title}.**`,
    lane.body,
    // Only an open lane given the derived files is pointed at one.
    firedLine(lane, campaigns, alone || derived.trim() === "" ? {} : ROWS),
    ...(fired === "" ? [] : ["### What fired for this lane, whole", fired]),
    ...(lane.sideBySide ? climbSection(climb) : []),
    ...opening(lane, report),
    ...(alone
      ? [
          "Once the lane is read, the report has this form:",
          ...form(`# Lane ${String(lane.number)}: ${lane.title}`, owners, names, "alone"),
        ]
      : [
          ...predicting(owedBy(lane, shared)),
          "The report's form, its owners and what a lane may leave unread are in the shared file.",
        ]),
  ].join("\n\n");
}

/**
 * Whether a report has the shape the synthesis reads. `text` is null where no file stands. Where
 * several campaigns are read, `names` lists them, and each finding's `Seen in:` line names them all.
 * A lane that read its question owes a line for each prediction of `shared` that names it.
 */
export function reportOf(
  lane: Lane,
  text: string | null,
  owners: readonly string[],
  names: readonly string[],
  shared = "",
): Report {
  if (text === null) {
    return { lane: lane.number, state: "missing", faults: [], verdict: null, findings: 0, resolved: {} };
  }
  const lines = text.split("\n");
  const said =
    lines
      .find((line) => line.startsWith("Verdict:"))
      ?.slice("Verdict:".length)
      .trim() ?? "";
  const verdict = VERDICTS.find((each) => said.startsWith(each)) ?? null;
  const unfinished = said.startsWith(PENDING) ? PENDING : ["provisional"].find((word) => said.includes(word));
  const resolved: Record<string, Resolution> = {};
  for (const line of lines) {
    const [id, how = ""] = line.startsWith(`${PREDICTION} `)
      ? line.slice(PREDICTION.length + 1).split(/: */u)
      : [];
    const resolution = RESOLUTIONS.find((each) => how.startsWith(each));
    if (id !== undefined && resolution !== undefined) resolved[id] = resolution;
  }
  const unresolved =
    verdict === "finding" || verdict === "no finding"
      ? owedBy(lane, shared).flatMap(({ id }) => (id in resolved ? [] : [id]))
      : [];
  const fields = names.length > 1 ? [...FIELDS, SEEN] : FIELDS;
  const counts = fields.map((field) => lines.filter((line) => line.startsWith(field)).length);
  const [findings = 0] = counts;
  const named = lines.flatMap((line) => (line.startsWith("Owner:") ? [line.slice("Owner:".length)] : []));
  const unowned = named.filter((line) => !owners.some((owner) => line.includes(owner))).length;
  // Each entry is a campaign's whole name and its triage: a name that holds another as a prefix
  // must not pass for it (review of 21 October). Entries part at a comma or a semicolon: on 22
  // October 9 of 20 lanes over two campaigns parted them with semicolons, their triage holding
  // commas, and were refused for leaving out a campaign they named.
  const unseen = names.filter((name) =>
    lines.some(
      (line) =>
        line.startsWith(SEEN) &&
        !line
          .slice(SEEN.length)
          .split(/[,;]/u)
          .some((entry) => entry.trim().split(" ")[0] === name),
    ),
  );
  const faults = [
    ...(lines[0]?.startsWith(`# Lane ${String(lane.number)}:`) === true
      ? []
      : ["the first line does not name the lane"]),
    ...(verdict === null && unfinished === undefined ? [`no verdict among: ${VERDICTS.join(", ")}`] : []),
    ...(counts.some((count) => count !== findings)
      ? [
          `the findings are uneven: ${fields.map((field, index) => `${field} ${String(counts[index])}`).join(", ")}`,
        ]
      : []),
    ...(verdict === "finding" && findings === 0 ? ["the verdict is a finding and none is written"] : []),
    // An isolated lane is a session of its own with one lane, so it has no other lane to weigh
    // against and may not leave its lane unread (release review, 3 November).
    ...(verdict === "omitted" && lane.isolated ? ["an isolated lane may not be omitted"] : []),
    // A session opens its report before it reads, as the hard rules ask; on 4 November buffer583's
    // lane 32 stood as "could not read, provisional" and `collect` read it as a final verdict.
    ...(unfinished === undefined ? [] : [`the verdict is ${unfinished}: the session is still writing`]),
    ...(unresolved.length > 0
      ? [
          `no \`${PREDICTION} <id>: ${RESOLUTIONS.join(" | ")}\` line for ${unresolved.join(", ")}, which the prior state hands this lane`,
        ]
      : []),
    // Recode's lane 15 on 10 October said no finding over two written findings, and was accepted.
    ...((verdict === "no finding" || verdict === "omitted") && findings > 0
      ? [`the verdict is ${verdict} and the report writes ${plural(findings, "finding")}`]
      : []),
    ...(unowned > 0
      ? [`${String(unowned)} of ${String(named.length)} owners are not in the owner table`]
      : []),
    ...(unseen.length > 0 && names.length > 1 ? [`a ${SEEN} line leaves out ${unseen.join(", ")}`] : []),
  ];
  const state = faults.length === 0 ? "ok" : "invalid";
  return { lane: lane.number, state, faults, verdict, findings, resolved };
}

/**
 * The report index the synthesis is given, one line per lane. A lane a session left out while its
 * trigger fired on one of the `campaigns` says so, since that is the lane most likely missed. Under
 * it, where the prior state of `shared` lists predictions, how the lanes resolved each and which
 * lane it names gave no line: where the primary's backtracking starts, with two lanes that disagree
 * side by side.
 */
export function reportIndex(
  reports: readonly Report[],
  pathOf: (lane: number) => string,
  campaigns: readonly Campaign[],
  shared = "",
): string {
  const fired = new Set(campaigns.flatMap(({ overview }) => overview.triggers.map(({ lane }) => lane)));
  const lanes = reports.map(({ lane, state, verdict, findings, faults }) => {
    const trigger = fired.has(lane) ? " although its trigger fired" : "";
    const read = verdict === "omitted" ? `omitted${trigger}` : verdict;
    const tail = state === "ok" ? `${read ?? ""}, ${plural(findings, "finding")}` : faults.join("; ");
    return `- lane ${String(lane)}: ${state}${tail === "" ? "" : `, ${tail}`}, at \`${pathOf(lane)}\``;
  });
  const predictions = predictionsOf(shared).map(({ id, lanes: named }) => {
    const said = RESOLUTIONS.flatMap((how) => {
      const by = reports.filter(({ resolved }) => resolved[id] === how).map(({ lane }) => lane);
      return by.length === 0 ? [] : [`${how} by lane ${by.join(", ")}`];
    });
    const silent = named.filter((lane) => !reports.some((each) => each.lane === lane && id in each.resolved));
    return `- ${id}: ${[...said, ...(silent.length === 0 ? [] : [`no line from lane ${silent.join(", ")}`])].join("; ")}`;
  });
  return [
    ...lanes,
    ...(predictions.length === 0
      ? []
      : ["", "Each prediction, as the lanes resolved it:", "", ...predictions]),
  ].join("\n");
}

/** A template with its `{name}` slots filled and its comments dropped. An unfilled slot is named. */
export function filled(template: string, values: Readonly<Record<string, string>>): string {
  const text = template.replaceAll(/<!--[\s\S]*?-->\n?/g, "");
  return text.replaceAll(/\{(\w+)\}/g, (slot, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`the template names ${slot}, which nothing fills`);
    return value;
  });
}
