/**
 * One Rule Author session: the agent that writes one addition to a campaign's correctness model,
 * and the host that puts the addition through its gates and leaves a candidate pack.
 *
 * Until this file no session of v2 wrote a check. v1's Builder wrote its checks beside its
 * harness, and v1 measured the result: 36 of 47 rehearsal misses were the check's fault (v1 #124),
 * and "the answer is the author's own" was the first blocker to a climb (v1 `AGENTS.md`, "Open
 * gaps"). v2 took the pen away and a person held it. When the tasks an Examiner writes keep coming
 * back too easy against the harness a campaign stands on, the reading is that the checks' span is
 * spent (`correctness-model` in `src/kernel/binding.ts`), and the exam grows only by a requirement
 * with a check of its own. This session writes one, behind the walls an Examiner works behind.
 *
 * It is given the contract, the checks as their brief declares them, the check program's source,
 * since its code has to fit it, the existing tasks whole, the answers stronger solves were
 * accepted on, and what was measured of the campaign's tasks against the harness it stands on
 * (`src/examiner/record.ts`). It is never given a harness, a Builder's note, an answer or a trace
 * of the solver being measured, or how many rules are wanted. It has no shell and reads no file
 * but through its tools.
 *
 * It sends parts and the host applies them (`candidate.ts`), so it never writes a file an existing
 * check lives in. Each addition it sends meets the gates in order, each logged as `rule.gate`:
 *
 * 1. shape: the candidate is built and proven to be the pack with one rule and one check added,
 *    and the tools the check names are on the verifier's tool path;
 * 2. controls: its controls get the verdicts they are labelled with, from the whole candidate
 *    program (`gates.ts`). A control is an edit of an accepted answer, made by the host from the
 *    change the session names, as an Examiner's reject control is (`changedAnswer`);
 * 3. determinism: a second run of every control gives the same verdict;
 * 4. interference: the accepted answers on record are graded under the candidate. This one is
 *    reported and refuses nothing.
 *
 * A gate that refuses says why, and the session may send the addition again while it has tries
 * left. A slip of the pen, a control that names no answer or changes nothing, costs no try.
 *
 * The interference is read in two parts, because the check is the session's own code. While the
 * session runs, that code is put only to answers its author can read anyway: the stronger solves'
 * witnesses. A measured solver's accepted answer, a pack's accept control and a stored sweep's
 * pass are graded once, when the session is over and can be told nothing more. Put to them
 * sooner, the code could carry one back: a verdict told of a control is a bit, what a check
 * throws on a control is told whole, and the Darwin wall leaves a check's cell the user's
 * temporary directory to write in (`userTempRules` in `src/verify/wall-policy.ts`), so a run on
 * a measured answer could leave it there for a later try's run on a control to find. The scan
 * of an added module's imports is no wall against that (`candidate.ts`).
 *
 * It stops at a candidate. When the session ends by `finish` with an addition that held, the rest
 * of the record is graded, the candidate is moved to `<candidates>/<session>`, the pack's tool
 * tree is copied into it, the proof is run once more over the whole directory, and
 * `rule.candidate` logs what it is. Nothing is adopted, frozen or moved: the campaign's checker
 * is the one it was, and whether the exam takes the candidate is the operator's, by another
 * command. An addition the session had not finished on, at its limits or at a crash, is not
 * kept, since its author was told what it refuses and had not said it stands by it. The controls
 * are kept whole in the log and not in the candidate's `controls.json`: they stand on tasks a
 * session wrote, which no pack holds, and an answer is written to no file outside the log.
 *
 * One session writes one requirement. A verifier that cannot decide stops the session, as it stops
 * any run (`decided`): the session writes its record and throws.
 */
