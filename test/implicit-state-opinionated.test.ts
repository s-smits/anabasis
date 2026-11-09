/**
 * The opinionated implicit-state tier: the plugin `implicit-state-opinionated`
 * (`name-encoded-state`, `state-file-overwrite`) and the cross-file kind `unowned-state-literal` of
 * `tools/oxlint/tree-implicit-state.ts`. Every fixture is a small foreign program, a preview
 * deployer and a job store, and each rule's nearest hostile case sits beside the shape it reports:
 * an extension capture, a predicate with no capture and a log line beside a parsed name; an append
 * and plain text beside a rewritten record; a declared union beside the same literals declared
 * nowhere.
 */
import { describe, expect, it } from "bun:test";
import { implicitStateFindings } from "../tools/oxlint/tree-implicit-state.ts";
import { lintRules } from "./helpers/lint-rule.ts";

const NAMES = `import { basename } from "node:path";
const PULL = /pr(\\d+)/u;
export interface Deploy { name: string; branch: string; file: string; log: string }
export function pullOf(deploy: Deploy): number {
  return Number(PULL.exec(deploy.name)?.[1]); // REPORT a number read back out of a name
}
export function ticketOf(deploy: Deploy): string {
  return /^(?<ticket>[A-Z]+-\\d+)/u.exec(deploy.branch)?.groups?.ticket ?? ""; // REPORT through a named group
}
export function stemOf(path: string): string {
  const found = basename(path).match(/^(.+)-\\d+$/u); // REPORT a name from basename()
  return found === null ? "" : (found[1] ?? "");
}
export function kindOf(deploy: Deploy): string {
  return /\\.(png|svg)$/u.exec(deploy.file)?.[1] ?? ""; // ADMITTED the extension is the file system's field
}
export function isPreview(deploy: Deploy): boolean {
  return /^preview-(\\d+)/u.test(deploy.name); // ADMITTED a predicate reads no capture
}
export function codeOf(deploy: Deploy): string {
  return /error (\\w+)/u.exec(deploy.log)?.[1] ?? ""; // ADMITTED a log line is no name
}
export function numbers(deploy: Deploy): string[] {
  return deploy.name.match(/(\\d+)/gu) ?? []; // ADMITTED a global match captures nothing
}
export function whole(deploy: Deploy): string {
  return /pr(\\d+)/u.exec(deploy.name)?.[0] ?? ""; // ADMITTED the whole match is the name itself
}
`;

const WRITES = `import { appendFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
export interface Job { path: string; log: string; state: string }
export function finish(job: Job): void {
  writeFileSync(job.path, JSON.stringify({ ...job, state: "done" })); // REPORT state rewritten whole
}
export async function save(job: Job): Promise<void> {
  await writeFile(job.path, \`\${JSON.stringify(job, null, 2)}\\n\`); // REPORT inside a template
}
export function record(job: Job): void {
  appendFileSync(job.log, \`\${JSON.stringify({ kind: "finished" })}\\n\`); // ADMITTED an append
}
export function flagged(job: Job): void {
  writeFileSync(job.log, \`\${JSON.stringify(job)}\\n\`, { flag: "a" }); // ADMITTED the append flag
}
export function note(job: Job): void {
  writeFileSync(job.path, "plain text"); // ADMITTED text that is not serialised structure
}
export function send(stream: { write(text: string): void }, job: Job): void {
  stream.write(JSON.stringify(job)); // ADMITTED a stream's write replaces no file
}
`;

const BOARD = `export const done = (status: string): boolean => status === "closed" || status === "merged";\n`;
const ISSUES = `export const shut = (issue: { status: string }): boolean =>
  issue.status === "closed" || issue.status === "merged";
export function close(issue: { status: string }): void {
  issue.status = "closed";
}
`;
const DECLARED = `export type IssueStatus = "open" | "closed" | "merged";\n`;
const PLATFORM = `export const unix = (os: string): boolean => os === "linux" || os === "darwin";\n`;

const findings = (files: Record<string, string>, kind = "unowned-state-literal"): string[] =>
  implicitStateFindings(new Map(Object.entries(files)))
    .filter((row) => row.kind === kind)
    .map((row) => `${row.path}:${row.line} ${(row.places ?? []).map((place) => place.path).join(" ")}`);

describe("the opinionated implicit-state rules", () => {
  it("report only the marked lines", async () => {
    await lintRules("implicit-state-opinionated", [
      ["name-encoded-state", NAMES, 3, "src/deploy.ts"],
      ["state-file-overwrite", WRITES, 2, "src/store.ts"],
      ["state-file-overwrite", WRITES, 0, "src/store.test.ts"],
    ]);
  });
});

describe("unowned-state-literal", () => {
  it("is reported where two files group the same literals that nothing declares", () => {
    expect(findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES })).toEqual([
      "src/board.ts:1 src/board.ts src/issues.ts",
    ]);
  });

  it("is not reported once a type declares the states, for one file, or for a test", () => {
    expect(findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES, "src/issue.ts": DECLARED })).toEqual(
      [],
    );
    expect(findings({ "src/board.ts": BOARD, "src/platform.ts": PLATFORM })).toEqual([]);
    expect(
      findings({ "src/board.ts": BOARD, "src/issues.ts": ISSUES.replace(/export function close[^]*/u, "") }),
    ).toEqual([]);
    expect(
      findings(
        { "src/board.ts": BOARD, "src/issues.ts": ISSUES.replace(/export function close[^]*/u, "") },
        "enumeration-literal-spread",
      ),
    ).toEqual(["src/board.ts:1 src/board.ts src/issues.ts"]);
    expect(findings({ "src/board.ts": BOARD, "test/issues.test.ts": ISSUES })).toEqual([]);
  });
});
