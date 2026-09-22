/** A segmented prompt driver over the ordinary Builder turn boundary. Labels identify steps only. */
import { PRIMARY_AUTHOR_PATHS, authoringIdentity } from "#src/author/author-first.ts";
import { openBuildSession } from "#src/author/build-agent.ts";
import { runBuilderTurn, turnEventRecorder, type BuilderTurnState } from "#src/author/builder-turn-loop.ts";
import type { BuilderExecutionRecorder } from "#src/author/builder-execution.ts";
import type { HostSession } from "#src/backends/pi-session.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import type { ModelAttemptGate } from "#src/run/campaign-budget.ts";
import type { SegmentCall } from "./segment-loop.mts";

export function segmentActor(input: {
  open: () => Promise<HostSession>;
  workspace: string;
  recorder: BuilderExecutionRecorder;
  attemptGate: ModelAttemptGate;
  maxTurns: number;
  turnTimeoutMs?: number;
  waitMs?: (ms: number) => Promise<void>;
}) {
  let session: HostSession | undefined;
  let turn = 0;
  // The turn loop's next-turn prompt reads these; the segments send their own prompts instead.
  const openedAtMs = Date.now();
  const paths = PRIMARY_AUTHOR_PATHS;
  const authoring = {
    workspace: input.workspace,
    paths,
    openingIdentity: authoringIdentity({ workspace: input.workspace, paths }),
  };
  const state: BuilderTurnState = {
    accepted: null,
    attempts: 0,
    lastRefusal: [],
    activeTurn: 0,
    terminal: false,
    terminalClause: null,
    idleTurns: 0,
  };
  return {
    async agent(call: SegmentCall) {
      input.attemptGate.assertAttemptAvailable();
      session ??= await openBuildSession(input.open);
      let text = "";
      await runBuilderTurn({
        session,
        state,
        recorder: input.recorder,
        prompt: call.prompt,
        kickoff: call.prompt,
        turn: ++turn,
        maxTurns: input.maxTurns,
        onTurnEvent: turnEventRecorder(input.recorder, () => {}),
        checkpoint() {},
        onTurnCompleted(_turn, result) {
          text = result.assistantText ?? "";
        },
        attemptGate: input.attemptGate,
        authoring,
        openedAtMs,
        ...keyIfDefined("turnTimeoutMs", input.turnTimeoutMs),
        ...keyIfDefined("waitMs", input.waitMs),
      });
      return text;
    },
    async dispose() {
      await session?.dispose();
    },
  };
}
