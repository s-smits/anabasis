// Draft acceptance and measurement are independent facts. Controlled probes retain the first
// parent cancellation through invocation cleanup; the real solver logs active children where
// the OS wall is available. Queued probes use the production host launcher and create no solve.
import { afterAll, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Draft } from "../src/examiner/draft.ts";
import { examine } from "../src/examiner/session.ts";
import { read } from "../src/kernel/log.ts";
import { solvesIn } from "../src/kernel/solves.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { dirname, join } from "../src/meta/path.ts";
import { judge, type Played, solve, type SolveRequest } from "../src/solver/run.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { probing } from "../tools/d1b/examine.ts";
import type { Campaign } from "../tools/d2/round.ts";
import { gated } from "../tools/d2/host.ts";
import { settingAsked } from "../tools/d2/setting.ts";
import { drafted, EXAMPLE, SOUND, seat, sweep } from "./helpers/examiner-seat.ts";

const MEASURED = { budget: { modelTurns: 20, minutes: 30 }, examples: ["no reading", "valid", "invalid"] };
const PLAYED: Played = {
  crash: null,
  broken: null,
  harness: null,
  turns: [],
  prompts: 1,
  submitted: undefined,
  flagged: undefined,
  wallEnded: false,
  silentSeconds: 0,
  turnsEnded: false,
  moved: false,
  homeBytes: 0,
};
const walled = osIsolationSupport().ok;
afterAll(sweep);

