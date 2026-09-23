/**
 * Measurement doubles for a no-provider battery: the executed isolation probe, the Built session
 * check and a verifier host that runs no tool. They were lifted out of the measurement warranty so
 * that the whole-loop warranty and the simulation runner would drive `measureHarness` against the
 * same doubles rather than each inventing its own, and six files read them now — `harness-measure`
 * with its `-inputs`, `-claim` and `-judge` siblings, plus `climb-loop` and
 * `full-run-scripted-loop`. That is worth knowing
 * before changing one: a double loosened to suit one caller quietly changes what the other five
 * are measuring.
 */
import type { SessionProfileEvidence } from "../../src/backends/session-isolation.ts";
import { runtimeProcess } from "../../src/meta/process.ts";
import {
  HOST_SOLVE_ISOLATION_FIXTURE,
  HOST_SOLVE_ISOLATION_PROFILE_ID,
  type HostSolveIsolationEvidence,
} from "../../src/verify/solve-sandbox.ts";
import type {
  ToolRunResult,
  VerifierExecutionEvidence,
  VerifierHostHandle,
} from "../../src/verify/verifier-port.ts";
import { double } from "./doubles.ts";

export function probeEvidence(isolated: boolean): HostSolveIsolationEvidence {
  return {
    fixture: HOST_SOLVE_ISOLATION_FIXTURE,
    isolated,
    available: true,
    deniedReadRefused: isolated,
    controlReadSucceeded: true,
    discriminationReadSucceeded: true,
    moveGuardRefused: true,
    profileDigest: "0".repeat(64),
    probedAt: "2026-07-27T00:00:00.000Z",
    evidence: [],
  };
}

export function builtSession(policyHash = "0".repeat(64)): SessionProfileEvidence {
  return {
    role: "built",
    model: "faux-pi",
    reasoningEffort: "medium",
    providerVersion: "test",
    activePermissionProfile: HOST_SOLVE_ISOLATION_PROFILE_ID,
    policyHash,
    confinedPid: runtimeProcess.pid + 1,
    controllerPid: runtimeProcess.pid,
  };
}

/** Full host double: the eval runner opens a scope per evaluate and reads the binding, tool and
 *  evidence interfaces afterwards. All three stay empty because an in-process evaluator never
 *  asks the host to run a tool; the port's `run` is present so a call would be an ordinary canned
 *  non-result rather than a missing method. */
export function fullFakeHost(): VerifierHostHandle {
  return {
    openSubject: () => ({
      port: {
        abandon: () => {},
        run: async (): Promise<ToolRunResult> => ({
          executed: false,
          exitCode: null,
          signal: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          nonResult: { kind: "verifierUnavailable", message: "test double runs no tool" },
          evidence: double<VerifierExecutionEvidence>({ outcome: "verifierUnavailable" }),
        }),
      },
      close: async () => ({ pendingInvocations: 0 }),
    }),
    executedBindings: () => [],
    tools: () => ({}),
    evidence: () => [],
  };
}
