/** One generated-module typecheck in a process of its own, so the compiler's syntax trees and types
 *  leave with it (`generated-module-typecheck.ts`). Arguments: the slug directory and the bundle;
 *  stdout: the answers and findings as one JSON document. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { runtimeProcess } from "../meta/process.ts";
import { probeTypecheck } from "./generated-module-typecheck.ts";

const [slugDir, bundle] = runtimeProcess.argv.slice(2);
if (slugDir === undefined || (bundle !== "agent" && bundle !== "correctness-model")) {
  throw new Error(`usage: generated-module-typecheck-child <slugDir> <agent|correctness-model>`);
}
await Bun.write(Bun.stdout, capturedJsonStringify(probeTypecheck(slugDir, bundle)));
