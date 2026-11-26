/**
 * What a whole-run investigation is made of once the log is read: which lanes open, each session's
 * prompt, and whether a report has the shape the synthesis uses. Nothing here touches a file;
 * `wri.ts` reads and writes.
 */
import { basename, dirname, join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { type Lane, section } from "./catalogue.ts";
import { firstWord, plain, VERDICTS as VETTED } from "./findings.ts";
import { TRIGGERS, type Trigger } from "./folds.ts";
import type { Overview } from "./read.ts";

interface Selection {
  readonly open: readonly Lane[];
  readonly isolated: readonly Lane[];
  readonly waiting: readonly Lane[];
}

export interface Campaign {
  readonly name: string;
  readonly log: string;
  readonly overview: Overview;
}

interface QuestionAnswer {
  readonly verdict: QuestionVerdict;
  readonly text: string;
}

interface Report {
  readonly lane: number;
  readonly state: "ok" | "missing" | "invalid";
  readonly faults: readonly string[];
  readonly verdict: string | null;
  readonly written: readonly Written[];
  readonly resolved: Readonly<Record<string, Resolution>>;
  readonly answered: Readonly<Record<string, QuestionAnswer>>;
}

interface SharedParts {
  readonly shared: string;
  readonly campaigns: readonly Campaign[];
  readonly catalogue: string;
  readonly owners: readonly string[];
  readonly derived?: string;
}

interface PromptParts extends SharedParts {
  readonly lane: Lane;
  readonly report: string;
  readonly common: string;
  readonly climb?: string;
}

const CAMPAIGN_HEADING = "Campaigns under review";
const RULES_HEADING = "Hard rules";
const TOOLS_HEADING = "Tools a lane runs";
const VERDICTS = ["finding", "no finding", "could not read", "omitted"] as const;
interface Assigned {
  readonly kind: typeof PREDICTION | typeof QUESTION;
  readonly id: string;
  readonly lanes: readonly number[];
  readonly head: string;
  readonly question: string;
  readonly row: string;
}

const PENDING = "pending";
const RESOLUTIONS = ["confirmed", "refuted", "not-observed"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const RESOLUTION_SYNONYMS = new Map<string, Resolution>([
  ["held", "confirmed"],
  ["falsified", "refuted"],
  ["unreached", "not-observed"],
]);
const PREDICTION = "Prediction";
const QUESTION = "Question";
const QUESTIONS_HEADING = "Operator questions";
const QUESTION_VERDICTS = ["yes", "partial", "no", "unmeasured"] as const;
type QuestionVerdict = (typeof QUESTION_VERDICTS)[number];
const QUESTION_VERDICT_LEAD = /^(yes|partial|no|unmeasured)\s*[,:;.]\s*(.+)$/iu;
const ASSIGNED_LINE = new RegExp(`^(${PREDICTION}|${QUESTION}) ([^:]+): *(.*?)\r?$`, "u");
const DETAIL = 300;
const FIELDS = ["Observation:", "Cause:", "Owner:", "Reverses if:", "Decision:"] as const;
const [OBSERVATION, CAUSE, OWNER, , DECISION] = FIELDS;
const SEEN = "Seen in:";
const TITLE = "### ";
export const FINDINGS_HEAD =
  "| id | owner | observation | cause | finding | seen in | decision |\n| --- | --- | --- | --- | --- | --- | --- |";
const [CONFIRMED, PLAUSIBLE] = VETTED;

interface Written {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly observation: string;
  readonly cause: string;
  readonly seen: string;
  readonly decision: string;
}
export const ROWS = {
  "REFUSALS BY CHECK": "checks",
  "CONTROL COVERAGE": "checks",
  "CHECKER READ WITH FAULTS": "checks",
  "PASSES LABELLED": "checks",
  "DELIVERABLES CAPTURED": "deliverables",
  "NO DELIVERABLES CAPTURED": "deliverables",
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
  "PRACTICE CONCENTRATION": "transfer",
  "PRE-PROMOTION PRACTICE RELEASED": "transfer",
  "BUILT HARNESS FOR EXPORT": "portability",
  "STEP CARRIERS": "scores",
  "NOTHING SCORED": "readings",
  "CUT BY ITS CAP": "readings",
  "SET SHORT": "readings",
  "PROMOTION UNCONFIRMED": "starter-reads",
  "CHAIN AGAINST THE STARTER": "transfer",
  CHAIN: "climb",
  "AFTER THE PROMOTION": "epoch-spend",
  "SPEND LED BY A ROLE": "epoch-spend",
  "BILLING RESIDUAL": "epoch-spend",
  "MISSES AT A LIMIT": "execution",
  "WALL SHARE": "execution",
  "NON-RESULTS": "execution",
  "HOST LOADED": "execution",
  "LOAD MOVED": "execution",
  "HIGH TOOL ERROR RATE": "execution",
  "BUILDER COMPACTED": "continuity",
  "EXAMINER COMPACTED": "continuity",
  "SOLVER COMPACTED": "continuity",
  "INTERRUPTED HANDOVER": "continuity",
  "SESSION ENDED": "continuity",
  "EXAMINER ZERO YIELD": "aim",
  "FAMILY CONCENTRATION": "aim",
  "UNDERPOWERED NO-STEPS": "readings",
  "SERVED ANOTHER MODEL": "degradations",
  "HOST CODE MOVED": "source",
  LAUNCHES: "launches",
  "ENDED AND WENT ON": "launches",
  "DRAFT AUDITED": "draft-audit",
  "DRAFT AUDIT DEFECTS": "draft-audit",
  "DRAFT AUDIT REFUSED": "draft-audit",
  "DRAFT AUDIT SKIPPED": "draft-audit",
  "VERIFIER TOOL PROVENANCE": "grounding",
  "VERIFIER FAULTS": "grounding",
  "NETWORK PARITY MISMATCH": "wall-audit",
  "WALL BOUNDARY SIGNAL": "wall-audit",
  "SEAT BOUNDARY ANOMALY": "seats",
  "ROLE YIELD SKEW": "seats",
  "DRAFT RULE DROP": "gaming",
  "PRACTICE HILL-CLIMBING": "gaming",
  "SPECIFICATION GAMING LEAD": "gaming",
} satisfies Partial<Record<keyof typeof TRIGGERS, string>>;

export function stem(lane: number): string {
  return String(lane).padStart(2, "0");
}

export const reportPath = (out: string, lane: number) => join(out, "lanes", `${stem(lane)}-report.md`);

export function numbersOf(spec: string): number[] {
  return spec.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map(Number);
    if (from === undefined || to === undefined || !Number.isInteger(from) || !Number.isInteger(to)) {
      throw new Error(`--lanes ${spec}: ${part} is no lane or range of lanes`);
    }
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });
}

