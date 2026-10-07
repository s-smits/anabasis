/**
 * The answer side of a solve: the record tool that prepares the answer, the tools that keep, show and
 * send it, and the reader of the domain's public resources. Their texts are v1's, as sweep
 * veryhard-hb-4c67fc's solves read them (harness-builder-v4 at 7af7315): `src/solve/built-starter.ts`,
 * `draft-candidates.ts` and `src/truth/public-resources.ts`.
 *
 * v1 kept a draft store beside the answer, and under the `shell` preset the sweep's harnesses chose
 * nothing but an artifact-writer ever wrote to it, so the prepared answer was the whole draft and it
 * was never stale. Here the desk holds only the prepared answer, and three things follow:
 * - `inspect_draft` shows the answer's status and the saved names, without v1's empty `state: {}`.
 * - The `stale` texts are gone, since nothing can make an answer stale.
 * - Submit no longer re-checks the answer's shape. The record tool's parameters are the contract's
 *   answer format, which pi validates before the tool runs, and the desk keeps its own copy, so
 *   what submit sends is what was checked.
 *
 * Arguments that fail the format come back as pi's validation error, where v1 threw its own
 * `arguments do not match the public artifact schema` text. pi's validator coerces, so the answer
 * prepared is the coerced one, which follows the format exactly (`answerFormatFault`).
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "typebox";
import { answerSchema, type Contract } from "../kernel/contract.ts";
import { sha256 } from "../meta/digest.ts";
import { capturedJsonStringify, capturedStructuredClone } from "../meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";
import { canonicalJson, hashJsonValue, stableJson } from "../meta/stable-json.ts";

/** One of the domain's public resources, as `read_public_resources` returns it. */
export interface PublicResource {
  readonly name: string;
  readonly content: JsonValue;
  readonly digest: string;
}

/** The prepared answer and what the solver holds beside it. */
export interface Desk {
  prepared: JsonValue | undefined;
  /** The answer submit accepted; once set, the solve has answered. */
  submitted: JsonValue | undefined;
  attempts: number;
  /** The code of the last refused submit, as v1 named it in the exhausted text. */
  lastRefusal: string | null;
  readonly saved: Map<string, JsonValue | undefined>;
}

/** built-starter.ts: submit's attempt budget, from `SUBMIT_MAX_ATTEMPTS` (truth/battery-record.ts:323). */
const SUBMIT_MAX_ATTEMPTS = 3;
/** draft-candidates.ts: how many candidates a solver may hold at once. */
const SAVED_CANDIDATES_MAX = 6;
/** built-starter.ts: the longest window one read returns, in characters. */
const MODEL_JSON_LIMIT = 12_000;
/** draft-store.ts: the largest answer a writer may prepare, as canonical JSON bytes. */
const ANSWER_MAX_BYTES = 1024 * 1024;

const CANDIDATE_NAME = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 60, description: "Your own label for this candidate." }),
});
const WINDOW = Type.Object({
  from: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Character to start reading at. Use the number the previous result named; omit it for the start.",
    }),
  ),
});

export function openDesk(): Desk {
  return { prepared: undefined, submitted: undefined, attempts: 0, lastRefusal: null, saved: new Map() };
}

/** public-resources.ts:54-56: a resource's digest binds its name and content. */
export function publicResource(name: string, content: JsonValue): PublicResource {
  return { name, content, digest: sha256(canonicalJson({ schema: "public-resource/v1", name, content })) };
}

/**
 * A harness's artifact-writer, bound to the contract: its name, label and description stay the
 * harness's, its parameters become the answer format, and its own code never runs
 * (built-starter.ts:464-496).
 */
export function recordTool(writer: AgentTool, contract: Contract, desk: Desk): AgentTool {
  return {
    name: writer.name,
    label: writer.label,
    description: writer.description,
    parameters: answerSchema(contract),
    executionMode: "sequential",
    execute: async (_id, params) => {
      // SAFETY: pi validated the arguments against the answer format, a JSON Schema.
      const answer = capturedStructuredClone(params) as JsonValue;
      const bytes = Buffer.byteLength(stableJson(answer));
      if (bytes > ANSWER_MAX_BYTES) {
        throw new Error(
          `the answer is ${String(bytes)} bytes; an answer holds at most ${String(ANSWER_MAX_BYTES)}`,
        );
      }
      desk.prepared = answer;
      return text("Prepared the exact public answer.", { answerDigest: hashJsonValue(answer) });
    },
  };
}

/** public-resources.ts:215-227. */
export function publicResourcesTool(resources: readonly PublicResource[]): AgentTool {
  return {
    name: "read_public_resources",
    label: "Read public rules",
    description:
      "Read this domain's public validity rules with their task paths, rule decisions, answer schema, fixed constants and allowed values.",
    parameters: Type.Object({}),
    execute: async () => text(capturedJsonStringify({ resources }, null, 2), { resources: resources.length }),
  };
}

