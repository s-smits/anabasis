// A bare solve-isolation label is never accepted: `physical` derives from an executed fixture.
import type { IsolationStrength } from "../claim/readiness.ts";

/**
 * The mechanism families that can write a physical solve isolation. Both apply this process's own
 * policy, through Darwin Seatbelt or Linux Bubblewrap (`src/verify/solve-sandbox.ts`), and both
 * work for any transport the host spawns. A new family needs its own executed discriminating
 * fixture before it may appear here, so this union is the whole list of what has one; a recorded
 * probe naming a family the union does not list therefore reads as contractual rather than
 * physical.
 */
const ISOLATION_FIXTURES = ["host-seatbelt-read-deny/v1", "host-bwrap-read-deny/v1"] as const;

/** Derived from the list rather than restated beside it, so one edit admits a family and the
 *  runtime guard below and every `Record<IsolationFixture, ...>` table move with it. */
export type IsolationFixture = (typeof ISOLATION_FIXTURES)[number];

/**
 * A persisted result from one read-deny fixture. It is deliberately structural, so the consumer
 * stays independent of any particular transport package, but a bare isolation label is not
 * accepted on its own: `physical` is derived only from the fixture's discriminating conjunction.
 */
export type IsolationProbeEvidence = {
  fixture: IsolationFixture;
  available: boolean;
  isolated: boolean;
  deniedReadRefused: boolean;
  controlReadSucceeded: boolean;
  /** The same verified profile, with only the covering deny rules lifted, returned the canary. It
   *  is what makes the refusal attributable to those rules rather than to a broken CLI that would
   *  have failed the read either way. */
  discriminationReadSucceeded: boolean;
  /** sha256 of the exact rules the deny check executed. The verified session's evidence must carry
   *  the same value, so the two checks bind identical bytes instead of agreeing on a shared
   *  label. */
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
