/**
 * A harness written out from its parts, as the host reads one. Only tests write a harness other
 * than the starter (`writeStarter`, `src/harness/starter.ts`), so this writer lives here.
 */
import { AGENT_DIR, GUIDE_FILE, TOOL_HOST_DIR, TOOLS_SPEC_FILE } from "../../src/meta/bundle-layout.ts";
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";

interface Written {
  readonly spec: { readonly presets: readonly string[]; readonly tools: readonly JsonObject[] };
  readonly guide?: string;
  readonly programs?: Readonly<Record<string, string>>;
  readonly hostPrograms?: Readonly<Record<string, string>>;
}

export function writeHarness(dir: string, harness: Written): void {
  mkdirSync(join(dir, AGENT_DIR), { recursive: true });
  writeFileSync(join(dir, TOOLS_SPEC_FILE), `${capturedJsonStringify(harness.spec, null, 2)}\n`);
  if (harness.guide !== undefined) writeFileSync(join(dir, AGENT_DIR, GUIDE_FILE), harness.guide);
  for (const [sub, entries] of [
    ["bin", harness.programs],
    [TOOL_HOST_DIR, harness.hostPrograms],
  ] as const) {
    const dest = join(dir, ".toolchain", sub);
    for (const [name, source] of Object.entries(entries ?? {})) {
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, name), source, { mode: 0o755 });
    }
  }
}
