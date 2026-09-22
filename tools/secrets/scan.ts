// The pre-commit secret gate. Two modes, one vocabulary:
//   --staged   the lines this commit ADDS (what .githooks/pre-commit runs)
//   default    every tracked file (what test/secret-scan.test.ts runs, so the gate covers it)
// The staged mode reads added lines only. A pre-commit hook cannot repair history, and re-reporting
// a line that is already committed teaches the operator to pass --no-verify, which is the one
// outcome that makes the gate worthless.

import { existsSync, readFileSync, statSync } from "../../src/meta/filesystem.ts";
import { type SecretHit, WAIVER, scanText } from "./rules.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { hostTool } from "../../src/meta/host-tool.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";

/** Refuse dotenv files by path because they may store credentials, including when staged with
 *  `git add -f`. Templates are exempt from this path rule but still receive the content scan. */
const ENV_FILE = /(^|\/)\.env(\.|$)/;
const ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template|dist)$/;

/** Skip these generated formats in the content scan; credentials inside them are not detected. */
const SKIP_CONTENT = [/\.lock$/, /\.min\.js$/, /\.map$/];

/** Added lines from the index, with their real line numbers in the new file. */
interface ScanStagedResult {
  hits: SecretHit[];
  refusedPaths: string[];
}

/** Every tracked file as it stands on disk. */
interface ScanTreeResult {
  hits: SecretHit[];
  refusedPaths: string[];
}

function git(args: string[]): string {
  return runTextSyncOrThrow([hostTool("git"), "-c", "core.quotePath=false", ...args], {
    maxBuffer: CAPTURE_MAX_BYTES,
  });
}

export function refusedPath(path: string): boolean {
  return ENV_FILE.test(path) && !ENV_TEMPLATE.test(path);
}

function scannable(path: string): boolean {
  return !SKIP_CONTENT.some((skip) => skip.test(path));
}

function scanStaged(): ScanStagedResult {
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n").filter(Boolean);
  const refusedPaths = staged.filter(refusedPath);
  const diff = git(["diff", "--cached", "--unified=0", "--no-color", "--diff-filter=ACMR"]);
  const hits: SecretHit[] = [];
  let path = "";
  let line = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) {
      const named = row.slice(4).trim();
      path = named === "/dev/null" ? "" : named.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!row.startsWith("+")) continue;
    if (path && scannable(path)) hits.push(...scanText(path, row.slice(1)).map((h) => ({ ...h, line })));
    line += 1;
  }
  return { hits, refusedPaths };
}

export function scanTree(): ScanTreeResult {
  const tracked = git(["ls-files"]).split("\n").filter(Boolean);
  const hits: SecretHit[] = [];
  for (const path of tracked.filter(scannable)) {
    if (!existsSync(path)) continue;
    if (!statSync(path).isFile()) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("\0")) continue; // binary
    hits.push(...scanText(path, text));
  }
  return { hits, refusedPaths: tracked.filter(refusedPath) };
}

export function report(hits: SecretHit[], refusedPaths: string[]): string {
  const lines: string[] = [];
  for (const path of refusedPaths) {
    lines.push(`  ${path}: a dotenv file may not be committed — it is a credential store`);
  }
  for (const hit of hits) {
    lines.push(`  ${hit.path}:${hit.line}: ${hit.what} (${hit.rule})`);
    lines.push(`    ${hit.masked}`);
  }
  return lines.join("\n");
}

function main(): void {
  const staged = Bun.argv.includes("--staged");
  const { hits, refusedPaths } = staged ? scanStaged() : scanTree();
  const subject = staged ? "the staged change" : "the tracked tree";
  if (hits.length === 0 && refusedPaths.length === 0) {
    console.log(`secret scan: ${subject} carries no credential-shaped literal`);
    return;
  }
  console.error(`secret scan: ${hits.length + refusedPaths.length} finding(s) in ${subject}`);
  console.error(`${report(hits, refusedPaths)}\n`);
  console.error(
    [
      "Remove the value, or — if it is a fixture — make it obviously not a credential:",
      "assemble it from parts at run time, or add the word `fake` to it. A line that must",
      `keep its literal shape carries \`${WAIVER}\` in a comment, stating the decision in the diff.`,
      "`git commit --no-verify` bypasses this gate; a value that leaves the machine is public.",
    ].join("\n"),
  );
  runtimeProcess.exitCode = 1;
}

if (Bun.argv[1]?.endsWith("scan.ts") === true) main();
