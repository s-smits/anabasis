// Isolated campaign source with command fakes: only the manifest varies. Campaign entry and
// launcher code run unchanged; installs and detached launches leave evidence instead of running.
import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { join, resolve } from "../../src/meta/path.ts";
import { capturedExecPath } from "../../src/meta/process.ts";
import { fakeHosts } from "./fake-hosts.ts";

const REPO = resolve(import.meta.dir, "../..");
export const PROMPT_FLAGS = [
  "--project",
  "fixture-products",
  "--prompt",
  "Multiply a base by six.",
  "--solver",
  "claude/claude-sonnet-5-5",
  "--budget",
  "100",
  "--builder",
  "claude/claude-opus-5-5",
  "--examiner",
  "claude/claude-opus-5-5",
  "--reviewer",
  "claude/claude-opus-5-5",
  "--no-builder-led",
];

export function campaignRuntime() {
  const made = fakeHosts();
  cpSync(join(REPO, "tools"), join(made.main, "tools"), { recursive: true });
  for (const name of ["src", "vendor", "node_modules"]) {
    symlinkSync(join(REPO, name), join(made.main, name));
  }
  const manifest = parseJsonAs<JsonObject>(readFileSync(join(REPO, "package.json"), "utf8"));
  const pin = (fields: JsonObject) =>
    writeFileSync(join(made.main, "package.json"), JSON.stringify({ ...manifest, ...fields }));
  pin({});
  const nice = join(made.root, "bin", "nice");
  writeFileSync(
    nice,
    `#!${capturedExecPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({tool:"nice",args}) + "\\n");
// Both the install and a forbidden detached campaign stop at this command fake.
process.exit(args.includes("install") ? 0 : 1);
`,
  );
  chmodSync(nice, 0o755);
  const run = (code: string, env: Record<string, string> = {}) =>
    made.run(code.replaceAll("CAMPAIGN/", `${made.main}/`), { ...env, FAKE_REPO: made.main });
  const folder = join(made.main, ".ana", "d2", "runtime");
  const seed = () => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "seed.json"), JSON.stringify({ from: null, events: 0 }));
  };
  return { ...made, run, pin, folder, seed };
}