/** Waits for a controlled cancellation without keeping an abort listener after settlement. */
async function stopped(signal: AbortSignal) {
  if (signal.aborted) return;
  const wait = Promise.withResolvers<void>();
  const abort = () => wait.resolve();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await wait.promise;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function solver(s: ReturnType<typeof seat<"draft">>, kill?: AbortSignal): SolveRequest {
  return {
    id: `draft-${dirname(s.log).split("/").at(-1) ?? "fixture"}`,
    condition: "fixture",
    task: EXAMPLE,
    contract: { ...SOUND, answerFormat: SOUND.answerFormat },
    harness: new URL("fixtures/harness-min", import.meta.url).pathname,
    resources: [],
    model: s.request.model,
    effort: "medium",
    limits: {
      wallSeconds: 600,
      turns: 3,
      shellDefaultSeconds: 30,
      shellMaxSeconds: 60,
      concurrency: 1,
    },
    models: s.request.models,
    verify: async () => ({ kind: "pass" }),
    log: s.log,
    repoRoot: dirname(s.log),
    comparison: s.request.id,
    ...keyIfDefined("kill", kill),
  };
}

for (const origin of ["session-wall", "caller"] as const) {
  it(`keeps a sound draft with interrupted measurement after ${origin} and latches that first source`, async () => {
    const s = seat("draft", [drafted(SOUND)]);
    const kill = new AbortController();
    const ready = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const running = examine({
      ...s.request,
      kill: kill.signal,
      limits: { ...s.request.limits, wallSeconds: origin === "session-wall" ? 0.1 : 600 },
      measure: async (_draft, signal) => {
        ready.resolve(signal);
        await stopped(signal);
        await release.promise;
        return null;
      },
    });
    const signal = await ready.promise;
    if (origin === "caller") kill.abort(new Error("unlabelled caller stop"));
    await stopped(signal);
    // A later caller stop and normal seat cleanup cannot replace the first wall origin. The wall
    // is followed by the agent loop's abort of the put's invocation, with pi's own reason: the
    // measure's signal keeps the first reason (`AbortSignal.any` in `putting`), where the
    // invocation's signal alone would read as the caller's.
    kill.abort();
    const ending = await judge(solver(s, signal), "probe", PLAYED);
    release.resolve();
    const result = await running;
    expect(ending).toMatchObject({ outcome: "non-result", kind: "killed", cancelledBy: origin });
    expect("reason" in ending ? ending.reason : "").not.toContain("the run was killed");
    expect(result).toMatchObject({ ended: "stands", puts: 1 });
    expect(s.of("draft.finished")).toMatchObject([
      {
        ended: "stands",
        stands: true,
        measurement: { status: "interrupted", cancelledBy: origin },
      },
    ]);
    expect(await judge(solver(s, signal), "probe", PLAYED)).toEqual(ending);
  });

  it.skipIf(!walled)(
    `logs three active child cancellations from ${origin} while the accepted draft stands`,
    async () => {
      const s = seat("draft", [drafted(SOUND)]);
      const kill = new AbortController();
      const ready = Promise.withResolvers<void>();
      let entered = 0;
      const running = examine({
        ...s.request,
        kill: kill.signal,
        limits: { ...s.request.limits, wallSeconds: origin === "session-wall" ? 10 : 600 },
        measure: async (_draft, signal) => {
          await Promise.all(
            SOUND.tasks.map(async (_task, index) => {
              const child = seat("draft", [
                async () => {
                  entered += 1;
                  if (entered === 3) ready.resolve();
                  await stopped(signal);
                  return fauxAssistantMessage("cancelled");
                },
              ]);
              const request = solver(s, signal);
              await solve({ ...request, id: `${request.id}-${String(index)}`, models: child.request.models });
            }),
          );
          return signal.aborted ? null : MEASURED;
        },
      });
      if (origin === "caller") {
        await ready.promise;
        kill.abort();
      }
      expect(await running).toMatchObject({ ended: "stands" });
      expect(entered).toBe(3);
      const children = solvesIn(read(s.log));
      expect(children).toHaveLength(3);
      for (const child of children) {
        expect(child.start.comparison).toBe(s.request.id);
        expect(child.ending).toMatchObject({ outcome: "non-result", kind: "killed", cancelledBy: origin });
        expect(child.ending?.reason).not.toContain("the run was killed");
      }
      expect(s.of("draft.finished")[0]?.measurement).toEqual({ status: "interrupted", cancelledBy: origin });
    },
  );
}

it("records complete only for the accepted draft whose aggregate returned, including identical reuse", async () => {
  for (const variant of ["reuse", "last-same", "last-changed"] as const) {
    const changed = variant === "last-changed";
    const final: Draft = changed ? { ...SOUND, domain: "Revised products" } : SOUND;
    const s = seat("draft", [drafted(SOUND), drafted(final)]);
    let calls = 0;
    await examine({
      ...s.request,
      limits: { ...s.request.limits, puts: variant === "reuse" ? 3 : 2 },
      measure: async () => {
        calls += 1;
        return MEASURED;
      },
    });
    expect(calls).toBe(1);
    expect(s.of("draft.finished")[0]?.measurement).toEqual({ status: changed ? "not-run" : "complete" });
    expect(s.of("solve.finished")).toEqual([]);
  }
});

it("cancels queued draft probes through the host without inventing solve ids or endings", async () => {
  const s = seat("draft", [drafted(SOUND)]);
  const kill = new AbortController();
  const queued = Promise.withResolvers<void>();
  let launched = 0;
  // SAFETY: the scripted launcher and the host's gate read only these fields.
  const campaign = {
    log: s.log,
    states: join(dirname(s.log), "states"),
    test: { model: s.request.model, effort: "medium" },
    limits: { concurrency: 4 },
  } as Campaign;
  const seated = gated(
    {
      seated: () => ({
        builder: null,
        setting: "fixture",
        solve: async () => {
          launched += 1;
          throw new Error("a cancelled queued solve must never launch");
        },
      }),
      loaded: false,
      host: {
        cores: 1,
        load: () => 2,
        waitMs: 1,
        sleep: async () => {
          queued.resolve();
          await stopped(kill.signal);
        },
      },
    },
    s.log,
  );
  const probe = await probing(campaign, seated, settingAsked({}, null), { "reviewer-effort": "high" });
  const running = examine({
    ...s.request,
    kill: kill.signal,
    measure: async (_draft, signal) => {
      await Promise.all(
        SOUND.tasks.map(async () =>
          probe({ ...EXAMPLE, checks: s.program, ruleIds: ["R1"] }, s.request.id, signal),
        ),
      );
      return signal.aborted ? null : MEASURED;
    },
  });
  await queued.promise;
  kill.abort();
  expect(await running).toMatchObject({ ended: "stands" });
  expect(launched).toBe(0);
  expect(s.of("solve.started")).toEqual([]);
  expect(s.of("solve.finished")).toEqual([]);
  expect(s.of("draft.finished")[0]?.measurement).toEqual({ status: "interrupted", cancelledBy: "caller" });
});

it("keeps a child's own wall a fail and an unlabelled external cancellation a caller non-result", async () => {
  const s = seat("draft", []);
  expect(await judge(solver(s), "probe", { ...PLAYED, wallEnded: true })).toEqual({
    outcome: "fail",
    kind: "wall-ended",
  });
  expect(await judge(solver(s, AbortSignal.abort()), "probe", PLAYED)).toMatchObject({
    outcome: "non-result",
    kind: "killed",
    cancelledBy: "caller",
  });
});
