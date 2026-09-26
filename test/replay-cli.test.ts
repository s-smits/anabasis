import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { type VerdictSide, diffVerdicts, resolveRecordedCandidate, main } from "../tools/replay/cli.ts";
import {
  writeMatchingSlug,
  MATCHING_BRIEF,
  MATCHING_TASKS,
  MATCHING_ACCEPTS,
} from "./helpers/matching-fixture.ts";
import { createSubmissionAuthority } from "../src/solve/final-submission.ts";
import { compilePublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";
import { commitPublicTask } from "../src/truth/task-split.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function replayRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-replay-reader-"));
  scratch.push(root);
  mkdirSync(join(root, "campaigns", "slug"), { recursive: true });
  return root;
}

function recordedBundle(root: string, snapshot = "snapshot-1", withSnapshot = true): void {
  const log = new EvidenceLog(join(root, "runs", "run-1"));
  log.write("battery.json", {
    runId: "run-1",
    cases: [],
    bundleSnapshot: { id: snapshot, agentHash: "a", correctnessModelHash: "b", taskSetHash: "c" },
  });
  log.record();
  if (withSnapshot) {
    const brief = join(root, ".bundle-snapshots", snapshot, "correctness-model", "brief.json");
    mkdirSync(dirname(brief), { recursive: true });
    writeFileSync(brief, "{}");
  }
}

