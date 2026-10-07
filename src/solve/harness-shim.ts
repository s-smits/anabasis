/**
 * What a v1 harness's `agent/tools.ts` imports, as `harness.ts` bundles it: both
 * `@ana/agent-bundle` and `@earendil-works/pi-ai` resolve to this one file, so the bundle carries
 * TypeBox and nothing of pi, and runs inside the command wall without pi installed there.
 *
 * Sed from harness-builder-v4 at 7af7315: the limits and the refusal in `toolDefinition`
 * (src/solve/define-tool.ts), the brand and the argument check in `defineDraftTool`
 * (src/solve/draft-tool.ts), the result check in `evidenceResult` (define-tool.ts), and the two
 * types from src/solve/built-starter.ts. Departures, each named where it is made:
 * - `run`'s `draft` is an object every access to which throws (`NO_DRAFT`): harness tools keep no
 *   state across calls in v2.
 * - `prepareArguments` is refused rather than carried: a function cannot cross the listing to the
 *   host, and no recorded harness declares one.
 * - `piSafeDraftParameters` is gone: it rewrote `number | null` unions because pi 0.82.1 coerced
 *   null to zero inside them, and pi-ai 1.0.4's `validateToolArguments` keeps both exact
 *   (`test/harness-tools.test.ts` holds that), so the declared schema is what pi receives.
 * - From pi-ai only `Type` and the two schema types are exported. A harness importing anything else
 *   from it fails to bundle, which says so, rather than pulling pi into the wall.
 */
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { keyIfDefined } from "../meta/optional-key.ts";

export { Type };
export type { Static, TSchema };

/** define-tool.ts:11. */
const TOOL_TEXT_LIMITS = { name: 128, label: 256, description: 4_000, evidence: 64 * 1024 } as const;

/** draft-tool.ts:16, the brand the caller checks a factory's tools for. */
const DRAFT_TOOL = Symbol.for("anabasis/draft-tool/v1");

/** define-tool.ts:13. */
export type Evidence<D = unknown> = { text: string; details?: D; terminate?: boolean };

/** v1 passed its DraftStore here; v2 runs each call alone, so there is no store to pass. The
 *  handler is itself a proxy answering every trap with the refusal, so reading, writing, listing
 *  or testing the draft all throw it, not only a property read. */
// SAFETY: `never` states what a harness's `run` may do with the draft: any use of it throws.
const NO_DRAFT: never = new Proxy(
  {},
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(
          "harness tools keep no state across calls in v2: each call runs alone under the command wall, so the draft argument to run() is not available",
        );
      },
    },
  ),
) as never;

interface DefineDraftToolSpec<P extends TSchema, D> {
  name: string;
  label: string;
  description: string;
  parameters: P;
  prepareArguments?: never;
  executionMode?: "sequential" | "parallel";
  run: (params: Static<P>, draft: never, signal?: AbortSignal) => Evidence<D> | Promise<Evidence<D>>;
}

export interface DraftTool {
  readonly [DRAFT_TOOL]: true;
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  executionMode?: "sequential" | "parallel";
  /** Checks the arguments against the declared schema, runs the tool, and checks its result. */
  call(params: unknown, signal: AbortSignal): Promise<Evidence>;
}

/** built-starter.ts:155-159, with the task's own type inlined. */
export interface DomainHarness {
  tools: DraftTool[];
}
export type DomainHarnessFactory = (task: {
  taskId: string;
  family: string;
  publicInput: unknown;
}) => DomainHarness;

export function defineDraftTool<P extends TSchema, D = unknown>(
  spec: DefineDraftToolSpec<P, NoInfer<D>>,
): DraftTool {
  for (const field of ["name", "label", "description"] as const) {
    if (spec[field].length > TOOL_TEXT_LIMITS[field]) {
      throw new Error(`tool ${field} exceeds its public limit`);
    }
  }
  if ("prepareArguments" in spec) {
    throw new Error(`tool "${spec.name}" declares prepareArguments, which v2 does not carry`);
  }
  return {
    [DRAFT_TOOL]: true,
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.parameters,
    ...keyIfDefined("executionMode", spec.executionMode),
    call: async (params, signal) => {
      if (!Value.Check(spec.parameters, params)) {
        const [first] = Value.Errors(spec.parameters, params);
        throw new Error(
          `tool "${spec.name}" arguments do not match its declared parameter schema${
            first === undefined ? "" : ` (${first.instancePath || "$"}: ${first.message})`
          }`,
        );
      }
      const evidence = await spec.run(params, NO_DRAFT, signal);
      if (evidence.text.length > TOOL_TEXT_LIMITS.evidence) {
        throw new Error("tool evidence text exceeds its public limit");
      }
      return evidence;
    },
  };
}
