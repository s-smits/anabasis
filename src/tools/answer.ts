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
 *
 * Every seat's own tool caps text results here at pi's 50 KB and 2,000 lines, with the full text
 * in a `.log` of its environment's TMPDIR. Until 25 October read_example cut at 20,000
 * characters, leaving four drafts of 22,191 to 73,638 characters as JSON that did not parse. On 26 October the
 * operator made spilling automatic for all seats, including harness tools; pi's coding tools
 * keep their own limits. A seat without an environment gets the size alone.
 */
import { copyJson, type Context } from "@earendil-works/chord";
import {
  defineTool,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { type TSchema, Type } from "typebox";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { boundText } from "../meta/bounded-text.ts";
import { sha256 } from "../meta/digest.ts";
import { rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { canonicalJson, hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import type { SeatTool } from "../agent/session.ts";
import { shellQuote } from "../wall/isolation.ts";
import type { WallExec } from "./coding.ts";

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
/** What pi keeps of a tool's result, `DEFAULT_MAX_BYTES` and `DEFAULT_MAX_LINES` of pi-durable's
 *  `truncate.js`, which 1.4.0 keeps private; the shown part leaves room for the notice. */
const RESULT = { bytes: 50 * 1024 - 512, lines: 2000 - 2 };
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
export function submitTool(desk: Desk, contract: Contract, home: string, exec: WallExec): SeatTool {
  const file = shellQuote(join(home, ANSWER_FILE));
  return tool({
    name: "submit",
    description: `Send ${ANSWER_FILE} from your working directory as your answer. It holds the answer as JSON, in the format ${ANSWER_FORMAT_FILE} gives. A file that does not is refused with the reason, and you may submit again. An accepted submit ends the task and returns no verdict. If you judge the task malformed, so that no answer could meet it as posed, give malformed instead, saying why: that ends the task with no answer read.`,
    parameters: SUBMIT_PARAMETERS,
    execute: async ({ malformed }, _api, context) => {
      if (desk.submitted !== undefined) return ending(text("Submitted."));
      const why = malformed?.trim() ?? "";
      desk.flagged ??= why === "" ? undefined : why;
      if (desk.flagged !== undefined) return ending(text("Flagged."));
      const { exitCode, output } = await exec(
        `[ -f ${file} ] || exit ${String(MISSING)}; head -c ${String(ANSWER_MAX_BYTES + 1)} ${file}`,
        { signal: context.abortSignal },
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
      return ending(text("Submitted.", { answerDigest: hashJsonValue(read.answer) }));
    },
  });
}

/** A seat tool, typed by its schema and always sequential on the shared command wall. */
export function tool<Parameters extends TSchema>(definition: ToolRegistration<Parameters>): SeatTool {
  return defineTool({
    ...definition,
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const result = await definition.execute(args, api, context);
      const output = result.output ?? [{ type: "text" as const, text: api.retainedOutput().text }];
      // pi bounds all text items together, keeping non-text items in place.
      const value = output.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
      if (Buffer.byteLength(value) <= RESULT.bytes && value.split("\n").length <= RESULT.lines) {
        return result;
      }
      const shown = await capped(value, definition.name, api, context);
      const first = output.findIndex((part) => part.type === "text");
      const kept = output.filter((part, at) => part.type !== "text" || at === first);
      return {
        ...result,
        output: kept.map((part) => (part.type === "text" ? { ...part, text: shown } : part)),
      };
    },
  });
}

/** A result the model reads as `value`, with `details` for the trace and the host. */
export function text(value: string, details: JsonObject | null = null): ToolExecutionResult {
  return { output: [{ type: "text", text: value }], details: copyJson(details) };
}

/** The head of `value` that pi keeps, and a notice of its full size and of the file that holds it. */
async function capped(value: string, name: string, api: ToolExecutionApi, context: Context): Promise<string> {
  const head = boundText(value, RESULT.bytes, "head", RESULT.lines).text;
  const file = await spill(value, name, api, context);
  const where = file === undefined ? "" : ` The full file is at ${file}.`;
  const size = plural(Buffer.byteLength(value), "byte");
  return `${head}\n\nShown: the first ${String(Buffer.byteLength(head))} of ${size}.${where}`;
}

/**
 * `value` whole in a new `.log` of the calling seat's TMPDIR, or undefined where none could be
 * written: a path is named only once its file is whole, as pi's `OutputSpill` does. The seat
 * writes that folder, so whatever stands at the new path is removed before an exclusive write: a
 * link it left there must never have the host overwrite its target. The environment makes each
 * path unique; the tool's name goes into it only where it is a safe file name.
 */
async function spill(value: string, name: string, api: ToolExecutionApi, context: Context) {
  const created = await api.env?.createTempFile(
    { prefix: isSafePathSegment(name) ? `${name}-` : "", suffix: ".log" },
    context,
  );
  if (created?.ok !== true) return undefined;
  try {
    rmSync(created.value, { force: true });
    writeFileSync(created.value, value, { flag: "wx" });
    return created.value;
  } catch {
    return undefined;
  }
}

/** `result`, asking that the run end after this round (`control.terminate`). */
export function ending<Result extends ToolExecutionResult>(result: Result): Result {
  return { ...result, control: { terminate: true } };
}
