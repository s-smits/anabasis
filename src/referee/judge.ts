import { type Static, Type } from "typebox";
import type { Contract, TaskCriterion } from "../kernel/contract.ts";
import { dossierOf, extract } from "../kernel/extract.ts";
import { append, eventsOf, type LogEvent, read, TRACE_KINDS } from "../kernel/log.ts";
import type { Task } from "../kernel/verify.ts";
import { boundText } from "../meta/bounded-text.ts";
import { sha256 } from "../meta/digest.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { ending, text, tool } from "../tools/answer.ts";
import { boundPublicInput, loggedVerdict, type Reader, runRefereeSession } from "./referee.ts";

const BRIEFED = "referee.brief";
const PAIRED = "referee.pair";
const HOLISTIC = "holistic";
const SECONDS = 600;
const TURNS = 3;
const ANSWER_BYTES = 24_000;
const LINE_BYTES = 240;
const VOTE = { A: 1, B: -1, neither: 0 } as const;

interface Criterion extends TaskCriterion {
  readonly weight: number;
}

interface JudgeCase {
  readonly log: string;
  readonly comparison: string;
  readonly task: Task;
  readonly contract: Contract;
}

export interface Asked {
  readonly comparison: string;
  readonly first: string;
  readonly second: string;
}

interface PairCase extends JudgeCase, Asked {}

function criteriaOf(contract: Contract, task: Task): Criterion[] {
  if (task.rubric !== undefined && task.rubric.length > 0) {
    return task.rubric.map(({ id, criterion }) => ({ id, criterion, weight: 1 }));
  }
  return (contract.objective?.items ?? []).flatMap((item) =>
    item.kind === "judge" ? [{ id: item.id, criterion: item.criterion, weight: item.weight }] : [],
  );
}

const briefOf = (events: readonly LogEvent[], task: string): readonly string[] | null => {
  const data = eventsOf(events, BRIEFED).findLast(({ event }) => event.data.task === task)?.event.data;
  return Array.isArray(data?.expectations) ? data.expectations.filter(isString) : null;
};

const BRIEF_SYSTEM = [
  "You prepare the grading brief for one task of an exam, before any answer to it exists.",
  "From the task's public input, its hidden values and the criteria it is judged on, write what a strong answer to this task shows: concrete expectations a grader can look for in an answer, each grounded in the input or the hidden values.",
  "Write expectations, never a single model answer: a task can have more than one strong answer, and each expectation should hold for any of them.",
  "Where a criterion cannot be judged from an answer at all, or code could decide it exactly, say so in a flag. Flags are advisory and change no score.",
].join("\n");

const PAIR_SYSTEM = [
  "You compare two answers, A and B, to one task of an exam on a single criterion, and record which answer meets it better, or that neither does.",
  "Judge the substance the criterion names. Length, formatting and confident tone are not substance: an answer is not better for being longer or more polished.",
  "Choose neither when the answers meet the criterion equally well or equally badly, and say which in kind.",
].join("\n");

const HOLISTIC_LINE =
  "Overall, which answer would serve the person who set this task better, judged on substance? Count padding, repetition, hedging and decoration against an answer; polish alone counts for nothing.";

const BRIEF_PARAMETERS = Type.Object({
  expectations: Type.Array(Type.String({ minLength: 1, maxLength: LINE_BYTES }), {
    minItems: 2,
    maxItems: 8,
  }),
  flags: Type.Array(Type.String({ minLength: 1, maxLength: LINE_BYTES }), { maxItems: 4 }),
});

const VOTE_PARAMETERS = Type.Object({
  better: Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("neither")]),
  kind: Type.Optional(
    Type.Union([Type.Literal("both-strong"), Type.Literal("both-weak"), Type.Literal("mixed")], {
      description:
        "Only with neither: whether both answers meet the criterion, both miss it, or each meets part.",
    }),
  ),
  reason: Type.String({ minLength: 1, maxLength: 400 }),
});

function taskLines({ task, contract }: JudgeCase, hidden: boolean): string[] {
  return [
    `Scope of the exam: ${contract.scope}`,
    `The task (${task.family}): ${capturedJsonStringify(boundPublicInput(task.publicInput))}`,
    ...(hidden ? [`Its hidden values: ${capturedJsonStringify(boundPublicInput(task.hidden))}`] : []),
  ];
}

interface Spend {
  readonly billed: number;
  readonly turns: number;
  readonly reportedCost: number | null;
}

const spendOf = (
  meters: readonly {
    readonly billed: number;
    readonly turns: number;
    readonly reportedCost: number | null;
  }[],
): Spend => ({
  billed: meters.reduce((sum, { billed }) => sum + billed, 0),
  turns: meters.reduce((sum, { turns }) => sum + turns, 0),
  reportedCost: meters.every(({ reportedCost }) => isNumber(reportedCost))
    ? meters.reduce((sum, { reportedCost }) => sum + (reportedCost ?? 0), 0)
    : null,
});

