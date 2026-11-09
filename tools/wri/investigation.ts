/**
 * What a whole-run investigation is made of once the log has been read: which lanes open, the
 * prompt each session is given, and whether a report has the shape the synthesis can use. Nothing
 * here touches a file; `tools/wri/wri.ts` does the reading and the writing.
 *
 * An open lane's prompt carries the shared instructions, the overview, the catalogue's stance, the
 * lane and the reporting rules. An isolated lane's carries the campaigns' rows, the hard rules, the
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
import { join } from "#src/meta/path.ts";
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
}

interface PromptParts {
  readonly lane: Lane;
  /** The shared instructions as the primary edited them. */
  readonly shared: string;
  readonly campaigns: readonly Campaign[];
  /** The whole catalogue, for its stance and its owner table. */
  readonly catalogue: string;
  readonly owners: readonly string[];
  /** Where the session writes its report. */
  readonly report: string;
  /** The campaigns' climbs side by side, for a lane that reads them; "" where one campaign is read. */
  readonly climb?: string;
}

const CAMPAIGN_HEADING = "Campaigns under review";
const RULES_HEADING = "Hard rules";
const VERDICTS = ["finding", "no finding", "could not read", "omitted"] as const;
const FIELDS = ["Observation:", "Cause:", "Owner:", "Reverses if:", "Decision:"] as const;
const SEEN = "Seen in:";

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

/**
 * Lanes packed into at most `count` sessions by label, a label never split. Each label, heaviest
 * first by the sum of its lanes' importance, joins the lightest session so far, so the sessions'
 * weights land near one another rather than equal. An isolated lane is a session of its own. The
 * operator asked for this on 1 November: four sessions of about eight lanes instead of one a lane.
 * Within a session the lanes run in number order, a blind lane first: on 7 November the blind
 * grading lane, read after three lanes of its session, said its grades were not blind.
 */
export function sessionsOf(lanes: readonly Lane[], count: number): Lane[][] {
  const open = lanes.filter((lane) => !lane.isolated);
  const labels = [...new Set(open.map((lane) => lane.label))]
    .map((label) => open.filter((lane) => lane.label === label))
    .toSorted((one, other) => weightOf(other) - weightOf(one));
  const sessions: Lane[][] = Array.from({ length: Math.min(count, labels.length) }, () => []);
  for (const label of labels) {
    sessions
      .reduce((lightest, each) => (weightOf(each) < weightOf(lightest) ? each : lightest))
      .push(...label);
  }
  return [
    ...sessions.map((each) =>
      each.toSorted((one, other) => Number(other.blind) - Number(one.blind) || one.number - other.number),
    ),
    ...lanes.filter((lane) => lane.isolated).map((lane) => [lane]),
  ];
}

/**
 * The most sessions the open lanes fill where the lightest weighs at least half the heaviest, so a
 * label of little importance joins another instead of taking a session to itself (operator,
 * 1 November). It is advice printed beside the build; the operator names the count.
 */
export function suggestedSessions(lanes: readonly Lane[]): number {
  const open = lanes.filter((lane) => !lane.isolated);
  const labels = new Set(open.map((lane) => lane.label)).size;
  const even = (count: number) => {
    const weights = sessionsOf(open, count).map(weightOf);
    return Math.min(...weights) >= Math.max(...weights) / 2;
  };
  return Array.from({ length: labels }, (_, index) => labels - index).find(even) ?? 1;
}