import {
  type AgentMessage,
  type AgentTool,
  runAgentLoop,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  createInitialSystemMessage,
  type Model,
  type Models,
  type ThinkingLevel,
  toToolDeclaration,
  type Usage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { REPORTED_COST } from "../backends/claude.ts";
import { CHANGE_FIELDS, shown } from "../examiner/session.ts";
import { measured } from "../examiner/record.ts";
import { type Checker, runControls } from "../kernel/acceptance.ts";
import type { Binding } from "../kernel/binding.ts";
import { type Contract, contractHash } from "../kernel/contract.ts";
import type { Rule as Screening, Stand } from "../kernel/ladder.ts";
import { append, type EventKind, type LogEvent, read } from "../kernel/log.ts";
import { dollars, freezePrices, priceKey, tokensOf } from "../kernel/meter.ts";
import { checkProgramVersion, decided, type Task, type Verifier } from "../kernel/verify.ts";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "../meta/filesystem.ts";
import { asRecord, isNumber, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { tmpdir } from "../meta/os.ts";
import { dirname, join, relative } from "../meta/path.ts";
import { pooled } from "../meta/pool.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { compareCodeUnits, hashJsonValue, stableJson } from "../meta/stable-json.ts";
import { countBy } from "../meta/tally.ts";
import { plural } from "../meta/text.ts";
import { type Change, changedAnswer } from "../review/probe.ts";
import { readProgramTool } from "../review/referee.ts";
import { text, tool } from "../solve/answer.ts";
import { failedTurn, loopCompaction, traceSink } from "../solve/run.ts";
import {
  type Added,
  type Addition,
  additive,
  copyTools,
  type Declared,
  declared,
  type Unproven,
  writeCandidate,
} from "./candidate.ts";
import {
  type Interference,
  interference,
  interfering,
  labelFaults,
  type NamedControl,
  type Regraded,
  repeatFaults,
  sifted,
  type Stored,
} from "./gates.ts";
import { firstMessage, NUDGE, SYSTEM_PROMPT } from "./prompt.ts";

export interface RuleLimits {
  readonly wallSeconds: number;
  /** The model's turns, each reply one, with or without a tool call. */
  readonly turns: number;
  /** Runs of the verifier in flight at once. */
  readonly concurrency: number;
  /** Additions the session may put to the gates. */
  readonly tries: number;
}

export interface RuleRequest {
  /** Names the session in the log, and its candidate's directory. */
  readonly id: string;
  readonly contract: Contract;
  /** The checker the campaign runs under, which the pack must be. */
  readonly base: Checker;
  /** The campaign's current pack: its `correctness-model/` and, where it has one, `.toolchain/`. */
  readonly pack: string;
  /** Where candidates are kept. The session's own is `<candidates>/<id>`, and each addition it
   *  tries is built beside it. */
  readonly candidates: string;
  /** The existing tasks, shown whole on request: the pack's and the ones sessions wrote. */
  readonly tasks: readonly Task[];
  /** Every accepted answer on record. The session reads the witnesses among them and no other, and
   *  its check is put to the others only when the session is over. */
  readonly stored: readonly Stored[];
  /** Where the measured solver stands, and the rule its solves are read by: what the opening
   *  message says was measured of the campaign's tasks is read against both. */
  readonly standsOn: Stand;
  readonly screening: Screening;
  /** What binds the campaign's climb as the caller read it, for the record of why this ran. */
  readonly binding: Pick<Binding, "binds" | "why">;
  /** A pack's check program copied to `to` without its battery, and a verifier over such a copy. */
  readonly stage: (pack: string, to: string) => string;
  readonly verifier: (checks: string) => Verifier;
  /** Whether the verifier's tool path holds a tool. */
  readonly found: (toolId: string) => boolean;
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly limits: RuleLimits;
  /** The backends, built on the home the session's model process keeps its state in. */
  readonly models: (home: string) => Models;
  readonly log: string;
  /** Aborts when the run is killed. */
  readonly kill?: AbortSignal;
}

/** The candidate a session left. */
export interface Candidate {
  /** The candidate pack's directory. */
  readonly dir: string;
  readonly rule: string;
  readonly check: string;
  /** The checker it would be: its contract's hash and its check program's digest. */
  readonly checker: Checker;
  readonly interference: Interference;
}

export interface Authored {
  /** How the session ended: by `finish`, at a limit, or otherwise. */
  readonly ended: "finished" | "wall" | "turns" | "killed" | "crashed" | "stopped";
  readonly tries: number;
  /** Null when the session finished with nothing added, or did not finish. */
  readonly candidate: Candidate | null;
}

/** A control as the session sends it: a task whose accepted answer it starts from, the label, and
 *  one change to that answer, or none for the answer as it stands. */
interface ControlEdit {
  readonly task: string;
  readonly expect: "accept" | "reject";
  readonly change?: Change | undefined;
}

/** An addition that held at every gate, as the session's last word so far. */
interface Held {
  readonly dir: string;
  readonly added: Added;
  readonly checker: Checker;
  /** The verifier over the program the gates ran, which grades the rest of the record. */
  readonly verify: Verifier;
  /** What that program made of the witnesses, and the answers the controls start from. */
  readonly graded: readonly Regraded[];
  readonly bases: readonly NamedControl[];
}

/** What a session's tools share. */
interface Desk {
  readonly request: RuleRequest;
  /** Where each try's candidate is built and staged. */
  readonly work: string;
  /** The answer a stronger solve was accepted on, by task: the last on record for each. */
  readonly witnesses: ReadonlyMap<string, JsonValue>;
  /** The accepted answers on record, the witnesses first, so that an answer a witness shares with
   *  another solve is read as the witness it is. */
  readonly stored: readonly Stored[];
  tries: number;
  held: Held | null;
  /** Whether `held` was set in the turn still running, so that its author has not yet read what
   *  the gates and the interference said of it. */
  unread: boolean;
  /** Aborted when the verifier threw, which ends the session. */
  readonly halt: AbortController;
  fatal: Error | null;
  note: string | null;
}

const GATE: EventKind = "rule.gate";
const WITNESS = "witness";
const REFUSED = "refused";
const PASSED = "passed";
/** The most of an added check's module one addition carries. */
const CODE_MAX_CHARS = 60_000;
const ENDINGS = ["finished", "killed", "wall", "turns"] as const;

/** Stop the session on what the verifier threw, and tell its author only that. */
function halted(desk: Desk, error: unknown): Error {
  desk.fatal ??= asError(error);
  desk.halt.abort();
  return new Error("The host could not go on, which is not your addition's fault. The session ends here.");
}

/**
 * The controls of an addition: the unchanged accepted answer of every task a control names, and
 * each control that changes one. Throws, in words for the session, a control that is none: one of
 * a task with no accepted answer to read, a reject control that changes nothing, or a change that
 * is not one (`changedAnswer`).
 */
function controlsOf(desk: Desk, checkId: string, edits: readonly ControlEdit[]) {
  const accepted = (taskId: string): JsonValue => {
    const answer = desk.witnesses.get(taskId);
    if (answer === undefined) {
      throw new Error(`${taskId} has no accepted answer on record for a control to start from`);
    }
    return answer;
  };
  const bases = [...new Set(edits.map((edit) => edit.task))].map(
    (taskId): NamedControl => ({
      name: `the accepted answer of ${taskId}`,
      taskId,
      answer: accepted(taskId),
      refusedBy: null,
    }),
  );
  const changed = edits.flatMap(({ task, expect, change }, index): NamedControl[] => {
    const name = `control ${String(index + 1)}`;
    if (change === undefined && expect === "reject") {
      throw new Error(`${name} is a reject control and names no change`);
    }
    if (change === undefined) return [];
    try {
      const answer = changedAnswer(accepted(task), change);
      return [{ name, taskId: task, answer, refusedBy: expect === "reject" ? checkId : null }];
    } catch (error) {
      throw new Error(`${name}: ${errorMessage(error)}`, { cause: error });
    }
  });
  return { bases, controls: [...bases, ...changed] };
}

/** The accepted answers the session reads, and the ones it does not. */
const readable = ({ from }: Stored) => from === WITNESS;

/** The candidate program's verdict of each stored answer, `width` at once. A verifier that cannot
 *  decide stops the run (`decided`). */
function gradedBy(verify: Verifier, stored: readonly Stored[], width: number): Promise<Regraded[]> {
  return pooled(stored, width, async (each) => ({
    stored: each,
    verdict: await decided(verify, each.task, each.answer),
  }));
}

/** An interference reading as `rule.gate` holds it: what it was taken over, the counts, and where
 *  the graded answers are from. */
function loggedReading(
  over: "witnesses" | "record",
  reading: Interference,
  graded: readonly Regraded[],
): JsonObject {
  return {
    outcome: "reported",
    over,
    ...reading,
    tasks: reading.tasks.map((task) => ({ ...task })),
    from: countBy(graded, ({ stored }) => stored.from),
  };
}

/** What the session is told of an addition that held: what its check makes of the other accepted
 *  answers it can read. */
function heldLines(told: Interference, checkId: string, graded: readonly Regraded[]) {
  const named = (pick: (task: Interference["tasks"][number]) => number) =>
    told.tasks.flatMap((task) => (pick(task) > 0 ? [task.taskId] : [])).join(", ");
  const why = graded.flatMap(({ stored, verdict }) =>
    verdict.kind === "faulty" && verdict.check === checkId
      ? [`${stored.task.taskId}: ${verdict.reason}`]
      : [],
  );
  return [
    told.applied === 0
      ? `No other accepted answer you can read is of a task ${checkId} applies to.`
      : `Of the ${plural(told.applied, "other accepted answer")} you can read that ${checkId} applies to, it refuses ${String(told.refused)}${told.refused === 0 ? "" : ` (${named((task) => task.refused)})`} and could not run on ${String(told.unrunnable)}${why.length === 0 ? "" : ` (${why.join("; ")})`}.`,
    "A new requirement may rightly refuse an old accepted answer, and that task then waits for a new one. A refusal the rule's statement does not decide, or an answer the check cannot run on, is a defect to mend. Send propose_rule again to replace this addition, or call finish to leave it as the candidate.",
  ];
}

/** One addition through the gates: the lines its author is told. */
async function tried(desk: Desk, addition: Addition, given: ReturnType<typeof controlsOf>): Promise<string> {
  const { request } = desk;
  const { limits, log } = request;
  desk.tries += 1;
  desk.held = null;
  const nth = desk.tries;
  const gate = (name: string, data: JsonObject) =>
    append(log, GATE, { session: request.id, try: nth, gate: name, ...data });
  const left = limits.tries - nth;
  const refused = (name: string, reason: string, more: JsonObject = {}) => {
    gate(name, { outcome: REFUSED, reason, ...more });
    return `Refused at the ${name} gate: ${reason}.\n${left > 0 ? `Send the addition again, revised: ${plural(left, "attempt")} left.` : "This session has no attempt left. Call finish."}`;
  };
  const dir = join(desk.work, String(nth));
  let proof: Added | Unproven;
  try {
    writeCandidate(request.pack, addition, dir);
    proof = additive(request.pack, dir, "model-only");
  } catch (error) {
    proof = { faults: [errorMessage(error)] };
  }
  const lost = addition.check.tools.flatMap((toolId) =>
    request.found(toolId) ? [] : [`${toolId} is not on the verifier's tool path`],
  );
  if ("faults" in proof) return refused("shape", [...proof.faults, ...lost].join("; "));
  if (lost.length > 0) return refused("shape", lost.join("; "));
  const { rule, check } = proof;
  const checks = request.stage(dir, join(desk.work, `${String(nth)}-checks`));
  const checker = {
    contract: contractHash({ ...request.contract, rules: proof.rules }),
    checks: hashJsonValue(checkProgramVersion(checks)),
  };
  gate("shape", { outcome: PASSED, rule: rule.id, check: check.id, ...checker });

  const verify = request.verifier(checks);
  const { faults: unfit, fit } = sifted(
    request.contract,
    proof,
    new Map(request.tasks.map((task) => [task.taskId, task])),
    given.controls,
  );
  const ran = await runControls(verify, request.tasks, fit, limits.concurrency);
  const runs = ran.map((run, index) => ({ ...run, name: fit[index]?.name ?? "" }));
  const faults = [...unfit, ...labelFaults(check.id, runs)];
  // The controls are logged whole, as gate 4 logs a task's: whoever adopts the candidate runs
  // them again from here, and no file outside the log holds an answer.
  const set = given.controls.map(({ taskId, answer, refusedBy }) => ({ taskId, answer, refusedBy }));
  const counts = countBy(given.controls, ({ refusedBy }) => (refusedBy === null ? "accepts" : "rejects"));
  if (faults.length > 0) {
    return refused("controls", faults.map(([, reason]) => reason).join("; "), {
      kinds: [...new Set(faults.map(([kind]) => kind))].sort(compareCodeUnits),
    });
  }
  gate("controls", { outcome: PASSED, controls: hashJsonValue(set), set, ...counts });

  const moved = repeatFaults(runs);
  if (moved.length > 0) return refused("determinism", moved.join("; "));
  gate("determinism", { outcome: PASSED, runs: 2 });

  // Only the answers its author can read. The rest of the record is graded when the session is
  // over (`authorRule`): until then this code is put to no answer its author may not see.
  const graded = await gradedBy(verify, interfering(proof, desk.stored).filter(readable), limits.concurrency);
  const reading = interference(check.id, graded, given.bases);
  gate("interference", loggedReading("witnesses", reading, graded));
  desk.held = { dir, added: proof, checker, verify, graded, bases: given.bases };
  return [
    `The addition holds at every gate: rule ${rule.id} and check ${check.id}, on ${plural(counts.accepts ?? 0, "accept control")} and ${plural(counts.rejects ?? 0, "reject control")}, each run twice.`,
    ...heldLines(reading, check.id, graded),
  ].join("\n");
}

function proposeTool(desk: Desk): AgentTool {
  const { limits } = desk.request;
  return tool({
    name: "propose_rule",
    label: "Propose a rule",
    description:
      "Put one addition through the host's gates: a public rule, the check that enforces it, the check's code and its controls. It returns the gate that refused and why, or that the addition holds, with what the check makes of the other accepted answers you can read. Each call replaces the addition before it.",
    parameters: Type.Object({
      rule: Type.Object({
        id: Type.String({
          minLength: 1,
          maxLength: 64,
          description: "A new id, in the style of the rules' ids.",
        }),
        statement: Type.String({
          minLength: 1,
          maxLength: 4000,
          description: "The rule as a solver reads it: everything the check requires of an answer.",
        }),
      }),
      check: Type.Object({
        id: Type.String({
          minLength: 1,
          maxLength: 64,
          description: "A new id, in the style of the checks' ids. It names the check's module.",
        }),
        assertion: Type.String({
          minLength: 1,
          maxLength: 700,
          description: "One sentence of what the check asserts of an answer, which a solver reads too.",
        }),
        families: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: "The task families the check applies to. Omit it for every family.",
          }),
        ),
        cites: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "Ids of existing public rules the check also enforces. The new rule is cited for you.",
          }),
        ),
        answer_paths: Type.Array(Type.String(), {
          minItems: 1,
          description:
            "The paths of the answer the code reads, spelled as the checks spell theirs: `$.items`. A declared path hands over everything under it; nothing else of the answer reaches the code.",
        }),
        public_input_paths: Type.Array(Type.String(), {
          description: "The paths of the task's public input the code reads, spelled the same way.",
        }),
        tools: Type.Optional(
          Type.Array(Type.String(), {
            description: "Tools the code runs, from the ones the opening message says a check may name.",
          }),
        ),
      }),
      code: Type.String({
        minLength: 1,
        maxLength: CODE_MAX_CHARS,
        description:
          "The check's module, TypeScript: it exports `check`, a function of the request that returns a boolean. It is placed at `added/<check id>.ts` of the check program.",
      }),
      controls: Type.Array(
        Type.Object({
          task: Type.String({ description: "An existing task with an accepted answer on record." }),
          expect: Type.Union([Type.Literal("accept"), Type.Literal("reject")], {
            description:
              "accept: every check must pass the answer. reject: the new check must refuse it, and no other check may.",
          }),
          change: Type.Optional(
            Type.Object(CHANGE_FIELDS, {
              description:
                "One change to the task's accepted answer. Omit it for an accept control that is the accepted answer as it stands.",
            }),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      if (desk.tries >= limits.tries) {
        throw new Error("This session has no attempt left at the gates. Call finish.");
      }
      const { rule, check, code } = args;
      let given: ReturnType<typeof controlsOf>;
      try {
        given = controlsOf(desk, check.id, args.controls);
      } catch (error) {
        // A control that is none is a slip of the pen, and costs no try.
        return text(`${errorMessage(error)}. Nothing was put to the gates. Send the addition again.`);
      }
      const addition: Addition = {
        rule,
        check: {
          id: check.id,
          assertion: check.assertion,
          families: check.families ?? "all",
          cites: check.cites ?? [],
          artifactPaths: check.answer_paths,
          publicInputPaths: check.public_input_paths,
          tools: check.tools ?? [],
        },
        code,
      };
      try {
        const told = await tried(desk, addition, given);
        desk.unread = desk.held !== null;
        return text(told);
      } catch (error) {
        throw halted(desk, error);
      }
    },
  });
}

function taskTool(desk: Desk): AgentTool {
  const tasks = new Map(desk.request.tasks.map((task) => [task.taskId, task]));
  return tool({
    name: "read_task",
    label: "Read a task",
    description:
      "Return one existing task of the domain whole: its family, its public input and its hidden values, and the answer the checks accepted for it where one is on record.",
    parameters: Type.Object({
      task: Type.String({ description: "A task's id, from the opening message." }),
    }),
    executionMode: "parallel",
    execute: async (_id, args) => {
      const task = tasks.get(args.task);
      if (task === undefined) throw new Error(`${args.task} is not one of the existing tasks`);
      const { taskId, family, publicInput, hidden } = task;
      const accepted = desk.witnesses.get(taskId);
      return text(
        `${shown({ taskId, family, publicInput, hidden })}\n${accepted === undefined ? "No accepted answer of it is on record for you to read." : `The answer the checks accepted:\n${shown(accepted)}`}`,
      );
    },
  });
}

function finishTool(desk: Desk): AgentTool {
  return tool({
    name: "finish",
    label: "Finish",
    description:
      "End the session. Say in one or two sentences what the rule requires and where it comes from, or why you added none.",
    parameters: Type.Object({ note: Type.String({ minLength: 1, maxLength: 700 }) }),
    executionMode: "sequential",
    execute: async (_id, args) => {
      // An addition is left as the candidate by an author that has read what was said of it.
      if (desk.unread) {
        throw new Error("propose_rule returned in this same turn. Read what it said, then call finish.");
      }
      desk.note = args.note.trim();
      return {
        ...text(
          desk.held === null
            ? "Finished, with nothing added."
            : "Finished. The addition is left as the candidate.",
        ),
        terminate: true,
      };
    },
  });
}

/** Why no Rule Author session starts under `id` on this log, or null. A session's id names its
 *  candidate's directory. */
export function taken(events: readonly LogEvent[], id: string): string | null {
  return events.some(({ kind, data }) => kind === "rule.started" && data.session === id)
    ? `session ${id} is in the log already; a session's id names one session`
    : null;
}

export async function authorRule(request: RuleRequest): Promise<Authored> {
  const { log, limits, model, pack } = request;
  const began = performance.now();
  const why = taken(read(log), request.id);
  if (why !== null) throw new Error(why);
  const final = join(request.candidates, request.id);
  const work = `${final}.tries`;
  if (existsSync(final) || existsSync(work)) {
    throw new Error(`${final} is there already, and no session of this log left it`);
  }
  mkdirSync(work, { recursive: true });
  // The pack is the campaign's own or nothing is proven against the campaign: its rules and its
  // check program are held to the checker the caller names before a turn is paid for.
  let staged: string;
  let checks: readonly Declared[];
  try {
    staged = request.stage(pack, join(work, "pack"));
    const own = declared(pack);
    checks = own.checks;
    if (
      contractHash(request.contract) !== request.base.contract ||
      stableJson(own.rules) !== stableJson(request.contract.rules) ||
      hashJsonValue(checkProgramVersion(staged)) !== request.base.checks
    ) {
      throw new Error(
        `${pack} is not the pack this campaign runs under: its rules or its check program differ`,
      );
    }
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
  const desk: Desk = {
    request,
    work,
    witnesses: new Map(
      request.stored.flatMap(({ task, answer, from }) => (from === WITNESS ? [[task.taskId, answer]] : [])),
    ),
    stored: [...request.stored.filter(readable), ...request.stored.filter((each) => !readable(each))],
    tries: 0,
    held: null,
    unread: false,
    halt: new AbortController(),
    fatal: null,
    note: null,
  };
  append(log, "rule.started", {
    session: request.id,
    model: priceKey(model),
    effort: request.effort,
    limits: { ...limits },
    standsOn: request.standsOn.harness,
    setting: request.standsOn.setting,
    binding: { binds: request.binding.binds, why: request.binding.why },
    base: { ...request.base },
    checks: checks.map(({ id }) => id),
    tasks: request.tasks.map(({ taskId }) => taskId),
    witnessed: [...desk.witnesses.keys()],
    stored: countBy(request.stored, ({ from }) => from),
  });
  const tools = [readProgramTool(staged), taskTool(desk), proposeTool(desk), finishTool(desk)];
  const wall = new AbortController();
  // Aborted when the loop returns, whatever returned it, so the model's own process is closed.
  const done = new AbortController();
  const signal = AbortSignal.any([
    wall.signal,
    done.signal,
    desk.halt.signal,
    ...(request.kill ? [request.kill] : []),
  ]);
  const turns: AssistantMessage[] = [];
  const summaries: Usage[] = [];
  const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: Date.now() });
  const system = createInitialSystemMessage(SYSTEM_PROMPT, tools.map(toToolDeclaration));
  // A name every solver's wall denies (`wall-policy.ts`): the session's Claude Code keeps its
  // state here, the tasks' hidden values and the accepted answers it read included.
  const home = mkdtempSync(join(tmpdir(), "ana-claude-cli-rule-author-"));
  let crash: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = request.models(home);
    const stream: StreamFn = (asked, context, options) => models.streamSimple(asked, context, options);
    timer = setTimeout(() => wall.abort(), limits.wallSeconds * 1000);
    await runAgentLoop(
      [
        user(
          firstMessage(
            request.contract,
            checks,
            request.tasks.map(({ taskId, family }) => ({
              taskId,
              family,
              witnessed: desk.witnesses.has(taskId),
            })),
            limits,
            measured(read(log), request.standsOn, request.screening),
          ),
        ),
      ],
      { messages: system === undefined ? [] : [system], tools },
      {
        model,
        reasoning: request.effort,
        sessionId: request.id,
        convertToLlm: (messages) => messages,
        toolExecution: "sequential",
        finishTurn: ({ message }) => {
          if (message.role === "assistant") turns.push(message);
          // What the turn's calls returned is read in the next one.
          desk.unread = false;
          return desk.note !== null || turns.length >= limits.turns ? { action: "end" } : undefined;
        },
        getFollowUpMessages: async () => (desk.note === null ? [user(NUDGE)] : []),
        prepareRequest: loopCompaction(log, "rule", request.id, stream, summaries),
      },
      traceSink(log, "rule", request.id, () => turns.length),
      signal,
      stream,
    );
  } catch (error) {
    crash = errorMessage(error);
  } finally {
    clearTimeout(timer);
    done.abort();
    rmSync(home, { recursive: true, force: true });
  }
  const cut = wall.signal.aborted || desk.halt.signal.aborted || request.kill?.aborted === true;
  crash ??= desk.fatal?.message ?? (cut ? null : failedTurn(turns));
  // The candidate is left only by a session that finished on an addition that held. The session
  // is over, so its check is now put to the rest of the record. Then the candidate is moved into
  // place, given the pack's tool tree, and proven once more as it stands on disk.
  let candidate: Candidate | null = null;
  if (desk.note !== null && crash === null && desk.held !== null) {
    const { dir, added, checker, verify, graded, bases } = desk.held;
    try {
      const rest = interfering(added, desk.stored).filter((each) => !readable(each));
      const all = [...graded, ...(await gradedBy(verify, rest, limits.concurrency))];
      const reading = interference(added.check.id, all, bases);
      append(log, GATE, {
        session: request.id,
        try: desk.tries,
        gate: "interference",
        ...loggedReading("record", reading, all),
      });
      renameSync(dir, final);
      copyTools(pack, final);
      const proof = additive(pack, final, "with-tools");
      if ("faults" in proof) throw new Error(`${final} is not proven: ${proof.faults.join("; ")}`);
      candidate = { dir: final, rule: added.rule.id, check: added.check.id, checker, interference: reading };
      append(log, "rule.candidate", {
        session: request.id,
        try: desk.tries,
        dir: relative(dirname(log), final),
        rule: { id: added.rule.id, statement: added.rule.statement },
        check: { id: added.check.id, assertion: added.check.assertion },
        base: { ...request.base },
        ...checker,
        reading: reading.reading,
        suspect: reading.suspect,
        note: reading.note,
      });
    } catch (error) {
      // The host could not leave what the gates passed: no candidate, and the caller is told.
      desk.fatal = asError(error);
      crash = desk.fatal.message;
      rmSync(final, { recursive: true, force: true });
    }
  }
  rmSync(work, { recursive: true, force: true });
  const by = {
    finished: desk.note !== null,
    killed: request.kill?.aborted === true,
    wall: wall.signal.aborted,
    turns: turns.length >= limits.turns,
  };
  const ended = crash === null ? (ENDINGS.find((reason) => by[reason]) ?? "stopped") : "crashed";
  const tokens = tokensOf([...turns.map((turn) => turn.usage), ...summaries]);
  const reported = asRecord(
    turns.flatMap((turn) => turn.diagnostics ?? []).findLast((d) => d.type === REPORTED_COST)?.details,
  )?.totalCostUsd;
  append(log, "rule.finished", {
    session: request.id,
    ended,
    note: desk.note,
    tries: desk.tries,
    candidate: candidate === null ? null : relative(dirname(log), candidate.dir),
    // An addition that held and was not finished on is not kept: its author had been told what
    // it refuses and had not said it stands by it.
    unfinished: candidate === null && desk.held !== null ? desk.held.added.check.id : null,
    crash,
    turns: turns.length,
    tokens: { ...tokens },
    ...dollars(freezePrices([model]), priceKey(model), tokens),
    reportedCost: isNumber(reported) ? reported : null,
    seconds: (performance.now() - began) / 1000,
  });
  if (desk.fatal !== null) throw desk.fatal;
  return { ended, tries: desk.tries, candidate };
}
