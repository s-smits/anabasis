/**
 * One specimen: a whole candidate bundle on disk — brief, tasks, controls, reference solve,
 * evaluator, writer tool — and the production census run over it. Every F2 test writes a real
 * bundle and varies one fact of it, so `specimen` takes the whole description and every other
 * builder here is a short call to it.
 *
 * The five `solvability-*.test.ts` files share this module. It carries what more than one of them
 * needs; a fixture one file uses stays in that file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { type TSchema, Type } from "@earendil-works/pi-ai";
import type { JsonObject, JsonValue } from "../../src/meta/json-shape.ts";
import { fingerprintSlug } from "../../src/claim/fingerprint.ts";
import { type DomainHarnessFactory, createBuiltStarter } from "../../src/solve/built-starter.ts";
import { defineDraftTool } from "../../src/solve/draft-tool.ts";
import { sha256OfFile } from "../../src/meta/digest.ts";
import { createVerifierHost } from "../../src/verify/host.ts";
import type { ToolEntry, VerifierHostHandle } from "../../src/verify/verifier-port.ts";
import type { SolvabilityStageCache } from "../../src/truth/solvability-stages.ts";
import { double } from "./doubles.ts";
import { scratchDir } from "./scratch.ts";
import { type SolvabilityProbeOptions, makeProbeSolvability } from "../../src/truth/solvability.ts";
import { keyIfDefined, keysIf } from "../../src/meta/optional-key.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { makeSolvabilityCensusGate } from "../../src/run/solvability-gate.ts";
import { createVerifierLifetime, type VerifierLifetime } from "../../src/verify/verifier-lifetime.ts";

export const OPERAND = { key: new Uint8Array(32).fill(11), keyId: "solvability-test-key" };

export type StarterFactory = NonNullable<SolvabilityProbeOptions["createSolvabilityStarter"]>;
export interface FixtureTask {
  taskId: string;
  family: string;
  publicInput: JsonObject;
  hidden: Array<{ checkId: string; expectation: JsonValue }>;
}

interface CheckSpec {
  id: string;
  /** The artifact roots the check declares it reads. */
  roots: string[];
  /** The public input paths it declares. */
  inputs?: string[];
  /** The installed tool that decides it, which also makes the evidence external and open. */
  tool?: string;
  /** Declare no hidden operand, for an authored check that reads the public task alone. */
  open?: true;
}

export interface SpecimenSpec {
  /** Reference-solve source, the line `// CHECKS`, then the evaluator source. */
  verifier: string;
  slug?: string;
  schema?: Array<{ name: string; "shape": string; taskConditioned?: true }>;
  /** Grounds the default `answer` check on this installed tool. */
  tool?: string;
  /** Replaces the default single `answer` check. */
  checks?: JsonValue[];
  /** Declared after the default `answer` check. */
  extraChecks?: JsonValue[];
  /** Replaces the two default tasks. */
  tasks?: FixtureTask[];
  /** Each default task's expected value, in task order. */
  answers?: JsonValue[];
  /** Added to every default task's hidden rows. */
  extraHidden?: Array<{ checkId: string; expectation: JsonValue }>;
  /** Replaces the accept corpus derived from the tasks. */
  accepts?: Array<{ id: string; taskId: string; artifact: JsonValue }>;
  /** Accept-control artifacts, in task order, instead of the answer each task expects. */
  acceptArtifacts?: JsonValue[];
  /** The roots the generated writer declares; the schema roots by default. */
  writerRoots?: string[];
  writerKinds?: Record<string, "unknown" | "string">;
  /** Also give the writer an incremental one-root tool. */
  fieldWriter?: boolean;
}

export interface Fixture {
  dir: string;
  fingerprint: ReturnType<typeof fingerprintOf>;
}

// ---------------------------------------------------------------------------------------------
// Running the census.

type Purpose = "adoption" | "readiness";
export type Witnessed = Awaited<ReturnType<ReturnType<typeof makeProbeSolvability>>>;

