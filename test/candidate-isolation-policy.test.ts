/**
 * What deriveCandidateIsolation grants and refuses before any sandbox exists: the public
 * declarations it projects, the linked epoch tool tree it opens read-only, the adopted tree it keeps
 * closed to a workspace holding its own copy, the .oss cell, network access, and the bundle contract it reads from the barrels.
 * A decision here is a path decision; OS enforcement is proved in the two executed files.
 */
import { afterAll, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { openPathRecord, runIsolated } from "../src/builder/candidate-isolation-runtime.ts";
import {
  deriveBundleContract,
  deriveCandidateIsolation,
  guardPath,
  HOST_SCRATCH_ROOTS,
  policyReadGrant,
} from "../src/builder/candidate-isolation.ts";
import { candidateIsolationProfile } from "../src/builder/candidate-isolation-profile.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { makeIsolationRepo, seedFile } from "./helpers/isolation-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
const TOOLCHAIN = ".toolchain";

// Two spellings of one directory: the derivation resolves symlinks, and one case needs the
// lexical path to build a symlinked campaigns root the policy must bind to its physical epoch.
const LEXICAL_SCRATCH = scratchDir("ana-isolation-");
const SCRATCH = realpathSync.native(LEXICAL_SCRATCH);
const onDarwin = runtimeProcess.platform === "darwin";
afterAll(cleanupScratch);
const makeFixtureRepo = (name: string) => makeIsolationRepo(SCRATCH, name);
const { repoRoot, binding } = makeIsolationRepo(SCRATCH, "repo");
const policy = deriveCandidateIsolation(binding, "author");

describe("policy derivation", () => {
  it("projects the real public correctness declarations without their protected type dependencies", async () => {
    const actualRoot = realpathSync.native(join(import.meta.dir, ".."));
    const epochDir = mkdtempSync(join(actualRoot, "test", ".ana-scratch-public-contract-"));
    const iterationDir = join(epochDir, "workspace"),
      ossRoot = join(epochDir, ".oss");
    mkdirSync(iterationDir);
    mkdirSync(ossRoot);
    try {
      const derived = deriveCandidateIsolation(
        { repoRoot: actualRoot, epochDir, iterationDir, ossRoot },
        "author",
      );
      const projected = policyReadGrant(derived);
      const record = openPathRecord(epochDir, "public-contract");
      for (const [path, allowed] of [
        ["src/verify/verifier-port.ts", true],
        ["src/correctness-bundle/correctness-model-contract.ts", true],
        ["src/verify/host.ts", false],
        ["src/correctness-bundle/contracts.ts", false],
        ["src/verify/verifier-lifetime.ts", false],
      ] as const) {
        const target = join(actualRoot, path);
        expect(guardPath(derived, "read", "read", target).decision).toBe(allowed ? "allow" : "deny");
        expect(projected.allow.includes(target)).toBe(allowed);
        if (!osIsolationSupport().ok) continue;
        const outcome = await runIsolated(derived, record, {
          capability: "bash",
          mode: "exec",
          command: "/bin/sh",
          args: ["-c", '/bin/cat "$1" >/dev/null', "contract-read", target],
          cwd: iterationDir,
          paths: [iterationDir],
          env: {},
          osRefusalIsOutcome: true,
        });
        expect(outcome.status === 0).toBe(allowed);
      }
    } finally {
      rmSync(epochDir, { recursive: true, force: true });
    }
  });

  it("reads a tool tree linked into another epoch without granting its source, writes or a redirected link", () => {
    const fixture = makeFixtureRepo("adopted-tools");
    const old = join(dirname(fixture.binding.epochDir), "epoch-old", "workspace");
    const tools = join(old, TOOLCHAIN);
    seedFile(join(tools, "engine"), "PUBLIC-TOOL");
    seedFile(join(old, "correctness-model", "evaluator.ts"), "PRIVATE");
    const workspaceTools = join(fixture.binding.iterationDir, TOOLCHAIN);
    rmSync(workspaceTools, { recursive: true, force: true });
    symlinkSync(tools, workspaceTools);
    const granted = deriveCandidateIsolation(fixture.binding, "author");
    expect(granted.allow.read).toContainEqual({ kind: "subpath", path: tools, id: "adopted-toolchain" });
    expect(granted.allow.write.some((rule) => rule.path === tools)).toBe(false);
    expect(
      deriveCandidateIsolation(fixture.binding, "workshop").allow.read.some((rule) => rule.path === tools),
    ).toBe(false);
    rmSync(workspaceTools);
    symlinkSync(join(old, "correctness-model"), workspaceTools);
    expect(
      deriveCandidateIsolation(fixture.binding, "author").allow.read.some(
        (rule) => rule.id === "adopted-toolchain",
      ),
    ).toBe(false);
  });

  it("lets a Builder edit the tools it installed, while the adopted epoch's tree stays read-only", () => {
    // The nudge in bash-install-env tells a Builder it may tune what it installed under .toolchain
    // when a call outruns the budget it wrote for its own solver. That is only true if the wall
    // says so: a real workspace tree is inside the write grant, and a tree that is a link into
    // another epoch is granted for reading alone (operator raised the access 2026-09-18).
    const fixture = makeFixtureRepo("own-tools-writable");
    const ownTools = join(fixture.binding.iterationDir, TOOLCHAIN);
    rmSync(ownTools, { recursive: true, force: true });
    seedFile(join(ownTools, "engine.cfg"), "iterations = 200");
    const derived = deriveCandidateIsolation(fixture.binding, "author");
    for (const path of [
      join(ownTools, "engine.cfg"),
      join(ownTools, "README.md"),
      join(ownTools, "bin", "new"),
    ]) {
      expect(guardPath(derived, "write", "write", path).decision).toBe("allow");
    }
    // Hostile: the same file reached through a link into a sibling epoch is readable, not writable.
    const sibling = join(dirname(fixture.binding.epochDir), "epoch-sibling", "workspace", TOOLCHAIN);
    seedFile(join(sibling, "engine.cfg"), "iterations = 200");
    rmSync(ownTools, { recursive: true, force: true });
    symlinkSync(sibling, ownTools);
    const linked = deriveCandidateIsolation(fixture.binding, "author");
    expect(guardPath(linked, "read", "read", join(sibling, "engine.cfg")).decision).toBe("allow");
    expect(guardPath(linked, "write", "write", join(sibling, "engine.cfg")).decision).toBe("deny");
  });

  it("grants the tree a linked workspace was seeded with, and no adopted tree to a workspace that copied its own", () => {
    // truss-sol 2026-09-05: the correction workspace kept the tree it was seeded with while the
    // domain link moved on, and `.toolchain/bun` through the workspace link was denied.
    const fixture = makeFixtureRepo("correction-tools");
    const campaign = dirname(fixture.binding.epochDir);
    const seeded = join(campaign, "epoch-seeded", "workspace", TOOLCHAIN);
    const later = join(campaign, "epoch-later", "workspace", TOOLCHAIN);
    seedFile(join(seeded, "bun"), "RUNTIME");
    seedFile(join(later, "bun"), "RUNTIME");
    const adopted = join(fixture.repoRoot, "domains", "hw");
    mkdirSync(adopted, { recursive: true });
    symlinkSync(later, join(adopted, TOOLCHAIN));
    const workspaceTools = join(fixture.binding.iterationDir, TOOLCHAIN);
    rmSync(workspaceTools, { recursive: true, force: true });
    symlinkSync(seeded, workspaceTools);
    const adoptedGrants = (derived: ReturnType<typeof deriveCandidateIsolation>) =>
      derived.allow.read.filter((rule) => rule.id === "adopted-toolchain").map((rule) => rule.path);
    const derived = deriveCandidateIsolation(fixture.binding, "author");
    expect(adoptedGrants(derived)).toEqual([seeded]);
    // Every backend's host tools consume this same derived for the resolved tool paths.
    expect(guardPath(derived, "read", "read", join(seeded, "bun")).decision).toBe("allow");
    // Hostile: the domain link's tree is not the workspace's, so the shell is not handed it either.
    expect(guardPath(derived, "read", "read", join(later, "bun")).decision).toBe("deny");
    // Hostile: a workspace that copied its tree reads the tree it was copied from no better than the
    // solver and the verifier do, so a copied file still naming that tree fails here first.
    rmSync(workspaceTools);
    seedFile(join(workspaceTools, "bun"), "RUNTIME");
    const copied = deriveCandidateIsolation(fixture.binding, "author");
    expect(adoptedGrants(copied)).toEqual([]);
    expect(guardPath(copied, "read", "read", join(later, "bun")).decision).toBe("deny");
    // Hostile: a workspace link re-pointed outside the campaign's epoch tool trees grants nothing.
    rmSync(workspaceTools, { recursive: true, force: true });
    symlinkSync(join(campaign, "epoch-later", "workspace", "correctness-model"), workspaceTools);
    seedFile(join(campaign, "epoch-later", "workspace", "correctness-model", "evaluator.ts"), "PRIVATE");
    expect(adoptedGrants(deriveCandidateIsolation(fixture.binding, "author"))).toEqual([]);
  });

  it("returns the same digest for the same binding and unchanged filesystem", () => {
    const again = deriveCandidateIsolation(binding, "author");
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(again.digest).toBe(policy.digest);
    expect(deriveCandidateIsolation(binding, "workshop").digest).not.toBe(policy.digest);
  });

  it("gives only the workshop policy access to the .oss cell", () => {
    const workshop = deriveCandidateIsolation(binding, "workshop");
    const workshopFile = join(binding.ossRoot, "candidate", "build.log");
    const authoredFile = join(binding.iterationDir, "slug", "correctness-model", "brief.json");
    expect(guardPath(workshop, "verifier_workshop", "write", workshopFile).decision).toBe("allow");
    expect(guardPath(workshop, "verifier_workshop", "read", authoredFile).decision).toBe("deny");
    expect(guardPath(policy, "bash", "exec", binding.ossRoot).decision).toBe("deny");
    expect(guardPath(policy, "read", "read", workshopFile).decision).toBe("deny");
    expect(guardPath(policy, "write", "write", workshopFile).decision).toBe("deny");
    expect(workshop.network).toBe("deny");
    expect(workshop.profile).toBe("isolated-workshop");
    expect(workshop.scratchWriteRoots[0]).toBe(join(binding.ossRoot, ".tmp"));
    expect<unknown>(workshop.scratchWriteRoots.slice(1)).toEqual(HOST_SCRATCH_ROOTS);
    expect(workshop.readDenyRoots).toEqual([]);
    if (onDarwin) {
      // The SBPL bytes are the Darwin mechanism's input; the Linux runtime builds its namespace
      // from the same policy value's binds instead, so only assert these on the Seatbelt host.
      // Reads remain allow-default for host tools. Writes are confined to the cell and declared
      // scratch roots; installers receive a cell-local HOME rather than the operator's home.
      const { profile } = candidateIsolationProfile(workshop, "exec");
      expect(profile).toContain("(allow default)");
      expect(profile).not.toContain("(deny default)");
      expect(profile).toContain('(deny file-write* (subpath "/"))');
      expect(profile).toContain('  (subpath "/Users")');
      expect(profile).toContain('  (subpath "/home")');
      expect(profile).toContain("(deny network*)");
    }
  });

  it("allows authoring network access and denies workshop network access", () => {
    const workshop = deriveCandidateIsolation(binding, "workshop");
    expect(policy.network).toBe("allow");
    expect(workshop.network).toBe("deny");
    if (onDarwin) {
      expect(candidateIsolationProfile(policy, "exec").profile).not.toContain("(deny network*)");
      expect(candidateIsolationProfile(workshop, "exec").profile).toContain("(deny network*)");
    }
  });

  it("binds a controller-owned campaigns symlink to its physical epoch", () => {
    const sourceRoot = join(LEXICAL_SCRATCH, "symlink-source");
    const controllerRoot = join(LEXICAL_SCRATCH, "symlink-controller");
    for (const dir of ["agent-bundle", "correctness-model-bundle", "correctness-model-prims"]) {
      mkdirSync(join(sourceRoot, "vendor", dir), { recursive: true });
    }
    for (const dir of ["solve", "correctness-bundle", "verify"]) {
      mkdirSync(join(sourceRoot, "src", dir), { recursive: true });
    }
    writeFileSync(
      join(sourceRoot, "vendor", "agent-bundle", "index.ts"),
      'export { defineTool } from "../../src/solve/define-tool.ts";\n',
    );
    writeFileSync(
      join(sourceRoot, "vendor", "correctness-model-bundle", "index.ts"),
      'export { declareTruthChecks } from "./truth-checks.ts";\n',
    );
    writeFileSync(
      join(sourceRoot, "vendor", "correctness-model-prims", "index.ts"),
      'export { relationalJoin } from "./relational-join.ts";\n',
    );
    writeFileSync(join(sourceRoot, "src", "solve", "define-tool.ts"), "export const defineTool = 1;\n");
    writeFileSync(
      join(sourceRoot, "vendor", "correctness-model-bundle", "truth-checks.ts"),
      "export const declareTruthChecks = 1;\n",
    );
    writeFileSync(
      join(sourceRoot, "vendor", "correctness-model-prims", "relational-join.ts"),
      "export const relationalJoin = 1;\n",
    );
    mkdirSync(join(controllerRoot, "hw", "epoch-1", "workspace"), { recursive: true });
    mkdirSync(join(controllerRoot, "hw", "epoch-1", ".oss"), { recursive: true });
    symlinkSync(controllerRoot, join(sourceRoot, "campaigns"));
    const lexicalEpoch = join(sourceRoot, "campaigns", "hw", "epoch-1");
    const linked = deriveCandidateIsolation(
      {
        repoRoot: sourceRoot,
        epochDir: lexicalEpoch,
        iterationDir: join(lexicalEpoch, "workspace"),
        ossRoot: join(lexicalEpoch, ".oss"),
      },
      "author",
    );

    expect(linked.epochDir).toBe(realpathSync.native(lexicalEpoch));
    expect(guardPath(linked, "read", "read", join(lexicalEpoch, "workspace")).decision).toBe("allow");
    expect(guardPath(linked, "write", "write", join(lexicalEpoch, "workspace", "new.ts")).decision).toBe(
      "allow",
    );
    expect(guardPath(linked, "read", "read", join(sourceRoot, "private.ts")).decision).toBe("deny");
  });

  it("refuses a direct external epoch even when its children are physically nested", () => {
    const external = join(SCRATCH, "external-controller");
    mkdirSync(join(external, "workspace"), { recursive: true });
    mkdirSync(join(external, ".oss"), { recursive: true });
    expect(() =>
      deriveCandidateIsolation(
        {
          ...binding,
          epochDir: external,
          iterationDir: join(external, "workspace"),
          ossRoot: join(external, ".oss"),
        },
        "author",
      ),
    ).toThrow(/repoRoot.*epochDir/);
  });

  it("derives the bundle contract from all three barrels and refuses a protected re-export", () => {
    const contract = deriveBundleContract(repoRoot);
    expect(contract).toEqual(
      [
        join(repoRoot, "src", "solve", "define-tool.ts"),
        join(repoRoot, "vendor", "agent-bundle", "index.ts"),
        join(repoRoot, "vendor", "correctness-model-bundle", "index.ts"),
        join(repoRoot, "vendor", "correctness-model-bundle", "truth-checks.ts"),
        join(repoRoot, "vendor", "correctness-model-prims", "index.ts"),
        join(repoRoot, "vendor", "correctness-model-prims", "relational-join.ts"),
      ].sort(),
    );
    const evil = makeFixtureRepo("evil");
    writeFileSync(
      join(evil.repoRoot, "vendor", "agent-bundle", "index.ts"),
      'export { host } from "../../src/verify/host.ts";\n',
    );
    expect(() => deriveCandidateIsolation(evil.binding, "author")).toThrow(/protected module/);
  });

  // Reusing public meta primitives never grants protected verifier code to either barrel. The
  // second spelling is the one `biome format` writes for a long specifier list, and it has to
  // refuse exactly like the flat one.
  it.each([
    ["correctness-model-prims", 'export { host } from "../../src/verify/host.ts";\n'],
    ["correctness-model-bundle", 'export {\n  host,\n  hostRoot,\n} from "../../src/verify/host.ts";\n'],
  ])("refuses src/verify/host.ts through %s", (barrel, reexport) => {
    const evil = makeFixtureRepo(`evil-${barrel}`);
    writeFileSync(join(evil.repoRoot, "vendor", barrel, "index.ts"), reexport);
    expect(() => deriveBundleContract(evil.repoRoot)).toThrow(/protected module: src\/verify\/host\.ts/);
  });

  // Type-only imports disappear at runtime, so they are not followed below the public export.
  // The read grant includes the modules needed to load the generated code. Wrapped, the statement
  // puts `from` on a line carrying no `import type`: a scan reading lines rather than statements
  // takes the erased edge for a runtime one and refuses a contract that is already correct.
  it.each([
    ["on one line", 'import type { Internal } from "../../src/verify/host.ts";'],
    ["wrapped by the formatter", 'import type {\n  Internal,\n  Other,\n} from "../../src/verify/host.ts";'],
  ])(
    "does not admit a controller internal reached only by a type edge below a barrel, %s",
    (spelling, edge) => {
      const typed = makeFixtureRepo(`typed-edge-${spelling.split(" ").join("-")}`);
      writeFileSync(
        join(typed.repoRoot, "vendor", "correctness-model-bundle", "truth-checks.ts"),
        `${edge}\nexport const declareTruthChecks: Internal = 1;\n`,
      );
      const contract = deriveBundleContract(typed.repoRoot);
      expect(contract).not.toContain(join(typed.repoRoot, "src", "verify", "host.ts"));
    },
  );
});
