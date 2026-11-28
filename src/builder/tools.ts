import { Type } from "typebox";
import type { AgentTool } from "../agent/session.ts";
import { append, CALL_KINDS, eventsOf, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import { callPrograms } from "../kernel/call-programs.ts";
import { checkCouldNotRun, type Ending } from "../kernel/solve.ts";
import { limitsIn } from "../kernel/condition.ts";
import { type Contract, hasJudge } from "../kernel/contract.ts";
import { callList, callText, closingOf, traceOf } from "../kernel/trace.ts";
import { type FileManifest, readAnswerFiles } from "../kernel/answer-files.ts";
import { answerImages, type Extracted, extract, headOf } from "../kernel/extract.ts";
import { billedParts } from "../kernel/meter.ts";
import {
  ended,
  passed,
  practiceRan,
  rejected,
  rejectionAside,
  solvesIn,
  standsOf,
  verdictsOf,
} from "../kernel/solves.ts";
import { objectiveOf } from "../kernel/verify.ts";
import { GAP_FLOOR, gainOver, gapBasis, type ObjectiveRule } from "../kernel/compare.ts";
import { poolOf } from "../kernel/reports.ts";
import { taskStates } from "../kernel/task.ts";
import { TOOL_HOST_DIR, TOOL_TREE_DIR, TOOL_TREE_ENV } from "../meta/bundle-layout.ts";
import { existsSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isFunction, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { join } from "../meta/path.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { plural } from "../meta/text.ts";
import { toolTreeEnv } from "../sandbox/isolation.ts";
import { ending as endSession, text, tool } from "../tools/answer.ts";
import { CODING_TOOLS, codingTools, prepareImage, selectedCodingTools } from "../tools/coding.ts";
import { type CommandSandbox, type NetworkReach, runSandboxed } from "../tools/command.ts";
import { formatKeys, namedTasks, readHarnessFiles } from "../harness/files.ts";
import type { Harness } from "../harness/open.ts";
import { installedPrograms } from "../harness/programs.ts";
import { HOST_ONLY, portableGuide } from "../harness/starter.ts";
import { clockText } from "../solver/run.ts";
import { STARTED as COMPARISON_STARTED } from "../campaign/comparison.ts";
import { budgetLeft } from "../campaign/opening.ts";
import { type Freezing, frozen, harnessNow, type HarnessSnapshot, snapshot } from "./store.ts";
import { type Listed, measuredClause, type ModePrompts, shellWalls } from "./prompt.ts";
import type { BuildRequest, PracticeTask } from "./session.ts";

export interface Bench extends Freezing {
  readonly request: BuildRequest;
  readonly modePrompts: ModePrompts;
  tasks: readonly PracticeTask[];
  reference: HarnessSnapshot;
  readonly parent: string;
  spent: number;
  readonly faulty: Set<string>;
  readonly faults: string[];
  readonly halt: AbortController;
  readonly kill: AbortSignal;
  practising: Promise<void>;
  steer: (content: string) => Promise<void>;
  readonly within: <T>(action: () => Promise<T>) => Promise<T>;
  fatal: Error | null;
  note: string | null;
  readonly told: Map<"broken" | "untried" | "unread", string>;
}

type Unmeasured = (digest: string) => Promise<string | null>;

interface Against {
  readonly rule: ObjectiveRule;
  readonly author: number;
}

interface PracticeRecord {
  readonly solves: string[];
  passed: number;
}

interface FoldedPractice {
  readonly records: ReadonlyMap<string, ReadonlyMap<string, PracticeRecord>>;
  readonly verdicts: ReturnType<typeof verdictsOf>;
}

const BAND_EDGES = [GAP_FLOOR, 0.1, 0.5, 0.9] as const;
const EMPTY_RECORD: { readonly solves: readonly string[]; readonly passed: number } = {
  solves: [],
  passed: 0,
};
const percent = (share: number): string => String(Math.round(share * 100));

function bandOf({ rule, author }: Against, measure: number): string {
  const gain = gainOver(rule, measure, author);
  const at = BAND_EDGES.findLastIndex((edge) => Math.abs(gain) >= edge);
  return at === -1 ? "level" : `${bandSize(at)} ${gain > 0 ? "better" : "worse"}`;
}

function bandSize(at: number): string {
  const [lower, upper] = [BAND_EDGES[at] ?? GAP_FLOOR, BAND_EDGES[at + 1]];
  return upper === undefined ? `${percent(lower)}% or more` : `${percent(lower)} to ${percent(upper)}%`;
}

function againstOf(events: readonly LogEvent[], contract: Contract): (version: string) => Against | null {
  const rule = contract.objective;
  if (rule === undefined) return () => null;
  const { bests } = poolOf(events);
  return (version) => {
    const author = bests.get(version);
    return author === undefined ? null : { rule, author };
  };
}

function endingText(ending: Ending): string {
  if (ending.outcome === "pass") return "pass";
  if (ending.outcome === "non-result") return `no result (${ending.kind})`;
  if (ending.outcome === "flagged") return "flagged (the solver judged the task malformed)";
  return ending.kind === "broken-harness"
    ? `fail (broken harness: ${ending.reason})`
    : `fail (${ending.kind})`;
}

function measuredText(
  verdicts: ReturnType<typeof verdictsOf>,
  solve: string,
  against: Against | null,
  name: () => string,
) {
  const measure = objectiveOf(verdicts.get(solve)?.checker);
  return against !== null && measure !== null
    ? ` Measured ${name()} against the author's answer on record: ${bandOf(against, measure)}.`
    : "";
}

export function recordsOf(events: readonly LogEvent[]) {
  const stands = standsOf(events);
  const byTask = new Map<string, Map<string, PracticeRecord>>();
  for (const solve of ended(practiceRan(events))) {
    if (rejectionAside(events, solve, stands)) continue;
    const pass = passed(solve);
    if (pass === null) continue;
    const forTask = byTask.get(solve.under.task) ?? new Map<string, PracticeRecord>();
    byTask.set(solve.under.task, forTask);
    const held = forTask.get(solve.under.harness) ?? { solves: [], passed: 0 };
    held.solves.push(solve.id);
    if (pass) held.passed += 1;
    forTask.set(solve.under.harness, held);
  }
  return byTask;
}

export function hasPractice(
  bench: Pick<Bench, "tasks">,
  events: readonly LogEvent[],
  harness: string,
): boolean {
  const records = recordsOf(events);
  return bench.tasks.some(({ version }) => (records.get(version)?.get(harness)?.solves.length ?? 0) > 0);
}

function usedText(solves: ReadonlyMap<string, ReturnType<typeof solvesIn>[number]>, solve: string): string {
  const { start, end } = solves.get(solve) ?? {};
  const limits = limitsIn(start?.limits);
  if (!isNumber(end?.seconds) || !isNumber(end.turns) || limits === null) return "";
  const given = limits.modelTurns === undefined ? "" : ` of ${String(limits.modelTurns)}`;
  const tokens = asRecord(end.tokens);
  const count = (value: JsonValue | undefined) => (isNumber(value) ? value : 0);
  const readTokens = count(tokens?.input) + count(tokens?.cacheRead) + count(tokens?.cacheWrite);
  const counted =
    tokens === null
      ? ""
      : `, and read ${String(readTokens)} tokens and wrote ${String(count(tokens.output))}`;
  return ` It took ${clockText(end.seconds)} of ${clockText(limits.wallSeconds)} and ${plural(end.turns, "model turn")}${given}${counted}.`;
}

function callsText(events: readonly LogEvent[], solve: string, programs: readonly string[]): string {
  const { calls } = traceOf(events, "solve", solve);
  if (calls.length === 0) return "";
  const failed = calls.flatMap(({ isError }, at) => (isError ? [at + 1] : []));
  const ran = calls.map((call) => ({ ...callPrograms(call), isError: call.isError }));
  const used = programs.flatMap((name) => {
    const by = ran.filter((call) => call.programs.includes(name));
    if (by.length === 0) return [];
    const broke = by.filter(({ isError }) => isError).length;
    return [`${name} ${String(by.length)}${broke === 0 ? "" : ` (${String(broke)} failed)`}`];
  });
  const shown =
    programs.length === 0
      ? ""
      : used.length === 0
        ? ` Harness programs run: none of ${String(programs.length)}.`
        : ` Harness programs run: ${used.join(", ")}.`;
  return ` It made ${plural(calls.length, "tool call")}; failed: ${failed.join(", ") || "none"}.${shown}`;
}

async function practise(bench: Bench, task: PracticeTask, kept: HarnessSnapshot, kill: AbortSignal) {
  const { request } = bench;
  const { solve, ending } = await request.practise(task, kept.dir, kept.harness.digest, kill);
  const lines: string[] = [];
  if (checkCouldNotRun(ending)) {
    bench.faulty.add(task.version);
    lines.push("The task's own check could not run on this answer: the task leaves this session's practice.");
  }
  if (rejected(ending) && request.referee !== undefined) {
    try {
      const finding = await request.referee(solve, task, kill);
      if (finding.ruling === "check-defect") {
        if (taskStates(read(request.log, TRACE_KINDS)).get(task.version) === "released") {
          append(request.log, "task.state", {
            version: task.version,
            state: "disputed",
            session: request.id,
            solve,
          });
        }
        lines.push("The task leaves practice.");
      }
    } catch (error) {
      bench.faults.push(`${solve}: ${errorMessage(error)}`);
    }
  }
  return { task, solve, ending, lines };
}

export function practiceLeft({ request, spent }: Bench, events: readonly LogEvent[]): number {
  const left = request.campaign === undefined ? null : budgetLeft(events);
  if (left !== null) return Math.max(0, Math.floor(left.dollars / left.reserve));
  const counted = request.limits.practiceSolves - spent;
  if (request.cap === undefined) return counted;
  const afforded = Math.floor(
    (request.cap.dollars - billedParts(events, request.id).session) / request.cap.reserve,
  );
  return Math.max(0, Math.min(counted, afforded));
}

const measuresOf = (
  verdicts: ReturnType<typeof verdictsOf>,
  solves: readonly string[],
  against: Against | null,
): string[] =>
  against === null
    ? []
    : solves.flatMap((id) => objectiveOf(verdicts.get(id)?.checker) ?? []).map((m) => bandOf(against, m));

export function listedPractice(
  events: readonly LogEvent[],
  tasks: readonly PracticeTask[],
  { parent, reference }: { readonly parent: string; readonly reference: string },
  contract: Contract,
): Listed[] {
  const states = taskStates(events);
  const verdicts = verdictsOf(events);
  const records = recordsOf(events);
  const againstFor = againstOf(events, contract);
  return tasks.map(({ version, task }) => {
    const kept = records.get(version)?.get(parent) ?? EMPTY_RECORD;
    const against = againstFor(version);
    const measures = measuresOf(verdicts, kept.solves, against);
    const ref = reference === parent ? null : (records.get(version)?.get(reference) ?? EMPTY_RECORD);
    return {
      taskId: task.taskId,
      family: task.family,
      left: states.get(version) === "disputed",
      solves: [...kept.solves],
      passed: kept.passed,
      ...keyIfDefined("measures", measures.length > 0 ? measures : undefined),
      ...keyIfDefined(
        "reference",
        ref !== null && ref.solves.length > 0
          ? {
              digest: reference,
              solves: [...ref.solves],
              passed: ref.passed,
              measures: measuresOf(verdicts, ref.solves, against),
            }
          : undefined,
      ),
    };
  });
}

function recordText(
  folded: FoldedPractice,
  version: string,
  roles: readonly (readonly [string | null, string])[],
  against: Against | null,
  name: () => string,
) {
  const named = new Map<string, string[]>();
  for (const [digest, role] of roles) {
    if (digest !== null) named.set(digest, [...(named.get(digest) ?? []), role]);
  }
  return [...named]
    .map(
      ([digest, roleNames]) => [roleNames, folded.records.get(version)?.get(digest) ?? EMPTY_RECORD] as const,
    )
    .filter(([, kept]) => kept.solves.length > 0)
    .map(([[role, ...also], kept], index) => {
      const which = `${role ?? ""}${also.length > 0 ? `, which is also ${also.join(" and ")}` : ""}`;
      const measured = measuredClause(name, measuresOf(folded.verdicts, kept.solves, against));
      return `${index === 0 ? "Record under" : "Under"} ${which}: ${index === 0 ? "passed " : ""}${String(kept.passed)} of ${String(kept.solves.length)}${measured}.`;
    })
    .join(" ");
}

function choosePracticeTasks(bench: Bench, requested: readonly string[]) {
  const offered = new Map(bench.tasks.map((task) => [task.task.taskId, task]));
  const unknown = requested.find((id) => !offered.has(id));
  if (unknown !== undefined) {
    throw new Error(
      `${unknown} is not one of this session's practice tasks: ${[...offered.keys()].join(", ")}`,
    );
  }
  const chosen = requested.flatMap((id) => offered.get(id) ?? []);
  const asked = read(bench.request.log, CALL_KINDS);
  const states = taskStates(asked);
  const closed = chosen.find(
    ({ version }) => states.get(version) !== "released" || bench.faulty.has(version),
  );
  if (closed !== undefined) throw new Error(`${closed.task.taskId} is no longer a practice task`);
  const left = practiceLeft(bench, asked);
  if (chosen.length > left) {
    throw new Error(
      `only ${plural(left, "practice solve")} left, and this asks for ${String(chosen.length)}`,
    );
  }
  return chosen;
}

export const PRACTICE_WAIT_SECONDS = 290;
export const PRACTICE_FAULT =
  "A practice solve could not be run, which is the host's fault and not the harness's. The session ends here.";

export function practiceTool(bench: Bench): AgentTool {
  const { request } = bench;
  return tool({
    name: "practice",
    description: `Run practice tasks with harness/ (or \`under: "reference"\`) using the measured solver and limits. Returns ending, time/turns/tokens, tool-call and harness-program counts, solve id for read_trace, cumulative records and coarse objective band vs author (level within ${percent(GAP_FLOOR)}%, or ${BAND_EDGES.map((_, at) => bandSize(at)).join(", ")} ${gapBasis(bench.request.contract.objective)}). Broken harnesses spend no solve.`,
    parameters: Type.Object({
      tasks: Type.Array(Type.String(), {
        minItems: 1,
        description: "Practice task ids, as the opening message lists them.",
      }),
      under: Type.Optional(
        Type.Union([Type.Literal("harness"), Type.Literal("reference")], {
          description:
            "Which harness solves: harness/ as it stands (the default), or the reference harness yours is compared with.",
        }),
      ),
    }),
    execute: async (args) => {
      choosePracticeTasks(bench, args.tasks);
      const ran = args.under === "reference" ? bench.reference : await snapshot(bench);
      const run = bench.practising.then(async () => {
        if (bench.fatal !== null) throw new Error(PRACTICE_FAULT);
        if (bench.note !== null || bench.kill.aborted) throw new Error("The session has ended.");
        const chosen = choosePracticeTasks(bench, args.tasks);
        const failed = new AbortController();
        const kill = AbortSignal.any([bench.kill, failed.signal]);
        bench.spent += chosen.length;
        let unstarted = 0;
        const solved = await pooled(chosen, request.limits.concurrency, async (task) => {
          if (bench.fatal !== null) return [];
          try {
            return [await practise(bench, task, ran, kill)];
          } catch (error) {
            if (error === kill.reason) {
              unstarted += 1;
              return [];
            }
            bench.fatal ??= asError(error);
            failed.abort();
            return [];
          }
        });
        if (bench.fatal !== null) throw new Error(PRACTICE_FAULT);
        if (unstarted > 0) {
          bench.spent -= unstarted;
          throw new Error("The session has ended.");
        }
        const events = read(request.log);
        const under = args.under ?? "harness";
        const roles = [
          [under === "reference" ? null : ran.harness.digest, "this harness"],
          [bench.reference.harness.digest, "the reference harness"],
          [
            under === "reference" ? (bench.opened?.harness.digest ?? null) : null,
            "harness/ as last practised",
          ],
          [bench.parent, "the harness you started from"],
        ] as const;
        const label = hasJudge(request.contract.objective)
          ? "the code-scored part of the objective"
          : "the objective";
        const names = [`${label} (${request.contract.objective?.quantity ?? ""})`];
        const name = () => names.shift() ?? label;
        const againstFor = againstOf(events, request.contract);
        const stands = standsOf(events);
        const scored = verdictsOf(events);
        const folded = { records: recordsOf(events), verdicts: scored };
        const solves = new Map(solvesIn(events).map((s) => [s.id, s]));
        const flat = solved.flat();
        const last = new Map(flat.map(({ task }, at) => [task.version, at]));
        const programs = installedPrograms(ran.harness.toolTree);
        const said = flat.map(({ task, solve, ending, lines }, at) => {
          const shown = rejectionAside(events, { id: solve, ending }, stands)
            ? "rejection set aside"
            : endingText(ending);
          const against = againstFor(task.version);
          return [
            `${task.task.taskId}${under === "reference" ? " under the reference harness" : ""}: ${shown}. Solve ${solve}.${usedText(solves, solve)}${callsText(events, solve, programs)}${measuredText(scored, solve, against, name)}`,
            ...(last.get(task.version) === at
              ? [recordText(folded, task.version, roles, against, name)].filter((line) => line !== "")
              : []),
            ...lines,
          ].join("\n");
        });
        const after = practiceLeft(bench, events);
        return `${said.join("\n\n")}\n\n${
          after > 0
            ? `${plural(after, "practice solve")} left.`
            : "No practice solve is left: what you change from here on is measured without a solve having run it."
        }`;
      });
      bench.practising = run.then(
        () => undefined,
        () => undefined,
      );
      const seconds = request.practiceWaitSeconds ?? PRACTICE_WAIT_SECONDS;
      const cutoff = Promise.withResolvers<null>();
      const timer = setTimeout(() => cutoff.resolve(null), seconds * 1000);
      const done = await Promise.race([run, cutoff.promise]).finally(() => clearTimeout(timer));
      if (done !== null) return text(done);
      bench.practising = run.then(
        (late) => bench.steer(`Practice begun earlier has finished:\n${late}`),
        (error: unknown) => bench.steer(`Practice begun earlier failed: ${errorMessage(error)}`),
      );
      return text(
        `Practice is still running after ${String(seconds)} s. Its results will arrive once it finishes, and a turn that calls no tool waits for them.`,
      );
    },
  });
}

const PAGE_BYTES = 16 * 1024;

function pageOf(extracted: Extracted, from: number): string {
  const bytes = Buffer.from(extracted.text);
  const start = Math.min(Math.floor(from), bytes.length);
  const end = Math.min(start + PAGE_BYTES, bytes.length);
  const more = end < bytes.length ? `; the next page is from ${String(end)}` : "";
  return [
    ...headOf(extracted),
    `bytes ${String(start)} to ${String(end)} of ${String(bytes.length)}${more}`,
    bytes.subarray(start, end).toString("utf8"),
  ].join("\n");
}

async function readDeliveredFile(
  bench: Bench,
  files: readonly FileManifest[],
  ask: { readonly solve: string; readonly path: string; readonly from: number },
) {
  const { solve, path, from } = ask;
  const exact = files.find((each) => each.path === path);
  const kept = exact ?? files.find((each) => path.startsWith(`${each.path}#`));
  if (kept === undefined) throw new Error(`${solve} delivered no file ${path}`);
  const [delivered = { path: kept.path, base64: "" }] = readAnswerFiles(bench.request.log, [kept]);
  const visuals = answerImages(delivered);
  const hit = from === 0 ? visuals.find((each) => each.path === path) : undefined;
  const image = hit === undefined ? null : await prepareImage(hit.bytes, hit.path, bench.request.model);
  if (image !== null) {
    return {
      output: [
        { type: "text" as const, text: exact === undefined ? path : headOf(extract(delivered)).join("\n") },
        image,
      ],
    };
  }
  if (exact === undefined) throw new Error(`${solve} has no viewable image ${path}`);
  const refs = visuals.flatMap((each) => (each.path === delivered.path ? [] : [each.path]));
  return text(
    `${pageOf(extract(delivered), from)}${refs.length === 0 ? "" : `\nembedded images: ${refs.join(", ")}`}`,
  );
}

export function traceTool(bench: Bench): AgentTool {
  return tool({
    name: "read_trace",
    description:
      "Inspect a practice solve: overview (ending, answer, delivered files, closing text, tool calls), one full call (`call`), or a delivered file (`file`, paged from `from` bytes, including structured contents, tables, formulas, embedded visuals, and direct image rendering).",
    parameters: Type.Object({
      solve: Type.String({ description: "A solve's id." }),
      call: Type.Optional(Type.Number({ minimum: 1, description: "A call's number, from the list." })),
      file: Type.Optional(Type.String({ description: "A delivered file's path, from the list." })),
      from: Type.Optional(
        Type.Number({ minimum: 0, description: "The byte of the file's text a page starts at." }),
      ),
    }),
    execute: async (args) => {
      const versions = new Set(bench.tasks.map(({ version }) => version));
      const events = read(bench.request.log);
      const ran = practiceRan(events).find(({ id }) => id === args.solve);
      const released =
        ran !== undefined &&
        (versions.has(ran.under.task) ||
          eventsOf(events, "task.state").some(
            ({ event: { data } }) => data.state === "released" && data.version === ran.under.task,
          ));
      if (ran === undefined || !released) {
        throw new Error(`${args.solve} is not a solve of one of this session's practice tasks`);
      }
      const { turns, calls } = traceOf(events, "solve", args.solve);
      if (args.call !== undefined) return text(callText(calls, args.call));
      const { answer, files = [] } = verdictsOf(events).get(args.solve) ?? {};
      if (args.file !== undefined) {
        return await readDeliveredFile(bench, files, {
          solve: args.solve,
          path: args.file,
          from: args.from ?? 0,
        });
      }
      return text(
        [
          `ending: ${rejectionAside(events, ran) ? "rejection set aside" : isString(ran.ending?.outcome) ? `${ran.ending.outcome}${isString(ran.ending.kind) ? ` (${ran.ending.kind})` : ""}` : "not recorded"}`,
          answer === undefined
            ? "no answer was submitted"
            : `submitted answer: ${capturedJsonStringify(answer)}`,
          ...(files.length === 0
            ? []
            : [
                `delivered files: ${files.map(({ path, bytes }) => `${path} (${String(bytes)} B)`).join(", ")}`,
              ]),
          `closing text: ${closingOf(turns) ?? "(none recorded)"}`,
          callList(calls),
        ].join("\n"),
      );
    },
  });
}

async function finishNotice(bench: Bench, unmeasured?: Unmeasured): Promise<string | null> {
  const { request, told } = bench;
  const again = "or call finish again to end the session as it is";
  const now = await harnessNow(bench);
  if (!isString(now)) {
    const why = errorMessage(now);
    if (told.get("broken") === why) return null;
    told.set("broken", why);
    const { unpractised, practised } = bench.modePrompts.broken;
    return `${why}. Left so, ${bench.opened === null ? unpractised : practised}. Mend it and call finish again, ${again}.`;
  }
  const events = read(request.log, CALL_KINDS);
  const left = practiceLeft(bench, events);
  const tried =
    bench.opened === null ||
    now === bench.parent ||
    hasPractice(bench, events, now) ||
    eventsOf(events, COMPARISON_STARTED).some(
      ({ event: { data } }) => data.old === now || data.fresh === now,
    );
  const untried = !tried && left > 0 && told.get("untried") !== now;
  const unreadKey = `${now}@${bench.reference.harness.digest}`;
  const unread = told.get("unread") === unreadKey ? null : ((await unmeasured?.(now)) ?? null);
  if (unread !== null) told.set("unread", unreadKey);
  if (untried) {
    told.set("untried", now);
    return `harness/ has changed since your last practice solve, so no solve has run it as it stands. ${plural(left, "practice solve")} ${left === 1 ? "is" : "are"} left. Practise it, ${again} ${bench.modePrompts.untried}.${unread === null ? "" : ` ${unread}`}`;
  }
  return unread === null ? null : `${unread} Call finish again to end the conversation as it is.`;
}

export const openingTool = (opening: string | (() => string), description: string): AgentTool =>
  tool({
    name: "read_opening",
    description,
    parameters: Type.Object({}),
    execute: async () => text(isFunction(opening) ? opening() : opening),
  });

export const waitTool = (description: string, next: () => Promise<string>): AgentTool =>
  tool({
    name: "wait",
    description,
    parameters: Type.Object({}),
    execute: async () => text(await next()),
  });

export function endingWith(each: AgentTool, line: (id: string) => string): AgentTool {
  return {
    ...each,
    execute: async (args, api, context) => {
      try {
        const result = await each.execute(args, api, context);
        const said = line(api.callId);
        if (said === "") return result;
        const output = result.output ?? [{ type: "text" as const, text: api.retainedOutput().text }];
        return { ...result, output: [...output, { type: "text", text: said }] };
      } catch (error) {
        const said = line(api.callId);
        throw new Error(said === "" ? errorMessage(error) : `${errorMessage(error)}\n\n${said}`, {
          cause: error,
        });
      }
    },
  };
}

export function finishTool(bench: Bench, unmeasured?: Unmeasured): AgentTool {
  return tool({
    name: "finish",
    description: bench.modePrompts.finish,
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    execute: async (args) => {
      const stands = await finishNotice(bench, unmeasured);
      if (stands !== null) throw new Error(`Not finished. ${stands}`);
      bench.note = args.note.trim();
      return endSession(text("Finished."));
    },
  });
}

function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0] ?? ""} and ${parts[1] ?? ""}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1) ?? ""}`;
}

function countPhrases(rows: readonly (readonly [number, string, string?, (readonly string[])?])[]): string[] {
  return rows.flatMap(([count, unit, suffix = "", names = []]) => {
    if (count === 0) return [];
    const detail =
      names.length === 0
        ? ""
        : ` (${names.slice(0, 6).join(", ")}${names.length > 6 ? `, +${String(names.length - 6)} more` : ""})`;
    return [`${plural(count, unit)}${suffix}${detail}`];
  });
}

function practiceProgramUsage(
  events: readonly LogEvent[],
  states: string,
  reference: string,
  programs: readonly string[],
): string | null {
  if (programs.length === 0) return null;
  const solves = practiceRan(events).filter(({ under }) => under.harness !== reference);
  if (solves.length === 0) return null;
  const installedBy = new Map<string, ReadonlySet<string>>();
  const hadProgram = (digest: string): ReadonlySet<string> => {
    const cached = installedBy.get(digest);
    if (cached !== undefined) return cached;
    const tree = join(states, digest, TOOL_TREE_DIR);
    const held = new Set(existsSync(tree) ? installedPrograms(tree) : []);
    installedBy.set(digest, held);
    return held;
  };
  const used = new Map(programs.map((name) => [name, 0]));
  const eligible = new Map(programs.map((name) => [name, 0]));
  for (const { id, under } of solves) {
    const present = hadProgram(under.harness);
    const called = new Set(traceOf(events, "solve", id).calls.flatMap((call) => callPrograms(call).programs));
    for (const name of programs) {
      if (!present.has(name)) continue;
      eligible.set(name, (eligible.get(name) ?? 0) + 1);
      if (called.has(name)) used.set(name, (used.get(name) ?? 0) + 1);
    }
  }
  const summary = programs.map((name) => {
    const total = eligible.get(name) ?? 0;
    return total === 0 ? `${name} (unpractised)` : `${name} ${String(used.get(name) ?? 0)}/${String(total)}`;
  });
  const unused = programs.filter((name) => (eligible.get(name) ?? 0) > 0 && (used.get(name) ?? 0) === 0);
  return `Practice use: ${summary.join(", ")}.${unused.length === 0 ? "" : ` Unused: ${unused.join(", ")}.`}`;
}

function opens(bench: Bench, harness: Harness, dir: string, envIssue: string | null = null): string {
  const { contract } = bench.request;
  const presets = selectedCodingTools(harness.presets);
  const programs = installedPrograms(harness.toolTree);
  const portablePrograms = installedPrograms(harness.toolTree, "portable");
  const hostPrograms = programs.filter((name) => !portablePrograms.includes(name));
  const ruleIds = [...new Set(contract.rules.map(({ id }) => id).filter((id) => id !== ""))];
  const info = readHarnessFiles(dir, [...new Set(formatKeys(contract.answerFormat))], ruleIds);
  const { guide, files: toolFiles, lines: toolLines } = info.size ?? { guide: 0, files: 0, lines: 0 };
  const splitOf = (written: string) =>
    info.hasSplit
      ? `${String(info.keptLines)} before "${HOST_ONLY}" (${String(portableGuide(written).length)} portable chars), ${String(Math.max(0, guide - info.keptLines))} under it; ${String(written.length)} characters`
      : `${String(written.length)} characters; no "${HOST_ONLY}" heading`;
  const guideLine =
    harness.guide === null ? "Guide: none." : `Guide: ${plural(guide, "line")} (${splitOf(harness.guide)}).`;
  const fileIssues = countPhrases([
    [info.hostPaths, "path", " to this machine"],
    [info.hostShebangs, "host-specific shebang"],
    [info.plainBins, "non-executable file", ` in bin/ or ${TOOL_HOST_DIR}/`],
    [info.brokenLinks, "broken link"],
    [
      info.campaignRefs,
      "reference",
      ` to campaign files (move adapters to .toolchain/${TOOL_HOST_DIR}/; stripped on export)`,
      info.campaignRefFiles,
    ],
  ]);
  const guideIssues = countPhrases([
    [info.keptHostRefs, "host reference", "", info.keptHostRefNames],
    [info.keptRuleIds, "rule id", "", info.keptRuleIdNames],
    [info.keptFormatKeys, "answer field", "", info.keptFormatKeyNames],
  ]);
  const exportNote = info.hasSplit
    ? `Before "${HOST_ONLY}", the guide names ${listText(guideIssues)}; text before that heading stays in exported harnesses.`
    : `The guide names ${listText(guideIssues)}, with no "${HOST_ONLY}" heading to separate them on export.`;
  const mentions = namedTasks(
    info.written,
    bench.tasks.map(({ task }) => task),
  );
  const usageLine = practiceProgramUsage(
    read(bench.request.log, CALL_KINDS),
    bench.request.states,
    bench.reference.harness.digest,
    programs,
  );
  return [
    "The harness opens.",
    `pi's tools: ${presets.join(", ") || "none"}.`,
    `Programs: ${portablePrograms.join(", ") || "none"}.`,
    ...(hostPrograms.length > 0
      ? [`Host-only programs (.toolchain/${TOOL_HOST_DIR}/, omitted on export): ${hostPrograms.join(", ")}.`]
      : []),
    ...(usageLine === null ? [] : [usageLine]),
    guideLine,
    ...(toolFiles > 0
      ? [`Your files under .toolchain/: ${plural(toolFiles, "file")}, ${plural(toolLines, "line")}.`]
      : []),
    ...(envIssue === null ? [] : [envIssue]),
    ...(programs.length > 0 && !presets.includes("bash")
      ? ["The solver has no shell, so it can run none of the programs itself."]
      : []),
    ...(fileIssues.length > 0 ? [`Files in harness/ carry ${listText(fileIssues)}.`] : []),
    ...(guideIssues.length > 0 ? [exportNote] : []),
    ...(mentions.length > 0 ? [`Matches a practice task: ${mentions.join("; ")}.`] : []),
  ].join("\n");
}

