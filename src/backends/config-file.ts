/** Shared fail-closed admission for optional operator configuration files and review choices. One
 *  owner for both, because both answer the same question — what did the operator actually declare —
 *  and a second reader that guessed differently would run a condition nobody chose. */
import { readFileSync } from "../meta/filesystem.ts";
import { errorCode, errorMessage } from "../meta/runtime-values.ts";

/** A missing file is the absence of a declaration, which is allowed: the caller then uses its own
 *  default. A file that exists and cannot be read is a different thing entirely — the operator did
 *  declare something and the host cannot tell what — so it throws rather than reading as absent,
 *  which would silently substitute the default for whatever that file says. */
export function readOptionalConfigFile(path: string, label: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw new Error(`${label} cannot be read: ${errorMessage(error)}`, { cause: error });
  }
}

/** Review has three mutually exclusive modes, so declaring two is a refusal rather than a
 *  precedence puzzle. The boolean keys must be a literal `true`: `disabled: false` looks like an
 *  instruction and means nothing here, since an absent review key already says nobody chose, and
 *  the two readings of that spelling would be a silent difference in which slot ran. */
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
