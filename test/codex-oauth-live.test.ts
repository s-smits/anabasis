import { expect, it } from "bun:test";

import type { AgentTurnEvent } from "../src/backends/backend-types.ts";
import type { PiBuiltStart } from "../src/backends/pi-built-child.ts";
import { startPiBuiltWorker, type PiBuiltWorkerBundle } from "../src/backends/pi-built-process.ts";
import { preflightPiBuilt, resolvePiBuiltRuntime } from "../src/backends/pi-built.ts";
import { sha256 } from "../src/meta/digest.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { hashJsonBytes } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import type { ResolvedSlots, SlotChoice } from "../src/backends/resolve.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { builtAgentInterface, starterRegistration } from "../src/solve/built-starter.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/correctness-bundle/harness-config.ts";

const runLive = Bun.env.ANA_RUN_CODEX_OAUTH_LIVE === "1";

function codexSlots(model: string): ResolvedSlots {
  const built: SlotChoice = {
    kind: "codex",
    model,
    reasoningEffort: "xhigh",
    source: "operator",
  };
  return {
    slug: "codex-oauth-live",
    builder: built,
    built,
    review: { enabled: false, source: "unconfigured" },
    operatorConfig: null,
  };
}

async function bundleWorker(): Promise<PiBuiltWorkerBundle> {
  const dir = mkdtempSync(join(tmpdir(), "ana-codex-oauth-live-"));
  const file = join(dir, "worker.mjs");
  const built = await Bun.build({
    entrypoints: [Bun.fileURLToPath(new URL("../src/backends/pi-built-child.ts", import.meta.url))],
    outdir: dir,
    naming: "worker.mjs",
    target: "bun",
    format: "esm",
    splitting: false,
    sourcemap: "none",
  });
  if (!built.success) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`live Codex worker bundle failed: ${built.logs.map((log) => log.message).join("; ")}`);
  }
  return { file, dir, digest: sha256(await Bun.file(file).bytes()) };
}

it.if(runLive)(
  "opens the confined Pi OpenAI-Codex OAuth model without a provider turn",
  async () => {
    const neutralRoot = mkdtempSync(join(tmpdir(), "ana-codex-oauth-preflight-"));
    try {
      const runtime = resolvePiBuiltRuntime(
        codexSlots(Bun.env.ANA_CODEX_OAUTH_MODEL ?? "gpt-5.6-sol"),
        neutralRoot,
        builtSolveIsolation(neutralRoot),
        { CODEX_HOME: Bun.env.CODEX_HOME, HOME: Bun.env.HOME, PATH: Bun.env.PATH },
      );
      const evidence = await preflightPiBuilt(runtime);
      expect(evidence.modelSelection.resolvedModel).toBe(runtime.profile.model);
      expect(evidence.modelSelection.effort).toBe(runtime.profile.thinkingLevel);
      expect(evidence.confinedPid).not.toBe(evidence.controllerPid);
    } finally {
      rmSync(neutralRoot, { recursive: true, force: true });
    }
  },
  60_000,
);

it.if(runLive)(
  "runs one real prompt through the confined Pi OpenAI-Codex OAuth transport",
  async () => {
    const model = Bun.env.ANA_CODEX_OAUTH_MODEL ?? "gpt-5.6-sol";
    const neutralRoot = mkdtempSync(join(tmpdir(), "ana-codex-oauth-root-"));
    const bundle = await bundleWorker();
    try {
      const runtime = resolvePiBuiltRuntime(
        codexSlots(model),
        neutralRoot,
        builtSolveIsolation(neutralRoot),
        {
          CODEX_HOME: Bun.env.CODEX_HOME,
          HOME: Bun.env.HOME,
          PATH: Bun.env.PATH,
        },
      );
      const contract = builtAgentInterface(
        [],
        starterRegistration([]),
        null,
        DEFAULT_HARNESS_SETTINGS.solveMs,
      );
      const prompt = "Return only this exact token, with no punctuation or explanation: LIVE_CODEX_OAUTH_OK";
      const start: Omit<PiBuiltStart, "workerInstanceId"> = {
        type: "start",
        profile: runtime.profile,
        credential: await runtime.auth(),
        contract,
        prompt,
        nudge: "",
        maxTurns: 1,
      };
      const events: AgentTurnEvent[] = [];
      // The identity now rides the turn that produced it, so the count of attested turns is read
      // from `turn_end` rather than from `done`.
      let attestedTurns = 0;
      const result = await startPiBuiltWorker({
        runtime,
        bundle,
        start,
        conditionDigest: hashJsonBytes({
          profile: start.profile,
          contract: start.contract,
          promptDigest: sha256(start.prompt),
          nudgeDigest: sha256(start.nudge),
          maxTurns: start.maxTurns,
          fakeResponsesDigest: null,
        }),
        tools: new Map(),
        onMessage: (message) => {
          if (message.type === "event") events.push(message.event);
          if (message.type === "turn_end" && message.identity !== undefined) attestedTurns += 1;
        },
      });
      const assistantText = events
        .values()
        .filter(
          (event): event is Extract<AgentTurnEvent, { type: "assistant_text" }> =>
            event.type === "assistant_text",
        )
        .map((event) => event.delta)
        .toArray()
        .join("");
      expect(result.done.errors).toEqual([]);
      expect(attestedTurns).toBe(1);
      expect(assistantText.trim()).toBe("LIVE_CODEX_OAUTH_OK");
    } finally {
      rmSync(bundle.dir, { recursive: true, force: true });
      rmSync(neutralRoot, { recursive: true, force: true });
    }
  },
  300_000,
);
