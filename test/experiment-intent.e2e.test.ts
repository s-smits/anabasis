/**
 * Experiment intent over the adopted product with authored checks alone: each proposal is checked
 * through immutable submit, census and full-task F2, and accepted bytes decide the attribution
 * (see experiment-freeze.e2e.test.ts for the static and repair cases).
 */
import { afterAll, beforeAll, it } from "bun:test";
import { type AdoptedProduct, buildAdopted, checkIntent } from "./helpers/experiment-freeze-products.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

afterAll(cleanupScratch);

let adopted: AdoptedProduct;
beforeAll(async () => {
  adopted = await buildAdopted(false);
});

// kind, proposed scope, prior-evidence owner, admitted scope (null: refused), refusal text, gate
// calls. An admission refusal still runs the gates once, so one submit reports every stage.
const ROWS = [
  ["tasks", "tasks", null, "climb", null, 1],
  ["product-tasks", "product", null, "climb", null, 1],
  ["schema-tasks", "tasks", null, null, "experiment-scope-mismatch", 1],
  ["schema-product", "product", null, "build", null, 1],
  ["agent", "product", null, "build", null, 1],
  ["controls", "product", "correctness-model", "evaluation", null, 1],
  ["mismatch", "tasks", null, null, "experiment-scope-mismatch", 1],
  ["schema-scope-revision", "tasks", null, "build", null, 1],
  ["unchanged", "product", null, null, "rebuild-evaluation-unmoved", 1],
  ["unsolvable", "product", null, null, null, 1],
  ["blocked-tasks", "tasks", "correctness-model", null, "experiment-product-repair-required", 1],
  ["blocked-product", "product", "brief", null, "experiment-product-repair-required", 1],
] as const;

it.concurrent.each(ROWS.map((row) => [row[0], row] as const))(
  "checks %s intent through immutable submit, census and full-task F2",
  (_kind, row) => checkIntent(adopted, row),
  // A full continuation with census and F2 per kind: past 60 s beside a full gate in the Linux VM.
  180_000,
);
