/**
 * The Darwin Seatbelt half: every case here spawns a sandbox-exec child and reads what it could
 * actually reach, so a passing guardPath decision is never taken for enforcement. The corpus spans
 * each rule class, because the agreement between the decision and the OS is the warranty.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import {
  CandidateIsolationRefusal,
  CandidateIsolationUnavailable,
  openPathRecord,
  readPathRecordRows,
  runIsolated,
} from "../src/builder/candidate-isolation-runtime.ts";
import {
  CANDIDATE_ISOLATION_GUARD_ID,
  deriveCandidateIsolation,
  guardPath,
} from "../src/builder/candidate-isolation.ts";
import { candidateIsolationProfile } from "../src/builder/candidate-isolation-profile.ts";
import { bashEnv } from "../src/builder/bash-install-env.ts";
import type { OptionalEnvValues } from "../src/backends/scrub-env.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { darwinSeatbeltSupport } from "../src/verify/darwin-seatbelt.ts";
import { PROTECTED_HOME_NAMES } from "../src/verify/wall-policy.ts";
import { proveCandidateIsolation } from "./helpers/candidate-isolation-proof.ts";
import { makeIsolationRepo, seedFile } from "./helpers/isolation-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
afterAll(cleanupScratch);
const DARWIN = darwinSeatbeltSupport().ok;
const protectedHomeReadRoots = (): string[] => PROTECTED_HOME_NAMES.map((name) => join(homedir(), name));
const { repoRoot, binding } = makeIsolationRepo(SCRATCH, "repo");
const policy = deriveCandidateIsolation(binding, "author");

/** One command under a Seatbelt profile, with no environment, as the isolation runs it. */
const sandboxed = (profile: string, ...argv: string[]) =>
  spawnSync("/usr/bin/sandbox-exec", ["-p", profile, ...argv], { env: {}, timeout: 10_000 });

