/**
 * A campaign over a seeded log (`seed.ts`) with a script in each model seat and no model called, so a
 * campaign's path can be walked before it is paid for. Everything under the seats is a paid campaign's;
 * flags and defaults are the rehearsed command's, except that no `--cap` is needed and the flags that
 * name a model are refused. A solve's script answers `pass`, `fail` or `none`: `--held` gives it under
 * the reference and new harnesses as `old:new` (default `none:pass`, a step), `--starter` under the
 * starter (default `none`). `--supply N` adds copies of the source's answered tasks, so a climb of
 * more than one epoch can be rehearsed.
 *
 *   bun run runs rehearse --name <seed> <the flags of tools/d2/harness-builder.ts> [--supply N]
 *     [--held none:pass] [--starter none]
 *   bun run runs rehearse --name <seed> --id <comparison> <the flags of tools/d2/checkpoint.ts> ...
 *   bun run runs rehearse --name <seed> --no-comparison <the flags of tools/d2/session.ts> ...
 */
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import type { Control } from "#src/kernel/acceptance.ts";
import { DELIVERABLES, readAnswerFiles } from "#src/kernel/answer-files.ts";
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { examinerSessions, verdictsOf } from "#src/kernel/solves.ts";
import type { Task } from "#src/kernel/verify.ts";
import { type Examined, examine, type Session } from "#src/examiner/session.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isFunction, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { ANSWER_FILE } from "#src/tools/answer.ts";
import { selectedCodingTools } from "#src/tools/coding.ts";
import { openHarness } from "#src/harness/open.ts";
import { shellQuote } from "#src/wall/isolation.ts";
import { campaignLog, starter } from "../d2/campaign.ts";
import { stagedExamOf } from "../d2/exam.ts";
import { checkpointCommand } from "../d2/checkpoint.ts";
import { harnessBuilder } from "../d2/harness-builder.ts";
import type { Seated } from "../d2/round.ts";
import type { Reader } from "#src/referee/referee.ts";
import { sessionCommand } from "../d2/session.ts";
import { packControls } from "../m0/stored-sweep.ts";
import { Misused, SEED_FILE } from "./registry.ts";
import { codeLine } from "./seed.ts";

const ENDS = ["pass", "fail", "none"] as const;
type End = (typeof ENDS)[number];
interface Sides {
  readonly old: End;
  readonly fresh: End;
}
interface Script {
  readonly held: Sides;
  readonly starter: End;
}

interface DraftedSource {
  readonly graded: Control[];
  readonly later: Task[];
  readonly answered: Task[];
}

const COPY = "rehearsal_copy";

const OWN = new Set(["held", "starter", "supply", "no-comparison"]);

const TOOL_USE = { stopReason: "toolUse" } as const;
/** The meter refuses to run without a list price; what a rehearsal meters at it is no cost. */
const PRICE = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
const GUIDE = "harness/agent/BUILT_AGENTS.md";
const SUMMARISER = "You are a context summarization assistant.";

/** A seed's sessions number their tasks afresh, so a task is matched by what it asks, its id aside. */
const contentOf = ({ family, publicInput, hidden }: Task): string => {
  const record = asRecord(publicInput);
  const own =
    record === null
      ? publicInput
      : Object.fromEntries(Object.entries(record).filter(([key]) => key !== COPY));
  return hashJsonValue({ family, publicInput: own, hidden });
};

function passedOn(
  args: readonly string[],
  tokens: readonly { kind: string; index: number; name?: string; inlineValue?: boolean | undefined }[],
  own: ReadonlySet<string>,
): string[] {
  const dropped = new Set(
    tokens.flatMap(({ kind, index, name, inlineValue }) => {
      if (kind !== "option" || name === undefined || !own.has(name)) return [];
      return inlineValue === false ? [index, index + 1] : [index];
    }),
  );
  return args.filter((_, index) => !dropped.has(index));
}

export function sidesOf(flag: string): Sides {
  const [old, fresh, ...more] = flag.split(":").map(endOf);
  if (old === undefined || fresh === undefined || more.length > 0) {
    throw new Error(
      `${flag}: say how a solve ends under the reference harness and the new, each pass, fail or none, as none:pass`,
    );
  }
  return { old, fresh };
}

function endOf(word: string): End | undefined {
  return ENDS.find((end) => end === word);
}

