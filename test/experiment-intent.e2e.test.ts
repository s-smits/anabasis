/**
 * Experiment intent composed through immutable submit, census and full-task F2 over an adopted
 * product: the accepted bytes, not the declared scope, decide whether a continuation is a task-only
 * climb, an evaluation correction or a build, and a refusal reaches the submission beside the gate
 * stages that ran. One row per composition the static attribution cases cannot reach; the byte
 * rules themselves belong to the static cases. These rows continue the product with authored checks
 * alone; experiment-intent-tool.e2e.test.ts holds the rows over an installed tool. Rows run one at a
 * time so each reports before the suite's idle wall.
 */
import { afterAll, beforeAll, it } from "bun:test";
import {
  type AdoptedProduct,
  EDITS,
  type IntentRow,
  buildAdopted,
  checkIntent,
} from "./helpers/experiment-freeze-products.ts";
import { cleanupScratch } from "./helpers/scratch.ts";

const ROWS: Array<[string, IntentRow]> = [
  [
    "a product proposal whose bytes moved only the battery is a climb",
    { tool: false, scope: "product", redesign: true, admitted: "climb" },
  ],
  [
    "a tasks proposal over a moved submission schema is refused, then admitted as a build once revised",
    { tool: false, scope: "tasks", redesign: true, edit: EDITS.schema, revise: true, admitted: "build" },
  ],
  [
    "a controls correction answering an evaluation finding is an evaluation",
    {
      tool: false,
      scope: "product",
      redesign: false,
      owner: "correctness-model",
      edit: EDITS.controls,
      admitted: "evaluation",
    },
  ],
  [
    "the same correction with no conformance probes run is an unproven build",
    {
      tool: false,
      scope: "product",
      redesign: false,
      owner: "correctness-model",
      edit: EDITS.controls,
      unprobed: true,
      admitted: "build",
    },
  ],
  [
    "a battery change cannot evade an owed product repair by declaring product scope",
    {
      tool: false,
      scope: "product",
      redesign: true,
      owner: "brief",
      refused: "experiment-product-repair-required",
    },
  ],
];

afterAll(cleanupScratch);

let plain: AdoptedProduct;
beforeAll(async () => {
  plain = await buildAdopted(false);
}, 180_000);

it.each(ROWS)(
  "%s",
  (_title, row) => checkIntent(plain, row),
  // A full continuation with census and F2 per row: past 60 s beside a full gate in the Linux VM.
  180_000,
);
