/**
 * Tests for the F2 solvability census before adoption. A candidate whose reference solve
 * passes task 1 but fails task 2 is refused. Feedback includes aggregate failure counts and
 * counts by declared check: runs 12 and 14 received too little information from a total alone.
 * It may also identify constant reference output across different inputs, as tested in
 * test/representation-census.test.ts. Task ids, per-task check results and raw verifier text
 * remain protected. The host retains the complete record in solvability.json.
 * Environment non-results route to the environment owner without becoming product failures.
 * These tests exercise that routing and the permitted feedback fields.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import type { BuiltHarness } from "../src/author/campaign-types.ts";
import type { AcceptIndependence } from "../src/run/accept-control-independence.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../src/claim/calibration.ts";
import { makeSolvabilityCensusGate } from "../src/run/solvability-gate.ts";
import { probeReturning } from "./helpers/solvability-probe.ts";

const SCRATCH = mkdtempSync(join(tmpdir(), "ana-solvgate-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const HARNESS = double<BuiltHarness>({ fingerprint: { taskSetHash: "tsh-1" } });

function iterationDir(name: string): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("the F2 pre-adoption solvability census", () => {
  it("refuses a candidate with one failed reference solve and reports check counts without task ids or verifier text", async () => {
    const dir = iterationDir("hostile");
    const probe = probeReturning([
      { taskId: "t1", status: "passed" },
      {
        taskId: "t2",
        status: "failed",
        failedCheckIds: ["tc-physics-session"],
        error: "[tc-physics-session] utilization 1.4 above 1.0 on member m3",
      },
    ]);
    const gate = makeSolvabilityCensusGate({}, probe);
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "correctness-model", severity: "blocking" });
    const authorVisible = JSON.stringify(feedback);
    expect(authorVisible).toContain("1 of 2");
    // Feedback names the declared check and its aggregate failure count. Runs 12 and 14
    // lacked that information; per-task results and raw verifier text remain protected.
    expect(authorVisible).toContain("tc-physics-session (1)");
    expect(authorVisible).not.toContain("t2");
    expect(authorVisible).not.toContain("utilization");
    // The full record — task ids, per-task joins, engine words — persists host-side, protected.
    const persisted = await Bun.file(join(dir, "solvability.json")).text();
    expect(persisted).toContain("t2");
    expect(persisted).toContain("utilization");
  });

  it("records no solvability.json and no feedback for a census the wall cut", async () => {
    const dir = iterationDir("cut");
    let cut = false;
    const failed = probeReturning([{ taskId: "t1", status: "failed", failedCheckIds: ["c"], error: "late" }]);
    const gate = makeSolvabilityCensusGate({}, async (input) => {
      cut = true;
      return await failed(input);
    });
    expect(await gate(HARNESS, dir, join(dir, "slug"), () => cut)).toEqual([]);
    expect(await Bun.file(join(dir, "solvability.json")).exists()).toBe(false);
  });

  it("names an unresolved tool as its own row beside the census count", async () => {
    const dir = iterationDir("tool-missing");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning(
        [{ taskId: "t1", status: "failed", error: 'toolId "cargo" is not in the resolved tool inventory' }],
        [
          {
            code: "solvability-tool-missing",
            path: "correctness-model/brief.json",
            detail:
              'check "tc-builds" names adapterId "cargo", which resolves under neither .toolchain nor the host path',
          },
        ],
      ),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    const missing = feedback.find((row) => JSON.stringify(row).includes("SOLVABILITY_TOOL_MISSING"));
    expect(missing).toMatchObject({ owner: "correctness-model", severity: "blocking" });
    expect(missing?.findings?.[0]?.detail).toContain('adapterId "cargo"');
    expect(JSON.stringify(feedback)).toContain("1 of 1");
  });

  it("routes the known-authored-tool refusal to brief with blocking severity", async () => {
    const dir = iterationDir("tool-self-authored");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning(
        [{ taskId: "t1", status: "passed" }],
        [
          {
            code: "solvability-tool-self-authored",
            path: "correctness-model/brief.json",
            detail:
              "check(s) structural-performance (truss-verify) are grounded only by a script under the candidate's own .toolchain",
          },
        ],
      ),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    const row = feedback.find((entry) => JSON.stringify(entry).includes("SOLVABILITY_TOOL_SELF_AUTHORED"));
    expect(row).toMatchObject({ owner: "brief", severity: "blocking" });
    expect(row?.findings?.[0]?.detail).toContain("structural-performance (truss-verify)");
  });

  it("routes a program-argument tool run to the brief owner as blocking", async () => {
    const dir = iterationDir("tool-program-argument");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning(
        [{ taskId: "t1", status: "passed" }],
        [
          {
            code: "solvability-tool-program-argument",
            path: "correctness-model/brief.json",
            detail:
              "check(s) structural-performance (python3, 1808-byte argument) declare external evidence but pass program text",
          },
        ],
      ),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    const row = feedback.find((entry) => JSON.stringify(entry).includes("SOLVABILITY_TOOL_PROGRAM_ARGUMENT"));
    expect(row).toMatchObject({ owner: "brief", severity: "blocking" });
    expect(row?.findings?.[0]?.detail).toContain("python3, 1808-byte argument");
  });

  it("ranks the concentration by failure count and stays silent when no failed case names a check", async () => {
    const dir = iterationDir("concentration");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning([
        { taskId: "t1", status: "failed", failedCheckIds: ["tc-b", "tc-a"] },
        { taskId: "t2", status: "failed", failedCheckIds: ["tc-b"] },
        // A failed case with no attributed check adds nothing to the class projection.
        { taskId: "t3", status: "failed" },
      ]),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    const authorVisible = JSON.stringify(feedback);
    expect(authorVisible).toContain("3 of 3");
    expect(authorVisible).toContain("2 declared truth-check(s): tc-b (2), tc-a (1)");
    expect(authorVisible).not.toContain("t1");
  });

  it("returns no feedback when all supplied reference solves pass", async () => {
    const dir = iterationDir("clean");
    const gate = makeSolvabilityCensusGate({}, probeReturning([{ taskId: "t1", status: "passed" }]));
    expect(await gate(HARNESS, dir, join(dir, "slug"))).toEqual([]);
  });

  it("routes a writer-inexpressible reference artifact as a representation refusal", async () => {
    const dir = iterationDir("representation");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning([
        { taskId: "t1", status: "passed" },
        {
          taskId: "t2",
          status: "failed",
          failureKind: "representation-defect",
          error: "nullable root value was omitted by the writer schema",
        },
      ]),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "brief", severity: "blocking" });
    const authorVisible = JSON.stringify(feedback);
    expect(authorVisible).toContain("SOLVABILITY_REPRESENTATION_DEFECT");
    // The detail describes a public authoring interface: writer schema, DraftStore or submit.
    // It may reach the Builder without identifying the task. In run w12, iteration 47
    // resolved this kind of defect with detailed feedback, while iterations 48–55 received
    // less detail. This test checks the disclosure rule, not that historical comparison.
    expect(authorVisible).toContain("nullable root value");
    expect(authorVisible).not.toContain("t2");
  });

  it("deduplicates representation-defect details and withholds beyond the projection cap", async () => {
    const dir = iterationDir("representation-dedup");
    const repeated = { failureKind: "representation-defect" as const, status: "failed" as const };
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning([
        { taskId: "t1", ...repeated, error: "writer omits the notes root" },
        { taskId: "t2", ...repeated, error: "writer omits the notes root" },
        ...Array.from({ length: 9 }, (_, i) => ({
          taskId: `t${String(i + 3)}`,
          ...repeated,
          error: `distinct defect ${String(i)}`,
        })),
      ]),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    const authorVisible = JSON.stringify(feedback);
    // The repeated detail collapses to one row with its count; the count-first ranking puts it ahead.
    expect(authorVisible).toContain("2 of 11 reference artifacts: writer omits the notes root");
    // Ten distinct details, eight projected: the remainder is named as withheld, not dropped silently.
    expect(authorVisible).toContain("2 further distinct defect(s)");
  });

  it("records the source identity the census ran under", async () => {
    const dir = iterationDir("identity");
    const gate = makeSolvabilityCensusGate({}, probeReturning([{ taskId: "t1", status: "passed" }]));
    await gate(HARNESS, dir, join(dir, "slug"));
    const persisted = JSON.parse(await Bun.file(join(dir, "solvability.json")).text());
    expect(persisted.source?.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("routes a census non-result to the environment owner", async () => {
    const dir = iterationDir("environment");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning([
        { taskId: "t1", status: "passed" },
        { taskId: "t2", status: "non-result", error: "engine host died pre-ready" },
      ]),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "environment", severity: "blocking" });
    expect(JSON.stringify(feedback)).not.toContain("engine host died");
  });

  it("routes a family the census refused, crossing the family but not the tasks inside it", async () => {
    const dir = iterationDir("family");
    const gate = makeSolvabilityCensusGate(
      {},
      probeReturning(
        [
          { taskId: "charge-1", status: "passed" },
          { taskId: "charge-2", status: "passed" },
        ],
        [
          {
            code: "TASK_FAMILY_UNIVERSAL_WITNESS",
            path: "correctness-model/tasks.json",
            owner: "task-curriculum",
            detail:
              'family "charge-firmware" has 2 tasks, and one accepted deliverable satisfies every one of them: moving only the task-conditioned root(s) "module" between siblings leaves every sibling passing',
          },
        ],
      ),
    );
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "tests", severity: "blocking" });
    const authorVisible = JSON.stringify(feedback);
    expect(authorVisible).toContain("TASK_FAMILY_UNIVERSAL_WITNESS");
    // Family name, denominator, marked root and remedy cross — all Builder-authored public
    // identities. Which sibling answered which stays in the protected host evidence.
    expect(authorVisible).toContain(String.raw`family \"charge-firmware\" has 2 tasks`);
    expect(authorVisible).toContain(String.raw`\"module\"`);
    expect(authorVisible).not.toContain("charge-1");
    expect(await Bun.file(join(dir, "solvability.json")).text()).toContain("charge-1");
  });

  it("blocks when the census cannot execute at all, keeping the failure record protected", async () => {
    const dir = iterationDir("unavailable");
    const gate = makeSolvabilityCensusGate({}, probeReturning(null));
    const feedback = await gate(HARNESS, dir, join(dir, "slug"));
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ owner: "correctness-model", severity: "blocking" });
    expect(JSON.stringify(feedback)).not.toContain("bundleSnapshot digest drifted");
    expect(await Bun.file(join(dir, "solvability.json")).text()).toContain("bundleSnapshot digest drifted");
  });
  /** A slug tree carrying the two files the copied-accept census reads: the recorded task array
   *  `witnessesOf` pairs its witnesses with, and the accept corpus it compares them against. */
  function slugWithCorpus(
    name: string,
    accepts: Array<{ id: string; taskId: string; artifact: unknown }>,
  ): string {
    const slugDir = join(SCRATCH, name, "slug");
    mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
    writeFileSync(
      join(slugDir, "correctness-model", "tasks.json"),
      JSON.stringify([
        {
          taskId: "bracket-a",
          family: "bracket",
          publicInput: { span_mm: 2400 },
          hidden: [{ expect: "protected" }],
        },
      ]),
    );
    writeFileSync(
      join(slugDir, "correctness-model", "controls.json"),
      JSON.stringify({ accept: accepts, reject: [] }),
    );
    return slugDir;
  }

  const REFERENCE_ARTIFACT = {
    design: { members: [{ id: "m1", section: "CHS33.7x2.6" }], totalMass_kg: 278.56 },
  };

  /** Read the recorded census back out of solvability.json. */
  async function acceptIndependence(dir: string): Promise<AcceptIndependence | undefined> {
    // SAFETY: the file this gate wrote one line earlier, through the shape it writes there.
    const recorded = JSON.parse(await Bun.file(join(dir, "solvability.json")).text()) as {
      acceptIndependence?: AcceptIndependence;
    };
    return recorded.acceptIndependence;
  }

  /** A probe whose one witness is the reference artifact for bracket-a. */
  function referencePassed() {
    return probeReturning([{ taskId: "bracket-a", status: "passed", artifact: REFERENCE_ARTIFACT }]);
  }

  /** One accept carrying the reference artifact, under an id of its own. */
  function copyOf(id: string) {
    return { id, taskId: "bracket-a", artifact: REFERENCE_ARTIFACT };
  }

  it("records the accept controls that carry the reference solve's own artifact, and advises on them", async () => {
    const dir = iterationDir("accept-copy");
    const gate = makeSolvabilityCensusGate({}, referencePassed());
    // Six compared, so the comparison is wide enough to reach the floor, and one that does not.
    // The control ids name no task, so the isolation assertion below reads what it claims to.
    const feedback = await gate(
      HARNESS,
      dir,
      slugWithCorpus("accept-copy", [
        // Key order differs from the witness: the question is the value, not the bytes.
        {
          id: "acc-copy",
          taskId: "bracket-a",
          artifact: { design: { totalMass_kg: 278.56, members: [{ section: "CHS33.7x2.6", id: "m1" }] } },
        },
        ...["acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"].map(copyOf),
        {
          id: "acc-independent",
          taskId: "bracket-a",
          artifact: { design: { members: [{ id: "m1", section: "CHS42.4x2.6" }], totalMass_kg: 281.655 } },
        },
      ]),
    );
    expect(await acceptIndependence(dir)).toEqual({
      accepts: 6,
      compared: 6,
      copiedFromReference: ["acc-copy", "acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"],
    });
    // One independent accept, under the declared floor of five: the corpus nominally calibrates the
    // checks and actually re-states the reference. Advisory, so it refuses nothing.
    const row = feedback.find((entry) => entry.owner === "accept-controls");
    expect(row).toMatchObject({ severity: "advisory" });
    expect(row?.claim).toContain(
      "1 of the 6 accept controls compared with a reference witness were reached without it",
    );
    // Control ids are Builder-authored, so they cross; the task id they are bound to does not.
    expect(row?.findings?.[0]?.detail).toContain("acc-copy");
    expect(JSON.stringify(row)).not.toContain("bracket-a");
    expect(await Bun.file(join(dir, "solvability.json")).text()).toContain("bracket-a");
  });

  it("counts an accept whose task reached no witness as compared with nothing, not reached without the reference", async () => {
    const dir = iterationDir("accept-uncompared");
    const gate = makeSolvabilityCensusGate({}, referencePassed());
    const feedback = await gate(
      HARNESS,
      dir,
      slugWithCorpus("accept-uncompared", [
        ...["acc-copy-a", "acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"].map(copyOf),
        // Three accepts for a task F2 produced no witness for. Subtracting the copies from every
        // declared accept read these as three artifacts the reference could not produce, which is
        // the opposite of what a missing witness says, and the row fired on a wholly copied corpus.
        { id: "acc-span-a", taskId: "span-a", artifact: REFERENCE_ARTIFACT },
        { id: "acc-span-b", taskId: "span-b", artifact: REFERENCE_ARTIFACT },
        { id: "acc-span-c", taskId: "span-c", artifact: REFERENCE_ARTIFACT },
      ]),
    );
    expect(await acceptIndependence(dir)).toMatchObject({ accepts: 8, compared: 5 });
    expect(feedback.filter((entry) => entry.owner === "accept-controls")).toEqual([]);
  });

  it("says nothing when the corpus still carries the declared floor of independent accepts", async () => {
    const dir = iterationDir("accept-floor");
    const gate = makeSolvabilityCensusGate({}, referencePassed());
    const feedback = await gate(
      HARNESS,
      dir,
      slugWithCorpus("accept-floor", [
        { id: "acc-copy", taskId: "bracket-a", artifact: REFERENCE_ARTIFACT },
        ...Array.from({ length: EVALUATOR_CALIBRATION_POLICY.minimumKnownPasses }, (_, at) => ({
          id: `acc-independent-${String(at)}`,
          taskId: "bracket-a",
          artifact: {
            design: { members: [{ id: "m1", section: "CHS42.4x2.6" }], totalMass_kg: 281.655 + at },
          },
        })),
      ]),
    );
    // The copy is surplus once the floor is met independently, so it earns no sentence.
    expect((await acceptIndependence(dir))?.copiedFromReference).toEqual(["acc-copy"]);
    expect(feedback.filter((entry) => entry.owner === "accept-controls")).toEqual([]);
  });

  it("says nothing when no accept was reached apart from the reference", async () => {
    const dir = iterationDir("accept-single");
    const gate = makeSolvabilityCensusGate({}, referencePassed());
    const feedback = await gate(
      HARNESS,
      dir,
      slugWithCorpus(
        "accept-single",
        ["acc-one", "acc-two", "acc-three", "acc-four", "acc-five"].map(copyOf),
      ),
    );
    // A wholly copied corpus and a domain whose task has one correct answer are the same bytes here.
    // The `uppercase` candidate the end-to-end gate calls clean is the second, so the row would fire
    // forever on a candidate with nothing to fix. The copies are still recorded.
    expect((await acceptIndependence(dir))?.copiedFromReference).toEqual([
      "acc-five",
      "acc-four",
      "acc-one",
      "acc-three",
      "acc-two",
    ]);
    expect(feedback.filter((entry) => entry.owner === "accept-controls")).toEqual([]);
  });

  it("counts no copy for an accept authored apart from the reference, nor for a control with no witness", async () => {
    const dir = iterationDir("accept-independent");
    const gate = makeSolvabilityCensusGate({}, referencePassed());
    await gate(
      HARNESS,
      dir,
      slugWithCorpus("accept-independent", [
        {
          id: "acc-bracket-a",
          taskId: "bracket-a",
          artifact: { design: { members: [{ id: "m1", section: "CHS42.4x2.6" }], totalMass_kg: 281.655 } },
        },
        // Same artifact as the witness, but for a task F2 produced no witness for: nothing to compare.
        { id: "acc-span-a", taskId: "span-a", artifact: REFERENCE_ARTIFACT },
      ]),
    );
    expect(await acceptIndependence(dir)).toEqual({ accepts: 2, compared: 1, copiedFromReference: [] });
  });
});
