// Whether a run is about physical hardware, and which other runs asked the same thing on different
// source. A firmware request names its boards — "writes firmware for ESP32 and Raspberry Pi Pico" —
// and every check the Builder wrote for it observes some narrower scope than the board itself: a
// compile against the installed core, a host double of the board's library, at best a simulator.
// Nothing in the loop compares the verdict against what the board would do, so this reader names
// the boards from recorded bytes and starts the two lanes that do: lane 29 pairs the harness with
// what the real target requires, and lane 30 runs the accepted artifacts through a ground-truth
// instrument it can execute. No flag starts them; a truss request names no board and starts neither.
//
//   bun wri.ts target <target> [--reference <abs dir>] [--json]
//
// The request is the one-line prompt the run's observability journal records as its operator
// directive; the opening binds only its digest. The brief is the current epoch's
// `correctness-model/brief.json`, whose `domain` sentence is where a Builder restates the boards.
//
// Same-request runs are read from the campaign tree beside this one: every opening whose
// `project.requestDigest` matches and whose `source.commit` differs. The nearest on each side by
// opening instant is the pair a matched-elapsed-window comparison of the source delta starts from;
// this reader names them and compares nothing.
//
// `--reference` pins an external reference tree by its Git revision, or by its content digest when
// it is not a Git tree. A missing reference is a recorded gap, never a failure.
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { BRIEF_FILE } from "#src/meta/bundle-layout.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { readEpochRecord } from "#src/author/campaign-epoch.ts";
import { portableToolTreeDigest } from "#src/verify/tool-inventory.ts";
import { campaignRuns } from "#tools/runs/discover.ts";
import { gitMaybe, gitText } from "../../main/git.ts";
import { openRecordedRun } from "../../main/run.ts";
import { type DigestTrigger, readJsonAsOrNull } from "./run-overview.ts";

export const HARDWARE_TARGET_SCHEMA = "wri-hardware-target/v1";
export const HARDWARE_TRIGGER = "HARDWARE TARGET NAMED (lanes 29, 30)";

/**
 * The physical targets a request or brief may name, by family. One owner: the trigger, the lane 30
 * isolation gate and the tests all read this list. A pattern matches a board or MCU name, never a
 * framework alone, and is case-sensitive where the lowercase spelling is an ordinary word.
 */
export const HARDWARE_TARGETS: ReadonlyArray<{ family: string; patterns: readonly RegExp[] }> = [
  { family: "ESP32", patterns: [/\bESP32(?:-[A-Z0-9]+)*\b/i, /\bESP8266\b/i] },
  {
    family: "RP2040",
    patterns: [/\bRaspberry Pi Pico(?: 2)?(?: W)?\b/i, /\bRP2(?:040|350)\b/i, /\bPico(?: 2)?(?: W)?\b/],
  },
  { family: "Raspberry Pi", patterns: [/\bRaspberry Pi (?:Zero(?: 2)?(?: W)?|[345](?: Model B)?)\b/i] },
  { family: "STM32", patterns: [/\bSTM32[A-Z0-9]*\b/i, /\b(?:Nucleo|Blue ?Pill|Black ?Pill)\b/i] },
  {
    family: "AVR",
    patterns: [
      /\bArduino (?:Uno|Nano(?: Every| 33 \w+)?|Mega(?: 2560)?|Leonardo|Micro|Due|Zero)\b/i,
      /\bAT(?:mega|tiny)\d+\w*\b/i,
      /\bAVR\b/,
    ],
  },
  { family: "nRF", patterns: [/\bnRF(?:51|52|53|54|91)\d*\b/i, /\bmicro:bit\b/i] },
  { family: "SAMD", patterns: [/\bSAM[DE]\d+\w*\b/i] },
  { family: "Teensy", patterns: [/\bTeensy(?: ?\d(?:\.\d)?)?\b/i] },
  { family: "MSP430", patterns: [/\bMSP430\w*\b/i] },
  { family: "PIC", patterns: [/\bPIC(?:1[0-8]|24|32)\w*\b/i] },
];

export interface NamedTarget {
  family: string;
  text: string;
  where: "request" | "brief";
}

export interface SameRequestRun {
  campaign: string;
  runId: string;
  commit: string;
  openedAt: string;
}

export interface ReferenceIdentity {
  root: string;
  state: "git" | "content" | "missing";
  revision: string | null;
  dirty: boolean | null;
  contentDigest: string | null;
}