function answersOf(graded: readonly Control[], log: string | null) {
  const verdicts = log === null ? [] : [...verdictsOf(read(log)).values()];
  const solved = verdicts.flatMap(({ task, answer, files, checker }) =>
    log === null || task === null || answer === undefined || checker === null || checker.kind === "faulty"
      ? []
      : [
          {
            taskId: task,
            answer,
            files: readAnswerFiles(log, files ?? []),
            refusedBy: checker.kind === "pass" ? null : "a check",
          },
        ],
  );
  const known = new Map<string, Partial<Record<"pass" | "fail", Control>>>();
  for (const control of [...graded, ...solved]) {
    const end = control.refusedBy === null ? "pass" : "fail";
    known.set(control.taskId, { [end]: control, ...known.get(control.taskId) });
  }
  return known;
}

/** A script that ran out fails as a provider would, so it is retried as a provider failure; a
 *  compaction's summary takes no turn of the script. */
function scripted(calls: readonly (readonly [string, JsonObject] | FauxResponseFactory)[], asked: number) {
  const faux = fauxProvider({
    models: [{ id: "script", contextWindow: 200_000, cost: PRICE }],
  });
  let next = 0;
  const answer: FauxResponseFactory = (context, ...rest) => {
    faux.appendResponses([answer]);
    const summarising = context.messages.some(
      ({ role, content }) => role === "system" && isString(content) && content.startsWith(SUMMARISER),
    );
    if (summarising) return fauxAssistantMessage("A scripted session holds nothing to summarise.");
    const at = next++;
    const call = calls[at];
    if (call !== undefined) {
      return isFunction(call)
        ? call(context, ...rest)
        : fauxAssistantMessage(fauxToolCall(call[0], call[1]), TOOL_USE);
    }
    if (at < calls.length + asked) return fauxAssistantMessage("The script holds no further call.");
    throw new Error("No more faux responses queued");
  };
  faux.setResponses([answer]);
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models };
}

function scriptedBuilder() {
  let [changed, compared, examined] = [false, false, false];
  const choose: FauxResponseFactory = (context) => {
    const last = JSON.stringify(context.messages.at(-1));
    const comparing = context.messages.some(
      (message) =>
        message.role === "system" &&
        message.toolsAdded?.some(({ name: tool }) => tool === "compare") === true,
    );
    if (compared && last.includes("Call examine") && !examined) {
      [changed, compared, examined] = [true, false, true];
      return fauxAssistantMessage(fauxToolCall("examine", {}), TOOL_USE);
    }
    const finish =
      compared ||
      (changed && !comparing) ||
      last.includes("no Examiner") ||
      last.includes("call finish again");
    const name = finish ? "finish" : changed ? "compare" : "bash";
    [changed, compared] = name === "bash" ? [true, false] : [false, name === "compare"];
    if (name === "finish") examined = false;
    const args =
      name === "bash"
        ? { command: `printf '\\nA rehearsal added this line.\\n' >> "$HOME/${GUIDE}"` }
        : { note: "The scripted Builder has no further action." };
    return fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE);
  };
  return scripted(
    Array.from({ length: 300 }, () => choose),
    0,
  );
}

function scriptedJudge(): Reader {
  const faux = fauxProvider({ models: [{ id: "script-judge", contextWindow: 200_000, cost: PRICE }] });
  const vote: FauxResponseFactory = (context) => {
    faux.appendResponses([vote]);
    const shown = JSON.stringify(context.messages);
    const [a, b] = [shown.indexOf("Answer A:"), shown.indexOf("Answer B:")];
    const [one, other] = [
      hashJsonValue(shown.slice(a, b)).slice(-8),
      hashJsonValue(shown.slice(b)).slice(-8),
    ];
    const better = one === other ? "neither" : one < other ? "A" : "B";
    return fauxAssistantMessage(fauxToolCall("record_vote", { better, reason: "scripted" }), TOOL_USE);
  };
  faux.setResponses([vote]);
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), effort: "medium", models: () => models };
}

