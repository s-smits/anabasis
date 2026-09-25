import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { BuiltHarness } from "../src/author/campaign-types.ts";
import { makeCensusGate } from "../src/run/census-gate.ts";
import type { ContractFinding } from "../src/truth/brief.ts";
import type { ControlReceipt } from "../src/truth/battery-record.ts";
import { double } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const CENSUS_BRIEF = {
  truthChecks: [
    {
      id: "bridge-truss-integrity-check",
      execution: {
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: ["bridge-truss-integrity"] },
      },
    },
    {
      id: "bridge-truss-physics-check",
      execution: {
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: ["bridge-truss-physics"] },
      },
    },
  ],
};

/**
 * The control census the gate runs over a candidate: which receipts it admits, which findings it
 * returns to the authoring session, and what it writes to census.json. Control probes use doubles,
 * so no candidate is compiled and no provider session opens.
 *
 * The census decides admission, never quality — a candidate that satisfies its own declared
 * contract is admitted and everything else is refused with the exact finding.
 */

afterAll(cleanupScratch);

const SCRATCH_ROOT = scratchDir(".ana-scratch-census-", import.meta.dir);

function censusHarness(overrides: {
  tasks?: number;
  rejects?: Array<{ id: string; expectedCheckId?: string; taskId?: string }>;
  taskBound?: boolean;
  brief?: unknown;
}): BuiltHarness {
  const tasks = Array.from({ length: overrides.tasks ?? 25 }, (_, i) => ({ taskId: `t${i}` }));
  const taskBound = overrides.taskBound !== false;
  const rejects = (
    overrides.rejects ?? [
      { id: "r-int", expectedCheckId: "bridge-truss-integrity-check" },
      { id: "r-phys", expectedCheckId: "bridge-truss-physics-check" },
    ]
  ).map((reject) => {
    const mapped = { ...reject };
    if (taskBound) mapped.taskId = reject.taskId ?? "t0";
    return mapped;
  });
  return double({
    brief: overrides.brief ?? CENSUS_BRIEF,
    battery: { tasks },
    corpus: { accept: [taskBound ? { id: "a1", taskId: "t0" } : { id: "a1" }], reject: rejects },
  });
}

function cleanProbeResult(corpus: BuiltHarness["corpus"]) {
  const controlReceipts = [
    ...corpus.accept.map((control) => ({
      schema: "control-receipt/v2" as const,
      controlId: control.id,
      taskId: control.taskId,
      kind: "accept" as const,
      expectedOutcome: "pass" as const,
      expectedCheckId: null,
      observedOutcome: "pass" as const,
      observedBlockingCheckIds: [],
      nonResultKind: null,
    })),
    ...corpus.reject.map((control) => {
      const expectedCheckId = control.expectedCheckId ?? null;
      return {
        schema: "control-receipt/v2" as const,
        controlId: control.id,
        taskId: control.taskId,
        kind: "reject" as const,
        expectedOutcome: "fail" as const,
        expectedCheckId,
        observedOutcome: expectedCheckId === null ? ("non-result" as const) : ("fail" as const),
        observedBlockingCheckIds: expectedCheckId === null ? [] : [expectedCheckId],
        nonResultKind: expectedCheckId === null ? ("verifier" as const) : null,
      };
    }),
  ];
  return { findings: [], controlReceipts };
}

/** A gate whose control probe always passes, recording each workspace it is handed. The cases below
 *  assert on that list: an empty one means the gate refused before it probed anything. */
function recordingGate() {
  const probed: string[] = [];
  const gate = makeCensusGate({
    probeControls: async (slugDir, _brief, corpus) => {
      probed.push(slugDir);
      return cleanProbeResult(corpus);
    },
    expectedTasks: 25,
  });
  return { gate, probed };
}