export interface HardwareTargetReport {
  schema: typeof HARDWARE_TARGET_SCHEMA;
  campaign: string;
  runId: string;
  request: string | null;
  requestDigest: string | null;
  commit: string | null;
  named: NamedTarget[];
  sameRequest: SameRequestRun[];
  nearest: { before: SameRequestRun | null; after: SameRequestRun | null };
  reference: ReferenceIdentity | null;
  triggers: DigestTrigger[];
}

export interface HardwareTargetInput {
  campaign: string;
  runId: string;
  reference?: string | null;
}

/** What this reader pairs runs on, from one run's opening. */
interface OpeningFacts {
  requestDigest: string | null;
  commit: string;
  openedAt: string | null;
}

/** Every target family the text names, with the spelling it used, first match per family. */
export function targetsIn(text: string, where: NamedTarget["where"]): NamedTarget[] {
  const named: NamedTarget[] = [];
  for (const { family, patterns } of HARDWARE_TARGETS) {
    const hits = patterns.flatMap((pattern) => {
      const match = pattern.exec(text);
      return match === null ? [] : [{ at: match.index, text: match[0] }];
    });
    const first = hits.sort((left, right) => left.at - right.at)[0];
    if (first !== undefined) named.push({ family, text: first.text, where });
  }
  return named;
}

/** The one-line prompt the run's journal records as its operator directive, or null. */
export function recordedRequest(campaign: string, runId: string): string | null {
  const path = join(campaign, "observability", `${runId}.jsonl`);
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"user-directive"')) continue;
    const row = directiveRow(line);
    if (row?.type === "prompt-ingested" && row.role === "user-directive" && isString(row.prompt)) {
      return row.prompt;
    }
  }
  return null;
}

/** One journal line as far as this reader reads it, or null for a torn line. */
function directiveRow(line: string): { type?: unknown; role?: unknown; prompt?: unknown } | null {
  try {
    return parseJsonAs<{ type?: unknown; role?: unknown; prompt?: unknown } | null>(line);
  } catch {
    return null;
  }
}

/** The current epoch's brief `domain` sentence, or null when no epoch or brief is recorded. */
function briefDomain(campaign: string): string | null {
  const current = readEpochRecord(campaign)?.current;
  if (!isString(current)) return null;
  const brief = readJsonAsOrNull<{ domain?: unknown } | null>(
    join(campaign, current, "workspace", BRIEF_FILE),
  );
  return isString(brief?.domain) ? brief.domain : null;
}

/** The targets the request and the brief name, request first, each family once. */
export function namedTargets(campaign: string, runId: string): NamedTarget[] {
  const request = recordedRequest(campaign, runId);
  const domain = briefDomain(campaign);
  const named = [
    ...(request === null ? [] : targetsIn(request, "request")),
    ...(domain === null ? [] : targetsIn(domain, "brief")),
  ];
  return named.filter((row, index) => named.findIndex((other) => other.family === row.family) === index);
}

/** The run's opening through the strict recorded-run reader, or null for a run it refuses, so one
 *  damaged sibling costs its own row and not the whole scan. */
function openingFacts(campaign: string, runId: string): OpeningFacts | null {
  try {
    const { opening, source } = openRecordedRun(campaign, runId);
    const project = isRecord(opening.project) ? opening.project : {};
    return {
      requestDigest: isString(project.requestDigest) ? project.requestDigest : null,
      commit: source.commit,
      openedAt: isString(opening.writtenAt) ? opening.writtenAt : null,
    };
  } catch {
    return null;
  }
}

/** Every run in the campaign tree beside `campaign` that asked the same request on other source,
 *  oldest first by opening instant. */
export function sameRequestRuns(campaign: string, requestDigest: string, commit: string): SameRequestRun[] {
  const root = dirname(campaign);
  const rows: SameRequestRun[] = [];
  for (const slug of readdirSync(root)) {
    for (const run of campaignRuns(join(root, slug))) {
      const other = openingFacts(run.campaignDir, run.runId);
      if (other?.requestDigest !== requestDigest || other.commit === commit || other.openedAt === null) {
        continue;
      }
      rows.push({
        campaign: run.campaignDir,
        runId: run.runId,
        commit: other.commit,
        openedAt: other.openedAt,
      });
    }
  }
  return rows.sort((left, right) => left.openedAt.localeCompare(right.openedAt));
}