export async function judgeBrief(reader: Reader, given: JudgeCase): Promise<void> {
  if (briefOf(read(given.log), given.task.taskId) !== null) return;
  const criteria = criteriaOf(given.contract, given.task);
  const kept: Static<typeof BRIEF_PARAMETERS>[] = [];
  const id = `judge-${crypto.randomUUID()}`;
  const meter = await runRefereeSession({
    id,
    reader,
    system: BRIEF_SYSTEM,
    opening: [
      ...taskLines(given, true),
      `The criteria it is judged on:\n${criteria.map(({ id: one, criterion }) => `- ${one}: ${criterion}`).join("\n")}`,
    ].join("\n\n"),
    tools: [
      tool({
        name: "record_brief",
        description: "Record the brief's expectations and any advisory flags.",
        parameters: BRIEF_PARAMETERS,
        execute: async (args) => {
          kept.push(args);
          return ending(text("Recorded."));
        },
      }),
    ],
    log: given.log,
    over: () => kept.length > 0,
    most: TURNS,
    defaultSeconds: SECONDS,
    next: "Nothing is recorded until you call record_brief.",
  });
  const brief = kept.at(-1);
  if (brief === undefined) throw new Error(`the judge wrote no brief for task ${given.task.taskId}`);
  append(given.log, BRIEFED, {
    comparison: given.comparison,
    task: given.task.taskId,
    reader: id,
    expectations: brief.expectations,
    flags: brief.flags,
    ...spendOf([meter]),
  });
}

function answerOf(events: readonly LogEvent[], log: string, solve: string, seed: string): string {
  const verdict = loggedVerdict(events, solve, log);
  if (verdict === null) throw new Error(`solve ${solve} has no answer on record to judge`);
  const files = verdict.files.map((file) => dossierOf(extract(file), `${seed}:${file.path}`));
  const whole = [`answer: ${capturedJsonStringify(verdict.answer)}`, ...files].join("\n\n");
  return boundText(whole, ANSWER_BYTES).text;
}

async function voted(
  reader: Reader,
  given: PairCase & { readonly id: string; readonly lines: readonly string[] },
  criterion: string,
  [a, b]: readonly [string, string],
) {
  const kept: Static<typeof VOTE_PARAMETERS>[] = [];
  const meter = await runRefereeSession({
    id: given.id,
    reader,
    system: PAIR_SYSTEM,
    opening: [...given.lines, `The criterion: ${criterion}`, `Answer A:\n${a}`, `Answer B:\n${b}`].join(
      "\n\n",
    ),
    tools: [
      tool({
        name: "record_vote",
        description: "Record which answer meets the criterion better, or neither.",
        parameters: VOTE_PARAMETERS,
        execute: async (args) => {
          kept.push(args);
          return ending(text("Recorded."));
        },
      }),
    ],
    log: given.log,
    over: () => kept.length > 0,
    most: TURNS,
    defaultSeconds: SECONDS,
    next: "Nothing is recorded until you call record_vote.",
  });
  return { vote: kept.at(-1) ?? null, meter };
}

export async function judgePair(reader: Reader, given: PairCase): Promise<void> {
  const events = read(given.log, TRACE_KINDS);
  const brief = briefOf(events, given.task.taskId);
  if (brief === null) throw new Error(`task ${given.task.taskId} has no brief to judge its answers against`);
  const seed = `${given.comparison}:${given.first}:${given.second}`;
  const answers = [given.first, given.second].map((solve) => answerOf(events, given.log, solve, seed));
  const [first = "", second = ""] = answers;
  const firstIsA = Number.parseInt(sha256(seed).slice(0, 1), 16) % 2 === 0;
  const id = `judge-${crypto.randomUUID()}`;
  const criteria = [
    ...criteriaOf(given.contract, given.task),
    { id: HOLISTIC, criterion: HOLISTIC_LINE, weight: 0 },
  ];
  const sessions = criteria.flatMap(({ id: one, criterion }) =>
    [firstIsA, !firstIsA].map(async (aIsFirst) => {
      const lines = taskLines(given, false);
      const shown =
        one === HOLISTIC
          ? lines
          : [...lines, `What a strong answer shows:\n${brief.map((line) => `- ${line}`).join("\n")}`];
      const order: [string, string] = aIsFirst ? [first, second] : [second, first];
      const { vote, meter } = await voted(reader, { ...given, id, lines: shown }, criterion, order);
      const sign = vote === null ? null : VOTE[vote.better] * (aIsFirst ? 1 : -1);
      return { one, sign, kind: vote?.kind ?? null, meter };
    }),
  );
  const passes = await Promise.all(sessions);
  const spend = spendOf(passes.map(({ meter }) => meter));
  if (passes.some(({ sign }) => sign === null)) {
    throw new Error(`the judge recorded no vote on ${given.first} against ${given.second}`);
  }
  const mean = (one: string) => {
    const signs = passes.flatMap((pass) => (pass.one === one && pass.sign !== null ? [pass.sign] : []));
    return signs.reduce((sum, sign) => sum + sign, 0) / Math.max(1, signs.length);
  };
  const scored = criteria.filter(({ id: one }) => one !== HOLISTIC);
  const weight = scored.reduce((sum, { weight: own }) => sum + own, 0);
  const ties = Object.fromEntries(
    criteria.flatMap(({ id: one }) => {
      const own = passes.filter((pass) => pass.one === one);
      const [p1, p2] = own.map(({ sign }) => sign ?? 0);
      if (p1 !== undefined && p2 !== undefined && p1 * p2 < 0) return [[one, "swap-disagreed"]];
      const kinds = own.flatMap(({ sign, kind }) => (sign === 0 && kind !== null ? [kind] : []));
      return kinds.length === own.length && kinds[0] !== undefined ? [[one, kinds[0]]] : [];
    }),
  );
  append(given.log, PAIRED, {
    comparison: given.comparison,
    task: given.task.taskId,
    solve: given.first,
    old: given.second,
    reader: id,
    judge:
      weight === 0 ? 0 : scored.reduce((sum, { id: one, weight: own }) => sum + own * mean(one), 0) / weight,
    holistic: mean(HOLISTIC),
    criteria: Object.fromEntries(criteria.map(({ id: one }) => [one, mean(one)])),
    ties,
    ...spend,
  });
}
