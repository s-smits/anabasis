/** Shared fail-closed admission for optional operator configuration files: what did the operator
 *  actually declare. A second reader that guessed differently would run a condition nobody chose. */
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
