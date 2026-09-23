/**
 * A scripted transport for the Builder session driver, and the two candidate-check outcomes every
 * case scripts against.
 *
 * `runBuilderSession` needs three things it does not own: a backend that opens sessions, a submit
 * implementation, and a roster of hosted tools. `scriptedOpener` supplies the first as a list of
 * turns — each one a function that may call the hosted tools the driver generated, exactly as a
 * real backend does in-process — and records what the session was opened and prompted with.
 *
 * Four of the eight `builder-session-*.test.ts` files import this module — kickoff, record,
 * refusal and turns — so a change here does not reach the other four. Three of those never open a
 * session at all, but `builder-session-stall.test.ts` does, against an opener it scripts itself,
 * which is the one to check by hand. The module carries what more than one importer needs; a tool
 * double or a finding batch a single file uses stays in that file.
 */
import type { JsonValue } from "../../src/meta/json-shape.ts";
import type { AgentTurnEvent, AgentTurnResult } from "../../src/backends/backend-types.ts";
import type { HostSession, PiTool } from "../../src/backends/pi-session.ts";
import type { BuilderSessionDeps } from "../../src/author/builder-session.ts";
import type { CandidateCheckOutcome } from "../../src/author/candidate-check.ts";
import type { FingerprintEvidence } from "../../src/claim/fingerprint.ts";
import { controllerValidatedFinding } from "../../src/truth/brief.ts";
import { required, scriptedSession } from "./doubles.ts";
import { MATCHING_BRIEF } from "./matching-fixture.ts";

export const FINGERPRINT = {
  ok: true,
  slug: "matching",
  agentHash: "a".repeat(64),
  correctnessModelHash: "b".repeat(64),
  scoringHash: "b".repeat(64),
  taskSetHash: "c".repeat(64),
  agentFiles: [],
  correctnessModelFiles: [],
} satisfies FingerprintEvidence;

export const ACCEPTED: CandidateCheckOutcome = {
  ok: true,
  fingerprint: FINGERPRINT,
  commit: "d".repeat(40),
  baseCommit: "e".repeat(40),
  changedPaths: ["correctness-model/brief.json"],
  deletedPaths: [],
  snapshotDir: "/controller/bundleSnapshot",
  snapshotId: "bundleSnapshot-id",
  bundle: {
    brief: MATCHING_BRIEF,
    battery: { tasks: [] },
    corpus: { accept: [], reject: [] },
    toolsSpec: { presets: [], tools: [] },
  },
  engineCondition: null,
  verifierEnvironmentHash: null,
  advisories: [],
};

export const REFUSED: CandidateCheckOutcome = {
  ok: false,
  stage: "bundle",
  findings: [
    controllerValidatedFinding({
      code: "missing-bundle-file",
      path: "correctness-model/tasks.json",
      detail: "absent",
    }),
  ],
  commit: "d".repeat(40),
};

export interface SubmitTool {
  name?: string;
  execute(
    toolCallId: string,
    args: Record<string, JsonValue>,
  ): Promise<{ content: Array<{ text: string }>; terminate?: boolean }>;
}

/** A scripted transport: each turn entry may invoke the hosted submit tool (as a real backend
 *  would in-process) before the turn result returns. */
export type TurnScript = (
  submit: SubmitTool,
  tools: readonly PiTool[],
  emit: (event: AgentTurnEvent) => void,
) => Partial<AgentTurnResult> | undefined | Promise<Partial<AgentTurnResult> | undefined>;

/** What one scripted session records about how it was opened and used. */
export type OpenedSession = {
  tools: readonly PiTool[];
  systemPrompt: string;
  disposed: number;
  prompts: string[];
  /** Each `configure` a continued conversation made, in order. */
  configured: Array<{ tools: readonly PiTool[]; systemPrompt: string }>;
};

export const INPUT = { slug: "matching", kickoff: "Build a slot binding harness.", workspace: "/tmp/ws" };

/** Find a hosted tool by name in the roster the session receives. */
export function toolNamed(tools: readonly unknown[], name: string): SubmitTool | undefined {
  // SAFETY: the driver hands the transport its generated tool records, and the marker fixtures in
  // the test files are written the same way, so every entry answers to `name`.
  return tools.map((tool) => tool as SubmitTool).find((tool) => tool.name === name);
}

/** An opener that plays `turns` in order and records what it was opened with. Named for what it
 *  returns: `scriptedSession` in doubles.ts is the session itself, and this hands one out. */
export function scriptedOpener(turns: TurnScript[]) {
  const opened: OpenedSession = { tools: [], systemPrompt: "", disposed: 0, prompts: [], configured: [] };
  const open = async (tools: readonly PiTool[], systemPrompt: string): Promise<HostSession> => {
    opened.tools = tools;
    opened.systemPrompt = systemPrompt;
    let turn = 0;
    return scriptedSession(
      async ({ prompt, onEvent }) => {
        opened.prompts.push(prompt);
        const script = turns[turn++];
        const submit = required(toolNamed(opened.tools, "submit"), "the hosted submit tool");
        const overrides =
          script === undefined ? {} : ((await script(submit, opened.tools, onEvent ?? (() => {}))) ?? {});
        return { status: "completed", assistantText: "worked", ...overrides };
      },
      () => {
        opened.disposed += 1;
      },
      (next, framing) => {
        opened.configured.push({ tools: next, systemPrompt: framing });
        opened.tools = next;
        opened.systemPrompt = framing;
      },
    );
  };
  return { open, opened };
}

export function deps(
  open: BuilderSessionDeps["open"],
  submit: BuilderSessionDeps["submit"],
  tools: readonly PiTool[] = [],
): BuilderSessionDeps {
  // A failed turn is retried on a growing backoff; no driver test spends that wall clock.
  return { open, tools, submit, waitMs: async () => {} };
}
