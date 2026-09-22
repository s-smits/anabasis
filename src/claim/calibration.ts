/**
 * Control corpus floors and Judge independence. The floors set how many known-correct and
 * deliberately incorrect controls an authored corpus must carry; authoring states and checks the
 * same numbers. The Main Judge runs no control census over that corpus, so no validity rule, bait
 * corpus or calibration rate lives here.
 */
import { policyRow, posInt } from "../critic/manifest.ts";

/** The registered control corpus floors, read from the frozen manifest's `evaluatorCalibration` row.
 *  A missing or invalid field takes the default of five. */
export const EVALUATOR_CALIBRATION_POLICY = policyRow("evaluatorCalibration", {
  minimumKnownPasses: { bound: posInt, fallback: 5 },
  minimumKnownFailures: { bound: posInt, fallback: 5 },
})();

/**
 * How independent the Judge is from the model being evaluated. Classification uses the two
 * `backendKind/modelId` pins, for example `claude/claude-opus-4-8`.
 */
export type EvaluatorIndependence = "same-model" | "same-family" | "different-family" | "deterministic";

/** Model family follows the vendor. A pin is `backendKind/modelId`, and the model id may have
 *  a vendor prefix (`openrouter/anthropic/claude-opus-4-8`). The backend kind is ignored, so one
 *  vendor's model reached through two transports is not counted independent. Use the model id's
 *  vendor prefix when present, or its leading letters otherwise: `claude-opus-4-8` and
 *  `claude-sonnet-5` share a family. The alias table joins vendor names that differ across
 *  transports, such as `anthropic` and `claude`. Unparseable pins and the broker's `unresolved`
 *  value are classified `same-model`, since an unknown identity cannot establish independence. */
const VENDOR_ALIASES = new Map([
  ["anthropic", "claude"],
  ["openai", "gpt"],
]);

function familyOf(pin: string): string | null {
  const slash = pin.indexOf("/");
  if (slash <= 0 || slash === pin.length - 1) return null;
  const model = pin.slice(slash + 1);
  if (model === "unresolved") return null;
  const vendorSlash = model.indexOf("/");
  const vendor =
    vendorSlash > 0
      ? model.slice(0, vendorSlash).toLowerCase()
      : (model.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? null);
  if (vendor === null || vendor === "unresolved") return null;
  return VENDOR_ALIASES.get(vendor) ?? vendor;
}

export function evaluatorIndependence(evaluatorPin: string, evaluatedPin: string): EvaluatorIndependence {
  if (evaluatorPin === evaluatedPin) return "same-model";
  const evaluatorFamily = familyOf(evaluatorPin);
  const evaluatedFamily = familyOf(evaluatedPin);
  if (evaluatorFamily === null || evaluatedFamily === null) return "same-model";
  return evaluatorFamily === evaluatedFamily ? "same-family" : "different-family";
}
