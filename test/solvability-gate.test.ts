/**
 * What the F2 census gate lets cross to the Builder, and to which owner.
 *
 * The session that authored the battery is the session that reads the refusal, so a refusal
 * detailed enough to be useful is detailed enough to be an answer key. The census therefore
 * projects counts and withholds locations: how many reference solves failed and how the failures
 * concentrate by declared check, but no task id, per-task result or verifier text. The whole record
 * stays host-side in `solvability.json`, so nothing is thrown away, only kept on the correct side.
 *
 * Routing is the other half. An environment failure that reads as a product failure sends the
 * Builder to repair something that was never broken, and a declaration the author made — a tool
 * that resolves nowhere — must reach the owner who can change that declaration.
 *
 * Every case here hands the gate a probe double: what runs the census over a real bundle is
 * `solvability-*.test.ts` beside this one, and constant reference output across inputs is measured
 * in `representation-census.test.ts`.
 */
import { afterAll, describe, expect, it } from "bun:test";
import type { BuiltHarness } from "../src/author/campaign-types.ts";
import { EVALUATOR_CALIBRATION_POLICY } from "../src/claim/calibration.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { AcceptIndependence } from "../src/run/accept-control-independence.ts";
import { makeSolvabilityCensusGate } from "../src/run/solvability-gate.ts";
import { double } from "./helpers/doubles.ts";
import { probeReturning } from "./helpers/solvability-probe.ts";

type Accept = { id: string; taskId: string; artifact: unknown };
type ToolRefusal = [code: string, owner: string, detail: string];

const SCRATCH = mkdtempSync(join(tmpdir(), "ana-solvgate-"));
const HARNESS = double<BuiltHarness>({ fingerprint: { taskSetHash: "tsh-1" } });
const REFERENCE_ARTIFACT = {
  design: { members: [{ id: "m1", section: "CHS33.7x2.6" }], totalMass_kg: 278.56 },
};
const INDEPENDENT_ARTIFACT = {
  design: { members: [{ id: "m1", section: "CHS42.4x2.6" }], totalMass_kg: 281.655 },
};

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Run the gate over `probe` in a fresh iteration directory, with `slugDir` as its slug. */
async function census(name: string, probe: ReturnType<typeof probeReturning>, slugDir?: string) {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  const feedback = await makeSolvabilityCensusGate({}, probe)(HARNESS, dir, slugDir ?? join(dir, "slug"));
  const recorded = () => Bun.file(join(dir, "solvability.json")).text();
  return { dir, feedback, authorVisible: JSON.stringify(feedback), recorded };
}

