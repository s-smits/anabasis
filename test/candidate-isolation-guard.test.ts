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
const DENY_OUTSIDE_ALLOW = "deny/outside-allow";
const DENY_MEASURED = "deny/measured";

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
afterAll(cleanupScratch);
const { repoRoot, binding } = makeIsolationRepo(SCRATCH, "repo");
const policy = deriveCandidateIsolation(binding, "author");

describe("guardPath decisions", () => {
  const read = (path: string) => guardPath(policy, "read", "read", path);
  const write = (path: string) => guardPath(policy, "write", "write", path);

  it("allows the candidate's own interfaces and denies every protected class", () => {
    expect(read(join(binding.iterationDir, "slug", "correctness-model", "brief.json")).decision).toBe(
      "allow",
    );
    expect(read(join(repoRoot, "node_modules", "pkg", "index.js")).decision).toBe("allow");
    expect(read(join(binding.epochDir, "backends.json")).decision).toBe("allow");
    for (const [path, reason] of [
      [join(repoRoot, "asks", "hw", "ask.md"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "asks", "hw", "verifier.py"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "asks", "other", "ask.md"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "domains", "adopted", "tasks.json"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "src", "verify", "host.ts"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "controller-private.txt"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "operator-policy.json"), DENY_OUTSIDE_ALLOW],
      [join(binding.epochDir, "late-panel.txt"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, ".env"), "deny/secret"],
      [join(repoRoot, ".git", "config"), "deny/git-history"],
      [join(binding.iterationDir, "census.json"), DENY_MEASURED],
      [join(binding.iterationDir, "iteration.json"), DENY_MEASURED],
      [join(binding.iterationDir, "solvability.json"), DENY_MEASURED],
    ] as const) {
      const decision = read(path);
      expect(decision.decision, path).toBe("deny");
      expect(decision.decision === "deny" && decision.reason, path).toBe(reason);
    }
  });

  it("denies the Builder every input the operator projections read, including its own path record", () => {
    // The authorship line: the Builder may read what it AUTHORED, never what was MEASURED about
    // it. builder-session.json is its own declared contract and stays readable by design; the path
    // record sits beside it and is denied BY NAME, because it records what
    // the isolation observed rather than what the Builder wrote. tools/outcome reads the denied side of
    // that line — per-case outcomes are per-task failure localisation (tenet 4) — so the census,
    // the scan, and the trace projection are host-side readers and reach no session.
    expect(read(join(binding.epochDir, "builder-session.json")).decision).toBe("allow");
    for (const [path, reason] of [
      [join(binding.epochDir, "builder-path-record.jsonl"), DENY_MEASURED],
      [join(binding.epochDir, "verifier-workshop.jsonl"), DENY_MEASURED],
      [join(binding.epochDir, `verifier-proposal-${"a".repeat(64)}.json`), DENY_MEASURED],
      [join(binding.epochDir, `verifier-admission-${"a".repeat(64)}.json`), DENY_MEASURED],
      [join(binding.iterationDir, ".bundle-snapshots", "accepted", "agent", "tools.ts"), DENY_MEASURED],
      [join(binding.iterationDir, "case-record.jsonl"), DENY_MEASURED],
      [join(repoRoot, "campaigns", "hw", "case-record.jsonl"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "tools", "outcome", "cli.ts"), DENY_OUTSIDE_ALLOW],
      [join(repoRoot, "tools", "outcome", "scan.ts"), DENY_OUTSIDE_ALLOW],
    ] as const) {
      const decision = read(path);
      expect(decision.decision, path).toBe("deny");
      expect(decision.decision === "deny" && decision.reason, path).toBe(reason);
    }
  });

  it("confines ordinary author writes to the iteration dir and keeps .oss isolated", () => {
    expect(write(join(binding.iterationDir, "slug", "out.ts")).decision).toBe("allow");
    expect(write(join(binding.ossRoot, "clone", "x.py")).decision).toBe("deny");
    expect(write(join(repoRoot, "src", "evil.ts")).decision).toBe("deny");
    expect(write(join(repoRoot, "domains", "adopted", "tasks.json")).decision).toBe("deny");
    expect(write(join(binding.iterationDir, "census.json")).decision).toBe("deny");
  });

  // Run 52 wrote package replacements into the workspace, so generated imports used those files
  // instead of the controller links. Writes are now refused, and the census still detects any
  // replacement created through another route.
  it("denies writing the controller-linked runtime closure under any workspace resolution root", () => {
    for (const root of ["node_modules", "agent/node_modules", "correctness-model/node_modules"]) {
      for (const [scope, packageName] of [
        ["@ana", "agent-bundle"],
        ["@earendil-works", "pi-ai"],
      ] as const) {
        const decision = write(join(binding.iterationDir, root, scope, packageName, "index.ts"));
        expect(decision.decision, `${root}/${scope}`).toBe("deny");
        expect(decision.decision === "deny" && decision.reason, `${root}/${scope}`).toBe(
          "deny/module-shadow",
        );
      }
    }
    const sourceShadow = write(join(binding.iterationDir, "node_modules", "src", "solve", "draft-tool.ts"));
    expect(sourceShadow.decision).toBe("deny");
    expect(sourceShadow.decision === "deny" && sourceShadow.reason).toBe("deny/module-shadow");
    const packageShadow = write(join(binding.iterationDir, "node_modules", "left-pad", "index.js"));
    expect(packageShadow.decision).toBe("deny");
    expect(packageShadow.decision === "deny" && packageShadow.reason).toBe("deny/module-shadow");
  });

  it("denies measured evidence by path segment, not leaf basename (the hostile corpus)", () => {
    // Two classes the leaf-only check missed live: the verifier non-result evidence (carries
    // stderrTail/command/args — protected verifier detail) and a dynamic leaf under a directory
    // whose NAME is protected. writeCompleted's tmp form must be as denied as its target.
    for (const [path, label] of [
      [join(binding.iterationDir, "verifier-non-result.json"), "plain verifier non-result"],
      [join(binding.iterationDir, "slug", "verifier-non-result.json"), "nested verifier non-result"],
      [
        join(binding.iterationDir, "verifier-non-result.json.tmp-4242-1690000000000"),
        "mid-write completed-json tmp form",
      ],
      [
        join(binding.epochDir, "evidence-builder-authoring", "02-1690000000000-4242.json"),
        "dynamic leaf under a protected directory name",
      ],
      [
        join(binding.epochDir, "evidence-builder-authoring", "sub", "x.json"),
        "nested under a protected directory name",
      ],
      [join(binding.iterationDir, "census.json", "report.json"), "prefix as directory segment"],
      [join(binding.epochDir, "evidence", "attempt.json"), "directory literally named evidence"],
      [join(binding.iterationDir, "conformance.json"), "conformance leaf"],
      [join(binding.iterationDir, "discrimination-report.json"), "discrimination leaf"],
      [join(binding.iterationDir, "census.json.bak"), "prefix-stem suffix stays denied"],
      [join(binding.iterationDir, "case-17", "trace.json"), "case- as directory segment"],
    ] as const) {
      const decision = read(path);
      expect(decision.decision, label).toBe("deny");
      expect(decision.decision === "deny" && decision.reason, label).toBe(DENY_MEASURED);
      expect(write(path).decision, `${label} (write)`).toBe("deny");
    }
    // False-positive guards: names near a prefix without matching it stay inside the Builder's
    // own readable tree — over-denying here would starve legitimate authored files.
    for (const name of ["census2.json", "xcensus.json", "casefoo.json"]) {
      const decision = read(join(binding.iterationDir, "slug", name));
      expect(decision.decision, name).toBe("allow");
      expect(decision.decision === "allow" && decision.reason, name).toBe("allow/candidate-tree");
    }
  });

  it("judges a symlink at its target, never its name", () => {
    const link = join(binding.iterationDir, "slug", "innocent.md");
    symlinkSync(join(repoRoot, "asks", "hw", "verifier.py"), link);
    const decision = guardPath(policy, "read", "read", link);
    expect(decision.decision).toBe("deny");
    expect(decision.decision === "deny" && decision.reason).toBe(DENY_OUTSIDE_ALLOW);
  });

  it("denies a sibling created after derivation by a standing rule, digest unchanged", () => {
    const before = policy.digest;
    mkdirSync(join(repoRoot, "domains", "new-sibling"), { recursive: true });
    seedFile(join(repoRoot, "domains", "new-sibling", "tasks.json"), "LATE-ANSWERS\n");
    mkdirSync(join(repoRoot, "campaigns", "hw", "epoch-2"), { recursive: true });
    seedFile(join(repoRoot, "campaigns", "hw", "epoch-2", "backends.json"), "{}\n");
    expect(
      guardPath(policy, "read", "read", join(repoRoot, "domains", "new-sibling", "tasks.json")).decision,
    ).toBe("deny");
    expect(
      guardPath(policy, "read", "read", join(repoRoot, "campaigns", "hw", "epoch-2", "backends.json"))
        .decision,
    ).toBe("deny");
    expect(policy.digest).toBe(before);
  });
});
