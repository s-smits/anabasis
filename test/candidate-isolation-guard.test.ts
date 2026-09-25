/**
 * guardPath over a derived policy: which of the candidate's own interfaces it allows, which
 * protected classes it denies, where an ordinary write may land, how it judges a symlink, and why
 * a sibling created after derivation is decided by a standing rule rather than a new digest.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { deriveCandidateIsolation, guardPath } from "../src/builder/candidate-isolation.ts";
import { makeIsolationRepo, seedFile } from "./helpers/isolation-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

type Mode = "read" | "write";
/** Each row asserts one decision; a reason of null checks the decision alone. */
type Row = readonly [Mode, string, "allow" | "deny", string | null];

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
afterAll(cleanupScratch);
const { repoRoot, binding } = makeIsolationRepo(SCRATCH, "repo");
const { iterationDir, epochDir, ossRoot } = binding;
const policy = deriveCandidateIsolation(binding, "author");

function expectRows(rows: readonly Row[]): void {
  for (const [mode, path, decision, reason] of rows) {
    const expected = reason === null ? { decision } : { decision, reason };
    expect(guardPath(policy, mode, mode, path), `${mode} ${path}`).toMatchObject(expected);
  }
}
const deny = (mode: Mode, reason: string | null) => (path: string) => [mode, path, "deny", reason] as const;

describe("guardPath decisions", () => {
  it("allows the candidate's own interfaces and denies every protected class", () => {
    expectRows([
      ["read", join(iterationDir, "slug", "correctness-model", "brief.json"), "allow", null],
      ["read", join(repoRoot, "node_modules", "pkg", "index.js"), "allow", null],
      ["read", join(epochDir, "backends.json"), "allow", null],
      ...[
        join(repoRoot, "asks", "hw", "ask.md"),
        join(repoRoot, "asks", "hw", "verifier.py"),
        join(repoRoot, "asks", "other", "ask.md"),
        join(repoRoot, "domains", "adopted", "tasks.json"),
        join(repoRoot, "src", "verify", "host.ts"),
        join(repoRoot, "controller-private.txt"),
        join(repoRoot, "operator-policy.json"),
        join(epochDir, "late-panel.txt"),
      ].map(deny("read", "deny/outside-allow")),
      ["read", join(repoRoot, ".env"), "deny", "deny/secret"],
      ["read", join(repoRoot, ".git", "config"), "deny", "deny/git-history"],
      ...["census.json", "iteration.json", "solvability.json"]
        .map((name) => join(iterationDir, name))
        .map(deny("read", "deny/measured")),
    ]);
  });

  it("denies the Builder every input the operator projections read, including its own path record", () => {
    // The authorship line: the Builder may read what it AUTHORED, never what was MEASURED about
    // it. builder-session.json is its own declared contract and stays readable by design; the path
    // record sits beside it and is denied BY NAME, because it records what
    // the isolation observed rather than what the Builder wrote. tools/outcome reads the denied side of
    // that line — per-case outcomes are per-task failure localisation (tenet 4) — so the census,
    // the scan, and the trace projection are host-side readers and reach no session.
    expectRows([
      ["read", join(epochDir, "builder-session.json"), "allow", null],
      ...[
        join(epochDir, "builder-path-record.jsonl"),
        join(epochDir, "verifier-workshop.jsonl"),
        join(epochDir, `verifier-proposal-${"a".repeat(64)}.json`),
        join(epochDir, `verifier-admission-${"a".repeat(64)}.json`),
        join(iterationDir, ".bundle-snapshots", "accepted", "agent", "tools.ts"),
        join(iterationDir, "case-record.jsonl"),
      ].map(deny("read", "deny/measured")),
      ...[
        join(repoRoot, "campaigns", "hw", "case-record.jsonl"),
        join(repoRoot, "tools", "outcome", "cli.ts"),
        join(repoRoot, "tools", "outcome", "scan.ts"),
      ].map(deny("read", "deny/outside-allow")),
    ]);
  });

  it("confines ordinary author writes to the iteration dir and keeps .oss isolated", () => {
    expectRows([
      ["write", join(iterationDir, "slug", "out.ts"), "allow", null],
      ...[
        join(ossRoot, "clone", "x.py"),
        join(repoRoot, "src", "evil.ts"),
        join(repoRoot, "domains", "adopted", "tasks.json"),
        join(iterationDir, "census.json"),
      ].map(deny("write", null)),
    ]);
  });

  // Run 52 wrote package replacements into the workspace, so generated imports used those files
  // instead of the controller links. Writes are now refused, and the census still detects any
  // replacement created through another route.
  it("denies writing the controller-linked runtime closure under any workspace resolution root", () => {
    expectRows(
      [
        ...["node_modules", "agent/node_modules", "correctness-model/node_modules"].flatMap((root) =>
          ["@ana/agent-bundle", "@earendil-works/pi-ai"].map((pkg) =>
            join(iterationDir, root, pkg, "index.ts"),
          ),
        ),
        join(iterationDir, "node_modules", "src", "solve", "draft-tool.ts"),
        join(iterationDir, "node_modules", "left-pad", "index.js"),
      ].map(deny("write", "deny/module-shadow")),
    );
  });

  it("denies measured evidence by path segment, not leaf basename (the hostile corpus)", () => {
    // Two classes the leaf-only check missed live: the verifier non-result evidence (carries
    // stderrTail/command/args — protected verifier detail) and a dynamic leaf under a directory
    // whose NAME is protected. writeCompleted's tmp form must be as denied as its target.
    const measured = [
      join(iterationDir, "verifier-non-result.json"),
      join(iterationDir, "slug", "verifier-non-result.json"),
      join(iterationDir, "verifier-non-result.json.tmp-4242-1690000000000"),
      join(epochDir, "evidence-builder-authoring", "02-1690000000000-4242.json"),
      join(epochDir, "evidence-builder-authoring", "sub", "x.json"),
      join(iterationDir, "census.json", "report.json"),
      join(epochDir, "evidence", "attempt.json"),
      join(iterationDir, "conformance.json"),
      join(iterationDir, "discrimination-report.json"),
      join(iterationDir, "census.json.bak"),
      join(iterationDir, "case-17", "trace.json"),
    ];
    expectRows([...measured.map(deny("read", "deny/measured")), ...measured.map(deny("write", null))]);
    // False-positive guards: names near a prefix without matching it stay inside the Builder's
    // own readable tree — over-denying here would starve legitimate authored files.
    expectRows(
      ["census2.json", "xcensus.json", "casefoo.json"].map(
        (name) => ["read", join(iterationDir, "slug", name), "allow", "allow/candidate-tree"] as const,
      ),
    );
  });

  it("judges a symlink at its target, never its name", () => {
    const link = join(iterationDir, "slug", "innocent.md");
    symlinkSync(join(repoRoot, "asks", "hw", "verifier.py"), link);
    expectRows([["read", link, "deny", "deny/outside-allow"]]);
  });

  it("denies a sibling created after derivation by a standing rule, digest unchanged", () => {
    const before = policy.digest;
    const late = [
      join(repoRoot, "domains", "new-sibling", "tasks.json"),
      join(repoRoot, "campaigns", "hw", "epoch-2", "backends.json"),
    ];
    for (const path of late) {
      mkdirSync(join(path, ".."), { recursive: true });
      seedFile(path, "LATE\n");
    }
    expectRows(late.map(deny("read", null)));
    expect(policy.digest).toBe(before);
  });
});
