/**
 * The SolvabilityCaseEvidence fields shared by two census-gate test suites.
 * Extracted from test/solvability-gate.test.ts when test/representation-census.test.ts became its
 * second consumer, so a field added to the evidence is added once here instead of in two fixtures.
 *
 * These are doubled evidence rows for testing what the gate projects. A test that needs the census
 * to actually run over a bundle on disk wants `solvability-specimen.ts` instead.
 */
import type { SolvabilityFailure } from "../../src/claim/readiness.ts";
import type { BuildDeps } from "../../src/correctness-bundle/build-deps.ts";
import { double } from "./doubles.ts";

export interface CaseSpec {
  taskId: string;
  status: "passed" | "failed" | "non-result";
  /** The reference artifact the witness readers take; omitted means the row carries none. */
  artifact?: unknown;
  /** Declared truth-checks this case's evaluate rejected; the concentration projection reads them. */
  failedCheckIds?: string[];
  /** A failed row's attribution; omitted means the checks rejected the witness. */
  failure?: SolvabilityFailure;
  error?: string;
}

export function solvabilityCase(spec: CaseSpec) {
  const { status } = spec;
  return {
    taskId: spec.taskId,
    fullTaskDigest: "d",
    publicTaskDigest: "p",
    artifactDigest: "artifact" in spec ? "a" : null,
    artifact: spec.artifact ?? null,
    status,
    ...(status === "failed" && { failure: spec.failure ?? "witness" }),
    ...(status === "non-result" && { nonResultKind: "reference-solve-host" }),
    submissionPath: null,
    referenceSolve: null,
    failedCheckIds: spec.failedCheckIds ?? [],
    predicateFailures: [],
    error: spec.error ?? (status === "passed" ? null : "reference artifact did not earn a truth verdict"),
  };
}

/** A probe returning exactly these rows; null returns the evidence-less bundleSnapshot-integrity failure.
 *  `findings` carries the probe's own contract findings, which the gate routes beside the cases. */
export function probeReturning(
  specs: CaseSpec[] | null,
  findings: Array<{ code: string; path: string; detail: string; owner?: string }> = [],
): BuildDeps["probeSolvability"] {
  const result =
    specs === null
      ? {
          evidence: null,
          findings: [
            {
              code: "solvability-bundleSnapshot-integrity",
              path: ".bundle-snapshots",
              detail: "bundleSnapshot digest drifted mid-probe",
            },
          ],
        }
      : { evidence: { schema: "solvability/v10", cases: specs.map(solvabilityCase) }, findings };
  return () => Promise.resolve(double<Awaited<ReturnType<BuildDeps["probeSolvability"]>>>(result));
}
