/** Shared fail-closed admission for optional operator configuration files and review choices. */
import { readFileSync } from "../meta/filesystem.ts";
import { errorCode, errorMessage } from "../meta/runtime-values.ts";

/** Missing is optional; an existing file that cannot be read is an invalid operator condition. */
export function readOptionalConfigFile(path: string, label: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(`${label} cannot be read: ${errorMessage(error)}`, { cause: error });
  }
}

/** Review has three mutually exclusive modes; boolean policy keys are literal true, not toggles. */
export function validateReviewOperator(
  operator: { kind?: unknown; inherit?: unknown; disabled?: unknown },
  operatorPath: string | null,
): void {
  const choices = [
    operator.kind !== undefined,
    operator.inherit !== undefined,
    operator.disabled !== undefined,
  ].filter(Boolean).length;
  if (choices > 1) {
    throw new Error(`${operatorPath}: review must choose exactly one of kind, inherit, or disabled`);
  }
  if (operator.disabled !== undefined && operator.disabled !== true) {
    throw new Error(`${operatorPath}: review.disabled must be true when present`);
  }
  if (operator.inherit !== undefined && operator.inherit !== true) {
    throw new Error(`${operatorPath}: review.inherit must be true when present`);
  }
}