/** The reference tree's identity: its Git revision and dirt, or a content digest when it is no
 *  Git tree, or `missing`. */
export function referenceIdentity(root: string): ReferenceIdentity {
  const blank = { root, revision: null, dirty: null, contentDigest: null };
  if (!existsSync(root)) return { ...blank, state: "missing" };
  const revision = existsSync(join(root, ".git")) ? gitMaybe(root, "rev-parse", "HEAD") : null;
  if (revision !== null) {
    return { ...blank, state: "git", revision, dirty: gitText(root, "status", "--porcelain") !== "" };
  }
  return { ...blank, state: "content", contentDigest: portableToolTreeDigest(root) };
}

function runLabel(run: SameRequestRun): string {
  return `${run.campaign.split("/").at(-1)}/${run.runId} on ${run.commit.slice(0, 9)}`;
}

function triggersOf(report: Omit<HardwareTargetReport, "triggers">): DigestTrigger[] {
  if (report.named.length === 0) return [];
  const where = [...new Set(report.named.map((row) => row.where))].join(" and ");
  const { before, after } = report.nearest;
  const pair = [
    ...(before === null ? [] : [`before ${runLabel(before)}`]),
    ...(after === null ? [] : [`after ${runLabel(after)}`]),
  ];
  const commits = new Set(report.sameRequest.map((run) => run.commit)).size;
  const sibling =
    report.sameRequest.length === 0
      ? "; no other run asked this request on other source"
      : `; same request on other source: ${pair.join(", ")} (${report.sameRequest.length} run(s) on ${commits} other commit(s))`;
  return [
    {
      name: HARDWARE_TRIGGER,
      rows: report.named.length,
      examples: [`${report.named.map((row) => row.text).join(", ")} named in the ${where}${sibling}`],
    },
  ];
}

export function buildHardwareTarget({
  campaign,
  runId,
  reference = null,
}: HardwareTargetInput): HardwareTargetReport {
  const recorded = openingFacts(campaign, runId);
  const requestDigest = recorded?.requestDigest ?? null;
  const commit = recorded?.commit ?? null;
  const openedAt = recorded?.openedAt ?? null;
  const sameRequest =
    requestDigest === null || commit === null ? [] : sameRequestRuns(campaign, requestDigest, commit);
  const earlier = openedAt === null ? [] : sameRequest.filter((run) => run.openedAt < openedAt);
  const later = openedAt === null ? [] : sameRequest.filter((run) => run.openedAt > openedAt);
  const base: Omit<HardwareTargetReport, "triggers"> = {
    schema: HARDWARE_TARGET_SCHEMA,
    campaign,
    runId,
    request: recordedRequest(campaign, runId),
    requestDigest,
    commit,
    named: namedTargets(campaign, runId),
    sameRequest,
    nearest: { before: earlier.at(-1) ?? null, after: later[0] ?? null },
    reference: reference === null ? null : referenceIdentity(reference),
  };
  return { ...base, triggers: triggersOf(base) };
}

function referenceLine(reference: ReferenceIdentity | null): string {
  if (reference === null) {
    return "reference: none pinned (--reference <abs dir> pins one); lane 29 names public authorities";
  }
  if (reference.state === "missing") {
    return `reference: ${reference.root} is absent — a recorded gap, not a failure`;
  }
  if (reference.state === "git") {
    return `reference: ${reference.root} at ${reference.revision}${reference.dirty === true ? " (dirty)" : ""}`;
  }
  return `reference: ${reference.root}, not a Git tree, content ${reference.contentDigest}`;
}

export function renderHardwareTarget(report: HardwareTargetReport): string {
  const named =
    report.named.length === 0
      ? ["  neither the request nor the brief names a hardware target; lanes 29 and 30 have nothing to read"]
      : report.named.map((row) => `  ${row.family.padEnd(13)}"${row.text}" in the ${row.where}`);
  return [
    `${report.runId}: request ${report.request === null ? "not recorded" : JSON.stringify(report.request)}`,
    ...named,
    `same request ${report.requestDigest?.slice(0, 12) ?? "?"} on other source: ${report.sameRequest.length} run(s)`,
    ...report.sameRequest.map((run) => `  ${run.openedAt}  ${runLabel(run)}`),
    referenceLine(report.reference),
    ...report.triggers.map((row) => `  ${row.name}: ${row.examples[0]}`),
  ].join("\n");
}
