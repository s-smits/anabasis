import type { Context } from "@earendil-works/chord/context";
import { copyJson } from "@earendil-works/chord/json";
import {
  defineTool,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { type TSchema, Type } from "typebox";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { type AnswerFile, capturedFiles, DELIVERABLES } from "../kernel/answer-files.ts";
import { boundText } from "../meta/bounded-text.ts";
import { sha256 } from "../meta/digest.ts";
import { rmSync, writeFileSync } from "../meta/filesystem.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { isSafePathSegment } from "../meta/path-segment.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { canonicalJson, hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import { type AgentTool, textsOf } from "../agent/session.ts";
import { shellQuote } from "../sandbox/isolation.ts";
import { toolchainPathDirs } from "../sandbox/policy.ts";
import CAPTURE from "./capture-answer.py" with { type: "text" };
import type { WallExec } from "./coding.ts";

export interface PublicResource {
  readonly name: string;
  readonly content: JsonValue;
  readonly digest: string;
}

export interface Desk {
  submitted: JsonValue | undefined;
  files?: readonly AnswerFile[];
  flagged: string | undefined;
}

export const ANSWER_FILE = "answer.json";
export const ANSWER_FORMAT_FILE = "public/answer-format.json";
const ANSWER_MAX_BYTES = 1024 * 1024;
const MISSING = 44;
const CAPTURED = "ana-capture:";
export const RESULT = { bytes: 50 * 1024 - 512, lines: 2000 - 2 };
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

export function publicResource(name: string, content: JsonValue): PublicResource {
  return { name, content, digest: sha256(canonicalJson({ schema: "public-resource/v1", name, content })) };
}

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

const CAPTURER = Bun.which("python3", { PATH: toolchainPathDirs().join(":") });

export function submitTool(desk: Desk, contract: Contract, home: string, exec: WallExec): AgentTool {
  return tool({
    name: "submit",
    description: `Send ${ANSWER_FILE} from your working directory as your answer. It holds the answer as JSON, in the format ${ANSWER_FORMAT_FILE} gives. A file that does not is refused with the reason, and you may submit again. Submit also captures regular files under ${DELIVERABLES.folder}/, at most ${String(DELIVERABLES.count)} files and ${String(DELIVERABLES.bytes)} bytes in total, refusing symlinks, special files and excess files or bytes with a reason; an absent folder supplies no files. An accepted submit ends the task and returns no verdict. If you judge the task malformed, so that no answer could meet it as posed, give malformed instead, saying why: that ends the task with no answer read.`,
    parameters: SUBMIT_PARAMETERS,
    execute: async ({ malformed }, _api, context) => {
      if (desk.submitted !== undefined) return ending(text("Submitted."));
      const why = malformed?.trim() ?? "";
      desk.flagged ??= why === "" ? undefined : why;
      if (desk.flagged !== undefined) return ending(text("Flagged."));
      if (CAPTURER === null) {
        throw new Error("submit finds no python3 on the host's own tool path to capture with");
      }
      const { exitCode, output } = await exec(
        `${shellQuote(CAPTURER)} -I -c ${shellQuote(CAPTURE)} ${shellQuote(home)} ${ANSWER_FILE} ${String(ANSWER_MAX_BYTES + 1)} ${DELIVERABLES.folder} ${String(DELIVERABLES.count)} ${String(DELIVERABLES.bytes)}`,
        { signal: context.abortSignal },
      );
      if (exitCode === MISSING) {
        return text(
          `Submit blocked: there is no ${ANSWER_FILE} in your working directory. Write your answer there as JSON, in the format ${ANSWER_FORMAT_FILE} gives, then submit again.`,
        );
      }
      if (exitCode !== 0) {
        return text(`Submit blocked: submission could not be read: ${output.toString("utf8").trim()}`);
      }
      const said = output
        .toString("utf8")
        .split("\n")
        .findLast((line) => line.startsWith(CAPTURED));
      const capture = asRecord(capturedJsonParse(said?.slice(CAPTURED.length) ?? "null"));
      if (!isString(capture?.answer)) throw new Error("invalid answer capture");
      const read = answerIn(Buffer.from(capture.answer, "base64"), contract);
      if ("fault" in read) return text(`Submit blocked: ${ANSWER_FILE} ${read.fault}`);
      const files = capturedFiles(capture.files);
      if (files.length > 0) desk.files = files;
      desk.submitted = read.answer;
      return ending(text("Submitted.", { answerDigest: hashJsonValue(read.answer) }));
    },
  });
}

export function tool<Parameters extends TSchema>(definition: ToolRegistration<Parameters>): AgentTool {
  return defineTool({
    ...definition,
    executionMode: "sequential",
    execute: async (args, api, context) => {
      const result = await definition.execute(args, api, context);
      const output = result.output ?? [{ type: "text" as const, text: api.retainedOutput().text }];
      const value = textsOf(output).join("");
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

export function text(value: string, details: JsonObject | null = null): ToolExecutionResult {
  return { output: [{ type: "text", text: value }], details: copyJson(details) };
}

async function capped(value: string, name: string, api: ToolExecutionApi, context: Context): Promise<string> {
  const lines = RESULT.lines - 2;
  const head = boundText(value, Math.floor((RESULT.bytes * 3) / 4), "head", Math.floor((lines * 3) / 4)).text;
  const tail = boundText(value, Math.floor(RESULT.bytes / 4), "tail", Math.floor(lines / 4)).text;
  const file = await spill(value, name, api, context);
  const where = file === undefined ? "" : ` The full file is at ${file}.`;
  const size = plural(Buffer.byteLength(value), "byte");
  const [first, last] = [head, tail].map((part) => String(Buffer.byteLength(part)));
  return `${head}\n\n[Left out here: all but the first ${first} and the last ${last} of ${size}.${where}]\n\n${tail}`;
}

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

export function ending<Result extends ToolExecutionResult>(result: Result): Result {
  return { ...result, control: { terminate: true } };
}