/** Counts the host subjects a census opened, and which checks each one ran. */
interface EvaluateLog {
  calls: number;
  subjects: string[];
  /** Check ids by subject id, so a transplant's narrowed check set is readable. */
  checks: Record<string, string[]>;
}

/** Exits 0 whatever it is handed. */
export const ACCEPTING_TOOL = "#!/bin/sh\nexit 0\n";
/** Exits 0 when its two cell files hold the same line — shell builtins only. */
export const COMPARING_TOOL = '#!/bin/sh\nread a < "$1"\nread b < "$2"\n[ "$a" = "$b" ]\n';
// ---------------------------------------------------------------------------------------------
// Verifier sources.

export const GOOD_VERIFIER = `
export function solve(task) {
  return { answer: task.publicInput.expected };
}
// CHECKS
export const checks = { answer: (request) => request.artifact?.answer === request.hidden[0]?.expectation };
`;

// ---------------------------------------------------------------------------------------------
// The writer the F2 submission path drives. Its parameters come from a file the specimen writes,
// so one starter serves every artifact shape below.

export const createSolvabilityStarter: NonNullable<
  SolvabilityProbeOptions["createSolvabilityStarter"]
> = async ({ slugDir, task, submission, publicArtifactSchema }) => {
  const writer = parseJsonAs<{
    roots: string[];
    kinds: Record<string, "unknown" | "string">;
    fieldWriter?: boolean;
  }>(readFileSync(join(slugDir, "agent/test-writer-schema.json"), "utf8"));
  const properties: Record<string, TSchema> = {};
  for (const root of writer.roots) {
    properties[root] = writer.kinds[root] === "string" ? Type.String() : Type.Unknown();
  }
  const factory: DomainHarnessFactory = () => {
    const staged: JsonObject = {};
    return {
      tools: [
        defineDraftTool({
          name: "write_answer",
          label: "Write answer",
          description: "Write the complete structured answer.",
          executionMode: "sequential",
          parameters: Type.Object(properties),
          run(params, draft) {
            draft.setArtifact(params);
            return { text: "answer written" };
          },
        }),
        ...(writer.fieldWriter === true
          ? [
              defineDraftTool({
                name: "set_field",
                label: "Set one artifact field",
                description: "Set one artifact root value.",
                executionMode: "sequential" as const,
                parameters: Type.Object({ root: Type.String(), value: Type.Unknown() }),
                run(params, draft) {
                  /* SAFETY: the TypeBox schema two lines above declares exactly these two
                     parameters, and the runtime validates against it before run(). */
                  const row = params as { root: string; value: JsonValue };
                  staged[row.root] = row.value;
                  draft.setArtifact({ ...staged });
                  return { text: "field set" };
                },
              }),
            ]
          : []),
      ],
    };
  };
  return createBuiltStarter(task, factory, submission, {
    domainToolAuthorities: [
      { name: "write_answer", authority: "artifact-writer" },
      ...(writer.fieldWriter === true ? [{ name: "set_field", authority: "artifact-writer" as const }] : []),
    ],
    publicArtifactSchema,
  });
};

/** One declared truth check. Every check in this file differs only in these five facts. */
export const check = ({ id, roots, inputs = [], tool, open }: CheckSpec): JsonValue => ({
  id,
  assertion: `the submitted ${id} satisfies its declared expectation`,
  execution: {
    families: "all",
    artifactPaths: roots,
    publicInputPaths: inputs,
    hidden: open === true || tool !== undefined ? "none" : "required",
    evidence: tool === undefined ? { kind: "authored" } : { kind: "external", requiredToolIds: [tool] },
  },
});

/** One task expecting its own answer. */
const answering = (taskId: string, family: string, expected: JsonValue): FixtureTask => ({
  taskId,
  family,
  publicInput: { expected },
  hidden: [{ checkId: "answer", expectation: expected }],
});

export const BASE_TASKS = [answering("ta", "one", "A"), answering("tb", "two", "B")];

