/** The F2 reference witnesses paired with their public tasks, and the input-insensitivity
 *  observation read over the failed ones. */
import { plainRecord } from "../meta/json-evidence.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { type ContractFinding, finding } from "../truth/brief.ts";
import { REFERENCE_SOLVE_ENTRY_SOLVE } from "../truth/evaluator-process-bundle.ts";
import type { JsonValue } from "../meta/json-shape.ts";

/** One reference witness paired with the public task the agent solving it would have seen. */
export interface Witness {
  taskId: string;
  artifact: unknown;
  /** Assembled from a validated `BuildTask` publicInput or from recorded JSON evidence, so the
   *  witness states that here rather than making each reader assert it. */
  publicInput: JsonValue;
}

/**
 * Detect a reference root that stays constant across different public inputs. The pattern this
 * catches is a reference solve reading publicInput fields the authored tasks do not carry, so it
 * derives one byte-identical value for every task and F2 refuses all of them. The aggregate count
 * alone tells the Builder only that the solve is wrong everywhere, and a rebuild can fail
 * identically; this observation names a concrete pattern the model can go and investigate.
 *
 * Both compared sides are the Builder's own facts — its solve's outputs, its authored public
 * inputs — so the finding may describe their relationship. It carries no task id, check id,
 * verifier output or hidden expectation.
 *
 * The archived census's empty-proves-nothing rule (`bulky` above) inverts here on purpose. For copying, empty
 * matching empty is no evidence; for responsiveness, a derived root that stays empty while every
 * input differs is exactly the signal, and an empty plan is the usual shape of the defect. A root
 * that is legitimately constant still yields a true observation with its denominators stated, and
 * the model judges whether that constancy was intended. These findings carry no severity of their
 * own: they accompany an already blocking census result as diagnosis.
 */
export function inputInsensitivity(witnesses: readonly Witness[]): ContractFinding[] {
  if (witnesses.length < 2) return [];
  const distinctInputs = new Set(witnesses.map((w) => canonicalJson(w.publicInput))).size;
  if (distinctInputs < 2) return []; // constant output under constant input proves nothing
  const first = plainRecord(witnesses[0]?.artifact);
  if (first === null) return [];
  const findings: ContractFinding[] = [];
  for (const root of Object.keys(first).sort()) {
    const values = witnesses.map((w) => {
      const record = plainRecord(w.artifact);
      return record !== null && root in record ? canonicalJson(record[root]) : null;
    });
    if (values.includes(null) || new Set(values).size !== 1) continue;
    findings.push(
      finding(
        "REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT",
        REFERENCE_SOLVE_ENTRY_SOLVE,
        `the reference solve returned one byte-identical value at artifact root "${root}" across all ${witnesses.length} failed reference solves, while those tasks carry ${distinctInputs} distinct public inputs — a root derived without reading the authored task; execute correctness-model/reference/index.ts#solve over the public inputs in correctness-model/tasks.json yourself and compare the field names solve reads against the fields the tasks actually carry`,
      ),
    );
  }
  return findings;
}
