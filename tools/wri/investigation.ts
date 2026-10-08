/**
 * What a whole-run investigation is made of once the log has been read: which lanes open, the
 * prompt each session is given, and whether a report has the shape the synthesis can use. Nothing
 * here touches a file; `tools/wri/wri.ts` does the reading and the writing.
 *
 * An open lane's prompt carries the shared instructions, the overview, the catalogue's stance, the
 * lane and the reporting rules. An isolated lane's carries the campaign's row, the hard rules, the
 * deterministic rows, its own triggers, the lane and the reporting rules: it is told neither the
 * operator's question nor what any other lane was started by, because it freezes its result before
 * it reads anything that could lead it.
 */
import { plural } from "#src/meta/text.ts";
import { type Lane, section } from "./catalogue.ts";
import type { Overview, Trigger } from "./read.ts";

export interface Selection {
  /** Lanes that open together, each with the shared instructions. */
  readonly open: readonly Lane[];
  /** Lanes that run alone. */
  readonly isolated: readonly Lane[];
  /** Isolated lanes whose trigger fired and which were not asked for: each waits on another lane. */
  readonly waiting: readonly Lane[];
}

export interface Report {
  readonly lane: number;
  readonly state: "ok" | "missing" | "invalid";
  readonly faults: readonly string[];
  readonly verdict: string | null;
  readonly findings: number;
}

export interface PromptParts {
  readonly lane: Lane;
  /** The shared instructions as the primary edited them. */
  readonly shared: string;
  readonly overview: Overview;
  /** The whole catalogue, for its stance and its owner table. */
  readonly catalogue: string;
  readonly owners: readonly string[];
  /** Where the session writes its report. */
  readonly report: string;
}

export const CAMPAIGN_HEADING = "Campaign under review";
export const RULES_HEADING = "Hard rules";
export const VERDICTS = ["finding", "no finding", "could not read"] as const;
const FIELDS = ["Observation:", "Cause:", "Owner:", "Reverses if:", "Decision:"] as const;

/** A lane's file stem: `07` for lane 7. */
export function stem(lane: number): string {
  return String(lane).padStart(2, "0");
}

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

/** The `## ` sections of the shared instructions an author left blank. A comment is no text. */
export function blankSections(shared: string): string[] {
  const text = shared.replaceAll(/<!--[\s\S]*?-->/g, "");
  return [...text.matchAll(/^## (.+)$/gm)].flatMap(([, heading = ""]) =>
    section(text, heading) === "" ? [heading] : [],
  );
}

function reporting(lane: Lane, report: string, owners: readonly string[]): string {
  return [
    "## Your report",
    "",
    `Write your report to \`${report}\`. Write its first two lines before you read anything, and append each finding as it settles, so a session that is stopped still leaves its work.`,
    "",
    "```",
    `# Lane ${String(lane.number)}: ${lane.title}`,
    "Verdict: <finding | no finding | could not read>, then one sentence",
    "",
    "## Findings",
    "",
    "### <one line naming the finding>",
    "Observation: what the log or the bytes show, cited by event kind, solve id, the first eight characters of a version or digest, check id and count",
    "Cause: what you infer from it, apart from the observation",
    "Owner: exactly one owner",
    "Reverses if: the observation that would reverse the finding",
    "Decision: what it changes for the operator",
    "",
    "## Not read",
    "What you could not read, and why.",
    "```",
    "",
    `An owner is one of: ${owners.map((owner) => `\`${owner}\``).join(", ")}. Name the file beside \`host\` and a prompt owner.`,
    "",
    "You read and you report. Write no file but your report, and scratch in a temporary directory of your own, never under the campaign's folder or the checkout. Start no solve, no session, no round and no check run; `wri.ts grade` is the one exception, and only where your lane names it. Reply with the report's path and one line per finding.",
  ].join("\n");
}

function triggerLines(triggers: readonly Trigger[]): string[] {
  return triggers.map((trigger) => `${trigger.name} (lane ${String(trigger.lane)}): ${trigger.detail}`);
}

