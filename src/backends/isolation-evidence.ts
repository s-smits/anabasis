// A bare solve-isolation label is never accepted: `physical` derives from an executed fixture.
import type { IsolationStrength } from "../claim/readiness.ts";

/**
 * The mechanism families that can write a physical solve isolation. Both apply policy from this
 * process through Darwin Seatbelt or Linux Bubblewrap (`src/verify/solve-sandbox.ts`) and work for
 * any transport the host spawns. A NEW family needs its own executed discriminating fixture; the
 * union is the whole list of what has one. A recorded probe naming a retired family reads as
 * contractual.
 */
const ISOLATION_FIXTURES = ["host-seatbelt-read-deny/v1", "host-bwrap-read-deny/v1"] as const;

/** Derived from the list rather than restated beside it: one edit admits a family, and the
 *  runtime guard below and every `Record<IsolationFixture, ...>` table move together. */
export type IsolationFixture = (typeof ISOLATION_FIXTURES)[number];

/**
 * A persisted result from one read-deny fixture. This is deliberately structural so the consumer
 * remains independent of a particular transport package, but a bare isolation label is not accepted:
 * `physical` is derived only from the fixture's discriminating conjunction.
 */
export type IsolationProbeEvidence = {
  fixture: IsolationFixture;
  available: boolean;
  isolated: boolean;
  deniedReadRefused: boolean;
  controlReadSucceeded: boolean;
  /** v2: the same verified profile with only the covering deny rules lifted returned the canary —
   *  the refusal is attributable to those rules, never to a broken CLI. */
  discriminationReadSucceeded: boolean;
  /** sha256 of the exact rules the deny check executed. The verified session's evidence must carry
   *  the SAME value, so the two checks bind identical bytes instead of a shared label. */
  profileDigest?: string | null;
  evidence: string[];
};

export function disclosedIsolation(probe: IsolationProbeEvidence | undefined): IsolationStrength {
  return probe !== undefined &&
    ISOLATION_FIXTURES.includes(probe.fixture) &&
    probe.available &&
    probe.isolated &&
    probe.deniedReadRefused &&
    probe.controlReadSucceeded &&
    probe.discriminationReadSucceeded
    ? "physical"
    : "contractual";
}