export function movedTo(log: string, held: readonly { name: string; path: string }[]): string {
  const name = basename(dirname(log));
  const run = held.find((each) => each.name === name);
  if (run === undefined) {
    throw new Error(`${log} is gone, and no worktree or archive holds a campaign ${name}`);
  }
  return run.path;
}

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

export const weightOf = (lanes: readonly Lane[]) => lanes.reduce((sum, lane) => sum + lane.importance, 0);
const heavierFirst = (one: readonly Lane[], other: readonly Lane[]) => weightOf(other) - weightOf(one);

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

export function blankSections(shared: string): string[] {
  const text = shared.replaceAll(/<!--[\s\S]*?-->/g, "");
  return [...text.matchAll(/^## (.+)$/gm)].flatMap(([, heading = ""]) =>
    section(text, heading) === "" ? [heading] : [],
  );
}

function tablesIn(text: string, want: Assigned["kind"]): Assigned[] {
  const cellsOf = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const found: Assigned[] = [];
  let head: { line: string; id: number; lanes: number; asked: number } | null = null;
  for (const line of text.split("\n")) {
    const cells = line.startsWith("|") ? cellsOf(line) : null;
    if (cells === null || head === null) {
      const [id = -1, lanes = -1, asked = -1] = ["id", "lanes", "question"].map(
        (name) => cells?.indexOf(name) ?? -1,
      );
      head = id >= 0 && lanes >= 0 ? { line, id, lanes, asked } : null;
      continue;
    }
    const kind = head.asked >= 0 ? QUESTION : PREDICTION;
    if (kind !== want) continue;
    const id = cells[head.id] ?? "";
    if (id === "" || /^[-: ]+$/u.test(id)) continue;
    const lanes = (cells[head.lanes] ?? "").split(",").map(Number);
    found.push({
      kind,
      id,
      lanes: lanes.filter((lane) => lane > 0),
      question: cells[head.asked] ?? "",
      head: head.line,
      row: line,
    });
  }
  return found;
}

function withoutSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const from = lines.indexOf(`## ${heading}`);
  if (from === -1) return markdown;
  const end = lines.slice(from + 1).findIndex((line) => line.startsWith("## "));
  return [...lines.slice(0, from), ...(end === -1 ? [] : lines.slice(from + 1 + end))].join("\n");
}