function rowLines({ rows }: Overview): string[] {
  return rows.flatMap((row) => [`${row.id}. ${row.title}`, ...row.lines.map((line) => `   ${line}`)]);
}

/** One lane's prompt. */
export function lanePrompt({ lane, shared, overview, catalogue, owners, report }: PromptParts): string {
  const clean = shared.replaceAll(/<!--[\s\S]*?-->\n?/g, "").trim();
  const own = overview.triggers.filter((trigger) => trigger.lane === lane.number);
  const context = lane.isolated
    ? [
        `## ${CAMPAIGN_HEADING}`,
        section(clean, CAMPAIGN_HEADING),
        `## ${RULES_HEADING}`,
        section(clean, RULES_HEADING),
        "## What the log holds",
        ["```", ...rowLines(overview), "", ...triggerLines(own), "```"].join("\n"),
      ]
    : [
        clean,
        "## What the log holds",
        "The rows are the primary reviewer's and are settled. A trigger says a lane has something to read and never what the answer is.",
        ["```", ...rowLines(overview), "", ...triggerLines(overview.triggers), "```"].join("\n"),
      ];
  return [
    `# Lane ${String(lane.number)}: ${lane.title}`,
    lane.isolated
      ? "You are one session of a whole-run investigation of an Anabasis campaign. Your lane runs alone: you are given no other lane's report and you open none."
      : "You are one session of a whole-run investigation of an Anabasis campaign. Other sessions read other lanes; you read yours.",
    ...context,
    "## Who holds which pen",
    section(catalogue, "Who holds which pen"),
    "## How the catalogue is read",
    section(catalogue, "How the catalogue is read"),
    "## Your lane",
    `**${String(lane.number)}. ${lane.title}.**`,
    lane.body,
    reporting(lane, report, owners),
  ].join("\n\n");
}

/** Whether a report has the shape the synthesis reads. `text` is null where no file stands. */
export function reportOf(lane: Lane, text: string | null, owners: readonly string[]): Report {
  if (text === null) return { lane: lane.number, state: "missing", faults: [], verdict: null, findings: 0 };
  const lines = text.split("\n");
  const said =
    lines
      .find((line) => line.startsWith("Verdict:"))
      ?.slice("Verdict:".length)
      .trim() ?? "";
  const verdict = VERDICTS.find((each) => said.startsWith(each)) ?? null;
  const counts = FIELDS.map((field) => lines.filter((line) => line.startsWith(field)).length);
  const [findings = 0] = counts;
  const named = lines.flatMap((line) => (line.startsWith("Owner:") ? [line.slice("Owner:".length)] : []));
  const unowned = named.filter((line) => !owners.some((owner) => line.includes(owner))).length;
  const faults = [
    ...(lines[0]?.startsWith(`# Lane ${String(lane.number)}:`) === true
      ? []
      : ["the first line does not name the lane"]),
    ...(verdict === null ? [`no verdict among: ${VERDICTS.join(", ")}`] : []),
    ...(counts.some((count) => count !== findings)
      ? [
          `the findings are uneven: ${FIELDS.map((field, index) => `${field} ${String(counts[index])}`).join(", ")}`,
        ]
      : []),
    ...(verdict === "finding" && findings === 0 ? ["the verdict is a finding and none is written"] : []),
    ...(unowned > 0
      ? [`${String(unowned)} of ${String(named.length)} owners are not in the owner table`]
      : []),
  ];
  return { lane: lane.number, state: faults.length === 0 ? "ok" : "invalid", faults, verdict, findings };
}

/** The report index the synthesis is given, one line per lane. */
export function reportIndex(reports: readonly Report[], pathOf: (lane: number) => string): string {
  return reports
    .map(({ lane, state, verdict, findings, faults }) => {
      const tail = state === "ok" ? `${verdict ?? ""}, ${plural(findings, "finding")}` : faults.join("; ");
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