export function scriptedSeats(script: Script, graded: readonly Control[], strayed: string[]): Seated {
  return (campaign, { reference }) => {
    const folder = dirname(campaign.log);
    if (!existsSync(join(folder, SEED_FILE))) {
      throw new Error(
        `${folder} is no seed: a rehearsal writes scripted solves, which a campaign's next round would count. Copy it first with bun run runs seed`,
      );
    }
    const answers = answersOf(graded, campaign.log);
    const least = starter(campaign);
    const writers = new Map<string, Promise<readonly string[]>>();
    const selectedOf = (dir: string) => {
      const known = writers.get(dir) ?? openHarness(dir).then(({ presets }) => selectedCodingTools(presets));
      writers.set(dir, known);
      return known;
    };
    const sideOf = async (dir: string) =>
      dir === reference ? "old" : dir === (await least).dir ? "starter" : "new";
    return {
      builder: scriptedBuilder(),
      judge: scriptedJudge(),
      setting: campaign.setting({ ...campaign.test, ...scripted([], 0) }),
      solve: async (task, harness, kill, comparison) => {
        const side = await sideOf(harness.dir);
        const admission = examinerSessions(read(campaign.log)).has(comparison);
        const wanted = admission
          ? script.held.old
          : { old: script.held.old, new: script.held.fresh, starter: script.starter }[side];
        const copied = asRecord(asRecord(task.publicInput)?.[COPY])?.of;
        const known = {
          ...(isString(copied) ? answers.get(copied) : undefined),
          ...answers.get(task.taskId),
          ...answers.get(contentOf(task)),
        };
        const control = wanted === "none" ? undefined : known[wanted];
        const answer = asRecord(control?.answer);
        const missing = wanted !== "none" && answer === null;
        if (missing) {
          strayed.push(
            `${task.taskId} has no answer on record that the checks ${wanted === "pass" ? "accepted" : "rejected"}, so the script gave none`,
          );
        }
        const selected = await selectedOf(harness.dir);
        const put = (path: string, content: string): readonly [string, JsonObject] => {
          // A delivered file goes by `write` where the harness selects it: a command is one argument of
          // its shell, which holds 128 KiB on Linux.
          const shell = selected.includes("bash") && (path === ANSWER_FILE || !selected.includes("write"));
          if (!shell) return ["write", { path, content }];
          const made = path === ANSWER_FILE ? "" : `mkdir -p "$(dirname ${shellQuote(path)})" && `;
          const into = path === ANSWER_FILE ? path : shellQuote(path);
          return ["bash", { command: `${made}printf %s ${shellQuote(content)} > ${into}` }];
        };
        // The files the answer delivered go under the folder submit captures, the text ones alone:
        // a check that reads a binary one names the solve as strayed.
        const delivered = (control?.files ?? []).flatMap(({ path, text }) =>
          text === undefined ? [] : [put(`${DELIVERABLES.folder}/${path}`, text)],
        );
        const by = scripted(
          [
            ...(answer === null ? [] : [...delivered, put(ANSWER_FILE, JSON.stringify(answer))]),
            ["submit", {}],
          ],
          campaign.limits.turns + 1,
        );
        const done = await campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill, comparison);
        const { ending } = done;
        const failed: readonly string[] = {
          pass: [],
          fail: ["rejected"],
          none: ["no-answer", "turns-ended"],
        }[wanted];
        const held =
          failed.length === 0
            ? ending.outcome === "pass"
            : ending.outcome === "fail" && failed.includes(ending.kind);
        if (!held && !missing) {
          strayed.push(
            `${done.solve}: ${task.taskId} under the ${side === "starter" ? "starter" : `${side === "old" ? "reference" : "new"} harness`} was scripted to ${wanted === "none" ? "give no answer" : wanted} and ended ${JSON.stringify(ending)}`,
          );
        }
        return done;
      },
    };
  };
}

function draftedSource(name: string): DraftedSource {
  const log = campaignLog(name);
  const staged = stagedExamOf(log);
  if (staged === null) {
    throw new Error(
      `campaign ${name} holds no exam of its own, and a rehearsal scripts answers from a drafted exam`,
    );
  }
  const seed = asRecord(capturedJsonParse(readFileSync(join(dirname(log), SEED_FILE), "utf8")));
  const sourceLog = isString(seed?.from) ? join(seed.from, LOG_FILE) : null;
  const source = sourceLog === null ? [] : read(sourceLog);
  const asked = new Map(
    proposalsOf(source).flatMap(({ task }) => (task === null ? [] : [[task.taskId, contentOf(task)]])),
  );
  const passes = [...verdictsOf(source).values()].flatMap(({ task, answer, files, checker }) => {
    const content = task === null ? undefined : asked.get(task);
    return content !== undefined && answer !== undefined && checker?.kind === "pass" && sourceLog !== null
      ? [{ taskId: content, answer, files: readAnswerFiles(sourceLog, files ?? []), refusedBy: null }]
      : [];
  });
  const held = new Set(proposalsOf(read(log)).map(({ version }) => version));
  const later = proposalsOf(source).flatMap(({ version, task, session }) =>
    task !== null && session !== null && !held.has(version) ? [task] : [],
  );
  const passed = new Set(passes.map(({ taskId }) => taskId));
  const answered = proposalsOf(source).flatMap(({ task }) =>
    task !== null && passed.has(contentOf(task)) ? [task] : [],
  );
  return { graded: [...packControls(staged.bundle), ...passes], later, answered };
}

