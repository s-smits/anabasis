/**
 * The answer side of a solve, which pi's coding agent has none of. The answer is a file,
 * `answer.json` in the solver's working directory, and `submit` sends it: the host reads the file
 * through the command wall, holds it to the contract's answer format, and keeps what it read as the
 * solve's answer. A file that is missing, is not JSON or does not follow the format is refused with
 * the reason, and the solver may submit again.
 *
 * v1 kept a DraftStore for each solve: harness tools wrote working values and files into it, an
 * artifact-writer turned the draft into the answer, a later change made that answer stale, and the
 * wall submitted the last one prepared. Four more tools served that store: `save_candidate`,
 * `restore_candidate`, `inspect_draft` and `preview_artifact`. v2 has no store: harness tools keep
 * no state, nothing goes stale and the wall submits nothing. Of 209 solves on record under the four
 * none restored or inspected a candidate, so a save changed nothing. And on truss, where an answer
 * is 3 to 8 KB of JSON, 38 of 41 answers were typed into the artifact-writer straight after a
 * command had printed them: the solver had computed the answer into a file and then copied it out
 * by hand (`docs/transfer.md`).
 *
 * So a solver's working state is what it is under pi, the files in its working directory, and the
 * answer is one of them. What v1's draft store held is kept the way a filesystem keeps it. The
 * public resources and the answer format are files there too (`prompt.ts`, `seedHome`).
 *
 * v1 took three submit attempts and no more, when its submit ran checks of its own. This one
 * returns no verdict and reads nothing hidden, so a refused submit tells a solver nothing but what
 * is wrong with its file, and none is counted.
 */
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { type TSchema, Type } from "typebox";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { sha256 } from "../meta/digest.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { canonicalJson, hashJsonValue } from "../meta/stable-json.ts";
import { shellQuote } from "../wall/isolation.ts";
import type { SolverTool, WallExec } from "./coding.ts";

/** One of the domain's public resources, as a file in the solver's home holds it. */
export interface PublicResource {
  readonly name: string;
  readonly content: JsonValue;
  readonly digest: string;
}

/** What a solve has answered. */
export interface Desk {
  /** The answer submit accepted; once set, the solve has answered. */
  submitted: JsonValue | undefined;
  /** Why the solver judged the task malformed, where it said so in place of an answer. */
  flagged: string | undefined;
}

/** The solver's answer, by its name in the working directory. */
export const ANSWER_FILE = "answer.json";
/** The contract's answer format, as the home is seeded with it. */
export const ANSWER_FORMAT_FILE = "public/answer-format.json";
/** The largest answer, in the file's bytes (v1's draft store held an answer to the same). */
const ANSWER_MAX_BYTES = 1024 * 1024;
const MISSING = 44;
/** `submit` takes nothing for an answer, which is the file, and `malformed` in place of one. */
const SUBMIT_PARAMETERS = Type.Object({
  malformed: Type.Optional(
    Type.String({
      description: `Only for a malformed task: why no answer could meet it as posed. ${ANSWER_FILE} is then not read.`,
    }),
  ),
});

export function openDesk(): Desk {
  return { submitted: undefined, flagged: undefined };
}

/** A resource's digest binds its name and content (as v1's did). */
export function publicResource(name: string, content: JsonValue): PublicResource {
  return { name, content, digest: sha256(canonicalJson({ schema: "public-resource/v1", name, content })) };
}

/** Why the bytes of an answer file are no answer under `contract`, or the answer they hold. */
function answerIn(bytes: Buffer, contract: Contract): { answer: JsonValue } | { fault: string } {
  if (bytes.length > ANSWER_MAX_BYTES) {
    return { fault: `is larger than the ${String(ANSWER_MAX_BYTES)} bytes an answer may hold` };
  }
  let answer: JsonValue;
  try {
    answer = capturedJsonParse(bytes.toString("utf8"));
  } catch (error) {
    return { fault: `is not JSON: ${errorMessage(error)}` };
  }
  const fault = answerFormatFault(contract.answerFormat, answer);
  return fault === null ? { answer } : { fault: `does not follow the answer format: ${fault}` };
}

/**
 * `submit`: the answer file under `home`, read by one walled command, checked and kept. An answer
 * once sent stays the answer, whatever the file holds afterwards. Or, with `malformed`, the
 * solver's word that the task is malformed in place of an answer, which ends the solve flagged
 * (`src/kernel/solve.ts`) and reads no file. It is an outcome the solver may choose, and tells it
 * nothing of the task.
 */
export function submitTool(desk: Desk, contract: Contract, home: string, exec: WallExec) {
  const file = shellQuote(join(home, ANSWER_FILE));
  return {
    name: "submit",
    label: "Submit",
    description: `Send ${ANSWER_FILE} from your working directory as your answer. It holds the answer as JSON, in the format ${ANSWER_FORMAT_FILE} gives. A file that does not is refused with the reason, and you may submit again. An accepted submit ends the task and returns no verdict. If you judge the task malformed, so that no answer could meet it as posed, give malformed instead, saying why: that ends the task with no answer read.`,
    promptSnippet: `Send ${ANSWER_FILE} as your answer, which ends the task`,
    parameters: SUBMIT_PARAMETERS,
    executionMode: "sequential",
    execute: async (_id, { malformed }, signal) => {
      if (desk.submitted !== undefined) return { ...text("Submitted."), terminate: true };
      const why = malformed?.trim() ?? "";
      desk.flagged ??= why === "" ? undefined : why;
      if (desk.flagged !== undefined) return { ...text("Flagged."), terminate: true };
      const { exitCode, output } = await exec(
        `[ -f ${file} ] || exit ${String(MISSING)}; head -c ${String(ANSWER_MAX_BYTES + 1)} ${file}`,
        { signal },
      );
      if (exitCode === MISSING) {
        return text(
          `Submit blocked: there is no ${ANSWER_FILE} in your working directory. Write your answer there as JSON, in the format ${ANSWER_FORMAT_FILE} gives, then submit again.`,
        );
      }
      if (exitCode !== 0) {
        return text(`Submit blocked: ${ANSWER_FILE} could not be read: ${output.toString("utf8").trim()}`);
      }
      const read = answerIn(output, contract);
      if ("fault" in read) return text(`Submit blocked: ${ANSWER_FILE} ${read.fault}`);
      desk.submitted = read.answer;
      return { ...text("Submitted.", { answerDigest: hashJsonValue(read.answer) }), terminate: true };
    },
  } satisfies SolverTool<typeof SUBMIT_PARAMETERS>;
}

/** A tool whose arguments are typed by its own parameters, in a list of any tools. */
export function tool<Parameters extends TSchema>(definition: AgentTool<Parameters>): AgentTool {
  return definition;
}

export function text(value: string, details: JsonObject | null = null): AgentToolResult<JsonObject | null> {
  return { content: [{ type: "text", text: value }], details };
}