/** The `## ` sections of the shared instructions an author left blank. A comment is no text. */
export function blankSections(shared: string): string[] {
  const text = shared.replaceAll(/<!--[\s\S]*?-->/g, "");
  return [...text.matchAll(/^## (.+)$/gm)].flatMap(([, heading = ""]) =>
    section(text, heading) === "" ? [heading] : [],
  );
}

function reporting(lane: Lane, report: string, owners: readonly string[], names: readonly string[]): string {
  const several = names.length > 1;
  return [
    "## Your report",
    "",
    `Write your report to \`${report}\`. Write its first two lines before you read anything, and append each finding as it settles, so a session that is stopped still leaves its work.`,
    "",
    "```",
    `# Lane ${String(lane.number)}: ${lane.title}`,
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
    "## Not read",
    "What you could not read, and why.",
    "```",
    "",
    ...(lane.isolated
      ? []
      : [
          // The operator, 3 November 2026: a session should follow a problem where it leads and
          // write only the lanes that matter for these runs (`docs/backlog/wri-free-lanes.md`).
          "Where this lane's evidence leads past its question, follow it, and write what you find here with the same fields. Where this lane matters less for these campaigns, at the point their logs have reached, than the other lanes your session was given, you may leave it unread: write only the heading and `Verdict: omitted`, then one sentence why (its question does not arise here, the primary's section already settles it, or another of your lanes covers it).",
          "",
        ]),
    `Each of the ${several ? "six" : "five"} fields starts a line of its own, as above: the collector counts them by the line's first word, and a finding written as one paragraph is refused (abl175-new's lane 11, 13 October).`,
    "",
    `An owner is one of: ${owners.map((owner) => `\`${owner}\``).join(", ")}. Name the file beside \`host\` and a prompt owner.`,
    "",
    "You read and you report. Write no file but your report, and scratch in a temporary directory of your own, never under the campaign's folder or the checkout. Start no solve, no session, no round and no check run; `wri.ts grade` is the one exception, and only where your lane names it. Reply with the report's path and one line per finding.",
  ].join("\n");
}

