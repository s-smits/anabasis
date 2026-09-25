/**
 * Every recorded census reading and not-slop answer in the session transcripts on this machine.
 *
 * The census history is spread over accounts: on 2026-09-24 the sessions that took it from 1992
 * findings to 0 were under `~/.claude-account3`, and a search of the other two accounts found only
 * readings of 0. So this reads every `~/.claude*` projects tree, subagent transcripts included,
 * and the Codex rollouts, and keys each reading by session and time rather than by account.
 *
 *   bun .claude/skills/simplify-precision/scripts/usage.mts [--since 2026-09-20] [--rows] [--answers]
 *
 * `--rows` adds each reading's shape counts; `--answers` lists every written not-slop answer.
 */

import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { basename, join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";

/** The census header, as `simplify-census.ts` prints it. */
const HEADER = /Simplify census — (\d+) findings? across (\d+) shapes/u;

/** One summary row under the `count  where  shape` line. */
const SUMMARY_ROW = /^\s+(\d+)\s{2}.+?\s{2}(\S+)$/u;

/** A written answer: `bun run not-slop -- answer <id> "<reason>"`. */
const ANSWER = /not-slop -- answer ([0-9a-f]{12}) (?:"([^"]*)"|'([^']*)')/gu;

interface Reading {
  session: string;
  time: string;
  findings: number;
  kinds: number;
  rows: string;
}

/** Every `.jsonl` under a directory, subagent directories included. */
function transcripts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return transcripts(path);
    return entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

/** Every string inside a parsed event: tool inputs and results nest at varying depths. */
function strings(value: JsonValue): string[] {
  if (isString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap((each) => strings(each));
  return Object.values(asRecord(value) ?? {}).flatMap((each) => strings(each));
}

/** The shape counts printed under a header, `shape=count` joined, or empty for a zero reading. */
function summaryRows(text: string): string {
  const lines = text.slice(text.search(HEADER)).split("\n").slice(1, 60);
  const rows: string[] = [];
  for (const line of lines) {
    const row = SUMMARY_ROW.exec(line);
    if (row !== null) rows.push(`${row[2]}=${row[1]}`);
    else if (rows.length > 0 && line.trim() === "") break;
  }
  return rows.join(" ");
}

function readFile(path: string, since: string) {
  const readings: Reading[] = [];
  const answers: string[] = [];
  const session = basename(path, ".jsonl").slice(0, 8);
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("Simplify census") && !line.includes("not-slop -- answer")) continue;
    const event = capturedJsonParse(line);
    const found = asRecord(event)?.timestamp;
    const time = isString(found) ? found.slice(0, 19) : "";
    if (time < since) continue;
    for (const text of strings(event)) {
      const header = HEADER.exec(text);
      if (header !== null) {
        readings.push({
          session,
          time,
          findings: Number(header[1]),
          kinds: Number(header[2]),
          rows: summaryRows(text),
        });
      }
      for (const answer of text.matchAll(ANSWER)) {
        answers.push(`${time}  ${session}  ${answer[1]}  ${answer[2] ?? answer[3] ?? ""}`);
      }
    }
  }
  return { readings, answers };
}

async function main(): Promise<void> {
  const parsed = parseOrDie(exitWith("usage"), { values: ["since"], flags: ["rows", "answers"] });
  const home = runtimeProcess.env.HOME ?? "";
  const accounts = readdirSync(home).filter((name) => name.startsWith(".claude"));
  const files = [
    ...accounts.flatMap((account) => transcripts(join(home, account, "projects"))),
    ...transcripts(join(home, ".codex", "sessions")),
  ];
  const read = files.map((file) => readFile(file, parsed.single.get("since") ?? ""));
  // A tool result is often recorded twice (the call's result and a progress echo), so a reading
  // is one per session, time and text.
  const readings = [
    ...new Map(
      read
        .flatMap((each) => each.readings)
        .map((reading) => [`${reading.session}${reading.time}${reading.rows}`, reading]),
    ).values(),
  ].sort((left, right) => left.time.localeCompare(right.time));
  const lines = readings.map(
    (reading) =>
      `${reading.time}  ${reading.session}  ${String(reading.findings).padStart(5)} in ${String(reading.kinds).padStart(2)} shapes${parsed.flags.has("rows") ? `  ${reading.rows}` : ""}`,
  );
  const answers = [...new Set(read.flatMap((each) => each.answers))].sort();
  await Bun.write(
    Bun.stdout,
    [
      `${readings.length} census readings in ${files.length} transcripts`,
      ...lines,
      ...(parsed.flags.has("answers") ? ["", `${answers.length} not-slop answers`, ...answers] : []),
      "",
    ].join("\n"),
  );
}

if (import.meta.main) await main();
