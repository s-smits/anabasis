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

// A split build divides the Builder along the hash line. The Harness Builder must not be able to
// read a hidden expectation, a check, a reference artifact or an instrument the answer agent
// installed, recover one from the workspace history or write around the wall; the answer agent
// writes nothing the Harness Builder owns. One rule holds both: every root the answer agent may
// write is a root the Harness Builder is denied both ways, so no install path of its own choosing
// lands where the Harness Builder reads.
describe("a split build's wall", () => {
  const harness = deriveCandidateIsolation(binding, "harness");
  const answer = deriveCandidateIsolation(binding, "answer");
  const decide = (split: typeof harness, mode: Mode | "exec", path: string) =>
    guardPath(split, mode, mode, path);
  const at = (...parts: string[]) => join(iterationDir, ...parts);
  /** An instrument the answer agent installed where the verifier's tool search finds it. */
  const installed = at(".toolchain", "answer", "bin", "truss-verify");

  it("keeps the Harness Builder out of everything the answer agent writes or installs, and the history, both ways", () => {
    const walled = [
      at("correctness-model", "tasks.json"),
      at("correctness-model", "reference", "best-design.json"),
      at("answer", "search", "log.txt"),
      installed,
      at(".toolchain", "answer", "home", ".local", "lib", "truss_verify.py"),
      at(".git", "objects", "ab", "cdef"),
    ];
    for (const path of walled) {
      for (const mode of ["read", "write"] as const) {
        expect(decide(harness, mode, path), `${mode} ${path}`).toMatchObject({
          decision: "deny",
          reason: "deny/purpose-isolation",
        });
      }
    }
    expect(decide(harness, "write", at("agent", "tools.ts"))).toMatchObject({ decision: "allow" });
    expect(decide(harness, "read", at("public", "tasks.json"))).toMatchObject({ decision: "allow" });
    expect(decide(harness, "write", at("MEMORY.md"))).toMatchObject({ decision: "allow" });
    // The Harness Builder keeps the rest of the tool tree for its own installs.
    for (const path of [at(".toolchain", "bin", "python3"), at(".toolchain", "home", ".local", "x")]) {
      for (const mode of ["read", "write"] as const) {
        expect(decide(harness, mode, path), `${mode} ${path}`).toMatchObject({ decision: "allow" });
      }
    }
    expect(decide(harness, "write", at("agent", "node_modules", "x.js"))).toMatchObject({
      reason: "deny/module-shadow",
    });
  });

  it("lets the answer agent write only inside what the Harness Builder is walled from", () => {
    expect(answer.allow.write.length).toBeGreaterThan(0);
    for (const { path } of answer.allow.write) {
      expect(harness.readDenyRoots, path).toContain(path);
      expect(harness.writeDenyRoots, path).toContain(path);
    }
    for (const path of [at("correctness-model", "tasks.json"), at("answer", "search.py"), installed]) {
      expect(decide(answer, "write", path), path).toMatchObject({ decision: "allow" });
    }
    for (const path of [
      at("agent", "tools.ts"),
      at("MEMORY.md"),
      at("SCRATCHPAD.md"),
      at("scratch", "x.py"),
      at(".toolchain", "lib", "truss_verify.py"),
      at(".toolchain", "bin", "solver"),
      at(".toolchain", "home", ".local", "bin", "solver"),
    ]) {
      expect(decide(answer, "write", path), path).toMatchObject({
        decision: "deny",
        reason: "deny/outside-allow",
      });
    }
    expect(decide(answer, "read", at("agent", "tools.ts"))).toMatchObject({ decision: "allow" });
    expect(decide(answer, "read", at(".toolchain", "bin", "python3"))).toMatchObject({ decision: "allow" });
    // A shell opens at the workspace root unless told otherwise; the OS wall still decides its writes.
    expect(decide(answer, "exec", iterationDir)).toMatchObject({ decision: "allow" });
    expect(decide(answer, "exec", at("agent"))).toMatchObject({ decision: "deny" });
  });

  it("leaves the whole Builder's policy as it was", () => {
    expect(policy.readDenyRoots).toEqual([ossRoot]);
    expect(policy.allow.write).toEqual([{ kind: "subpath", path: iterationDir, id: "iteration-write" }]);
    expect(policy.writeDenyRoots.every((root) => root.endsWith("node_modules"))).toBe(true);
    expect(new Set([policy.digest, harness.digest, answer.digest]).size).toBe(3);
  });
});