/** The agent side of the bundle. The probe injects its own starter, so nothing here compiles
 *  `tools.ts`; the fingerprint requires the file, and `test-writer-schema.json` is what the
 *  injected starter reads to declare the roots and kinds the schema promises. */
function writeAgent(dir: string, roots: string[], spec: SpecimenSpec): void {
  writeFileSync(
    join(dir, "agent", "tools.ts"),
    `import { defineDraftTool } from "@ana/agent-bundle";
import { Type } from "@earendil-works/pi-ai";
export function createDomainHarness(_task) {
  return { tools: [defineDraftTool({ name: "write_answer", label: "Write answer",
    description: "Write the complete structured answer.", executionMode: "sequential",
    parameters: Type.Object({}), run: (params, draft) => { draft.setArtifact(params); return { text: "written" }; },
  })] };
}
`,
  );
  const kinds = spec.writerKinds ?? {};
  const fieldWriter = spec.fieldWriter === true;
  const schema = { roots, kinds, ...keysIf(fieldWriter, () => ({ fieldWriter })) };
  writeFileSync(join(dir, "agent", "test-writer-schema.json"), JSON.stringify(schema));
  writeFileSync(
    join(dir, "agent", "tools-spec.json"),
    JSON.stringify({
      presets: [],
      declined: { files: "fixture without a shell" },
      tools: [{ name: "write_answer", kind: "artifact-writer", description: "Write the answer." }],
    }),
  );
  writeFileSync(join(dir, "agent", "BUILT_AGENTS.md"), "Write the answer, then prepare it.\n");
}

function fingerprintOf(dir: string, slug = "proof") {
  const fingerprint = fingerprintSlug(dir, { slug });
  if (!fingerprint.ok) throw new Error(JSON.stringify(fingerprint.findings));
  return fingerprint;
}

export function specimen(spec: SpecimenSpec): Fixture {
  const slug = spec.slug ?? "proof";
  const schema = spec.schema ?? [{ name: "answer", "shape": "string" }];
  const dir = scratchDir("ana-solvability-");
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "correctness-model/reference"), { recursive: true });
  writeAgent(dir, spec.writerRoots ?? schema.map((root) => root.name), spec);

  const [reference, checks] = spec.verifier.split("// CHECKS");
  if (reference === undefined || checks === undefined) throw new Error("fixture needs both sections");
  writeFileSync(join(dir, "correctness-model/reference/index.ts"), reference);
  writeFileSync(join(dir, "correctness-model/evaluator.ts"), checks);

  const expectations = spec.answers ?? BASE_TASKS.map((base) => base.publicInput.expected ?? null);
  const tasks =
    spec.tasks ??
    BASE_TASKS.map((base, index) => {
      const task = answering(base.taskId, base.family, expectations[index] ?? null);
      // An externally grounded check declares no hidden operand, so its tasks carry none.
      const hidden = spec.tool === undefined ? [...task.hidden, ...(spec.extraHidden ?? [])] : [];
      return { ...task, hidden };
    });
  const artifacts =
    spec.acceptArtifacts ?? tasks.map((task) => ({ answer: task.publicInput.expected ?? null }));
  const accepts =
    spec.accepts ??
    artifacts.map((artifact, index) => ({
      id: `accept-${String(index)}`,
      taskId: tasks[index % tasks.length]?.taskId ?? "ta",
      artifact,
    }));

  const answer = check({
    id: "answer",
    roots: ["$.answer"],
    inputs: ["$.expected"],
    ...keyIfDefined("tool", spec.tool),
  });
  const model = (name: string) => join(dir, "correctness-model", name);
  writeFileSync(
    model("brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      slug,
      domain: "answering",
      decisions: ["the submitted answer is the writer decision"],
      gates: ["the answer must match the hidden expectation"],
      truthChecks: spec.checks ?? [answer, ...(spec.extraChecks ?? [])],
      joins: [],
      artifactSchema: schema,
      designRuleConstants: [],
    }),
  );
  writeFileSync(model("tasks.json"), JSON.stringify(tasks));
  writeFileSync(model("controls.json"), JSON.stringify({ accept: accepts, reject: [] }));
  return { dir, fingerprint: fingerprintOf(dir, slug) };
}

