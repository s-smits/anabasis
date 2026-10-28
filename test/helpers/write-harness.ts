/**
 * A harness written out from its parts, as the host reads one: the two files it requires, and a
 * guide and programs where the harness has them. Only the tests write a harness other than the
 * starter (`writeStarter`, `src/harness/starter.ts`), so this writer lives here.
 */
import {
  AGENT_DIR,
  GENERATED_TOOLS_FILE,
  GUIDE_FILE,
  TOOLS_SPEC_FILE,
} from "../../src/meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";

interface Written {
  readonly spec: { readonly presets: readonly string[]; readonly tools: readonly JsonObject[] };
  readonly tools: string;
  readonly guide?: string;
  readonly programs?: Readonly<Record<string, string>>;
}

export function writeHarness(dir: string, harness: Written): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(harness.spec, null, 2)}\n`);
  writeFileSync(join(dir, GENERATED_TOOLS_FILE), harness.tools);
  if (harness.guide !== undefined) writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), harness.guide);
  const bin = join(dir, ".toolchain", "bin");
  for (const [name, source] of Object.entries(harness.programs ?? {})) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, name), source, { mode: 0o755 });
  }
}
