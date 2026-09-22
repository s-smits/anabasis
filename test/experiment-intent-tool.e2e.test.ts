/**
 * Experiment intent over the adopted product whose checks require the installed fixture tool:
 * a relocated, edited, unknown or mid-gate-changed tool is attributed from the bytes the host
 * hashed (see experiment-freeze.e2e.test.ts for the static and repair cases).
 */
import { afterAll, beforeAll, it } from "bun:test";
import { type AdoptedProduct, buildAdopted, checkIntent } from "./helpers/experiment-freeze-products.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

let adopted: AdoptedProduct;
beforeAll(async () => {
  adopted = await buildAdopted(true);
});

// kind, proposed scope, prior-evidence owner, admitted scope (null: refused), refusal text, gate
// calls. An admission refusal still runs the gates once, so one submit reports every stage.
const ROWS = [
  ["tool-relocated", "tasks", null, "climb", null, 1],
  ["tool-tasks", "tasks", null, null, "experiment-scope-mismatch", 1],
  ["tool-product", "product", null, "build", null, 1],
  ["tool-only", "product", null, "evaluation", null, 1],
  ["tool-unknown", "tasks", null, null, "experiment-scope-mismatch", 1],
  ["tool-mid-gate", "product", null, null, "verifier-condition-drift", 1],
] as const;

it.concurrent.each(ROWS.map((row) => [row[0], row] as const))(
  "checks %s intent through immutable submit, census and full-task F2",
  (_kind, row) => checkIntent(adopted, row),
  // A full continuation with census and F2 per kind: past 60 s beside a full gate in the Linux VM.
  180_000,
);
