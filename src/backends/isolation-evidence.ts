// A bare solve-isolation label is never accepted: `physical` derives from an executed fixture.
import type { IsolationStrength } from "../claim/readiness.ts";

/**
 * The mechanism families that can write a physical solve isolation: Darwin Seatbelt and Linux
 * Bubblewrap, applied from this process (`src/verify/solve-sandbox.ts`). A new family needs its own
 * executed discriminating fixture; a probe naming an unlisted family reads as contractual.
 */
const ISOLATION_FIXTURES = ["host-seatbelt-read-deny/v1", "host-bwrap-read-deny/v1"] as const;

/** Derived from the list, so one edit admits a family everywhere. */
export type IsolationFixture = (typeof ISOLATION_FIXTURES)[number];

/**
 * A persisted result from one read-deny fixture, structural so the consumer stays
 * transport-independent. `physical` derives only from the fixture's discriminating conjunction.
 */
export type IsolationProbeEvidence = {
  fixture: IsolationFixture;
  available: boolean;
  isolated: boolean;
  deniedReadRefused: boolean;
  controlReadSucceeded: boolean;
  /** The same profile with only the covering deny rules lifted returned the canary, so the refusal
   *  is attributable to those rules. */
  discriminationReadSucceeded: boolean;
  /** sha256 of the exact rules the deny check executed; the session evidence must carry the same
   *  value, so both checks bind identical bytes. */
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
