// Pre-commit and repository-wide secret scanner (ported from v1's `tools/secrets/scan.ts`).
// Supports two scanning scopes using the same rule set:
//   --staged   lines added in the Git index (run by `bun run commit:check`)
//   range      lines added across a commit range via `scanAdded` (run by the pre-push hook)
//   default    all tracked files (`bun run secrets`, run by the gate and CI's darwin job)
// Staged mode inspects added lines only, because a pre-commit check cannot rewrite committed
// history and re-reporting existing lines encourages operators to bypass the check.

import { existsSync, readFileSync, statSync } from "../../src/meta/filesystem.ts";
import { type SecretHit, WAIVER, scanText } from "./rules.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import { hostTool } from "../../src/meta/host-tool.ts";
import { CAPTURE_MAX_BYTES, runTextSyncOrThrow } from "../../src/meta/subprocess.ts";

/** Refuse dotenv files by path because they may store credentials, including when staged with
 *  `git add -f`. Templates are exempt from this path rule but still receive the content scan. */
const ENV_FILE = /(^|\/)\.env(\.|$)/;
const ENV_TEMPLATE = /(^|\/)\.env\.([\w-]+\.)?(example|sample|template|dist)$/;

/** Skip these generated formats in the content scan; credentials inside them are not detected. */
const SKIP_CONTENT = [/\.lock$/, /\.min\.js$/, /\.map$/];

/** Added lines from the index or a range, with their real line numbers in the new file. */
interface ScanAddedResult {
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

/** Scans lines added by `git diff <range>` (such as `--cached` or a commit range). */
export function scanAdded(range: readonly string[]): ScanAddedResult {
  const staged = git(["diff", ...range, "--name-only", "--diff-filter=ACMR"])
    .split("\n")
    .filter(Boolean);
  const refusedPaths = staged.filter(refusedPath);
  const diff = git(["diff", ...range, "--unified=0", "--no-color", "--diff-filter=ACMR"]);
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
    if (path && scannable(path)) for (const hit of scanText(path, row.slice(1))) hits.push({ ...hit, line });
    line += 1;
  }
  return { hits, refusedPaths };
}

function scanTree(): ScanTreeResult {
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
    lines.push(`  ${hit.path}:${hit.line}: ${hit.what} (${hit.rule})`, `    ${hit.masked}`);
  }
  return lines.join("\n");
}

function main(): void {
  const staged = Bun.argv.includes("--staged");
  const { hits, refusedPaths } = staged ? scanAdded(["--cached"]) : scanTree();
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
      "A value that leaves the machine is public.",
    ].join("\n"),
  );
  runtimeProcess.exitCode = 1;
}

if (Bun.argv[1]?.endsWith("scan.ts") === true) main();