it.each([true, false])("replays accepted bytes through the real verifier: pass=%s", async (pass) => {
  const root = replayRoot();
  const domain = join(root, "domains", "slug");
  writeMatchingSlug(join(domain, ".bundle-snapshots", "snapshot-1"));
  const log = new EvidenceLog(join(domain, "runs", "run-1"));
  log.write("battery.json", {
    runId: "run-1",
    bundleSnapshot: { id: "snapshot-1", agentHash: "a", correctnessModelHash: "b", taskSetHash: "c" },
    cases: [
      {
        taskId: "t1",
        family: "single-part",
        acceptedSubmit: true,
        truthOk: pass,
        pass,
        runtimeNonResult: null,
        runtimeNonResultKind: null,
      },
    ],
  });
  const authority = createSubmissionAuthority({
    maxAttempts: 1,
    publicArtifactSchema: compilePublicArtifactSchema(
      MATCHING_BRIEF.artifactSchema,
      MATCHING_ACCEPTS.map((row) => row.artifact),
    ),
  });
  const final = authority.acceptArtifact(
    JSON.stringify({ assignments: [{ part: "alpha", slot: pass ? "s3" : "s1" }] }),
  );
  expect(final.accepted).toBe(true);
  log.write("cases/t1/final-submission.json", capturedJsonParse(JSON.stringify(final)));
  log.write("cases/t1/public-task.json", {
    publicTaskDigest: commitPublicTask(MATCHING_TASKS[0]!).publicTaskDigest,
  });
  log.record();
  const printed = await main(["slug/run-1", "--out", "report.json"], root);
  const report = JSON.parse(printed);
  expect(report).toMatchObject({
    missingTools: [],
    cleanup: { state: "complete" },
    rows: [{ taskId: "t1", replayed: { truthOk: pass, pass, nonResultKind: null } }],
  });
  // The grading tree by commit, never by the path it happened to sit at, and the rows it reached.
  expect(report.gradedUnder.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(report.source).toBeUndefined();
  expect(report.rows[0].checkRuns.map((row: { outcome: string }) => row.outcome)).toContain(
    pass ? "pass" : "fail",
  );
  expect(report.rows[0].replayed.checkRuns).toBeUndefined();
  expect(JSON.parse(readFileSync(join(root, "report.json"), "utf8"))).toEqual(report);
  await expect(main(["slug/run-1", "--out"], root)).rejects.toThrow("usage: replay");
});

describe("resolveRecordedCandidate", () => {
  it("finds the complete archived pair after the domain retains only the old battery", () => {
    const root = replayRoot();
    recordedBundle(join(root, "domains", "slug"), "snapshot-1", false);
    const archive = join(root, "campaigns", "slug", "promotions", "run-2-replaced");
    recordedBundle(archive);
    const found = resolveRecordedCandidate("slug/run-1", root);
    expect(found.slugDir).toBe(archive);
    expect(found.runDir).toBe(join(archive, "runs", "run-1"));
    expect(found.candidateDir).toBe(join(archive, ".bundle-snapshots", "snapshot-1"));
  });

  it("refuses an incomplete pair instead of borrowing a snapshot from another root", () => {
    const root = replayRoot();
    recordedBundle(join(root, "domains", "slug"), "snapshot-1", false);
    const archive = join(root, "campaigns", "slug", "promotions", "run-2-replaced");
    recordedBundle(archive, "snapshot-2", false);
    const brief = join(archive, ".bundle-snapshots", "snapshot-1", "correctness-model", "brief.json");
    mkdirSync(dirname(brief), { recursive: true });
    writeFileSync(brief, "{}");
    expect(() => resolveRecordedCandidate("slug/run-1", root)).toThrow("no complete recorded battery");
  });

  it("refuses tampered battery evidence instead of falling back to a valid archive", () => {
    const root = replayRoot();
    const domain = join(root, "domains", "slug");
    recordedBundle(domain, "snapshot-1", false);
    writeFileSync(join(domain, "runs", "run-1", "battery.json"), "{}");
    recordedBundle(join(root, "campaigns", "slug", "promotions", "run-2-replaced"));
    expect(() => resolveRecordedCandidate("slug/run-1", root)).toThrow("tampered");
  });

  it("refuses linked archive containers, archive leaves, run roots and snapshot roots", () => {
    for (const surface of ["container", "archive", "run", "snapshot"] as const) {
      const root = replayRoot();
      const archive = join(root, "campaigns", "slug", "promotions", "run-2-replaced");
      recordedBundle(archive);
      const linked = {
        container: dirname(archive),
        archive,
        run: join(archive, "runs"),
        snapshot: join(archive, ".bundle-snapshots"),
      }[surface];
      const outside = join(replayRoot(), "moved");
      renameSync(linked, outside);
      symlinkSync(outside, linked);
      expect(() => resolveRecordedCandidate("slug/run-1", root)).toThrow("no complete recorded battery");
    }
  });

  it("keeps linked output collections usable but refuses a linked domain leaf", () => {
    const root = replayRoot();
    const shared = replayRoot();
    recordedBundle(join(shared, "domains", "slug"));
    symlinkSync(join(shared, "domains"), join(root, "domains"));
    expect(resolveRecordedCandidate("slug/run-1", root).slugDir).toBe(join(root, "domains", "slug"));
    const outside = join(replayRoot(), "moved");
    renameSync(join(shared, "domains", "slug"), outside);
    symlinkSync(outside, join(shared, "domains", "slug"));
    expect(() => resolveRecordedCandidate("slug/run-1", root)).toThrow("no complete recorded battery");
  });

  it("refuses snapshot traversal even when the record itself is attested", () => {
    const root = replayRoot();
    recordedBundle(join(root, "domains", "slug"), "../outside");
    expect(() => resolveRecordedCandidate("slug/run-1", root)).toThrow("safe single path segment");
  });
});

function side(over: Partial<VerdictSide> = {}): VerdictSide {
  return { truthOk: true, pass: true, nonResultKind: null, nonResult: null, failedCheckIds: [], ...over };
}

describe("diffVerdicts", () => {
  const recorded = new Map<string, VerdictSide>([
    ["t-pass", side()],
    ["t-fail", side({ truthOk: false, pass: false, failedCheckIds: ["b-check", "a-check"].sort() })],
    ["t-drift", side({ truthOk: false, pass: false, failedCheckIds: ["a-check"] })],
    ["t-tool", side({ truthOk: false, pass: false, failedCheckIds: ["target-compiles"] })],
  ]);

  it("counts same, changed and non-result rows from the replayed side", () => {
    const { rows, summary } = diffVerdicts(
      recorded,
      [
        {
          taskId: "t-pass",
          truthOk: true,
          pass: true,
          nonResultKind: null,
          nonResult: null,
          failedCheckIds: [],
        },
        {
          taskId: "t-fail",
          truthOk: false,
          pass: false,
          nonResultKind: null,
          nonResult: null,
          failedCheckIds: ["b-check", "a-check"],
        },
        {
          taskId: "t-drift",
          truthOk: true,
          pass: true,
          nonResultKind: null,
          nonResult: null,
          failedCheckIds: [],
        },
        {
          taskId: "t-tool",
          truthOk: null,
          pass: null,
          nonResultKind: "verifierUnavailable",
          nonResult: "tool never started",
          failedCheckIds: [],
        },
      ],
      2,
    );
    expect(rows.map((row) => [row.taskId, row.same])).toEqual([
      ["t-pass", true],
      ["t-fail", true],
      ["t-drift", false],
      ["t-tool", false],
    ]);
    expect(summary).toEqual({ cases: 4, same: 2, changed: 2, nonResults: 1, skippedUnaccepted: 2 });
  });

  it("marks a recorded case that received no replayed row as a not-replayed non-result", () => {
    const { rows, summary } = diffVerdicts(new Map([["t-pass", side()]]), []);
    expect(rows[0]?.replayed.nonResultKind).toBe("not-replayed");
    expect(rows[0]?.same).toBe(false);
    expect(summary).toEqual({ cases: 1, same: 0, changed: 1, nonResults: 1, skippedUnaccepted: 0 });
  });

  it("treats a differing failed check set as changed even when the booleans agree", () => {
    const { summary } = diffVerdicts(
      new Map([["t-fail", side({ truthOk: false, pass: false, failedCheckIds: ["a-check"] })]]),
      [
        {
          taskId: "t-fail",
          truthOk: false,
          pass: false,
          nonResultKind: null,
          nonResult: null,
          failedCheckIds: ["a-check", "b-check"],
        },
      ],
    );
    expect(summary.changed).toBe(1);
  });
});