describe("the census gate", () => {
  // On Linux the Builder's own sandbox is Bubblewrap, and denying a path that does not exist makes
  // the mountpoint first: `--ro-bind /dev/null <path>` leaves a zero-byte mode-444 file on the
  // host at exactly the denied path. Reading mere existence as a shadow made the guard refuse its
  // own artefact — a live campaign completed a census of 25 tasks, 40 controls and no findings as an
  // environment non-result. Only a directory can shadow: Node skips a plain file at `@ana` and
  // resolves the vendor module from the parent tree.
  it.concurrent("ignores a plain file at node_modules/@ana, which cannot shadow a module", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-shadow-file");
    const slugDir = join(iterationDir, "workspace");
    mkdirSync(join(slugDir, "node_modules"), { recursive: true });
    writeFileSync(join(slugDir, "node_modules", "@ana"), "");
    const { gate, probed } = recordingGate();
    await gate(censusHarness({}), iterationDir, slugDir);
    expect(probed).toEqual([slugDir]);
    expect(existsSync(join(iterationDir, "environment-non-result.json"))).toBe(false);
  });

  it.concurrent("hands a workspace package that diverts @ana resolution back to the Builder with its path", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-shadow-dir");
    const slugDir = join(iterationDir, "workspace");
    // A workspace package diverts resolution (an empty @ana scope directory does not: resolution
    // keeps walking up past it). The package sits inside the workspace, so the Builder wrote it and
    // the Builder can remove it; classifying it as an environment failure would end authoring.
    const shadow = join(slugDir, "node_modules", "@ana", "agent-bundle");
    mkdirSync(shadow, { recursive: true });
    writeFileSync(join(shadow, "package.json"), '{"name":"@ana/agent-bundle","exports":{".":"./index.ts"}}');
    writeFileSync(join(shadow, "index.ts"), "export const shadowed = true;\n");
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "agent", "tools.ts"), 'import "@ana/agent-bundle";\n');
    const { gate, probed } = recordingGate();
    const feedback = await gate(censusHarness({}), iterationDir, slugDir);
    expect(feedback).toEqual([
      expect.objectContaining({
        owner: "agent/tools.ts",
        severity: "blocking",
        findings: [
          expect.objectContaining({
            code: "vendor-shadowed",
            path: "agent",
            detail: expect.stringContaining("remove node_modules/@ana/agent-bundle/index.ts"),
          }),
        ],
      }),
    ]);
    expect(probed).toEqual([]);
    expect(existsSync(join(iterationDir, "environment-non-result.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8")).verdict).toBe("fail");
  });

  it.concurrent("settles a tool the host could not run as the environment's non-result, not a correctness-model finding", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-tool-refused");
    const slugDir = join(iterationDir, "workspace");
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    const detail =
      '3 example(s) called tool "cc" for check "bound" and the host could not run it (sandbox) after its retry: "a0", "a1", "a2"; the verifier environment owns this, not the correctness model';
    const gate = makeCensusGate({
      probeControls: async (_dir, _brief, corpus) => ({
        ...cleanProbeResult(corpus),
        findings: [{ code: "verifier-tool-refused", path: "correctness-model/evaluator.ts", detail }],
      }),
      expectedTasks: 25,
    });
    const feedback = await gate(censusHarness({}), iterationDir, slugDir);
    expect(feedback).toEqual([
      expect.objectContaining({
        owner: "environment",
        severity: "blocking",
        claim: `control census cannot run: ${detail}`,
      }),
    ]);
    expect(feedback.some((row) => row.owner === "correctness-model/evaluator.ts")).toBe(false);
    expect(JSON.parse(readFileSync(join(iterationDir, "environment-non-result.json"), "utf8"))).toMatchObject(
      { kind: "verifier-tool-refused", detail },
    );
    const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
    expect(census.verdict).toMatchObject({ kind: "non-result" });
    // The controls that completed before the refusal keep their recorded evidence.
    expect(census.controlReceipts).toEqual(cleanProbeResult(censusHarness({}).corpus).controlReceipts);
  });

  it.concurrent("returns a census that exceeds its wall to the Builder as a blocking finding naming the stage, never accepting the candidate", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-wall-exceeded");
    const slugDir = join(iterationDir, "workspace");
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    // A control probe slower than the wall stands in for a heavy census.
    const probe = Promise.withResolvers<void>();
    let cut: (() => boolean) | undefined;
    const gate = makeCensusGate({
      probeControls: async (_dir, _brief, corpus, _tasks, stopped) => {
        cut = stopped;
        await probe.promise;
        return cleanProbeResult(corpus);
      },
      expectedTasks: 25,
      censusWallMs: 20,
    });
    const feedback = await gate(censusHarness({}), iterationDir, slugDir);
    expect(feedback).toEqual([
      expect.objectContaining({
        owner: "correctness-model/evaluator.ts",
        severity: "blocking",
        claim: "census wall: the controls stage was still running when the census stopped",
        findings: [
          expect.objectContaining({
            code: "census-wall-exceeded",
            path: "correctness-model/evaluator.ts",
            detail: expect.stringContaining("during the controls stage"),
          }),
        ],
      }),
    ]);
    expect(existsSync(join(iterationDir, "environment-non-result.json"))).toBe(false);
    // The cut probe is told to start no further control.
    expect(cut?.()).toBe(true);
    const verdict = () => JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8")).verdict;
    expect(verdict()).toBe("fail");
    // The abandoned probe finishing later must not replace the recorded failure with a pass.
    probe.resolve();
    await Bun.sleep(20);
    expect(verdict()).toBe("fail");
  });

  it.concurrent("applies the same wall to a solvability census that outlives it", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-wall-solvability");
    const slugDir = join(iterationDir, "workspace");
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    let cut: (() => boolean) | undefined;
    const gate = makeCensusGate({
      probeControls: async (_dir, _brief, corpus) => cleanProbeResult(corpus),
      expectedTasks: 25,
      solvability: (_harness, _dir, _slug, stopped) => {
        cut = stopped;
        return new Promise(() => undefined);
      },
      censusWallMs: 20,
    });
    const feedback = await gate(censusHarness({}), iterationDir, slugDir);
    expect(cut?.()).toBe(true);
    expect(feedback).toMatchObject([
      {
        owner: "correctness-model/evaluator.ts",
        claim: expect.stringContaining("reference solve stage"),
        findings: [{ path: "correctness-model/reference/index.ts" }],
      },
    ]);
    expect(JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8")).verdict).toBe("fail");
  });

  it.concurrent("leaves an invented @ana specifier to the Builder's own probe, never the environment", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-invented-package");
    const slugDir = join(iterationDir, "workspace");
    // The classification boundary: a misspelt or invented @ana name is an authoring defect the
    // generated-module-load probe owns; only controller-declared packages are environment property.
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "agent", "tools.ts"), 'import "@ana/correctness-model-bundel";\n');
    const { gate, probed } = recordingGate();
    await gate(censusHarness({}), iterationDir, slugDir);
    expect(probed).toEqual([slugDir]);
    expect(existsSync(join(iterationDir, "environment-non-result.json"))).toBe(false);
  });

  it.concurrent("refuses a bundle whose @ana walk-up cannot resolve at all", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-unresolvable");
    const slugDir = join(iterationDir, "workspace");
    const shadow = join(slugDir, "node_modules", "@ana", "agent-bundle");
    mkdirSync(shadow, { recursive: true });
    // A package whose declared entry is absent: resolution throws instead of diverging.
    writeFileSync(join(shadow, "package.json"), '{"name":"@ana/agent-bundle","exports":{".":"./gone.ts"}}');
    mkdirSync(join(slugDir, "agent"), { recursive: true });
    writeFileSync(join(slugDir, "agent", "tools.ts"), 'import "@ana/agent-bundle";\n');
    const { gate, probed } = recordingGate();
    const feedback = await gate(censusHarness({}), iterationDir, slugDir);
    expect(feedback).toContainEqual(expect.objectContaining({ owner: "environment", severity: "blocking" }));
    expect(probed).toEqual([]);
    expect(JSON.parse(readFileSync(join(iterationDir, "environment-non-result.json"), "utf8"))).toMatchObject(
      {
        kind: "vendor-resolution-broken",
        package: "@ana/agent-bundle",
      },
    );
  });

  it.concurrent("passes a full-size battery with zero census findings", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-pass");
    mkdirSync(iterationDir, { recursive: true });
    const { gate, probed } = recordingGate();
    // The gate probes the workspace tree supplied by the caller, without deriving another slug path.
    const workspace = join(SCRATCH_ROOT, "census-pass-workspace");
    const feedback = await gate(censusHarness({}), iterationDir, workspace);
    expect(feedback).toEqual([]);
    expect(probed).toEqual([workspace]);
    const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
    expect(census).toMatchObject({
      verdict: "pass",
      tasks: 25,
      expectedTasks: 25,
      acceptControls: 1,
      rejectControls: 2,
      findings: [],
    });
  });

  it.concurrent("blocks on executed census findings", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-fail");
    mkdirSync(iterationDir, { recursive: true });
    const finding: ContractFinding = {
      code: "DISCRIMINATION_REJECT_PASSED",
      path: "correctness-model/controls.json",
      detail: 'reject "r-int" passed the verifier',
    };
    // r-int passed: the live run reported that once, so the gate's receipt re-check adds no second row.
    const passed = (corpus: BuiltHarness["corpus"]) =>
      cleanProbeResult(corpus).controlReceipts.map(
        (receipt): ControlReceipt =>
          receipt.kind === "reject"
            ? { ...receipt, observedOutcome: "pass", observedBlockingCheckIds: [] }
            : receipt,
      );
    const gate = makeCensusGate({
      probeControls: async (_slugDir, _brief, corpus) => ({
        findings: [finding],
        controlReceipts: passed(corpus),
      }),
      expectedTasks: 25,
    });
    const feedback = await gate(
      censusHarness({
        rejects: [{ id: "r-int", expectedCheckId: "bridge-truss-integrity-check" }],
      }),
      iterationDir,
      join(iterationDir, "workspace"),
    );
    expect(feedback.map((f) => [f.owner, f.severity])).toEqual([
      ["correctness-model/evaluator.ts", "blocking"],
    ]);
    // EVERY census feedback row carries controller-validated findings: the outer repair input
    // drops findings-less feedback (consumerhw-live-01 iteration 2).
    for (const row of feedback) {
      expect(row.findings?.length ?? 0).toBeGreaterThan(0);
      const [carried] = row.findings ?? [];
      expect(carried).toMatchObject({
        disclosure: { class: "authored" },
      });
    }
    expect(feedback[0]?.claim).toContain("control census against the installed tools returned 1 finding(s)");
    const verifierRow = feedback[0];
    expect(verifierRow?.findings).toHaveLength(1);
    const [verifierFinding] = verifierRow?.findings ?? [];
    expect(verifierFinding).toMatchObject({
      disclosure: { class: "authored" },
    });
    const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
    expect(census.verdict).toBe("fail");
    expect(census.findings).toHaveLength(1);
  });

  it.concurrent("reports verifier drift only when the census established its own identity", async () => {
    const harness = double<BuiltHarness>({
      ...censusHarness({}),
      conformance: { verifierEnvironmentHash: "sha-captured" },
    });
    const codesFor = async (
      name: string,
      probe: Awaited<ReturnType<Parameters<typeof makeCensusGate>[0]["probeControls"]>>,
    ) => {
      const iterationDir = join(SCRATCH_ROOT, name);
      mkdirSync(iterationDir, { recursive: true });
      const feedback = await makeCensusGate({ probeControls: async () => probe, expectedTasks: 25 })(
        harness,
        iterationDir,
        join(iterationDir, "workspace"),
      );
      return feedback.flatMap((row) => row.findings ?? []).map((finding) => finding.code);
    };
    // A module that would not load stops the census before any tool ran: its own finding alone.
    const unloaded = {
      findings: [{ code: "generated-module-load", path: "correctness-model/evaluator.ts", detail: "load" }],
    };
    expect(await codesFor("census-drift-unloaded", unloaded)).toEqual(["generated-module-load"]);
    const changed = { ...cleanProbeResult(harness.corpus), verifierEnvironmentHash: "sha-changed" };
    expect(await codesFor("census-drift-changed", changed)).toEqual(["verifier-condition-drift"]);
  });

  it.concurrent("keeps an advisory F2 observation beside a passing admission verdict", async () => {
    const iterationDir = join(SCRATCH_ROOT, "census-advisory");
    mkdirSync(iterationDir, { recursive: true });
    const gate = makeCensusGate({
      probeControls: async (_slugDir, _brief, corpus) => cleanProbeResult(corpus),
      expectedTasks: 25,
      solvability: async () => [
        {
          owner: "correctness-model/brief.json",
          severity: "advisory",
          claim: "the representation census recorded an observation",
          evidence: "public representation census",
        },
      ],
    });

    const feedback = await gate(censusHarness({}), iterationDir, join(iterationDir, "workspace"));
    expect(feedback).toMatchObject([{ owner: "correctness-model/brief.json", severity: "advisory" }]);
    expect(JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"))).toMatchObject({
      verdict: "pass",
      findings: [],
    });
  });

  // All three roots Node's walk can step through before leaving the workspace: run 52's shim
  // appeared under agent/, but a replacement package at any of them diverts the vendor resolution
  // the same way. Each writes real divergent bytes — an empty @ana scope cannot divert anything.
  // The owner follows the importing directory, so the finding reaches the contract the shadow
  // broke; the remedy names the shadow's own path, which is what run 52's seven rounds lacked.
  for (const shadowRoot of ["node_modules", "agent/node_modules", "correctness-model/node_modules"]) {
    it.concurrent(`hands a workspace ${shadowRoot}/@ana shadow to the Builder that wrote it, never to the environment`, async () => {
      const suffix = shadowRoot.replaceAll("/", "-");
      const iterationDir = join(SCRATCH_ROOT, `census-shadow-${suffix}`);
      mkdirSync(iterationDir, { recursive: true });
      const workspace = join(SCRATCH_ROOT, `census-shadow-workspace-${suffix}`);
      const shim = join(workspace, shadowRoot, "@ana", "agent-bundle");
      mkdirSync(shim, { recursive: true });
      writeFileSync(join(shim, "package.json"), '{"name":"@ana/agent-bundle","exports":{".":"./index.ts"}}');
      writeFileSync(join(shim, "index.ts"), "export const shadowed = true;\n");
      // The importer sits in the generated directory whose walk-up meets this shadow root.
      const importer = shadowRoot === "correctness-model/node_modules" ? "correctness-model" : "agent";
      mkdirSync(join(workspace, importer), { recursive: true });
      writeFileSync(join(workspace, importer, "tools.ts"), 'import "@ana/agent-bundle";\n');
      const { gate, probed } = recordingGate();
      const feedback = await gate(censusHarness({}), iterationDir, workspace);
      const owner = importer === "agent" ? "agent/tools.ts" : "correctness-model/evaluator.ts";
      expect(feedback).toMatchObject([{ owner, severity: "blocking" }]);
      expect(feedback[0]?.claim).toContain("@ana/agent-bundle");
      expect(feedback[0]?.findings?.[0]?.detail).toContain(`remove ${shadowRoot}/@ana/agent-bundle/index.ts`);
      expect(probed).toEqual([]);
      const census = JSON.parse(readFileSync(join(iterationDir, "census.json"), "utf8"));
      expect(census.verdict).toBe("fail");
      expect(existsSync(join(iterationDir, "environment-non-result.json"))).toBe(false);
    });
  }
});
