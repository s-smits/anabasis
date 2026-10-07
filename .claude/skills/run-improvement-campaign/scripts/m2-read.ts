#!/usr/bin/env bun

/**
 * M2's reads: each packet `m2-packets.ts` wrote goes to a reader with no tools at all, three times,
 * and the majority label becomes the case's label in `labels.jsonl`, the file the outcome join
 * reads (`{"caseKey", "label"}` per line). A label the record decided needs no read and is copied
 * across, so every case the packet step listed has exactly one line.
 *
 * The reader is `claude -p` with every built-in tool disabled, no MCP server, no session kept, safe
 * mode on and an empty working directory, and the packet on stdin. It cannot open a file, so it
 * cannot see which arm a case came from. Each read's own transcript is checked rather than
 * trusted: a read counts only when the session offered nothing but the structured-output tool,
 * called nothing else, and every message came from the model asked for. Fewer than two thirds of
 * the replicates agreeing gives `unclassified`. Reads, their agreement and their reasons go to
 * `reads.jsonl` beside the labels, never into them, and identical packets share their reads, so a
 * case graded again in a later battery is read once.
 *
 *   bun m2-read.ts --dir <abs m2 dir> [--reads 3] [--parallel 8] [--model claude-opus-5-5]
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { tmpdir } from "#src/meta/os.ts";
import { sha256 } from "#src/meta/digest.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import type { CaseRow, M2Label } from "./m2-packets.ts";

/** One reader's answer, with what its transcript showed. A read that failed carries `error`. */
export interface ReadResult {
  label: ReaderLabel | null;
  decidingCheck: string | null;
  reason: string | null;
  models: string[];
  tools: string[];
  error: string | null;
}

export type ReaderLabel = Exclude<M2Label, "wall-ended">;

/** A case's label from its reads, and the share of the replicates asked for that agreed on it. */
export interface Aggregate {
  label: M2Label;
  agreement: number;
}

export interface LabelLine {
  caseKey: string;
  label: M2Label;
}

const READER_LABELS: readonly ReaderLabel[] = ["limit", "check-defect", "under-specified", "unclassified"];
const ALL_LABELS: ReadonlySet<string> = new Set<M2Label>([...READER_LABELS, "wall-ended"]);
const STRUCTURED_OUTPUT = "StructuredOutput";
const DEFAULT_MODEL = "claude-opus-5-5";
const READ_TIMEOUT_MS = 15 * 60 * 1000;
const PROMPT_FILE = join(import.meta.dir, "..", "references", "m2-reader.md");
const LABEL_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", enum: READER_LABELS },
    decidingCheck: { type: "string" },
    reason: { type: "string" },
  },
  required: ["label", "decidingCheck", "reason"],
  additionalProperties: false,
};

const USAGE = `usage: m2-read.ts --dir <abs m2 dir> [--reads 3] [--parallel 8] [--model ${DEFAULT_MODEL}]

Reads <dir>/m2-cases.jsonl and <dir>/packets/, makes --reads tool-less reads of each packet,
and writes <dir>/reads.jsonl and <dir>/labels.jsonl. Reads are cached by packet digest under
<dir>/read-cache/, so a rerun pays only for packets it has not read.`;

/** The label of `reads`: one that at least two thirds of the `replicates` asked for agree on, else
 *  `unclassified`. A failed read counts against agreement, never for a label. */
export function aggregate(reads: readonly ReadResult[], replicates: number): Aggregate {
  const counts = Map.groupBy(
    reads.flatMap((read) => (read.label === null ? [] : [read.label])),
    (label) => label,
  );
  const [label, votes] = [...counts].reduce<[ReaderLabel | null, number]>(
    (best, [candidate, group]) => (group.length > best[1] ? [candidate, group.length] : best),
    [null, 0],
  );
  const agreement = replicates === 0 ? 0 : votes / replicates;
  return { label: label !== null && votes * 3 >= replicates * 2 ? label : "unclassified", agreement };
}

/** One read out of its stream-json transcript, refused unless the session offered and called the
 *  structured-output tool alone and every message came from `model`. */
export function readOfTranscript(lines: readonly string[], model: string): ReadResult {
  const events = lines.flatMap((line) => {
    const event = line.trim() === "" ? null : capturedJsonParse(line);
    return isRecord(event) ? [event] : [];
  });
  const ofType = (type: string) => events.filter((event) => event.type === type);
  const messages = ofType("assistant").flatMap((event) => (isRecord(event.message) ? [event.message] : []));
  const results = ofType("result");
  const models = new Set([
    ...ofType("system").flatMap((event) => (isString(event.model) ? [event.model] : [])),
    ...messages.flatMap((message) => (isString(message.model) ? [message.model] : [])),
    ...results.flatMap((event) => Object.keys(isRecord(event.modelUsage) ? event.modelUsage : {})),
  ]);
  // A tool name that is not a string is still a tool, and refuses the read like any other.
  const tools = new Set(
    [
      ...ofType("system").flatMap((event) => (Array.isArray(event.tools) ? event.tools : [])),
      ...messages
        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
        .flatMap((block) => (isRecord(block) && block.type === "tool_use" ? [block.name] : [])),
    ].map((tool) => (isString(tool) ? tool : (capturedJsonStringify(tool) ?? "an unnamed tool"))),
  );
  const output = results.at(-1)?.structured_output ?? null;
  const byText = (a: string, b: string) => a.localeCompare(b);
  const seen = { models: [...models].toSorted(byText), tools: [...tools].toSorted(byText) };
  const refusal = seen.tools.some((tool) => tool !== STRUCTURED_OUTPUT)
    ? `tools other than ${STRUCTURED_OUTPUT} were offered or called`
    : seen.models.some((name) => name !== model) || seen.models.length === 0
      ? `the transcript names models ${seen.models.join(", ") || "none"}, not ${model}`
      : null;
  const answer = isRecord(output) ? output : {};
  const label = READER_LABELS.find((candidate) => candidate === answer.label) ?? null;
  const error = refusal ?? (label === null ? "no structured label in the result" : null);
  return {
    label: error === null ? label : null,
    decidingCheck: isString(answer.decidingCheck) ? answer.decidingCheck : null,
    reason: isString(answer.reason) ? answer.reason : null,
    ...seen,
    error,
  };
}