/** Each campaign's rows and the triggers `pick` keeps, under its name where several are read. */
function holds(campaigns: readonly Campaign[], pick: (trigger: Trigger) => boolean): string {
  return campaigns
    .map(({ name, log, overview: { rows, triggers } }) => {
      const block = [
        "```",
        ...rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]),
        "",
        ...triggers
          .filter(pick)
          .map((trigger) => `${trigger.name} (lane ${String(trigger.lane)}): ${trigger.detail}`),
        "```",
      ].join("\n");
      return campaigns.length === 1 ? block : `### ${name}\n\nLog: \`${log}\`\n\n${block}`;
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
 * lane 14 on 11 October reported `NEVER CHECKED` false, which the reader had never fired.
 */
function firedLine(lane: Lane, campaigns: readonly Campaign[]): string {
  const names = Object.entries(TRIGGERS).flatMap(([name, number]) => (number === lane.number ? [name] : []));
  const list = (each: readonly string[]) => each.map((name) => `\`${name}\``).join(", ");
  const on = campaigns.flatMap(({ name, overview: { triggers } }) => {
    const fired = names.filter((each) => triggers.some((trigger) => trigger.name === each));
    return fired.length === 0 ? [] : [{ name, fired }];
  });
  const quiet = names.filter((each) => !on.some(({ fired }) => fired.includes(each)));
  const one = campaigns.length === 1;
  return [
    on.length === 0
      ? `None of these triggers fired on ${one ? "this campaign" : "any campaign under review"}: the lane is open because its question stands whenever a harness was compared.`
      : `Fired ${on.map(({ name, fired }) => `on ${one ? "this campaign" : `\`${name}\``}: ${list(fired)}`).join("; ")}, as "What the logs hold" prints them.`,
    ...(quiet.length === 0
      ? []
      : [`Not fired: ${list(quiet)}. Read each as the logs' silence on it, not as a lead.`]),
  ].join(" ");
}

/** One lane's prompt. */
export function lanePrompt({
  lane,
  shared,
  campaigns,
  catalogue,
  owners,
  report,
  climb = "",
}: PromptParts): string {
  const clean = shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim();
  const own = ["## What the logs hold", holds(campaigns, (trigger) => trigger.lane === lane.number)];
  const context =
    lane.isolated || lane.blind
      ? [
          `## ${CAMPAIGN_HEADING}`,
          section(clean, CAMPAIGN_HEADING),
          `## ${RULES_HEADING}`,
          section(clean, RULES_HEADING),
          ...(lane.blind ? [] : own),
        ]
      : [
          clean,
          "## What the logs hold",
          "The rows are the primary reviewer's and are settled. A trigger says a lane has something to read and never what the answer is.",
          holds(campaigns, () => true),
        ];
  const what = campaigns.length === 1 ? "an Anabasis campaign" : "several Anabasis campaigns";
  return [
    `# Lane ${String(lane.number)}: ${lane.title}`,
    lane.isolated
      ? `You are one session of a whole-run investigation of ${what}. Your lane runs alone: you are given no other lane's report and you open none.`
      : `You are one session of a whole-run investigation of ${what}. Other sessions read other lanes; you read yours.`,
    ...context,
    ...equalsSection(campaigns),
    "## Who holds which pen",
    section(catalogue, "Who holds which pen"),
    "## How the catalogue is read",
    section(catalogue, "How the catalogue is read"),
    "## Your lane",
    `**${String(lane.number)}. ${lane.title}.**`,
    lane.body,
    firedLine(lane, campaigns),
    ...(lane.sideBySide ? climbSection(climb) : []),
    reporting(
      lane,
      report,
      owners,
      campaigns.map(({ name }) => name),
    ),
  ].join("\n\n");
}

/**
 * Whether a report has the shape the synthesis reads. `text` is null where no file stands. Where
 * several campaigns are read, `names` lists them, and each finding's `Seen in:` line names them all.
 */
export function reportOf(
  lane: Lane,
  text: string | null,
  owners: readonly string[],
  names: readonly string[],
): Report {
  if (text === null) return { lane: lane.number, state: "missing", faults: [], verdict: null, findings: 0 };
  const lines = text.split("\n");
  const said =
    lines
      .find((line) => line.startsWith("Verdict:"))
      ?.slice("Verdict:".length)
      .trim() ?? "";
  const verdict = VERDICTS.find((each) => said.startsWith(each)) ?? null;
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
    ...(verdict === null ? [`no verdict among: ${VERDICTS.join(", ")}`] : []),
    ...(counts.some((count) => count !== findings)
      ? [
          `the findings are uneven: ${fields.map((field, index) => `${field} ${String(counts[index])}`).join(", ")}`,
        ]
      : []),
    ...(verdict === "finding" && findings === 0 ? ["the verdict is a finding and none is written"] : []),
    // An isolated lane is a session of its own with one lane, so it has no other lane to weigh
    // against and may not leave its lane unread (release review, 3 November).
    ...(verdict === "omitted" && lane.isolated ? ["an isolated lane may not be omitted"] : []),
    // A session writes its report early, as the hard rules ask; on 4 November buffer583's lane 32
    // stood as "could not read, provisional" and `collect` read it as a final verdict.
    ...(said.includes("provisional") ? ["the verdict is provisional: the session is still writing"] : []),
    // Recode's lane 15 on 10 October said no finding over two written findings, and was accepted.
    ...((verdict === "no finding" || verdict === "omitted") && findings > 0
      ? [`the verdict is ${verdict} and the report writes ${plural(findings, "finding")}`]
      : []),
    ...(unowned > 0
      ? [`${String(unowned)} of ${String(named.length)} owners are not in the owner table`]
      : []),
    ...(unseen.length > 0 && names.length > 1 ? [`a ${SEEN} line leaves out ${unseen.join(", ")}`] : []),
  ];
  return { lane: lane.number, state: faults.length === 0 ? "ok" : "invalid", faults, verdict, findings };
}

/**
 * The report index the synthesis is given, one line per lane. A lane a session left out while its
 * trigger fired on one of the `campaigns` says so, since that is the lane most likely missed.
 */
export function reportIndex(
  reports: readonly Report[],
  pathOf: (lane: number) => string,
  campaigns: readonly Campaign[],
): string {
  const fired = new Set(campaigns.flatMap(({ overview }) => overview.triggers.map(({ lane }) => lane)));
  return reports
    .map(({ lane, state, verdict, findings, faults }) => {
      const trigger = fired.has(lane) ? " although its trigger fired" : "";
      const read = verdict === "omitted" ? `omitted${trigger}` : verdict;
      const tail = state === "ok" ? `${read ?? ""}, ${plural(findings, "finding")}` : faults.join("; ");
      return `- lane ${String(lane)}: ${state}${tail === "" ? "" : `, ${tail}`}, at \`${pathOf(lane)}\``;
    })
    .join("\n");
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
