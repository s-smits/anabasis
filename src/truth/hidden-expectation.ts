/**
 * Hidden data for one declared truth check, carried by tasks and optional control overrides.
 * The controller selects the check's row when constructing its evaluation request; the public
 * task projection excludes it. This type is shared by the task and control contracts so they use
 * the same check-id binding. */
import type { JsonValue } from "../meta/json-shape.ts";

export type HiddenExpectation = {
  /** Must be one of the brief's declared truth-check ids. */
  checkId: string;
  /** What the verifier should find. The answer key travels inside the recorded battery, so it is JSON. */
  expectation: JsonValue;
};
