/**
 * Validate the agent and correctness-model bundles, then calculate their content hashes and a
 * separate battery hash. Failed validation returns findings instead of fingerprints.
 * Claim.create() requires recorded bundle hashes to identify the measured product.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { basename, join } from "../meta/path.ts";
import { BRIEF_FILE, CONTROLS_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";
import { sha256 } from "../meta/digest.ts";
import { type BundleFile, IrregularBundleEntryError, hashBundle } from "./bundle-hash.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, agent-deciding-computation): commented out (unsure): the
// agent-side copy scan's import.
// import { agentCarriesDecidingComputation } from "./correctness-model-hygiene.ts";
import {
  generatedCorrectnessModelCapabilityEscapes,
  scannableBundleSource,
} from "./correctness-model-hygiene.ts";
import {
  type BundleValidationFinding,
  parseGeneratedSource,
  validateAgentBundle,
} from "./bundle-validation.ts";
import { scoringClosureHash } from "./scoring-closure.ts";

/** The evaluation identity one measurement was labelled under: the scoring program plus the
 *  battery pair (tasks.json, controls.json) that supplied its controls corpus. Both halves are
 *  needed to say a finding describes a given tree, because a controls-only correction moves the
 *  second while leaving the first byte-identical, and the case labels a run produces are
 *  conditioned on the controls as much as on the checker. A reference solve or test rewritten
 *  beside them labels nothing, so it leaves the identity where it was. */
export type EvaluationIdentity = { scoringHash: string | null; taskSetHash: string | null };

export interface FingerprintEvidence {
  ok: true;
  slug: string;
  /** Hash of everything under agent/. The public task projection is supplied separately for each
   *  case through `commitPublicTask` rather than stored in this bundle, so changing only the
   *  battery leaves this hash unchanged, which is what distinguishes a task change from a change
   *  to the solving agent. */
  agentHash: string;
  /** Hash of correctness-model/ excluding tasks.json and controls.json. Battery identity is
   *  recorded separately from verifier identity, because including the battery here makes editing a
   *  task look like a change to the correctness model even when the verifier code is untouched. */
  correctnessModelHash: string;
  /** The scoring program alone: brief.json and evaluator.ts with every module it imports
   *  (`scoring-closure.ts`). Every "did the scoring move" reading compares this, so a rewritten
   *  reference solve or test keeps a task probe a task probe. Falls back to correctnessModelHash
   *  when the import closure cannot be read. */
  scoringHash: string;
  /** Hash of tasks.json and controls.json, including ids and contents. Controls refer to
   *  task ids, so the two files together identify the battery.
   *  Null when the bundle carries no tasks.json. */
  taskSetHash: string | null;
  agentFiles: BundleFile[];
  correctnessModelFiles: BundleFile[];
}

/** Tasks and their task-bound controls. Both contribute to taskSetHash, outside correctnessModelHash
 *  and scoringHash, so a task-only change can keep the scoring program fixed. */
export const BATTERY_FILES = [basename(TASKS_FILE), basename(CONTROLS_FILE)] as const;

interface FingerprintRejection {
  ok: false;
  slug: string;
  findings: BundleValidationFinding[];
}

/** One content address over the battery pair. Null without tasks.json. */
export function batteryHash(correctnessModelDir: string): string | null {
  if (!existsSync(join(correctnessModelDir, basename(TASKS_FILE)))) return null;
  return sha256(
    new Uint8Array(
      Bun.concatArrayBuffers(
        BATTERY_FILES.flatMap((name) => {
          const path = join(correctnessModelDir, name);
          return [existsSync(path) ? readFileSync(path) : new Uint8Array(), Uint8Array.of(10)];
        }),
      ),
    ),
  );
}

/**
 * Fingerprint `slugDir`, which must contain exactly the two-bundle layout: `agent/` and `correctness-model/`.
 * Returns every validation finding at once, because a repair loop should see the whole list rather
 * than one finding per round.
 */