function assignedOf(shared: string): Assigned[] {
  const clean = shared.replaceAll(/<!--[\s\S]*?-->/g, "");
  return [
    ...tablesIn(withoutSection(clean, QUESTIONS_HEADING), PREDICTION),
    ...tablesIn(section(clean, QUESTIONS_HEADING), QUESTION),
  ];
}

const assignedTo = (lane: Lane, shared: string, kind: Assigned["kind"]) =>
  lane.isolated || lane.blind
    ? []
    : assignedOf(shared).filter((each) => each.kind === kind && each.lanes.includes(lane.number));

const ASKING = {
  [PREDICTION]: (one: boolean) => [
    "## Predictions this lane resolves",
    `The prior state assigns the ${one ? "prediction" : "predictions"} below to this lane. Recount each from the log regardless of other findings, and add one line per id under \`## Predictions\` in your report: \`${PREDICTION} <id>: <${RESOLUTIONS.join(" | ")}>\`, followed by two counts (how often the trigger occurred and how often the expected event followed). Mark a prediction \`not-observed\` if its trigger never occurred, and note explicitly when a mechanism ran without shifting any comparison reading. The collector rejects reports missing assigned predictions.`,
  ],
  [QUESTION]: (one: boolean) => [
    "## Operator questions this lane answers",
    `The operator asks the ${one ? "question" : "questions"} below of every investigation, and they fall to this lane. Answer each from the logs whatever else you find, and add one line per id under \`## Questions\` in your report: \`${QUESTION} <id>: <${QUESTION_VERDICTS.join(" | ")}>, <count, denominator, and file, command, or selector that prints it again>\`; detail may follow on later lines. Where these campaigns cannot show the answer, open with \`unmeasured\` and name the owed read. The collector rejects reports missing an assigned question or its status word.`,
  ],
} as const;

function asking(kind: Assigned["kind"], assigned: readonly Assigned[]): string[] {
  const [first] = assigned;
  if (first === undefined) return [];
  return [
    ...ASKING[kind](assigned.length === 1),
    [first.head, first.head.replaceAll(/[^|]+/g, " --- "), ...assigned.map(({ row }) => row)].join("\n"),
  ];
}

function opening(lane: Lane, report: string): string[] {
  return [
    "## Your report",
    `Write your report to \`${report}\`. Before you read anything for this lane, open it with the two lines below; then replace the second and append each finding as it settles, so a session that is stopped still leaves its work.`,
    ["```", `# Lane ${String(lane.number)}: ${lane.title}`, `Verdict: ${PENDING}`, "```"].join("\n"),
  ];
}

