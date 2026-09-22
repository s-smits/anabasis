import { spawnTextSync as spawnSync } from "./bun-spawn-sync.ts";
import { mkdirSync, rmSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import {
  type CandidateIsolationBinding,
  type CandidateAccessPolicy,
} from "../../src/builder/candidate-isolation.ts";
import { candidateIsolationProfile } from "../../src/builder/candidate-isolation-profile.ts";
import { type DarwinSeatbeltRuntime, darwinSeatbeltSupport } from "../../src/verify/darwin-seatbelt.ts";

type CandidateIsolationProof =
  | {
      kind: "proven";
      policyDigest: string;
      checks: { denyRefused: true; controlAllowed: true; discriminationLeaked: true };
    }
  | {
      kind: "non-result";
      reason: "mechanism-unavailable" | "probe-failed" | "control-vacuous" | "discrimination-vacuous";
    };

export function proveCandidateIsolation(
  policy: CandidateAccessPolicy,
  binding: CandidateIsolationBinding,
  runtime: DarwinSeatbeltRuntime = {},
): CandidateIsolationProof {
  const support = darwinSeatbeltSupport(runtime);
  if (!support.ok) return { kind: "non-result", reason: "mechanism-unavailable" };
  const canary = `candidate-isolation-canary-${policy.digest.slice(0, 12)}`;
  const protectedCanary = join(policy.repoRoot, "domains", ".isolation-canary");
  const controlCanary = join(binding.iterationDir, ".isolation-canary");
  try {
    mkdirSync(join(policy.repoRoot, "domains"), { recursive: true });
    mkdirSync(binding.iterationDir, { recursive: true });
    writeFileSync(protectedCanary, canary);
    writeFileSync(controlCanary, canary);
    const session = candidateIsolationProfile(policy, "read");
    const wider = candidateIsolationProfile(policy, "read", [protectedCanary]);
    const read = (profile: string, target: string) =>
      spawnSync(support.mechanismPath, ["-p", profile, "/bin/cat", target], {
        env: {},
        timeout: 10_000,
      });
    const denied = read(session.profile, protectedCanary);
    if (denied.status === 0 || denied.stdout.includes(canary)) {
      return { kind: "non-result", reason: "probe-failed" };
    }
    const control = read(session.profile, controlCanary);
    if (control.status !== 0 || !control.stdout.includes(canary)) {
      return { kind: "non-result", reason: "control-vacuous" };
    }
    const discriminating = read(wider.profile, protectedCanary);
    if (discriminating.status !== 0 || !discriminating.stdout.includes(canary)) {
      return { kind: "non-result", reason: "discrimination-vacuous" };
    }
    return {
      kind: "proven",
      policyDigest: policy.digest,
      checks: { denyRefused: true, controlAllowed: true, discriminationLeaked: true },
    };
  } finally {
    rmSync(protectedCanary, { force: true });
    rmSync(controlCanary, { force: true });
  }
}