export function fingerprintSlug(
  slugDir: string,
  opts?: { slug?: string },
): FingerprintEvidence | FingerprintRejection {
  const slug = opts?.slug ?? slugDir.split("/").findLast(Boolean) ?? slugDir;
  const agentDir = join(slugDir, "agent");
  const correctnessModelDir = join(slugDir, "correctness-model");
  for (const [name, dir] of [
    ["agent", agentDir],
    ["correctness-model", correctnessModelDir],
  ] as const) {
    if (!existsSync(dir)) {
      return {
        ok: false,
        slug,
        findings: [
          {
            code: "missing-bundle",
            file: name,
            detail: `slug has no ${name}/ bundle — the two-bundle layout is the fingerprint's precondition`,
          },
        ],
      };
    }
  }

  // Generated builds write brief.json before authoring the correctness model, so its presence is
  // what selects the capability scan below; a read-only fixture without that marker skips it.
  const generated = existsSync(join(correctnessModelDir, basename(BRIEF_FILE)));
  const validation = validateAgentBundle(agentDir);
  if (!validation.ok) return { ok: false, slug, findings: validation.findings };

  // Validation already walked agent/, and an irregular entry there returned findings above. The
  // correctness-model bundle is hashed here, so its irregular entries have to reject here: a
  // symlinked correctness-model file would be verified at runtime while being absent from the
  // verifier's content address, which is the one place a reader looks to say what ran.
  let agent: ReturnType<typeof hashBundle>;
  let correctnessModel: ReturnType<typeof hashBundle>;
  // Gate audit 2026-09-25 (docs/gate-audit.md, bundle-walls): kept: an entry the content hash cannot cover
  // would leave measured bytes outside the product identity.
  try {
    agent = hashBundle(agentDir);
    correctnessModel = hashBundle(correctnessModelDir, { excludeTop: [...BATTERY_FILES] });
  } catch (error) {
    if (!(error instanceof IrregularBundleEntryError)) throw error;
    return {
      ok: false,
      slug,
      findings: error.entries.map((path) => ({
        code: "non-regular-entry" as const,
        file: path,
        detail:
          "unsupported or excluded entry in the bundle — rejected, not skipped: unhashed content breaks the content address's coverage",
      })),
    };
  }
  // Gate audit 2026-09-25 (docs/gate-audit.md, bundle-walls): kept: process execution and the ambient
  // environment belong to the verifier host, never to authored correctness-model source.
  // Brief-marked generated source may not spawn processes or forward the ambient environment.
  // `scannableBundleSource` leaves test files out, since they are not part of what the verifier
  // executes.
  const correctnessModelSourceFindings: BundleValidationFinding[] = generated
    ? correctnessModel.files.flatMap((file) => {
        if (!scannableBundleSource(file)) return [];
        const source = parseGeneratedSource(
          readFileSync(join(correctnessModelDir, file.path), "utf8"),
          file.path,
        );
        return generatedCorrectnessModelCapabilityEscapes(source).map((capabilityEscape) => ({
          code: "correctness-model-capability-escape" as const,
          file: `correctness-model/${file.path}`,
          detail:
            capabilityEscape.kind === "child-process"
              ? `generated correctnessModel loads ${capturedJsonStringify(capabilityEscape.token)} directly — process execution belongs to the controller-owned verifier host, never model-authored correctnessModel source`
              : `generated correctnessModel forwards the ambient environment through ${capturedJsonStringify(capabilityEscape.token)} — ambient forwarding is outside model-authored correctnessModel authority; verifier execution belongs to the controller-owned host`,
        }));
      })
    : [];
  // Gate audit 2026-09-25 (docs/gate-audit.md, agent-deciding-computation): commented out (unsure): an agent
  // module exporting two or more computations structurally identical to the correctness model's is refused;
  // unsure the match separates a copied verifier from legitimate candidate analysis.
  // // The import checks above close the route where agent code imports the verifier's modules, but
  // // a copy leaves no import behind, and the solver's roster would then answer the question the
  // // battery asks. This check reads the agent's own source for that copy.
  // const decidingInAgent: BundleValidationFinding[] = generated
  //   ? agentCarriesDecidingComputation(agentDir, agent.files, correctnessModelDir, correctnessModel.files).map(
  //       (copy) => ({
  //         code: "agent-carries-deciding-computation" as const,
  //         file: `agent/${copy.agentFile}`,
  //         detail: `agent/${copy.agentFile} exports ${copy.shared.length} of the computations correctness-model/${copy.correctnessModelFile} decides with (${copy.shared.join(", ")}); the solver may analyse its own candidate against published rules, but shipping the deciding computation in its tool roster measures the verifier against itself — keep that computation in correctness-model/ only`,
  //       }),
  //     )
  //   : [];
  // Gate audit 2026-09-25 (docs/gate-audit.md, agent-deciding-computation): commented out (unsure): the
  // agent-side copy scan joined the source findings here.
  // const sourceFindings = [...correctnessModelSourceFindings, ...decidingInAgent];
  const sourceFindings = correctnessModelSourceFindings;
  if (sourceFindings.length > 0) return { ok: false, slug, findings: sourceFindings };
  const taskSetHash = batteryHash(correctnessModelDir);
  return {
    ok: true,
    slug,
    agentHash: agent.hash,
    correctnessModelHash: correctnessModel.hash,
    scoringHash: scoringClosureHash(correctnessModelDir) ?? correctnessModel.hash,
    taskSetHash,
    agentFiles: agent.files,
    correctnessModelFiles: correctnessModel.files,
  };
}

/** The recorded task-set identity, or null when the candidate has no readable battery. */
export function taskSetDigest(domainDir: string): string | null {
  try {
    return batteryHash(join(domainDir, "correctness-model"));
  } catch {
    return null;
  }
}

/** The evaluation identity of one bundle directory, read through the same two recorded digests
 *  promotion and experiment freeze already check. It sits beside them because it is exactly their
 *  composition: promotion owns it, admission needs it, and a copy in either file would close a
 *  module cycle that neither file's subject asked for. */
export function evaluationIdentity(domainDir: string): EvaluationIdentity {
  const recorded = fingerprintSlug(domainDir);
  return {
    scoringHash: recorded.ok ? recorded.scoringHash : null,
    taskSetHash: taskSetDigest(domainDir),
  };
}
