import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { checkBundleArtifact } from "../src/run/bundle-entry.ts";
import { blockingIssueSummary, publicTaskVerdict } from "../src/truth/verdict-binding.ts";
import { writeMatchingSlug } from "./helpers/matching-fixture.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each([false, true])(
  "writes standalone check evidence and cleanup after missing artifact: %s",
  async (missing) => {
    const root = mkdtempSync(join(tmpdir(), "bundle-entry-"));
    roots.push(root);
    const bundle = join(root, "bundle");
    writeMatchingSlug(bundle);
    const artifact = join(root, "artifact.json");
    if (!missing) writeFileSync(artifact, JSON.stringify({ assignments: [{ part: "alpha", slot: "s3" }] }));
    const output = join(root, "output");
    const checked = checkBundleArtifact(bundle, "t1", artifact, output);
    if (missing) await expect(checked).rejects.toThrow("ENOENT");
    else expect(await checked).toMatchObject({ truthOk: true, pass: true });
    const evidence = JSON.parse(readFileSync(join(output, "t1-verdict.json"), "utf8"));
    expect(evidence.verifierCleanup).toEqual({ state: "complete" });
    expect(evidence.executionEvidence).toEqual([]);
    if (missing) {
      expect(evidence.record).toBeNull();
      expect(evidence.failure).toContain("ENOENT");
    } else {
      expect(evidence.record.truthOk).toBe(true);
      expect(evidence.failure).toBeNull();
    }
  },
);

/**
 * The bundle's `check` entry and the replay CLI publish the same five fields and each used to
 * build them itself. The keys are asserted exactly, not with `toMatchObject`, because the shortcut
 * a second author reaches for is spreading the record — and the record carries `runtimeNonResult`,
 * the message, which the bundle withholds on purpose: its output is a public surface and rule 4
 * keeps verifier detail off one. Sorting `failedCheckIds` is what makes two gradings of the same
 * bytes comparable at all, which is the only thing a replay does.
 */
it("projects the five public fields, sorted, and nothing the record carries beside them", () => {
  const record = {
    truthOk: false,
    pass: false,
    runtimeNonResultKind: null,
    runtimeNonResult: "a verifier message no public surface may repeat",
  };
  const graded = publicTaskVerdict("t1", record, {
    ok: false,
    issues: [
      { message: "b", checkId: "span-check" },
      { message: "a", checkId: "anchor-check" },
      { message: "a again", checkId: "span-check" },
    ],
    checkReceipts: [],
  });
  expect(graded).toEqual({
    taskId: "t1",
    truthOk: false,
    pass: false,
    nonResultKind: null,
    failedCheckIds: ["anchor-check", "span-check"],
  });

  const ungraded = publicTaskVerdict(
    "t2",
    { truthOk: null, pass: null, runtimeNonResultKind: "sandbox" },
    null,
  );
  expect(ungraded.failedCheckIds).toEqual([]);
  expect(ungraded.nonResultKind).toBe("sandbox");
});

it("bounds each blocking message in the operator summary and marks what it left out", () => {
  const summary = blockingIssueSummary({
    ok: false,
    issues: [{ checkId: "span-check", message: "y".repeat(200) }],
    checkReceipts: [],
  });
  expect(summary).toBe(`[span-check] ${"y".repeat(180)} […20 bytes omitted]`);
});