/** Edit one correctness-model file and fingerprint the changed candidate. */
export function revise(fixture: Fixture, file: string, from: string, to: string): Fixture {
  const path = join(fixture.dir, "correctness-model", file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`fixture text missing: ${from}`);
  writeFileSync(path, text.replace(from, to));
  return { dir: fixture.dir, fingerprint: fingerprintOf(fixture.dir) };
}
export function testLifetime(): VerifierLifetime {
  return createVerifierLifetime({ root: scratchDir("ana-solvability-receipts-") });
}

export function probe(options: SolvabilityProbeOptions = {}, purpose: Purpose = "adoption") {
  const run = makeProbeSolvability(
    { verifierLifetime: testLifetime(), createSolvabilityStarter, ...options },
    purpose,
  );
  return (fixture: Fixture, stages?: SolvabilityStageCache): Promise<Witnessed> =>
    run({
      slugDir: fixture.dir,
      fingerprint: fixture.fingerprint,
      operandCommitment: OPERAND,
      ...keyIfDefined("stages", stages),
    });
}

export const witness = (
  fixture: Fixture,
  options: SolvabilityProbeOptions = {},
  purpose: Purpose = "adoption",
): Promise<Witnessed> => probe(options, purpose)(fixture);

export const statuses = (result: Witnessed) => result.evidence?.cases.map((row) => row.status);
export const codes = (result: Witnessed) => result.findings.map((finding) => finding.code);
export const failure = (result: Witnessed, index = 0) => result.evidence?.cases[index]?.error;
export const sources = (result: Witnessed) => result.evidence?.cases.map((row) => row.referenceSolve?.source);
export const keys = (result: Witnessed) => result.evidence?.cases.map((row) => row.referenceSolve?.key);

/** What the census gate hands the author for this result. */
export function gate(
  fixture: Fixture,
  result: Witnessed,
  options: Parameters<typeof makeSolvabilityCensusGate>[0] = {},
) {
  return makeSolvabilityCensusGate(options, async () => result)(
    double({ fingerprint: fixture.fingerprint }),
    fixture.dir,
    fixture.dir,
  );
}

export function evaluateLog(): EvaluateLog {
  return { calls: 0, subjects: [], checks: {} };
}

export function countingHost(log: EvaluateLog, host = createVerifierHost()): VerifierHostHandle {
  return {
    openSubject: (subject) => {
      log.calls += 1;
      log.subjects.push(subject.subjectId);
      log.checks[subject.subjectId] = (subject.checks ?? []).map((applicable) => applicable.id);
      return host.openSubject(subject);
    },
    tools: () => host.tools(),
    evidence: () => host.evidence(),
    executedBindings: () => host.executedBindings(),
  };
}
/** A real executable whose content digest the host checks before it launches it. */
export function installedTool(id: string, body: string): ToolEntry {
  const path = join(scratchDir("ana-solvability-tool-"), id);
  writeFileSync(path, body, { mode: 0o755 });
  return { id, path, digest: sha256OfFile(path), source: "host", kind: "binary", interpreter: null };
}

/** Put an executable under the candidate's own tool tree, where validation resolves declared ids. */
export function installUnderCandidate(fixture: Fixture, id: string, body: string): Fixture {
  const bin = join(fixture.dir, ".toolchain", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, id), body, { mode: 0o755 });
  return { dir: fixture.dir, fingerprint: fingerprintOf(fixture.dir) };
}

/** GOOD_VERIFIER with a different solve body: the one line the reference-solve tests vary. */
export const solving = (body: string) =>
  GOOD_VERIFIER.replace("return { answer: task.publicInput.expected };", body);
