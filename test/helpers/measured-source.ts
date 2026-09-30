/**
 * A run's measured source as `wri.ts read` meets it: a Git checkout at one commit whose copy of the
 * whole-run-investigation scripts is a set of stubs, and a campaign whose run opened at that commit.
 * Every stub prints `<lane> read by the stub source with <its arguments>`, so a test can tell whose
 * readers read the run and what they were asked. `wri.ts scope` answers with `STUB_SCOPE`, every
 * in-process lane records `{ triggers }` at its `--out`, and the snapshot writes the status its
 * `snapshotStatus` argument names.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { JsonValue } from "../../src/meta/json-shape.ts";
import { dirname, join } from "../../src/meta/path.ts";
import { spawnTextSync } from "./bun-spawn-sync.ts";
import { scratchDir } from "./scratch.ts";

export const STUB_RUN = "custom-stub-20260930T000000000Z-abcdef";

export const STUB_SCOPE = {
  schema: "wri-brief/v1",
  campaign: "stub",
  runId: STUB_RUN,
  startedAt: "2026-09-30T00:00:00.000Z",
  endedAt: "2026-09-30T01:00:00.000Z",
  live: false,
  hours: 1,
  epochs: 1,
  batteries: [],
  cases: { verified: 0, unaccepted: 0, nonResult: 0 },
  terminal: { outcome: "completed", reason: "completed" },
  controllerError: null,
  tier: "probe",
  lanes: ["walls"],
  semanticLanes: 6,
  why: "sized by the stub source",
};

const valueOf = "const valueOf = (flag) => Bun.argv[Bun.argv.indexOf(flag) + 1];";

export interface StubOptions {
  /** The status the snapshot records, or null for a snapshot that records none. */
  snapshotStatus?: Record<string, JsonValue> | null;
  /** The snapshot's exit code. */
  snapshotExit?: number;
  /** Extra files the snapshot writes beside its status, by name. */
  snapshotFiles?: Record<string, string>;
  /** Fields of the checkout's package.json beyond its name. */
  manifest?: Record<string, JsonValue>;
  /** Triggers every in-process lane records. */
  triggers?: JsonValue[];
}

const said = (lane: string) =>
  `console.log(${JSON.stringify(lane)} + " read by the stub source with " + Bun.argv.slice(2).join(" "));`;

function scripts({
  snapshotStatus = { schema: "outcome-snapshot-status/v2", complete: true, views: [] },
  snapshotExit = 0,
  snapshotFiles = {},
  triggers = [],
}: StubOptions) {
  const status = snapshotStatus === null ? null : { runIds: [STUB_RUN], ...snapshotStatus };
  return {
    "scripts/wri.ts": [
      valueOf,
      "const command = Bun.argv[2];",
      `if (command === "scope") console.log(JSON.stringify(${JSON.stringify(STUB_SCOPE)}));`,
      `else { await Bun.write(valueOf("--out"), JSON.stringify({ triggers: ${JSON.stringify(triggers)} })); console.log(command + " read by the stub source with " + Bun.argv.slice(3).join(" ")); }`,
    ].join("\n"),
    "scripts/trace-review.ts": [
      valueOf,
      'const out = valueOf("--out");',
      ...(status === null
        ? []
        : [`await Bun.write(out + "/snapshot-status.json", JSON.stringify(${JSON.stringify(status)}));`]),
      ...Object.entries(snapshotFiles).map(
        ([name, text]) => `await Bun.write(out + "/" + ${JSON.stringify(name)}, ${JSON.stringify(text)});`,
      ),
      said("snapshot"),
      `process.exit(${snapshotExit});`,
    ].join("\n"),
    "scripts/trace-challenge.ts": said("challenge"),
    "classifier/prose-classify.ts": said("posture"),
  };
}

function git(repo: string, ...args: string[]): string {
  const result = spawnTextSync("git", [
    "-C",
    repo,
    "-c",
    "user.email=t@example.com",
    "-c",
    "user.name=T",
    ...args,
  ]);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** A committed stub source and a campaign whose one run opened at its commit. */
export function stubSource(options: StubOptions = {}) {
  const root = scratchDir("ana-measured-source-");
  const repo = join(root, "source");
  for (const [path, text] of Object.entries(scripts(options))) {
    const file = join(repo, ".claude/skills/whole-run-investigation", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${text}\n`);
  }
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stub-source", ...options.manifest }));
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "stub source");
  const commit = git(repo, "rev-parse", "HEAD");
  const campaign = join(root, "campaign");
  mkdirSync(join(campaign, "controller", STUB_RUN), { recursive: true });
  mkdirSync(join(campaign, "versions"));
  writeFileSync(
    join(campaign, "controller", STUB_RUN, "opening.json"),
    JSON.stringify({
      schema: "campaign-opening/v2",
      runId: STUB_RUN,
      writtenAt: STUB_SCOPE.startedAt,
      source: { commit, dirty: false, sourceDigest: "d".repeat(64) },
    }),
  );
  return { repo, campaign, commit };
}