function form(
  heading: string,
  owners: readonly string[],
  names: readonly string[],
  lane: "open" | "alone",
): string[] {
  const open = lane === "open";
  return [
    [
      "```",
      heading,
      `Verdict: <${VERDICTS.join(" | ")}>, then one sentence`,
      "",
      "## Findings",
      "",
      "### <kind>: <one line naming the finding>",
      `Observation: <${CONFIRMED} | ${PLAUSIBLE}>, then what the log or the bytes show, cited by event kind, solve id, the first eight characters of a version or digest, check id and count, and last the command, or the file and line, that prints it again; plausible where you read a sample and nothing recounts it`,
      `Cause: <${CONFIRMED} | ${PLAUSIBLE}>, then what you infer, apart from the observation: why the owner let it through, at its file and line in the tree that ran where the owner is code or a prompt, and the count that parts it from the nearest other cause; plausible until that count is read, with what would settle it`,
      "Owner: exactly one owner",
      "Reverses if: the observation that would reverse the finding",
      "Decision: what it changes for the operator; a remedy only beside the count on record that it would have moved",
      `${SEEN} ${names.map((name) => `${name} <the log parts that show it, as slice.ts selectors such as comparison.reported{2} or Builder:b-1{4-7} | absent | cannot show>`).join("; ")}`,
      "",
      "## Checked",
      "With a verdict of no finding, which leaves Findings empty: what you checked and found sound, in sentences without the five fields",
      "",
      ...(open
        ? [
            "## Predictions",
            `${PREDICTION} <id>: <${RESOLUTIONS.join(" | ")}>, then how often its trigger occurred and how often its event followed; a line for each row the lane's prompt hands it, and no section where it hands none`,
            "",
            "## Questions",
            `${QUESTION} <id>: <${QUESTION_VERDICTS.join(" | ")}>, <count, denominator, and where it prints again>; a line for each operator question the lane's prompt hands it, and no section where it hands none`,
            "",
          ]
        : []),
      "## Not read",
      "What you could not read, and why.",
      "```",
    ].join("\n"),
    ...(open
      ? [
          "Where a lane's evidence leads past its question, follow it to the code or the text that let it through, and write what you find in that lane's report with the same fields. Where a lane matters less for these campaigns, at the point their logs have reached, than the other lanes your session was given, you may leave it unread: write only the heading and `Verdict: omitted`, then one sentence why (its question does not arise here, the primary's section already settles it, or another of your lanes covers it).",
        ]
      : []),
    "Each of the six fields starts a line of its own, as above: the collector counts them by the line's first word, and a finding written as one paragraph is refused.",
    "A heading's `<kind>` is one lowercase word naming the defect's class in your own terms (a misreading, a missing right, a leak, a reuse); the collector numbers each kind within the lane and cites the finding as `lane<N>-<kind><k>`. The `Seen in:` line names every campaign on that one line, `<campaign> <selector>` or `<campaign> absent: <why>`, separated by `;`. A selector points at the log part a reader opens to see the finding, so an Oracle handover prints it beside the finding.",
    `An owner is one of: ${owners.map((owner) => `\`${owner}\``).join(", ")}. Name the file beside \`host\` and a prompt owner.`,
    "You read and you report. Write no file but your report, and scratch in a temporary directory of your own, never under the campaign's folder or the checkout. Start no solve, no session, no round and no check run; `wri.ts grade` is the one exception, and only where your lane names it. Reply with the report's path and one line per finding.",
  ];
}

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

function climbSection(climb: string): string[] {
  return [
    "## The campaigns side by side",
    climb.trim() === ""
      ? "One campaign is under review: say which other campaign would settle what one cannot."
      : climb.trim(),
  ];
}

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
          ...asking(PREDICTION, assignedTo(lane, shared, PREDICTION)),
          ...asking(QUESTION, assignedTo(lane, shared, QUESTION)),
          "The report format, owner table, and omission criteria are in the shared instructions file.",
        ]),
  ].join("\n\n");
}