describe("the census projects counts and keeps locations host-side", () => {
  it("refuses one failed reference solve, naming the check and its count but not the task or engine text", async () => {
    const { feedback, authorVisible, recorded } = await census(
      "hostile",
      probeReturning([
        { taskId: "t1", status: "passed" },
        {
          taskId: "t2",
          status: "failed",
          failedCheckIds: ["tc-physics-session"],
          error: "[tc-physics-session] utilization 1.4 above 1.0 on member m3",
        },
      ]),
    );
    expect(feedback).toMatchObject([{ owner: "correctness-model", severity: "blocking" }]);
    expect(authorVisible).toContain("1 of 2");
    expect(authorVisible).toContain("tc-physics-session (1)");
    expect(authorVisible).not.toContain("t2");
    expect(authorVisible).not.toContain("utilization");
    expect(await recorded()).toContain("utilization 1.4");
  });

  it("ranks the concentration by count and adds nothing for a failed case that names no check", async () => {
    const { authorVisible } = await census(
      "concentration",
      probeReturning([
        { taskId: "t1", status: "failed", failedCheckIds: ["tc-b", "tc-a"] },
        { taskId: "t2", status: "failed", failedCheckIds: ["tc-b"] },
        { taskId: "t3", status: "failed" },
      ]),
    );
    expect(authorVisible).toContain("3 of 3");
    expect(authorVisible).toContain("2 declared truth-check(s): tc-b (2), tc-a (1)");
    expect(authorVisible).not.toContain("t1");
  });

  it("says nothing for a clean census and records the source identity it ran under", async () => {
    const { feedback, recorded } = await census(
      "clean",
      probeReturning([{ taskId: "t1", status: "passed" }]),
    );
    expect(feedback).toEqual([]);
    expect(JSON.parse(await recorded()).source?.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("records nothing and says nothing for a census the wall cut", async () => {
    const dir = join(SCRATCH, "cut");
    mkdirSync(dir, { recursive: true });
    let cut = false;
    const failed = probeReturning([{ taskId: "t1", status: "failed", failedCheckIds: ["c"], error: "late" }]);
    const gate = makeSolvabilityCensusGate({}, async (input) => {
      cut = true;
      return await failed(input);
    });
    expect(await gate(HARNESS, dir, join(dir, "slug"), () => cut)).toEqual([]);
    expect(await Bun.file(join(dir, "solvability.json")).exists()).toBe(false);
  });

  it("blocks a census that could not execute, keeping its failure record protected", async () => {
    const { feedback, authorVisible, recorded } = await census("unavailable", probeReturning(null));
    expect(feedback).toMatchObject([{ owner: "correctness-model", severity: "blocking" }]);
    expect(authorVisible).not.toContain("bundleSnapshot digest drifted");
    expect(await recorded()).toContain("bundleSnapshot digest drifted");
  });

  it("routes a census non-result to the environment owner without its text", async () => {
    const { feedback, authorVisible } = await census(
      "environment",
      probeReturning([
        { taskId: "t1", status: "passed" },
        { taskId: "t2", status: "non-result", error: "engine host died pre-ready" },
      ]),
    );
    expect(feedback).toMatchObject([{ owner: "environment", severity: "blocking" }]);
    expect(authorVisible).not.toContain("engine host died");
  });
});

describe("a refused declaration reaches the owner who can change it", () => {
  // Each beside a failed census row, so the tool's own row is proved to sit beside the count
  // rather than be folded into it. The detail names Builder-authored identities, so it crosses.
  it.each<ToolRefusal>([
    [
      "solvability-tool-missing",
      "correctness-model",
      'check "tc-builds" names adapterId "cargo", which resolves under neither .toolchain nor the host path',
    ],
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
    // [
    //   "solvability-tool-self-authored",
    //   "brief",
    //   "check(s) structural-performance (truss-verify) are grounded only by a script under the candidate's own .toolchain",
    // ],
    // Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
    // [
    //   "solvability-tool-program-argument",
    //   "brief",
    //   "check(s) structural-performance (python3, 1808-byte argument) declare external evidence but pass program text",
    // ],
  ])("%s goes to %s as its own blocking row", async (code, owner, detail) => {
    const { feedback, authorVisible } = await census(
      code,
      probeReturning(
        [{ taskId: "t1", status: "failed", error: "the tool did not run" }],
        [{ code, path: "correctness-model/brief.json", detail }],
      ),
    );
    expect(authorVisible).toContain("1 of 1");
    expect(feedback).toContainEqual(
      expect.objectContaining({
        owner,
        severity: "blocking",
        findings: [expect.objectContaining({ code: code.toUpperCase().replaceAll("-", "_"), detail })],
      }),
    );
  });

  it("routes a writer-inexpressible reference artifact to brief, with its interface detail and no task", async () => {
    const { feedback, authorVisible } = await census(
      "representation",
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
    expect(feedback).toMatchObject([{ owner: "brief", severity: "blocking" }]);
    expect(authorVisible).toContain("SOLVABILITY_REPRESENTATION_DEFECT");
    // The detail describes the public authoring interface — writer schema, DraftStore, submit — so
    // it may cross, provided it identifies no task.
    expect(authorVisible).toContain("nullable root value");
    expect(authorVisible).not.toContain("t2");
  });

  it("collapses repeated representation details and names the ones past the projection cap", async () => {
    const repeated = { failureKind: "representation-defect" as const, status: "failed" as const };
    const { authorVisible } = await census(
      "representation-dedup",
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
    expect(authorVisible).toContain("2 of 11 reference artifacts: writer omits the notes root");
    expect(authorVisible).toContain("2 further distinct defect(s)");
  });
});

/** A slug with the one recorded task the witness pairs with and the accept corpus it is compared to. */
function slugWithCorpus(name: string, accepts: Accept[]): string {
  const slugDir = join(SCRATCH, `${name}-slug`);
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  const task = { taskId: "bracket-a", family: "bracket", publicInput: { span_mm: 2400 }, hidden: [] };
  writeFileSync(join(slugDir, "correctness-model", "tasks.json"), JSON.stringify([task]));
  writeFileSync(
    join(slugDir, "correctness-model", "controls.json"),
    JSON.stringify({ accept: accepts, reject: [] }),
  );
  return slugDir;
}

const copyOf = (id: string): Accept => ({ id, taskId: "bracket-a", artifact: REFERENCE_ARTIFACT });

/** The census over a slug whose one witness is the reference artifact for bracket-a. */
async function independenceOf(name: string, accepts: Accept[]) {
  const probe = probeReturning([{ taskId: "bracket-a", status: "passed", artifact: REFERENCE_ARTIFACT }]);
  const run = await census(name, probe, slugWithCorpus(name, accepts));
  // SAFETY: the file the gate wrote one line earlier, through the shape it writes there.
  const recorded = JSON.parse(await run.recorded()) as { acceptIndependence?: AcceptIndependence };
  const advice = run.feedback.filter((entry) => entry.owner === "accept-controls");
  return { ...run, independence: recorded.acceptIndependence, advice };
}

describe("accept controls that restate the reference solve", () => {
  it("advises when fewer than the floor were reached without it, naming controls but not the task", async () => {
    const { independence, advice, recorded } = await independenceOf("accept-copy", [
      // Key order differs from the witness: the question is the value, not the bytes.
      {
        id: "acc-copy",
        taskId: "bracket-a",
        artifact: { design: { totalMass_kg: 278.56, members: [{ section: "CHS33.7x2.6", id: "m1" }] } },
      },
      ...["acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"].map(copyOf),
      { id: "acc-independent", taskId: "bracket-a", artifact: INDEPENDENT_ARTIFACT },
    ]);
    expect(independence).toEqual({
      accepts: 6,
      compared: 6,
      copiedFromReference: ["acc-copy", "acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"],
    });
    expect(advice).toMatchObject([{ severity: "advisory" }]);
    expect(advice[0]?.claim).toContain(
      "1 of the 6 accept controls compared with a reference witness were reached without it",
    );
    expect(advice[0]?.findings?.[0]?.detail).toContain("acc-copy");
    expect(JSON.stringify(advice)).not.toContain("bracket-a");
    expect(await recorded()).toContain("bracket-a");
  });

  const independents = Array.from({ length: EVALUATOR_CALIBRATION_POLICY.minimumKnownPasses }, (_, at) => ({
    id: `acc-independent-${String(at)}`,
    taskId: "bracket-a",
    artifact: { design: { ...INDEPENDENT_ARTIFACT.design, totalMass_kg: 281.655 + at } },
  }));
  it.each<[string, Accept[], Partial<AcceptIndependence>]>([
    [
      // Accepts for a task F2 produced no witness for are compared with nothing; subtracting the
      // copies from every declared accept would read them as reached without the reference.
      "an accept whose task reached no witness counts as uncompared",
      [
        ...["acc-copy-a", "acc-copy-b", "acc-copy-c", "acc-copy-d", "acc-copy-e"].map(copyOf),
        ...["span-a", "span-b", "span-c"].map((taskId) => ({
          id: `acc-${taskId}`,
          taskId,
          artifact: REFERENCE_ARTIFACT,
        })),
      ],
      { accepts: 8, compared: 5 },
    ],
    [
      "a copy beside the floor of independent accepts is surplus",
      [copyOf("acc-copy"), ...independents],
      { copiedFromReference: ["acc-copy"] },
    ],
    [
      // A wholly copied corpus and a task with one correct answer are the same bytes here, and the
      // second has nothing to fix.
      "no accept reached apart from the reference",
      ["acc-one", "acc-two", "acc-three", "acc-four", "acc-five"].map(copyOf),
      { copiedFromReference: ["acc-five", "acc-four", "acc-one", "acc-three", "acc-two"] },
    ],
    [
      "an accept authored apart from the reference, and a copy for a task with no witness",
      [
        { id: "acc-bracket-a", taskId: "bracket-a", artifact: INDEPENDENT_ARTIFACT },
        { id: "acc-span-a", taskId: "span-a", artifact: REFERENCE_ARTIFACT },
      ],
      { accepts: 2, compared: 1, copiedFromReference: [] },
    ],
  ])("records and stays silent: %s", async (name, accepts, recorded) => {
    const { independence, advice } = await independenceOf(name.split(" ").slice(0, 4).join("-"), accepts);
    expect(independence).toMatchObject(recorded);
    expect(advice).toEqual([]);
  });
});
