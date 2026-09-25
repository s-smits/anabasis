/**
 * Experiment intent over the adopted product whose checks require the installed fixture tool: the
 * rows of experiment-intent.e2e.test.ts whose answer depends on installed-tool hashing. The rows
 * run in their own file so the two adopted products build and measure in parallel workers, and run
 * one at a time so each reports before the suite's idle wall.
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
    "a battery change over the relocated, byte-identical tool is a climb",
    { tool: true, scope: "tasks", redesign: true, admitted: "climb" },
  ],
  [
    "a tasks proposal over an edited tool is refused, then admitted as a build once revised",
    { tool: true, scope: "tasks", redesign: true, edit: EDITS.tool, revise: true, admitted: "build" },
  ],
  [
    "an edited installed tool alone is an evaluation",
    { tool: true, scope: "product", redesign: false, edit: EDITS.tool, admitted: "evaluation" },
  ],
  [
    "a tool edited after submit captured it is refused as verifier drift",
    {
      tool: true,
      scope: "product",
      redesign: true,
      midGate: EDITS.tool,
      refused: "verifier-condition-drift",
    },
  ],
];

afterAll(cleanupScratch);

let withTool: AdoptedProduct;
beforeAll(async () => {
  withTool = await buildAdopted(true);
}, 180_000);

it.each(ROWS)(
  "%s",
  (_title, row) => checkIntent(withTool, row),
  // A full continuation with census and F2 per row: past 60 s beside a full gate in the Linux VM.
  180_000,
);