export function reportOf(
  lane: Lane,
  text: string | null,
  owners: readonly string[],
  names: readonly string[],
  shared = "",
): Report {
  if (text === null) {
    return {
      lane: lane.number,
      state: "missing",
      faults: [],
      verdict: null,
      written: [],
      resolved: {},
      answered: {},
    };
  }
  const lines = text.split("\n");
  const written = writtenIn(lines, lane.number);
  const verdictLine =
    lines
      .find((line) => line.startsWith("Verdict:"))
      ?.slice("Verdict:".length)
      .trim() ?? "";
  const verdict = VERDICTS.find((each) => verdictLine.startsWith(each)) ?? null;
  const unfinished = verdictLine.startsWith(PENDING)
    ? PENDING
    : ["provisional"].find((word) => verdictLine.includes(word));
  const resolved: Record<string, Resolution> = {};
  const answered: Record<string, QuestionAnswer> = {};
  for (const line of lines) {
    const [, kind, id = "", said = ""] = ASSIGNED_LINE.exec(line) ?? [];
    const how = said.trim();
    const direct = RESOLUTIONS.find((each) => how.startsWith(each));
    const synonym = [...RESOLUTION_SYNONYMS].find(([alias]) => how.startsWith(alias))?.[1];
    const resolution = direct ?? synonym;
    if (kind === PREDICTION && resolution !== undefined) resolved[id] = resolution;
    if (kind === QUESTION) {
      const match = QUESTION_VERDICT_LEAD.exec(plain(how));
      const word = match?.[1]?.toLowerCase();
      const verdictWord = QUESTION_VERDICTS.find((each) => each === word);
      if (verdictWord !== undefined && match?.[2]?.trim() !== "") {
        answered[id] = { verdict: verdictWord, text: how };
      }
    }
  }
  const owed = (kind: Assigned["kind"], done: Readonly<Record<string, Resolution | QuestionAnswer>>) =>
    verdict === "finding" || verdict === "no finding"
      ? assignedTo(lane, shared, kind).flatMap(({ id }) => (id in done ? [] : [id]))
      : [];
  const unresolved = owed(PREDICTION, resolved);
  const unanswered = owed(QUESTION, answered);
  const fields = names.length > 1 || lines.some((line) => line.startsWith(SEEN)) ? [...FIELDS, SEEN] : FIELDS;
  const counts = fields.map((field) => lines.filter((line) => line.startsWith(field)).length);
  const [findings = 0] = counts;
  const named = lines.flatMap((line) => (line.startsWith(OWNER) ? [line.slice(OWNER.length)] : []));
  const unowned = named.filter((line) => !owners.some((owner) => line.includes(owner))).length;
  // Each entry is a campaign's whole name and its triage: a name that holds another as a prefix must
  // not pass for it.
  const unseen = names.filter((name) =>
    lines.some(
      (line) =>
        line.startsWith(SEEN) &&
        !line
          .slice(SEEN.length)
          .split(/[,;](?![^{]*\})/u)
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
    // against and may not leave its lane unread.
    ...(verdict === "omitted" && lane.isolated ? ["an isolated lane may not be omitted"] : []),
    ...(unfinished === undefined ? [] : [`the verdict is ${unfinished}: the session is still writing`]),
    ...(unresolved.length > 0
      ? [
          `no \`${PREDICTION} <id>: ${RESOLUTIONS.join(" | ")}\` line for ${unresolved.join(", ")}, which the prior state hands this lane`,
        ]
      : []),
    ...(unanswered.length > 0
      ? [
          `no \`${QUESTION} <id>: <${QUESTION_VERDICTS.join(" | ")}>, <evidence>\` line for ${unanswered.join(", ")}, which the operator's questions hand this lane`,
        ]
      : []),
    // A report can say no finding over findings it wrote, which is refused rather than accepted.
    ...((verdict === "no finding" || verdict === "omitted") && findings > 0
      ? [`the verdict is ${verdict} and the report writes ${plural(findings, "finding")}`]
      : []),
    ...(unowned > 0
      ? [`${String(unowned)} of ${String(named.length)} owners are not in the owner table`]
      : []),
    ...(unseen.length > 0 && names.length > 1 ? [`a ${SEEN} line leaves out ${unseen.join(", ")}`] : []),
  ];
  const state = faults.length === 0 ? "ok" : "invalid";
  return { lane: lane.number, state, faults, verdict, written, resolved, answered };
}

function writtenIn(lines: readonly string[], lane: number): Written[] {
  const markOf = (fieldText: string) => {
    const word = firstWord(plain(fieldText));
    return word === CONFIRMED || word === PLAUSIBLE ? word : "unmarked";
  };
  const starts = lines.flatMap((line, at) => (line.startsWith(OBSERVATION) ? [at] : []));
  const kinds: string[] = [];
  return starts.map((at, index) => {
    const own = lines.slice(at, starts[index + 1]);
    const fieldValue = (field: string) =>
      own.find((line) => line.startsWith(field))?.slice(field.length) ?? "";
    const heading =
      lines.slice((starts[index - 1] ?? -1) + 1, at).findLast((line) => line.startsWith(TITLE)) ?? "";
    const [, named = "finding", title = heading.slice(TITLE.length)] =
      /^### ([a-z]+): (.*)$/iu.exec(heading) ?? [];
    const kind = named.toLowerCase();
    kinds.push(kind);
    return {
      id: `lane${String(lane)}-${kind}${String(kinds.filter((one) => one === kind).length)}`,
      title: title.trim(),
      owner: fieldValue(OWNER).trim(),
      observation: markOf(fieldValue(OBSERVATION)),
      cause: markOf(fieldValue(CAUSE)),
      seen: fieldValue(SEEN).trim(),
      decision: fieldValue(DECISION).trim(),
    };
  });
}

function questionLines(
  rows: readonly Assigned[],
  reports: readonly Report[],
  unframed: ReadonlySet<number>,
): string[] {
  const tally = { yes: 0, partial: 0, no: 0, unmeasured: 0, conflict: 0, incomplete: 0, unanswered: 0 };
  const okReports = reports.filter(({ state }) => state === "ok");
  const items = rows.flatMap(({ kind, id, lanes: named, question }) => {
    if (kind !== QUESTION) return [];
    const open = named.filter((lane) => !unframed.has(lane));
    if (open.length === 0) return [];
    const answers = okReports.flatMap(({ lane, answered }) => {
      const answer = answered[id];
      return answer === undefined ? [] : [{ lane, ...answer }];
    });
    const silent = open.filter((lane) =>
      reports.some((each) => each.lane === lane && (each.state !== "ok" || !(id in each.answered))),
    );
    const unopened = open.filter((lane) => !reports.some((each) => each.lane === lane));
    const verdicts = [...new Set(answers.map(({ verdict }) => verdict))];
    if (answers.length === 0) tally.unanswered += 1;
    else if (verdicts.length > 1) tally.conflict += 1;
    else if (silent.length > 0 || unopened.length > 0) tally.incomplete += 1;
    else if (verdicts[0] !== undefined) tally[verdicts[0]] += 1;
    const notes = [
      ...(verdicts.length > 1
        ? [`conflict: ${answers.map(({ lane, verdict }) => `lane ${String(lane)} ${verdict}`).join(" vs ")}`]
        : []),
      ...(silent.length === 0 ? [] : [`no line from lane ${silent.join(", ")}`]),
      ...(unopened.length === 0 ? [] : [`lane ${unopened.join(", ")} not opened`]),
    ];
    return [
      `- ${id}: ${question}${notes.length === 0 ? "" : ` (${notes.join("; ")})`}`,
      ...answers.map(({ lane, text }) => `  - lane ${String(lane)}: ${text}`),
    ];
  });
  if (items.length === 0) return [];
  const counts = [
    ...QUESTION_VERDICTS.map((v) => `${String(tally[v])} ${v}`),
    ...(tally.conflict > 0 ? [`${String(tally.conflict)} conflict`] : []),
    ...(tally.incomplete > 0 ? [`${String(tally.incomplete)} incomplete`] : []),
    `${String(tally.unanswered)} unanswered`,
  ].join(", ");
  return ["", `Each operator question, as the lanes answered it (Scorecard: ${counts}):`, "", ...items];
}

export function reportIndex(
  reports: readonly Report[],
  pathOf: (lane: number) => string,
  campaigns: readonly Campaign[],
  shared = "",
  unframed: ReadonlySet<number> = new Set(),
): string {
  const fired = new Set(campaigns.flatMap(({ overview }) => overview.triggers.map(({ lane }) => lane)));
  const lanes = reports.map(({ lane, state, verdict, faults, written }) => {
    const trigger = fired.has(lane) ? " although its trigger fired" : "";
    const read = verdict === "omitted" ? `omitted${trigger}` : verdict;
    const tail = state === "ok" ? `${read ?? ""}, ${plural(written.length, "finding")}` : faults.join("; ");
    return `- lane ${String(lane)}: ${state}${tail === "" ? "" : `, ${tail}`}, at \`${pathOf(lane)}\``;
  });
  const found = reports.flatMap(({ written }) =>
    written.map(({ id, owner, observation, cause, title, seen, decision }) =>
      [id, owner, observation, cause, title, seen, decision]
        .map((cell) => cell.replaceAll("|", "/"))
        .join(" | "),
    ),
  );
  const rows = assignedOf(shared);
  const predictions = rows.flatMap(({ kind, id, lanes: named }) => {
    if (kind !== PREDICTION) return [];
    const open = named.filter((lane) => !unframed.has(lane));
    if (open.length === 0) return [];
    const resolutionNotes = RESOLUTIONS.flatMap((how) => {
      const by = reports.filter(({ resolved }) => resolved[id] === how).map(({ lane }) => lane);
      return by.length === 0 ? [] : [`${how} by lane ${by.join(", ")}`];
    });
    const silent = open.filter((lane) => !reports.some((each) => each.lane === lane && id in each.resolved));
    return [
      `- ${id}: ${[...resolutionNotes, ...(silent.length === 0 ? [] : [`no line from lane ${silent.join(", ")}`])].join("; ")}`,
    ];
  });
  return [
    ...lanes,
    ...(found.length === 0 ? [] : ["", FINDINGS_HEAD, ...found.map((row) => `| ${row} |`)]),
    ...(predictions.length === 0
      ? []
      : ["", "Each prediction, as the lanes resolved it:", "", ...predictions]),
    ...questionLines(rows, reports, unframed),
  ].join("\n");
}

export function filled(template: string, values: Readonly<Record<string, string>>): string {
  const text = template.replaceAll(/<!--[\s\S]*?-->\n?/g, "");
  return text.replaceAll(/\{(\w+)\}/g, (slot, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`the template names ${slot}, which nothing fills`);
    return value;
  });
}