const ENV_CHECK_MARKER = "ANA_ENV_CHECK_STATUS=";

async function checkEnvScript(wall: CommandSandbox, toolTree: string | null): Promise<string | null> {
  if (toolTreeEnv(toolTree) === undefined) return null;
  const chunks: Buffer[] = [];
  const label = `harness/.toolchain/${TOOL_TREE_ENV}`;
  try {
    await runSandboxed(wall, `source "${label}"; printf '\\n${ENV_CHECK_MARKER}%d\\n' "$?"`, {
      onData: (data) => chunks.push(data),
      timeout: 15,
    });
  } catch (error) {
    return `${label} failed while sourced: ${errorMessage(error)}.`;
  }
  const output = Buffer.concat(chunks).toString("utf8");
  const match = new RegExp(`^${ENV_CHECK_MARKER}(\\d+)$`, "mu").exec(output);
  if (match === null) {
    return `${label} exited early when sourced, which silences subsequent shell commands.`;
  }
  const code = Number(match[1]);
  if (code === 0) return null;
  const before = output.slice(0, match.index).trim().split("\n").at(-1) ?? "";
  return `${label} returned status ${String(code)} when sourced${before === "" ? "" : `: ${before}`}.`;
}

function checkTool(bench: Bench, wall: CommandSandbox): AgentTool {
  return tool({
    name: "check_harness",
    description:
      "Validate harness/ without spending a solve: reports tools, programs, guide length and portable split, host-path/campaign leaks, env.sh health and practice-task leakage.",
    parameters: Type.Object({}),
    execute: async () =>
      await frozen(bench, async ({ dir, harness }) => {
        const envIssue = await checkEnvScript(wall, harness.toolTree);
        return text(opens(bench, harness, dir, envIssue));
      }),
  });
}

export function walledTools(bench: Bench, wall: CommandSandbox, network: NetworkReach): AgentTool[] {
  return [
    ...codingTools(wall, CODING_TOOLS).map((each) =>
      each.name === "bash" ? { ...each, description: `${each.description}${shellWalls(network)}` } : each,
    ),
    checkTool(bench, wall),
  ];
}
