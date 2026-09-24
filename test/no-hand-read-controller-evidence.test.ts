/**
 * The rule that sends a skill script's reading of a run's opening and terminal to `openRecordedRun`
 * in `.claude/skills/main/run.ts`, whose reading is the controller's strict one.
 *
 * What reports is the path reaching a JSON read, whichever way the file name is spelled — the
 * literal, a local constant, or the constant `src/run/controller-lineage.ts` exports — so importing
 * the constant and joining it by hand is still a hand read. What passes is every use of the same
 * name that parses no field: an archive copying the bytes, a scan for `terminal.json.tmp-*`
 * orphans, an existence test, and the file named in a message.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines } from "./helpers/oxlint-rule-fixture.ts";

const SCRIPT = `
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { TERMINAL_FILE } from "#src/run/controller-lineage.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
const OPENING = "opening.json";
export const terminal = (dir) => readJsonFileOrNull(join(dir, "terminal.json")); // REPORT the literal, parsed
export const opening = (dir) => readJsonFileOrNull(join(dir, OPENING)); // REPORT a local constant, parsed
export const imported = (dir) => readJsonFileOrNull(join(dir, TERMINAL_FILE)); // REPORT the exported constant, joined by hand
export const parsed = (dir) => JSON.parse(readFileSync(join(dir, "opening.json"), "utf8")); // REPORT parsed from the bytes
export function bound(dir) {
  const path = join(dir, TERMINAL_FILE); // REPORT bound first, then parsed
  return existsSync(path) ? readJsonFileOrNull(path) : null;
}
export function forwarded(dir) {
  const readOptional = (path) => (existsSync(path) ? readJsonFileOrNull(path) : null);
  return readOptional(join(dir, OPENING)); // REPORT a local reader forwards to the JSON read
}
export const copied = (dir, out) => copyFileSync(join(dir, OPENING), join(out, "controller/opening.json")); // ADMITTED bytes, no field
export const archived = (add, dir) => add(join(dir, "terminal.json"), "controller/terminal.json"); // ADMITTED an archive entry
export const orphan = (name) => name.startsWith(\`\${TERMINAL_FILE}.tmp-\`); // ADMITTED a damaged file's prefix
export const present = (dir) => existsSync(join(dir, "terminal.json")); // ADMITTED discovery, not a read
export const label = (error) => new Error(\`terminal.json: \${error}\`); // ADMITTED names the file for a reader
`.trimStart();

describe("ana/no-hand-read-controller-evidence", () => {
  const reports = (at: string): number[] =>
    reportedLines("ana", "no-hand-read-controller-evidence", SCRIPT, at);

  it("reports every spelling of the path that reaches a JSON read, and admits every use that parses nothing", () => {
    const expected = expectedLines(SCRIPT);
    expect(expected).toHaveLength(6);
    expect(reports(".claude/skills/zip-run/scripts/example.mjs")).toStrictEqual(expected);
  });

  it("speaks to skill scripts only, and never to the owner or a skill's test", () => {
    expect(reports(".claude/skills/main/run.ts")).toStrictEqual([]);
    expect(reports(".claude/skills/zip-run/scripts/example.test.ts")).toStrictEqual([]);
    expect(reports("src/run/example.ts")).toStrictEqual([]);
  });
});
