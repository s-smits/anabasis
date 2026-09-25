/**
 * These cases run the archive writer itself rather than a second interpretation of its safeguard
 * fields, because a test that re-derived the fields would only ever agree with itself. What the
 * writer has to get right is the difference between not knowing and knowing zero: an absent log
 * stays distinct from an observed zero, a malformed log is not a complete zero even when the
 * primary asks for completeness, and an observed zero is claimed only after an explicit byte-bound
 * reconciliation.
 *
 * The rest is provenance. A stderr-only firing counts, while unrelated text and the terminal line
 * are not receipts. A firing routes only from the primary's adjudication and never from its count.
 * And a firing invents no independent review, while an explicit review is invalidated once the
 * source drifts underneath it.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { join, resolve } from "../src/meta/path.ts";
import { scaffoldArchive } from "../.claude/skills/whole-run-investigation/scripts/archive-scaffold.mjs";
import {
  ArchiveValidationError,
  validateArchiveDirectory,
} from "../.claude/skills/whole-run-investigation/scripts/validate-archive.mjs";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const RUN = "review-evidence-fixture";
const SENSOR = "99-test-sensor";
const LINE = `2026-09-13T12:00:00.000Z | ${SENSOR} | fixture\n`;
type Coverage = { complete: boolean; t0: boolean; t1: boolean };
type SensorRow = {
  id: string;
  status: string;
  count: number | null;
  countSource: string | null;
  coverage: Coverage;
  firing: { state: string };
  logReceipt: { state: string };
  stderrReceipt: { state: string };
  processReceipt: { state: string };
  retirement: { independentReview?: { reviewed: boolean; reason?: string } };
  route: { state: string; owner: string; reason?: string };
};
type Archive = {
  safeguards: SensorRow[];
  safeguardEvidence: Record<string, JsonValue>;
  safeguardReconciliation: { bytesVerified: boolean };
};

afterAll(cleanupScratch);
const writeJson = (path: string, value: JsonValue) => writeFileSync(path, `${JSON.stringify(value)}\n`);

function fixture(log: string | null = null) {
  const review = scratchDir("ana-wri-evidence-");
  const repo = join(review, "source");
  const campaign = join(review, "campaign");
  const controller = join(campaign, "controller", RUN);
  const logDir = join(campaign, "safeguards", RUN);
  const snapshot = join(review, "snapshot");
  for (const dir of [join(repo, "src", "meta"), controller, logDir, snapshot]) {
    mkdirSync(dir, { recursive: true });
  }
  const caller = join(repo, "src", "meta", "caller.ts");
  writeFileSync(caller, `safeguardTriggered("${SENSOR}", "fixture");\n`);
  writeFileSync(join(repo, "src", "meta", "safeguard.ts"), "export function safeguardTriggered() {}\n");
  const logFile = join(logDir, "SAFEGUARDS_LOG.txt");
  if (log !== null) writeFileSync(logFile, log);
  writeJson(join(controller, "terminal.json"), {
    outcome: "completed",
    epoch: "epoch-test",
  });
  writeJson(join(snapshot, "snapshot-status.json"), {
    source: { commit: "a".repeat(40), sourceDigest: "b".repeat(64) },
    opening: { path: join(controller, "opening.json") },
  });
  writeJson(join(review, "wri-review.json"), {
    runId: RUN,
    campaign,
    repo,
    reviewCheckout: resolve(import.meta.dirname, ".."),
  });
  return { review, logFile, caller, stderr: join(review, "stderr.log") };
}

function build(review: string): Archive {
  scaffoldArchive(review);
  return parseJsonAs<Archive>(readFileSync(join(review, "archive", "review.json"), "utf8"));
}

function sensor(archive: Archive): SensorRow {
  const row = archive.safeguards.find((item) => item.id === SENSOR);
  if (row === undefined) throw new Error("fixture sensor was not inventoried");
  return row;
}

function decide(review: string, changes: Record<string, JsonValue>): void {
  const path = join(review, "verdicts.json");
  const verdicts = parseJsonAs<{ safeguards: Record<string, JsonValue> }>(readFileSync(path, "utf8"));
  verdicts.safeguards = { ...verdicts.safeguards, ...changes };
  writeJson(path, verdicts);
}

function reconcile(review: string, archive: Archive): void {
  decide(review, {
    reconciliation: {
      evidence: archive.safeguardEvidence,
      t0: true,
      t1: true,
      reason: "Primary reconciled the fixture's exact source and log bytes.",
    },
  });
}

function archiveIssues(review: string): string[] {
  try {
    validateArchiveDirectory(join(review, "archive"));
  } catch (cause) {
    if (!(cause instanceof ArchiveValidationError)) throw cause;
    return cause.issues;
  }
  return [];
}

describe("recorded safeguard evidence", () => {
  it("keeps an absent log distinct from an observed zero and invents no completeness", () => {
    const fx = fixture();
    const archive = build(fx.review);
    expect(sensor(archive)).toMatchObject({
      status: "inconclusive",
      count: null,
      countSource: null,
      firing: { state: "inconclusive" },
      coverage: { complete: false, t0: false, t1: false },
    });
    expect(archive.safeguardReconciliation.bytesVerified).toBe(false);
    expect(sensor(archive).retirement.independentReview).toBeUndefined();
  });

  it("claims an observed zero only after an explicit byte-bound reconciliation", () => {
    const fx = fixture("");
    const first = build(fx.review);
    expect(sensor(first)).toMatchObject({ count: 0, status: "inconclusive" });
    reconcile(fx.review, first);
    const reviewed = build(fx.review);
    expect(reviewed.safeguardReconciliation.bytesVerified).toBe(true);
    expect(sensor(reviewed)).toMatchObject({
      count: 0,
      status: "not-fired",
      coverage: { complete: true, t0: true, t1: true },
    });
    writeFileSync(fx.logFile, LINE);
    const moved = build(fx.review);
    expect(moved.safeguardReconciliation.bytesVerified).toBe(false);
    expect(sensor(moved)).toMatchObject({
      count: 1,
      firing: { state: "fired" },
      coverage: { complete: false },
    });
  });

  it("counts stderr-only firings without treating unrelated text or the terminal as a receipt", () => {
    const fx = fixture();
    build(fx.review);
    writeFileSync(fx.stderr, `ordinary mention of ${SENSOR}\n[safeguard] ${LINE}[safeguard] ${LINE}`);
    decide(fx.review, { stderrLog: fx.stderr, stderrOnlyIds: [SENSOR] });
    const row = sensor(build(fx.review));
    expect(row).toMatchObject({
      status: "fired",
      count: 2,
      countSource: "stderr",
      logReceipt: { state: "inconclusive" },
      stderrReceipt: { state: "present" },
      processReceipt: { state: "inconclusive" },
      coverage: { complete: false },
    });
    expect(row.retirement.independentReview).toBeUndefined();
  });

  it("does not invent an independent review from a firing and invalidates an explicit one after source drift", () => {
    const fx = fixture(LINE);
    const first = build(fx.review);
    expect(sensor(first).retirement.independentReview).toBeUndefined();
    reconcile(fx.review, first);
    decide(fx.review, {
      independentReviews: {
        [SENSOR]: { reviewed: true, reason: "Independent fixture review recorded.", anchor: "#safeguards" },
      },
    });
    expect(sensor(build(fx.review)).retirement.independentReview).toMatchObject({
      reviewed: true,
      reason: "Independent fixture review recorded.",
    });
    writeFileSync(fx.caller, `// source changed\nsafeguardTriggered("${SENSOR}", "fixture");\n`);
    const moved = build(fx.review);
    expect(moved.safeguardReconciliation.bytesVerified).toBe(false);
    expect(sensor(moved).retirement.independentReview).toBeUndefined();
  });

  it("routes a firing only from the primary's adjudication, never from its count", () => {
    // A `route.state` of "routed" derived from a positive count alone is an assurance no recorded
    // byte supports, so a firing with no adjudication stays inconclusive.
    const fx = fixture(LINE);
    const first = build(fx.review);
    expect(sensor(first)).toMatchObject({ status: "fired", route: { state: "inconclusive" } });
    expect(sensor(first).route.reason).toBeUndefined();
    expect(
      archiveIssues(fx.review).some((issue) => /fired safeguard must be routed to its owner/.test(issue)),
    ).toBe(true);
    reconcile(fx.review, first);
    decide(fx.review, {
      routes: {
        [SENSOR]: {
          state: "routed",
          reason: "The primary handed the firing to the caller file's owner.",
          anchor: "#safeguards",
        },
      },
    });
    expect(sensor(build(fx.review)).route).toMatchObject({
      state: "routed",
      reason: "The primary handed the firing to the caller file's owner.",
    });
    decide(fx.review, { routes: { [SENSOR]: { state: "routed" } } });
    expect(sensor(build(fx.review)).route).toMatchObject({ state: "inconclusive" });
  });

  it("does not call a malformed log a complete zero even when the primary asks for completeness", () => {
    const fx = fixture("truncated logger output\n");
    const first = build(fx.review);
    reconcile(fx.review, first);
    expect(sensor(build(fx.review))).toMatchObject({
      status: "inconclusive",
      count: 0,
      coverage: { complete: false, t1: false },
    });
  });

  it("counts a stderr firing for an unlisted id, holds a declared stderr-only id without its capture, and the validator refuses the incomplete archive", () => {
    const fx = fixture("");
    build(fx.review);
    // The run log records nothing; the capture records one firing the primary did not declare stderr-only.
    writeFileSync(fx.stderr, `[safeguard] ${LINE}`);
    decide(fx.review, { stderrLog: fx.stderr });
    expect(sensor(build(fx.review))).toMatchObject({
      status: "fired",
      count: 1,
      countSource: "run-log+stderr",
    });
    // Declared stderr-only but the capture is not supplied: no count, not an observed zero.
    decide(fx.review, { stderrLog: null, stderrOnlyIds: [SENSOR] });
    const held = build(fx.review);
    expect(sensor(held)).toMatchObject({
      status: "inconclusive",
      count: null,
      countSource: null,
      coverage: { complete: false },
    });
    // The archive validator refuses what the scaffold left incomplete instead of reading it as covered.
    const issues = archiveIssues(fx.review);
    expect(issues.some((issue) => /safeguards\[\d+\]\.coverage\.complete must be true/.test(issue))).toBe(
      true,
    );
    expect(issues).toContain("safeguardReconciliation.bytesVerified must be true");
  });
});