/** save_candidate, restore_candidate, inspect_draft, preview_artifact and submit, in v1's order. */
export function deskTools(desk: Desk): AgentTool[] {
  const held = () => (desk.saved.size === 0 ? "none" : [...desk.saved.keys()].join(", "));
  return [
    tool({
      name: "save_candidate",
      label: "Save candidate",
      description:
        "Keep the draft and its prepared answer under a name, so a later change can be undone. Saving the same name again replaces it.",
      parameters: CANDIDATE_NAME,
      executionMode: "sequential",
      execute: async (_id, { name }) => {
        if (!desk.saved.has(name) && desk.saved.size >= SAVED_CANDIDATES_MAX) {
          return text(
            `Not saved: ${String(SAVED_CANDIDATES_MAX)} candidates are already held (${held()}). Save over one of those names instead.`,
          );
        }
        desk.saved.set(name, desk.prepared);
        return text(`Saved "${name}". Held: ${held()}.`);
      },
    }),
    tool({
      name: "restore_candidate",
      label: "Restore candidate",
      description:
        "Put the draft and its prepared answer back to a saved candidate. The candidate stays saved.",
      parameters: CANDIDATE_NAME,
      executionMode: "sequential",
      execute: async (_id, { name }) => {
        if (!desk.saved.has(name)) return text(`No candidate named "${name}". Held: ${held()}.`);
        desk.prepared = desk.saved.get(name);
        return text(
          `Restored "${name}". Check it before you submit: the answer prepared with it is prepared again.`,
        );
      },
    }),
    tool({
      name: "inspect_draft",
      label: "Inspect draft",
      description:
        "Read working values and files, with prepared-answer status. Use preview_artifact to read the exact answer submit would send.",
      parameters: WINDOW,
      executionMode: "parallel",
      execute: async (_id, { from }) =>
        modelView(
          {
            preparedAnswer: desk.prepared === undefined ? "absent" : "current",
            savedCandidates: [...desk.saved.keys()],
          },
          from,
        ),
    }),
    tool({
      name: "preview_artifact",
      label: "Preview artifact",
      description: "Show the exact answer submit would send.",
      parameters: WINDOW,
      executionMode: "parallel",
      execute: async (_id, { from }) =>
        desk.prepared === undefined
          ? text("No answer has been prepared. Call an artifact-writer.")
          : modelView(desk.prepared, from),
    }),
    tool({
      name: "submit",
      label: "Submit",
      description: `Send the prepared answer. Up to ${String(SUBMIT_MAX_ATTEMPTS)} submit attempts are accepted.`,
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async () => submit(desk),
    }),
  ];
}

/** built-starter.ts:338-365 and final-submission.ts:255-327, less the shape check (see above). */
function submit(desk: Desk): AgentToolResult<JsonObject | null> {
  if (desk.submitted !== undefined) return { ...text("Submitted."), terminate: true };
  if (desk.attempts >= SUBMIT_MAX_ATTEMPTS) {
    const prior = desk.lastRefusal === null ? "" : ` (the last attempt was rejected as ${desk.lastRefusal})`;
    return text(
      `Submit blocked: the submit attempt budget (${String(SUBMIT_MAX_ATTEMPTS)}) is exhausted — no further attempts are accepted${prior}`,
    );
  }
  desk.attempts += 1;
  if (desk.prepared === undefined) {
    desk.lastRefusal = "draft-unmaterialized";
    return text(
      "Submit blocked: Call an artifact-writer to prepare the exact public answer, then submit again.",
    );
  }
  desk.submitted = desk.prepared;
  return { ...text("Submitted.", { answerDigest: hashJsonValue(desk.submitted) }), terminate: true };
}

/** built-starter.ts:305-317: a long value arrives as a window naming where the next one starts. */
function modelView(value: JsonValue, from = 0): AgentToolResult<JsonObject | null> {
  const complete = stableJson(value);
  const start = Math.min(Math.max(0, Math.trunc(from)), complete.length);
  const window = complete.slice(start, start + MODEL_JSON_LIMIT);
  const next = start + window.length;
  const left = complete.length - next;
  const before = start === 0 ? "" : `… (${String(start)} chars before this)\n`;
  const after = left === 0 ? "" : `\n… (${String(left)} chars left; call again with from: ${String(next)})`;
  return text(`${before}${window}${after}`, { from: start, total: complete.length });
}

/** A tool whose arguments are typed by its own parameters, in a list of any tools. */
function tool<Parameters extends TSchema>(definition: AgentTool<Parameters>): AgentTool {
  return definition;
}

function text(value: string, details: JsonObject | null = null): AgentToolResult<JsonObject | null> {
  return { content: [{ type: "text", text: value }], details };
}