describe.if(DARWIN)("executed OS enforcement", () => {
  it("writes physical only on the three-way probe conjunction, and refuses without the mechanism", () => {
    const proof = proveCandidateIsolation(policy, binding);
    expect(proof.kind).toBe("proven");
    if (proof.kind === "proven") {
      expect(proof.policyDigest).toBe(policy.digest);
      expect(proof.checks).toEqual({ denyRefused: true, controlAllowed: true, discriminationLeaked: true });
    }
    const absent = proveCandidateIsolation(policy, binding, { platform: "linux" });
    expect(absent).toMatchObject({ kind: "non-result", reason: "mechanism-unavailable" });
  });

  it("keeps every secret name denied in the home and the repository, and only there", () => {
    // The census the narrowing was decided on. All fourteen names from BUILDER_SECRET_PATH_PATTERNS
    // are seeded in the three places one can live, so a wrongly-allowed read succeeds rather than
    // failing on a missing file. Location is what protects them: the home roots and the repository
    // are denied by subpath, above and independent of any name. Inside the cell's own tree the
    // key-shaped names are the cell's own bytes and readable; the config names a later host process
    // would obey stay denied there too.
    const names = [
      ".env",
      ".env.local",
      "auth.json",
      "x.pem",
      "x.key",
      "x.p12",
      "x.pfx",
      "id_rsa",
      "id_dsa",
      "id_ecdsa",
      "id_ed25519",
      ".npmrc",
      ".netrc",
      join(".codex", "hooks.json"),
    ];
    const homeDecoy = join(homedir(), "ana-isolation-census-decoy");
    const places = {
      home: homeDecoy,
      repository: join(repoRoot, "census-decoy"),
      cell: join(binding.ossRoot, "census-decoy"),
    };
    for (const root of Object.values(places)) for (const name of names) seedFile(join(root, name), "DECOY\n");
    try {
      for (const purpose of ["author", "workshop"] as const) {
        const cellPolicy = deriveCandidateIsolation(binding, purpose);
        const { profile } = candidateIsolationProfile(cellPolicy, "exec");
        const readable = (root: string) =>
          names.filter((name) => sandboxed(profile, "/bin/cat", join(root, name)).status === 0);
        expect(readable(places.home), `${purpose} home`).toEqual([]);
        expect(readable(places.repository), `${purpose} repository`).toEqual([]);
        // Location still owns the roots that hold the real ones.
        // Read the contents, not the metadata: `file-read-metadata` is granted everywhere, so `ls`
        // on a denied file still succeeds and would prove nothing.
        for (const root of protectedHomeReadRoots()) {
          const probe = existsSync(root) && statSync(root).isDirectory() ? join(root, ".") : root;
          expect(sandboxed(profile, "/bin/cat", probe).status, `${purpose} ${root}`).not.toBe(0);
        }
        // The authoring profile denies the workshop tree wholesale, so only the workshop sees its own.
        expect(readable(places.cell), `${purpose} cell`).toEqual(
          purpose === "workshop"
            ? [
                "x.pem",
                "x.key",
                "x.p12",
                "x.pfx",
                "id_rsa",
                "id_dsa",
                "id_ecdsa",
                "id_ed25519",
                // An agent directory is material an agent may read; `auth.json` inside one is still
                // denied by name, and the real ones under the home roots by location.
                join(".codex", "hooks.json"),
              ]
            : [],
        );
      }
    } finally {
      rmSync(homeDecoy, { recursive: true, force: true });
    }
  });

  it("reads public certificate material while every real credential stays denied by location", () => {
    // The suffix denies used to cover `*.pem` and `*.key`, which on these profiles could only ever
    // match public material or the cell's own bytes: both home roots and the repository are denied
    // wholesale by subpath, above and independent of any suffix. Keeping the suffixes cost the host
    // trust store on the one profile that reaches the network.
    for (const purpose of ["author", "workshop"] as const) {
      const cellPolicy = deriveCandidateIsolation(binding, purpose);
      const { profile } = candidateIsolationProfile(cellPolicy, "exec");
      const reads = (target: string) => sandboxed(profile, "/bin/cat", target).status === 0;
      expect(reads("/private/etc/ssl/cert.pem"), `${purpose} trust store`).toBe(true);
      for (const secret of [
        join(homedir(), ".ssh", "id_ed25519"),
        join(homedir(), ".codex", "auth.json"),
        join(repoRoot, ".env"),
      ]) {
        expect(reads(secret), `${purpose} ${secret}`).toBe(false);
      }
    }
  });

  it("ends the key-suffix deny at the name and reads a measured prefix literally", () => {
    // Two regex spellings the profile must not widen, each checked where it is the last matching
    // rule Seatbelt sees. `*.p12` decides inside the host scratch grant the deny is emitted under;
    // `census.json` decides inside the candidate tree, where the measured denies come last of all.
    const { binding: named } = makeIsolationRepo(SCRATCH, "anchored-names");
    const namedPolicy = deriveCandidateIsolation(named, "author");
    const { profile } = candidateIsolationProfile(namedPolicy, "read", ["/bin/cat"]);
    const reads = (path: string) => sandboxed(profile, "/bin/cat", path).status === 0;
    for (const [name, open] of [
      ["key.p12.bak", true],
      ["key.p12", false],
    ] as const) {
      expect(reads(seedFile(join(SCRATCH, "anchored-scratch", name), "seeded\n")), name).toBe(open);
    }
    // A dot in a measured name is a dot, so censusXjson beside census.json is the Builder's own
    // file. The guard reads it the same way, which is the agreement this compartment exists for.
    for (const [name, open] of [
      ["censusXjson", true],
      ["census.json", false],
    ] as const) {
      const path = seedFile(join(named.iterationDir, name), "seeded\n");
      expect(reads(path), name).toBe(open);
      expect(guardPath(namedPolicy, "read", "read", path).decision, name).toBe(open ? "allow" : "deny");
    }
  });

  it("lets a cell write its own key-shaped bytes but never a name another program reads as config", () => {
    // A file the cell can create and not read back is the useless combination, and a public
    // verification key is exactly what an installer must write and then read. Config names stay
    // denied in both directions: those are executed or obeyed by the next process, not just stored.
    const cellPolicy = deriveCandidateIsolation(binding, "workshop");
    const { profile } = candidateIsolationProfile(cellPolicy, "exec");
    const roundTrips = (name: string) => {
      const target = join(binding.ossRoot, name);
      const wrote = sandboxed(profile, "/usr/bin/touch", target).status === 0;
      const read = sandboxed(profile, "/bin/cat", target).status === 0;
      return { wrote, read };
    };
    for (const name of ["homebrew-1.pem", "server.key", "id_ed25519"]) {
      expect(roundTrips(name), name).toEqual({ wrote: true, read: true });
    }
    for (const name of [".npmrc", ".env", "auth.json"]) {
      expect(roundTrips(name), name).toEqual({ wrote: false, read: false });
    }
  });

  it("exempts the cell's own HOME from the config-name denies without exempting the tree around it", () => {
    // `workshopEnvironment` puts HOME, the caches and TMPDIR inside the cell, so `npm config set`
    // writes `$HOME/.npmrc` — a name nothing outside the cell reads. The exemption is those exact
    // directories only: the same name one level up, in the cell's shared tree, stays denied.
    const cellPolicy = deriveCandidateIsolation(binding, "workshop");
    const { profile } = candidateIsolationProfile(cellPolicy, "exec");
    const writes = (target: string) => {
      mkdirSync(join(target, ".."), { recursive: true });
      return sandboxed(profile, "/usr/bin/touch", target).status === 0;
    };
    for (const root of cellPolicy.cellRuntimeRoots) {
      for (const name of [".npmrc", ".netrc", ".env"]) {
        expect(writes(join(root, name)), join(root, name)).toBe(true);
      }
    }
    for (const name of [".npmrc", ".netrc", ".env"]) {
      expect(writes(join(binding.ossRoot, name)), name).toBe(false);
    }
  });

  it("agrees with the OS on a corpus spanning every rule class (the anti-bb15 warranty)", () => {
    const { profile } = candidateIsolationProfile(policy, "read", ["/bin/cat"]);
    // Segment-denied evidence are seeded so a wrongly-allowed read would succeed, not fail on a
    // missing file; the near-miss names prove the OS profile does not over-deny either.
    seedFile(join(binding.iterationDir, "verifier-non-result.json"), "PROTECTED-STDERR-TAIL\n");
    seedFile(
      join(binding.epochDir, "evidence-builder-authoring", "02-1690000000000-4242.json"),
      "ATTEMPT-EVIDENCE\n",
    );
    seedFile(join(binding.iterationDir, "slug", "census2.json"), "authored near-miss\n");
    seedFile(join(binding.iterationDir, "slug", "casefoo.json"), "authored near-miss\n");
    seedFile(
      join(binding.iterationDir, ".bundle-snapshots", "accepted", "agent", "tools.ts"),
      "ACCEPTED-CODE\n",
    );
    seedFile(join(binding.epochDir, "verifier-admission-old.json"), "DURABLE-ADMISSION\n");
    const corpus = [
      join(binding.iterationDir, "slug", "correctness-model", "brief.json"),
      join(repoRoot, "asks", "hw", "ask.md"),
      join(repoRoot, "node_modules", "pkg", "index.js"),
      join(repoRoot, "asks", "hw", "verifier.py"),
      join(repoRoot, "asks", "other", "ask.md"),
      join(repoRoot, "domains", "adopted", "tasks.json"),
      join(repoRoot, "src", "verify", "host.ts"),
      join(repoRoot, "controller-private.txt"),
      join(repoRoot, ".env"),
      join(binding.iterationDir, "census.json"),
      join(binding.iterationDir, "verifier-non-result.json"),
      join(binding.iterationDir, ".bundle-snapshots", "accepted", "agent", "tools.ts"),
      join(binding.epochDir, "verifier-admission-old.json"),
      join(binding.epochDir, "evidence-builder-authoring", "02-1690000000000-4242.json"),
      join(binding.iterationDir, "slug", "census2.json"),
      join(binding.iterationDir, "slug", "casefoo.json"),
    ];
    for (const target of corpus) {
      const guard = guardPath(policy, "read", "read", target).decision;
      const os = sandboxed(profile, "/bin/cat", target);
      expect(guard === "allow" ? os.status === 0 : os.status !== 0, target).toBe(true);
    }
  });

  it("allows candidate writes and refuses repository writes and secret reads under the exec profile", () => {
    const { profile } = candidateIsolationProfile(policy, "exec", ["/bin/sh"]);
    const sh = (command: string) => sandboxed(profile, "/bin/sh", "-c", command);
    expect(sh(`echo authored > ${join(binding.iterationDir, "slug", "note.txt")}`).status).toBe(0);
    expect(sh(`echo evil > ${join(repoRoot, "pwned.txt")}`).status).not.toBe(0);
    expect(sh(`cat ${join(repoRoot, ".env")}`).stdout).not.toContain("SECRET=1");
    expect(sh(`cat ${join(binding.iterationDir, "census.json")}`).stdout).not.toContain("remedy");
  });

  it("writes the launch's temporary directory, which the wall only ever sees resolved", () => {
    // A detached launch freezes TMPDIR under `/var/tmp`, and Seatbelt evaluates the resolved
    // `/private/var/tmp`: a scratch grant naming only the spelling refused every mktemp and
    // compiler scratch file the Builder's shell made there, whichever spelling the shell used.
    const launch = mkdtempSync(join("/var/tmp", "ana-scratch-grant-"));
    try {
      const { profile } = candidateIsolationProfile(policy, "exec", ["/usr/bin/touch"]);
      for (const target of [join(launch, "spelled"), join(realpathSync.native(launch), "resolved")]) {
        const touched = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/touch", target], {
          env: {},
          timeout: 10_000,
        });
        expect(touched.status, target).toBe(0);
      }
    } finally {
      rmSync(launch, { recursive: true, force: true });
    }
  });

  it("resolves a linked package's hoisted dependency from the Builder cell's environment", () => {
    // The workspace links each repository package as `linkWorkspacePackageScopes` does; the wall
    // never lists the repository root, so resolving from a package's real path misses its sibling.
    const modules = join(repoRoot, "node_modules");
    seedFile(join(modules, "linked-pkg", "package.json"), '{"name":"linked-pkg","type":"module"}\n');
    seedFile(join(modules, "linked-pkg", "index.js"), 'export { value } from "hoisted-dep";\n');
    seedFile(join(modules, "hoisted-dep", "package.json"), '{"name":"hoisted-dep","type":"module"}\n');
    seedFile(join(modules, "hoisted-dep", "index.js"), 'export const value = "HOISTED";\n');
    const workspaceModules = join(binding.iterationDir, "node_modules");
    mkdirSync(workspaceModules, { recursive: true });
    for (const name of ["linked-pkg", "hoisted-dep"]) {
      symlinkSync(join(modules, name), join(workspaceModules, name));
    }
    const bun = runtimeProcess.execPath;
    const { profile } = candidateIsolationProfile(policy, "exec", [bun]);
    const env = bashEnv(binding.iterationDir);
    const load = (childEnv: OptionalEnvValues) =>
      spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", profile, bun, "--no-env-file", "-e", 'console.log((await import("linked-pkg")).value)'],
        { cwd: binding.iterationDir, env: childEnv, timeout: 30_000 },
      );
    const resolved = load(env);
    expect(resolved.stdout.trim()).toBe("HOISTED");
    const realPath = load({ ...env, NODE_PRESERVE_SYMLINKS: undefined });
    expect(realPath.status).not.toBe(0);
    expect(realPath.stderr).toContain("Cannot find package 'hoisted-dep'");
  });

  it("closes ordinary host-home files while keeping the candidate tree reachable", () => {
    const homeScratch = mkdtempSync(join(homedir(), ".ana-isolation-stat-"));
    const canary = join(homeScratch, "canary.txt");
    writeFileSync(canary, "HOST-HOME-CANARY");
    try {
      const { profile } = candidateIsolationProfile(policy, "exec", ["/bin/sh"]);
      const sh = (command: string) => sandboxed(profile, "/bin/sh", "-c", command);
      // Reachability: the ancestors of the candidate tree stat, so its own files open.
      expect(sh(`stat -f%N ${homedir()} && stat -f%N ${repoRoot}`).status).toBe(0);
      expect(
        sh(`cat ${join(binding.iterationDir, "slug", "correctness-model", "brief.json")}`).stdout,
      ).toContain("authored");
      expect(sh(`cat ${canary}`).stdout).not.toContain("HOST-HOME-CANARY");
      expect(sh(`ls ${homeScratch}`).status).not.toBe(0);
      expect(sh(`cat ${join(homedir(), ".ssh", "id_ed25519")}`).status).not.toBe(0);
      expect(sh(`ls ${repoRoot}`).status).not.toBe(0);
      expect(sh(`cat ${join(binding.iterationDir, "census.json")}`).stdout).not.toContain("remedy");
    } finally {
      rmSync(homeScratch, { recursive: true, force: true });
    }
  });

  it("does not widen an exec child from one executable to the repository or a protected root", () => {
    // `extraReadPaths` grants the one executable a spawned command needs, and the question is
    // whether that grant leaks sideways into the repository or host home.
    const { profile } = candidateIsolationProfile(policy, "exec", ["/bin/cat"]);
    const reads = (target: string) => sandboxed(profile, "/bin/cat", target);
    expect(reads(join(repoRoot, ".env")).status).not.toBe(0);
    expect(reads(join(homedir(), ".ssh", "id_ed25519")).status).not.toBe(0);
  });

  it("opens the correctness barrel's directory whole and keeps src/correctness-bundle closed entirely", () => {
    // The contract's runtime half sits beside its barrel under vendor/ (2026-09-02), so the grant
    // is one directory the Builder's `bun test` can list and load from, and src/correctness-bundle
    // carries no granted file that would need its listing opened. Both halves executed here: the
    // barrel directory lists its runtime file, and a file under src/correctness-bundle or under
    // src/review, which holds the Judge's source, is neither listable nor readable.
    const contractFile = policy.allow.read.find(
      (rule) =>
        rule.id === "bundle-contract" &&
        rule.path.endsWith(join("correctness-model-bundle", "truth-checks.ts")),
    )?.path;
    if (contractFile === undefined) throw new Error("fixture has no correctness-model-bundle runtime file");
    const parent = dirname(contractFile);
    const protectedDirs = ["correctness-bundle", "review"].map((dir) => join(repoRoot, "src", dir));
    const protectedFiles = protectedDirs.map((dir) => join(dir, "protected-source.ts"));
    for (const file of protectedFiles) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "PROTECTED-BYTES");
    }
    try {
      const { profile } = candidateIsolationProfile(policy, "exec", ["/bin/ls", "/bin/cat"]);
      const run = (argv: string[]) => sandboxed(profile, ...argv);
      const listed = run(["/bin/ls", parent]);
      expect(listed.status).toBe(0);
      expect(listed.stdout).toContain("truth-checks.ts");
      for (const [index, dir] of protectedDirs.entries()) {
        expect(run(["/bin/ls", dir]).status).not.toBe(0);
        const read = run(["/bin/cat", protectedFiles[index] ?? dir]);
        expect(read.status).not.toBe(0);
        expect(read.stdout).not.toContain("PROTECTED-BYTES");
      }
    } finally {
      for (const file of protectedFiles) rmSync(file, { force: true });
    }
  });

  it("author exec reaches a localhost listener while the workshop cell cannot", () => {
    // `Bun.listen` returns a bound server whose `port` is a number, so the fixture needs neither a
    // bind promise nor an assertion about what `address()` returned.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open: (socket) => {
          socket.end();
        },
        data: () => {},
      },
    });
    const { port } = server;
    try {
      const author = candidateIsolationProfile(policy, "exec", ["/usr/bin/nc"]).profile;
      const open = sandboxed(author, "/usr/bin/nc", "-z", "127.0.0.1", String(port));
      expect(open.status).toBe(0);
      const cell = candidateIsolationProfile(deriveCandidateIsolation(binding, "workshop"), "exec", [
        "/usr/bin/nc",
      ]).profile;
      const refused = sandboxed(cell, "/usr/bin/nc", "-z", "127.0.0.1", String(port));
      expect(refused.status).not.toBe(0);
    } finally {
      server.stop(true);
    }
  });

  it("runIsolated: records both checks on allow, refuses on deny without spawning, leaks no remedy text", async () => {
    const record = openPathRecord(binding.epochDir, "session-1");
    const target = join(binding.iterationDir, "slug", "correctness-model", "brief.json");
    const outcome = await runIsolated(policy, record, {
      capability: "read",
      mode: "read",
      command: "/bin/cat",
      args: [target],
      cwd: repoRoot,
      paths: [target],
    });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("authored");
    let refusal: unknown;
    try {
      await runIsolated(policy, record, {
        capability: "read",
        mode: "read",
        command: "/bin/cat",
        args: [join(binding.iterationDir, "census.json")],
        cwd: repoRoot,
        paths: [join(binding.iterationDir, "census.json")],
      });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(CandidateIsolationRefusal);
    if (!(refusal instanceof CandidateIsolationRefusal)) throw new Error("measured read was not refused");
    expect(refusal.message).not.toContain("remedy");
    expect(refusal.message).not.toContain("OpenSees");
    const raw = readPathRecordRows(record.path);
    expect(raw).toHaveLength(2);
    expect(raw.filter((row) => row.decision === "allow")).toHaveLength(1);
    expect(raw.filter((row) => row.decision === "deny")).toHaveLength(1);
    expect(raw.filter((row) => row.reason === "deny/measured")).toHaveLength(1);
    expect(raw[0]).toMatchObject({
      guardId: CANDIDATE_ISOLATION_GUARD_ID,
      enforcement: "os-allowed",
      policyDigest: policy.digest,
    });
    expect(raw[1]).toMatchObject({ enforcement: "guard-denied", profileDigest: null });
  });

  it("refuses malformed persisted path rows before resuming their sequence", () => {
    const epoch = mkdtempSync(join(tmpdir(), "ana-path-record-"));
    const path = join(epoch, "builder-path-record.jsonl");
    try {
      writeFileSync(path, '{"seq":"1","decision":"allow"}\n');
      expect(() => readPathRecordRows(path)).toThrow(/malformed path record row/);
      expect(() => openPathRecord(epoch, "resumed")).toThrow(/malformed path record row/);
    } finally {
      rmSync(epoch, { recursive: true, force: true });
    }
  });

  it("fails closed with no environment bypass: an unavailable or outer-sandboxed mechanism refuses", async () => {
    const record = openPathRecord(binding.epochDir, "session-2");
    const target = join(binding.iterationDir, "slug", "correctness-model", "brief.json");
    const request = {
      capability: "read",
      mode: "read" as const,
      command: "/bin/cat",
      args: [target],
      cwd: repoRoot,
      paths: [target],
    };
    await expect(runIsolated(policy, record, request, { platform: "linux" })).rejects.toBeInstanceOf(
      CandidateIsolationUnavailable,
    );
    await expect(runIsolated(policy, record, request, { outerSandboxed: true })).rejects.toBeInstanceOf(
      CandidateIsolationUnavailable,
    );
    expect(record.count()).toBe(0);
  });
});