/** One tool-less read of `packet`, in an empty directory so no project file loads. */
async function readOnce(packet: string, prompt: string, model: string): Promise<ReadResult> {
  const cwd = mkdtempSync(join(tmpdir(), "ana-m2-read-"));
  const child = Bun.spawn(
    [
      "claude",
      "-p",
      "--safe-mode",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--model",
      model,
      "--system-prompt",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      capturedJsonStringify(LABEL_SCHEMA),
    ],
    {
      cwd,
      stdin: new TextEncoder().encode(packet),
      stdout: "pipe",
      stderr: "pipe",
      timeout: READ_TIMEOUT_MS,
    },
  );
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  const read = readOfTranscript(stdout.split("\n"), model);
  return code === 0 ? read : { ...read, label: null, error: read.error ?? `reader exited ${code}` };
}

/** The label file's text: one `{"caseKey","label"}` line per case. */
export function labelLines(lines: readonly LabelLine[]): string {
  return lines.map(({ caseKey, label }) => `${capturedJsonStringify({ caseKey, label })}\n`).join("");
}

/** Parse a label file, refusing an unknown label or a case keyed twice. */
export function parseLabels(text: string): Map<string, M2Label> {
  const labels = new Map<string, M2Label>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = parseJsonAs<Partial<LabelLine>>(line);
    if (!isString(row.caseKey) || !isString(row.label) || !ALL_LABELS.has(row.label)) {
      throw new Error(`label line is not {"caseKey","label"} with a known label: ${line}`);
    }
    if (labels.has(row.caseKey)) throw new Error(`case ${row.caseKey} is labelled twice`);
    labels.set(row.caseKey, row.label);
  }
  return labels;
}

async function eachInParallel<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, width) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

async function main(args: CommandArgs): Promise<void> {
  const dir = args.required("dir");
  const replicates = args.int("reads") ?? 3;
  const model = args.value("model") ?? DEFAULT_MODEL;
  const prompt = readFileSync(PROMPT_FILE, "utf8");
  const rows = readFileSync(join(dir, "m2-cases.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parseJsonAs<CaseRow>(line));
  const cache = join(dir, "read-cache");
  mkdirSync(cache, { recursive: true });
  const toRead = rows.flatMap((row) => (row.packet === null ? [] : [row.packet]));
  await eachInParallel([...new Set(toRead)], args.int("parallel") ?? 8, async (relative) => {
    const packet = readFileSync(join(dir, relative), "utf8");
    const cached = join(cache, `${sha256(packet + prompt)}.json`);
    const kept = existsSync(cached) ? parseJsonAs<ReadResult[]>(readFileSync(cached, "utf8")) : [];
    const good = kept.filter((read) => read.error === null);
    const fresh = await Promise.all(
      Array.from({ length: Math.max(0, replicates - good.length) }, () => readOnce(packet, prompt, model)),
    );
    writeFileSync(cached, capturedJsonStringify([...good, ...fresh]));
  });
  const reads = rows.map((row) => {
    if (row.packet === null) {
      return { caseKey: row.caseKey, label: row.deterministic ?? "unclassified", reads: [] };
    }
    const packet = readFileSync(join(dir, row.packet), "utf8");
    const all = parseJsonAs<ReadResult[]>(
      readFileSync(join(cache, `${sha256(packet + prompt)}.json`), "utf8"),
    );
    const ok = all.filter((read) => read.error === null).slice(0, replicates);
    return { caseKey: row.caseKey, packetDigest: sha256(packet), ...aggregate(ok, replicates), reads: all };
  });
  writeFileSync(join(dir, "reads.jsonl"), reads.map((row) => `${capturedJsonStringify(row)}\n`).join(""));
  writeFileSync(join(dir, "labels.jsonl"), labelLines(reads));
  const failed = reads.flatMap((row) => row.reads).filter((read) => read.error !== null);
  console.log(
    `${reads.length} cases labelled, ${failed.length} reads refused or failed (see ${dirname(cache)}/reads.jsonl)`,
  );
}

if (import.meta.main) {
  await runCommand(
    {
      name: "m2-read.ts",
      usage: USAGE,
      options: { dir: "abs", reads: "int", parallel: "int", model: "text" },
    },
    main,
  );
}
