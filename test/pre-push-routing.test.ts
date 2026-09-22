/**
 * Documentation pushes used to enter the same queued full gate as source pushes. This fixture
 * executes the real hook between real commits, with Bun replaced only at the final gate boundary,
 * so the test observes the routing decision without running the repository suite recursively.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const repositoryRoot = join(import.meta.dir, "..");
const hook = join(repositoryRoot, ".githooks", "pre-push");
const prepareHook = join(repositoryRoot, ".githooks", "prepare-commit-msg");
const fixture = mkdtempSync(join(tmpdir(), "ana-pre-push-routing-"));
const fakeBin = join(fixture, "bin");

const git = (...args: string[]): string => execTextSync("git", args, { cwd: fixture }).trim();

mkdirSync(fakeBin);
writeFileSync(
  join(fakeBin, "bun"),
  '#!/bin/sh\nprintf \'%s\\t%s\\t%s\\n\' "$ANA_TEST_WORKERS" "$*" "$ANA_TESTED_COMMIT" >> "$ANA_HOOK_MARKER"\n' +
    '[ -z "${ANA_FAKE_GATE_OUTPUT:-}" ] || { printf \'%s\\n\' "$ANA_FAKE_GATE_OUTPUT"; exit 1; }\n',
);
chmodSync(join(fakeBin, "bun"), 0o755);
git("init", "-q");
git("config", "user.email", "fixture@localhost");
git("config", "user.name", "fixture");
mkdirSync(join(fixture, "src"));
writeFileSync(join(fixture, "README.md"), "one\n");
writeFileSync(join(fixture, "src", "owner.ts"), "export const owner = 1;\n");
git("add", "-A");
git("commit", "-qm", "base");
const base = git("rev-parse", "HEAD");

writeFileSync(join(fixture, "README.md"), "two\n");
git("add", "README.md");
git("commit", "-qm", "docs");
const docs = git("rev-parse", "HEAD");

writeFileSync(join(fixture, "src", "owner.ts"), "export const owner = 2;\n");
git("add", "src/owner.ts");
git("commit", "-qm", "source");
const source = git("rev-parse", "HEAD");

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function runHook(local: string, remote: string, markerName: string, gateOutput = "") {
  const marker = join(fixture, markerName);
  const result = spawnTextSync("sh", [hook], {
    cwd: fixture,
    stdin: `refs/heads/main ${local} refs/heads/main ${remote}\n`,
    env: {
      ...Bun.env,
      HOME: fixture,
      PATH: `${fakeBin}:${Bun.env.PATH ?? ""}`,
      ANA_HOOK_MARKER: marker,
      ANA_TEST_WORKERS: "9",
      ANA_FAKE_GATE_OUTPUT: gateOutput,
    },
  });
  return { ...result, marker };
}

function runHookWithRefs(lines: readonly string[], markerName: string) {
  const marker = join(fixture, markerName);
  const result = spawnTextSync("sh", [hook], {
    cwd: fixture,
    stdin: `${lines.join("\n")}\n`,
    env: {
      ...Bun.env,
      HOME: fixture,
      PATH: `${fakeBin}:${Bun.env.PATH ?? ""}`,
      ANA_HOOK_MARKER: marker,
      ANA_TEST_WORKERS: "9",
    },
  });
  return { ...result, marker };
}

describe("pre-push proof routing", () => {
  it("checks a documentation-only update without starting Bun or the full gate", () => {
    const result = runHook(docs, base, "docs-marker");
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("documentation-only update");
    expect(existsSync(result.marker)).toBe(false);
  });

  it("runs the full gate when source bytes changed", () => {
    const result = runHook(source, docs, "source-marker");
    expect(result.status).toBe(0);
    expect(readFileSync(result.marker, "utf8")).toContain("9\trun gate");
  });

  it("runs the full gate for a new remote ref even when its tip contains documentation", () => {
    const result = runHook(docs, "0".repeat(40), "new-ref-marker");
    expect(result.status).toBe(0);
    expect(readFileSync(result.marker, "utf8")).toContain("9\trun gate");
  });

  // The tested identity is the checkout, so a batch push naming a parent and a composed tip must
  // report the same commit whichever order Git lists them in.
  it("names the checked-out tree whatever order the refs arrive in", () => {
    const parent = `refs/heads/parent ${docs} refs/heads/parent ${base}`;
    const tip = `refs/heads/main ${source} refs/heads/main ${docs}`;
    const forward = runHookWithRefs([parent, tip], "order-forward-marker");
    const reverse = runHookWithRefs([tip, parent], "order-reverse-marker");
    expect(forward.status).toBe(0);
    expect(reverse.status).toBe(0);
    const named = (marker: string): string => readFileSync(marker, "utf8").trim().split("\t")[2] ?? "";
    expect(named(forward.marker)).toBe(source);
    expect(named(reverse.marker)).toBe(named(forward.marker));
  });

  it("refuses a ref the checked-out tree does not contain", () => {
    const unrelated = execTextSync("git", ["commit-tree", `${base}^{tree}`, "-m", "unrelated"], {
      cwd: fixture,
    }).trim();
    const result = runHookWithRefs(
      [`refs/heads/side ${unrelated} refs/heads/side ${base}`],
      "unrelated-marker",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not contained in the checked-out tree");
    expect(existsSync(result.marker)).toBe(false);
  });

  // A static failure names every finding to the pusher and parks them for the fix commit on top,
  // so the history pairs the failing commit with a repair that records what was wrong.
  const lint = [
    "src/a.ts:2:10: error anti-slop(require-safety-comment-for-type-assertion): no SAFETY",
    "src/a.ts:1:30: error ana(unproven-unknown-parameter): never proved",
    "src/c.ts:1:1: warning: Unused oxlint-disable directive (no problems were reported).",
    "Found 1 warning and 2 errors.",
    "gate: step lint failed (exit 1)",
  ].join("\n");
  const findings = [
    "anti-slop(require-safety-comment-for-type-assertion) src/a.ts:2:10 no SAFETY",
    "ana(unproven-unknown-parameter) src/a.ts:1:30 never proved",
    "oxlint(unused-directive) src/c.ts:1:1 Unused oxlint-disable directive (no problems were reported).",
  ];

  function prepareMessage(text: string): string {
    const file = join(fixture, "COMMIT_EDITMSG_TEST");
    writeFileSync(file, text);
    expect(spawnTextSync("sh", [prepareHook, file, "message"], { cwd: fixture }).status).toBe(0);
    return readFileSync(file, "utf8");
  }

  it("lists each static finding and says how to publish the fix", () => {
    const result = runHook(source, docs, "lint-failure-marker", lint);
    expect(result.status).toBe(1);
    for (const finding of findings) expect(result.stderr).toContain(`\n${finding}\n`);
    expect(result.stderr).toContain(`YOUR PUSH DID NOT GO THROUGH: lint failed on ${source.slice(0, 9)}`);
  });

  // A gate run under a terminal ends every line in CR and Bun colours stderr, as
  // in the recorded line `\u001b[0m\u001b[31mfile-size: … exceeds 888\u001b[0m\r`.
  it("reads the same findings from a log written under a terminal", () => {
    const result = runHook(source, docs, "terminal-lint-marker", lint.replaceAll("\n", "\r\n"));
    for (const finding of findings) expect(result.stderr).toContain(`\n${finding}\n`);
    const policy =
      "\u001b[0m\u001b[31mfile-size: src/b.ts: 915 nonblank lines exceeds 888\u001b[0m\r\ngate: step source-policy failed (exit 1)\r";
    const terminal = runHook(source, docs, "terminal-policy-marker", policy);
    expect(terminal.stderr).toContain("\nsource-policy(file-size) src/b.ts 915 nonblank lines exceeds 888\n");
  });

  it("appends the findings to the commit made on top of the failing one, and to no other", () => {
    expect(runHook(source, docs, "lint-fix-marker", lint).status).toBe(1);
    const fixed = prepareMessage("Fix the lint\n\nCo-Authored-By: A <a@localhost>\n");
    const trailers = execTextSync("git", ["interpret-trailers", "--parse"], { cwd: fixture, stdin: fixed });
    expect(trailers.trim().split("\n")).toEqual([
      "Co-Authored-By: A <a@localhost>",
      `Gate-Fix: lint ${source.slice(0, 9)}`,
      ...findings.map((finding) => `Gate-Finding: ${finding}`),
    ]);

    const pending = join(fixture, ".git", "ana-gate", "fix-forward");
    writeFileSync(pending, readFileSync(pending, "utf8").replace(source, base));
    expect(prepareMessage("Unrelated work\n")).toBe("Unrelated work\n");
  });

  it("asks for no fix commit when the failure is a test", () => {
    const tests = ["(fail) owner > counts [4.00ms]", " 1 fail", 'error: script "test" exited with code 1'];
    const result = runHook(source, docs, "test-failure-marker", tests.join("\n"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("THE GATE FAILED");
    expect(result.stderr).not.toContain("DID NOT GO THROUGH");
  });
});
