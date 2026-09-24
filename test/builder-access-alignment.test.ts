import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { deriveCandidateIsolation, guardPath } from "../src/builder/candidate-isolation.ts";

/** Expected access through the shared host-tool policy. */
type AccessExpectation = {
  path: string;
  read: boolean | null;
  write: boolean | null;
  why: string;
};

/** Every backend uses this CandidateAccessPolicy for its host-dispatched filesystem tools.
 * The shared verdict table exercises guardPath; OS execution is proved in candidate-isolation
 * and the production mount test, not by mirroring a provider SDK's precedence rules. */

/** The shared verdicts for a Builder session on `workspace`, on any backend. */
function builderAccessExpectations(workspace: string): AccessExpectation[] {
  const home = Bun.env.HOME ?? "/Users/nobody";
  return [
    { path: join(workspace, "agent", "tools.ts"), read: true, write: true, why: "the session's own tree" },
    {
      path: join(workspace, "node_modules", "@ana", "core", "index.ts"),
      read: null,
      write: false,
      why: "the vendor shadow stays host-owned; whether it is readable is the backend's own choice",
    },
    { path: "/tmp/ana-probe.txt", read: true, write: true, why: "OS scratch the SDKs themselves need" },
    { path: join(home, ".ssh", "config"), read: false, write: false, why: "a protected home name" },
    { path: join(home, "ordinary.txt"), read: false, write: false, why: "ordinary host-home state" },
    {
      path: join(dirname(home), "Shared", ".zshrc"),
      read: false,
      write: false,
      why: "what sits beside the operator's home stays closed",
    },
    {
      path: join(home, ".codex", "auth.json"),
      read: false,
      write: false,
      why: "a live credential beside a network grant",
    },
    {
      path: join(home, ".codex", "sessions", "rollout.jsonl"),
      read: false,
      write: false,
      why: "no Builder writes codex rollouts, so the home keeps them closed",
    },
  ];
}

const within = (path: string, root: string): boolean =>
  root === "/" || path === root || path.startsWith(`${root}/`);

describe("Builder wall alignment", () => {
  // The host isolation boundary is bound to real directories, with the table rooted at its workspace.
  const hostRepo = mkdtempSync(join(tmpdir(), "ana-align-host-"));
  const hostEpoch = join(hostRepo, "campaigns", "hw", "epoch-1");
  const hostWorkspace = join(hostEpoch, "02-hw");
  mkdirSync(hostWorkspace, { recursive: true });
  mkdirSync(join(hostEpoch, ".oss"), { recursive: true });
  // The derivation walks the vendor barrels to admit their closures; empty barrels suffice here.
  for (const barrel of ["agent-bundle", "correctness-model-bundle", "correctness-model-prims"]) {
    mkdirSync(join(hostRepo, "vendor", barrel), { recursive: true });
    writeFileSync(join(hostRepo, "vendor", barrel, "index.ts"), "export {};\n");
  }
  afterAll(() => rmSync(hostRepo, { recursive: true, force: true }));
  const hostPolicy = deriveCandidateIsolation(
    {
      repoRoot: hostRepo,
      slug: "hw",
      epochDir: hostEpoch,
      iterationDir: hostWorkspace,
      ossRoot: join(hostEpoch, ".oss"),
    },
    "author",
  );
  function hostHalf(mode: "read" | "write", path: string): boolean {
    const guard = guardPath(hostPolicy, "align", mode, path);
    if (guard.decision === "allow") return true;
    // In-process file tools ask guardPath; a spawned command reaches the OS scratch roots
    // through the runIsolated wall instead. Only a path the in-process wall does not cover
    // falls through to that grant — an explicit deny (shadow, secret, measured) binds both.
    if (guard.reason !== "deny/outside-allow") return false;
    return hostPolicy.scratchWriteRoots.some((root) => within(guard.resolved ?? path, root));
  }
  const hostVerdict = (path: string) => ({ read: hostHalf("read", path), write: hostHalf("write", path) });
  for (const row of builderAccessExpectations(hostWorkspace)) {
    it(`host policy expresses: ${row.why} (${row.path})`, () => {
      const verdict = hostVerdict(row.path);
      if (row.read !== null) expect(verdict.read).toBe(row.read);
      if (row.write !== null) expect(verdict.write).toBe(row.write);
    });
  }
});
