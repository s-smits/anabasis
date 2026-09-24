import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { readControllerEvidence, resolveLaunchRunId } from "../src/run/controller-evidence.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

const roots: string[] = [];
const RUN = "run-current";
const ABSENT = Symbol("absent abandonedRuns");
const MALFORMED_CASES: Array<[string, JsonValue]> = [
  ["a non-list", "run-a"],
  ["an empty run id", [""]],
  ["the current run", [RUN]],
  ["duplicates", ["run-a", "run-a"]],
  ["a reordered list", ["run-b", "run-a"]],
];

const RUN_END = { climb: null, provenance: [] };

function controllerFixture(
  abandonedRuns: JsonValue | typeof ABSENT = [],
  verifierCleanup?: JsonValue,
  terminalSchema = "campaign-terminal/v4",
): string {
  const root = mkdtempSync(join(tmpdir(), "ana-controller-abandoned-runs-"));
  roots.push(root);
  const campaignDir = join(root, "campaigns", "project");
  const controllerDir = join(campaignDir, "controller", RUN);
  const epoch = "epoch-aaaaaaaaaaaa";
  mkdirSync(controllerDir, { recursive: true });
  writeFileSync(
    join(campaignDir, "epochs.json"),
    JSON.stringify({
      schema: "campaign-epochs/v1",
      current: epoch,
      epochs: [{ key: epoch, supersedes: null }],
    }),
  );
  const source = { commit: "a".repeat(40), dirty: false, sourceDigest: "b".repeat(64) };
  const budget = { turnBudget: null, turnsUsed: 0, status: "active" };
  const opening: JsonObject = {
    schema: "campaign-opening/v2",
    runId: RUN,
    source,
    budget,
    epoch: { key: epoch },
    continuation: null,
    operatorVerifierRegistry: null,
  };
  if (abandonedRuns !== ABSENT) opening.abandonedRuns = abandonedRuns;
  writeFileSync(join(controllerDir, "opening.json"), JSON.stringify(opening));
  writeFileSync(
    join(controllerDir, "terminal.json"),
    JSON.stringify({
      schema: terminalSchema,
      budget,
      openingDigest: hashJsonValue(opening),
      source,
      epoch,
      lock: { token: "recorded-token", ownedAtRecord: true },
      iterations: [],
      absentSteps: [],
      outcome: "completed",
      abortClause: null,
      terminalReason: "completed",
      writtenAt: "2026-09-18T12:00:00.000Z",
      runEnd: RUN_END,
      ...keyIfDefined("verifierCleanup", verifierCleanup),
    }),
  );
  return campaignDir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("controller abandoned-run evidence", () => {
  it("discloses cleanup receipts and refuses an empty pending claim", () => {
    const verifierCleanup = { state: "pending", receiptIds: ["/protected/receipt"] };
    expect(readControllerEvidence(controllerFixture([], verifierCleanup), RUN)).toMatchObject({
      verifierCleanup,
    });
    expect(readControllerEvidence(controllerFixture([], { state: "complete" }), RUN)).toMatchObject({
      verifierCleanup: { state: "complete" },
    });
    expect(() =>
      readControllerEvidence(controllerFixture([], { state: "pending", receiptIds: [] }), RUN),
    ).toThrow("verifierCleanup");
  });
  it("reads a recorded empty observation and refuses an opening that records none", () => {
    expect(readControllerEvidence(controllerFixture([]), RUN)).toMatchObject({
      state: "recorded",
      abandonedRuns: [],
    });
    expect(() => readControllerEvidence(controllerFixture(ABSENT), RUN)).toThrow(/abandonedRuns/);
  });

  it("reads back the run-end numbers the terminal recorded, and refuses a terminal from before them", () => {
    expect(readControllerEvidence(controllerFixture([]), RUN)).toMatchObject({ runEnd: RUN_END });
    expect(() =>
      readControllerEvidence(controllerFixture([], undefined, "campaign-terminal/v3"), RUN),
    ).toThrow(/campaign-terminal\/v3.*campaign-terminal\/v4/);
  });

  it("returns the authenticated sorted predecessor list", () => {
    expect(readControllerEvidence(controllerFixture(["run-a", "run-b"]), RUN)).toMatchObject({
      state: "recorded",
      abandonedRuns: ["run-a", "run-b"],
    });
  });

  it("carries the recorded absent steps and refuses a terminal that omits them", () => {
    const campaign = controllerFixture([]);
    expect(readControllerEvidence(campaign, RUN)).toMatchObject({ state: "recorded", absentSteps: [] });
    const terminalPath = join(campaign, "controller", RUN, "terminal.json");
    const { absentSteps: _dropped, ...rest } = JSON.parse(readFileSync(terminalPath, "utf8"));
    writeFileSync(terminalPath, JSON.stringify(rest));
    expect(() => readControllerEvidence(campaign, RUN)).toThrow(/absentSteps/);
  });

  for (const [name, value] of MALFORMED_CASES) {
    it(`refuses ${name}`, () => {
      expect(() => readControllerEvidence(controllerFixture(value), RUN)).toThrow(/abandonedRuns/);
    });
  }
});

/** The launch id walk belongs beside the abandoned-sibling reader above: both ask which recorded
 *  openings a campaign already holds under one run name. */
it("resolveLaunchRunId walks the letter suffixes and refuses only at exhaustion", () => {
  const root = mkdtempSync(join(tmpdir(), "ana-runid-"));
  roots.push(root);
  const controller = join(root, "campaigns", "walk", "controller");
  for (const id of ["walk-run", "walk-runb", "walk-runc"]) {
    mkdirSync(join(controller, id), { recursive: true });
    writeFileSync(join(controller, id, "opening.json"), "{}\n");
  }
  expect(resolveLaunchRunId(root, "walk", "fresh-run")).toBe("fresh-run");
  expect(resolveLaunchRunId(root, "walk", "walk-run")).toBe("walk-rund");
  for (const letter of "defghijklmnopqrstuvwxyz") {
    mkdirSync(join(controller, `walk-run${letter}`), { recursive: true });
    writeFileSync(join(controller, `walk-run${letter}`, "opening.json"), "{}\n");
  }
  expect(() => resolveLaunchRunId(root, "walk", "walk-run")).toThrow(/every continuation suffix b-z/);
});