function scriptedExaminer(
  later: Task[],
  answered: readonly Task[],
  supply: number,
  graded: readonly Control[],
): Session<"write"> {
  const answers = answersOf(graded, null);
  let copies = 0;
  const callsFor = (wanted: number): (readonly [string, JsonObject])[] => {
    const own = later.splice(0, wanted);
    const copied: Task[] = [];
    while (own.length + copied.length < wanted && copies < supply && answered.length > 0) {
      const source = answered[copies % answered.length];
      if (source === undefined) break;
      copies += 1;
      copied.push({
        ...source,
        publicInput: { ...asRecord(source.publicInput), [COPY]: { of: source.taskId, n: copies } },
      });
    }
    const batch = [...own, ...copied].map(({ family, publicInput, hidden }) => ({
      family,
      public_input: publicInput,
      hidden: hidden ?? null,
    }));
    return [
      ...[...own, ...copied].flatMap((task, index): (readonly [string, JsonObject])[] => {
        const source = asRecord(asRecord(task.publicInput)?.[COPY])?.of;
        const answer =
          answers.get(contentOf(task))?.pass ?? (isString(source) ? answers.get(source)?.pass : undefined);
        const instance = batch[index];
        return instance === undefined || answer === undefined
          ? []
          : [["try_answer", { ...instance, answer: answer.answer }]];
      }),
      ...(batch.length === 0 ? [] : [["propose_tasks", { tasks: batch }] as const]),
      // Twice, since a first finish before the host has the tasks it needs is declined once.
      ...Array.from(
        { length: 2 },
        () =>
          [
            "finish",
            { note: batch.length === 0 ? "The source holds no further task." : "The source's next tasks." },
          ] as const,
      ),
    ];
  };
  return (request, wall) => {
    const queue = callsFor(request.wanted);
    const pull: FauxResponseFactory = () => {
      const call = queue.shift();
      if (call === undefined) throw new Error("No more faux responses queued");
      return fauxAssistantMessage(fauxToolCall(call[0], call[1]), TOOL_USE);
    };
    const turns = queue.map(() => pull);
    const { rest } = request;
    const woken =
      rest === undefined
        ? undefined
        : async (examined: Examined) => {
            const ask = await rest(examined);
            if (ask !== null) {
              queue.splice(0, queue.length, ...callsFor(ask.wanted));
              turns.push(...queue.map(() => pull));
            }
            return ask;
          };
    return examine({ ...request, ...scripted(turns, 0), rest: woken }, wall);
  };
}

export async function rehearse(args: readonly string[]): Promise<void> {
  const { values, tokens } = parseArgs({
    args: [...args],
    strict: false,
    tokens: true,
    options: {
      held: { type: "string", default: "none:pass" },
      starter: { type: "string", default: "none" },
      supply: { type: "string", default: "0" },
      "no-comparison": { type: "boolean", default: false },
      id: { type: "string" },
      name: { type: "string" },
      builder: { type: "string" },
      solver: { type: "string" },
      reviewer: { type: "string" },
    },
  });
  const { held } = values;
  const least = isString(values.starter) ? endOf(values.starter) : undefined;
  const seated = (["builder", "solver", "reviewer"] as const).filter((seat) => values[seat] !== undefined);
  if (seated.length > 0) {
    // A reviewer named here would be a live one, paid to read scripted fails.
    throw new Error(`a rehearsal seats no model: drop --${seated.join(", --")}`);
  }
  if (!isString(held) || least === undefined || !isString(values.name)) throw new Misused();
  const drafted = draftedSource(values.name);
  const seeded = dirname(campaignLog(values.name));
  if (existsSync(join(seeded, SEED_FILE))) {
    console.log(codeLine(resolve(import.meta.dir, "..", ".."), seeded));
  }
  const { graded } = drafted;
  const strayed: string[] = [];
  const seats = scriptedSeats({ held: sidesOf(held), starter: least }, graded, strayed);
  const flags = passedOn(args, tokens, OWN);
  try {
    if (values["no-comparison"] !== true && !isString(values.id)) {
      await harnessBuilder(flags, {
        seated: seats,
        // The opening a seed copied names its source's reviewer, a live model.
        unreviewed: true,
        examine: scriptedExaminer(drafted.later, drafted.answered, Number(values.supply), graded),
      });
    } else if (isString(values.id)) await checkpointCommand(flags, seats);
    else if ((await sessionCommand(flags, seats)) === null) {
      strayed.push("the Builder's script left the harness as it was");
    }
  } catch (error) {
    for (const each of strayed) console.error(`⚠ ${each}`);
    throw error;
  }
  if (strayed.length === 0) {
    console.log("the rehearsal went as scripted");
    return;
  }
  for (const each of strayed) console.error(`⚠ ${each}`);
  console.error("the rehearsal did not go as scripted: read each named solve's trace in the log");
  runtimeProcess.exitCode = 1;
}
