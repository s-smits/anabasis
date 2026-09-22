/**
 * Print the production-assembled model-visible prompt text, so a simulation hands a real
 * actor the exact bytes a paid run would — and so a behaviour can be attributed to the surface
 * that carries it without re-deriving the assembly by hand.
 *
 * Surfaces come from the run tree's own exports, never from retyped text:
 *   - `system`: the Builder session contract via `builderSystemPrompt` (optionally with
 *     the web-search line);
 *   - `kickoff`: the from-scratch direct kickoff via `directKickoff` + `prepareUserContext`;
 *   - `built`: the Built solver's universal prompt at the seeded solve wall, the guide preamble,
 *     first-turn template, nudge, and the `shell` preset's bash description and schema. The tool
 *     roster line and the operating guide come from an adopted bundle and are not assembled here.
 *
 * Steering is controller-derived per round and has no argument-free assembly. Read its owning
 * functions in `builder-campaign.ts` directly.
 *
 * Usage, from the tree whose run you are simulating:
 *
 *   bun .claude/skills/system-path-simulation/scripts/show-prompt-surfaces.mts \
 *     --surface system [--web-search] \
 *     [--grep <term>]
 *
 *   ... --surface kickoff --prompt "one-liner" [--context /abs/public-context-dir]
 *
 *   ... --surface built
 *
 * `--grep` filters output to lines containing the term (case-insensitive) with one line of
 * context, which answers "which surface carries this sentence" in one command. Output goes to
 * stdout; nothing is written.
 */

import { dirname, isAbsolute, resolve } from "#src/meta/path.ts";

import { builderSystemPrompt } from "#src/author/builder-start-prompt.ts";
import { prepareUserContext } from "#src/builder/user-context.ts";
import { directKickoff } from "#src/run/direct-input.ts";
import {
  BUILT_FIRST_TURN_TEMPLATE,
  BUILT_GUIDE_PREAMBLE,
  BUILT_NUDGE,
  builtSystemPrompt,
} from "#src/solve/built-starter.ts";
import { createBuiltBashTool } from "#src/solve/built-bash.ts";
import { DEFAULT_HARNESS_SETTINGS } from "#src/truth/harness-config.ts";
import { type ExitWith, exitWith, parseOrDie } from "./cli-args.mts";

const die: ExitWith = exitWith("show-prompt-surfaces");

const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");

const parsed = parseOrDie(die, {
  values: ["surface", "grep", "prompt"],
  repeatable: ["context"],
  flags: ["web-search"],
});

function grepped(text: string, term: string | null): string {
  if (term === null) return text;
  const lines = text.split("\n");
  const needle = term.toLowerCase();
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(needle)) {
      keep.add(i - 1);
      keep.add(i);
      keep.add(i + 1);
    }
  });
  const hits = lines.filter((_, i) => keep.has(i));
  return hits.length === 0 ? `(no line carries ${JSON.stringify(term)} on this surface)` : hits.join("\n");
}

const surface = parsed.single.get("surface") ?? null;
const term = parsed.single.get("grep") ?? null;
if (term?.trim() === "") die("--grep must not be empty");

if (surface === "system") {
  if (parsed.single.has("prompt")) die("--prompt is only valid with --surface kickoff");
  if ((parsed.repeated.get("context")?.length ?? 0) > 0) {
    die("--context is only valid with --surface kickoff");
  }
  console.log(grepped(builderSystemPrompt(parsed.flags.has("web-search")), term));
} else if (surface === "kickoff") {
  if (parsed.flags.has("web-search")) die("--web-search is only valid with --surface system");
  const prompt = parsed.single.get("prompt") ?? null;
  if (prompt === null || prompt.trim() === "") {
    die("kickoff surface needs --prompt with the exact one-liner");
  }
  const context = prepareUserContext(
    REPO_ROOT,
    [...(parsed.repeated.get("context") ?? [])].map((path) => {
      if (!isAbsolute(path)) die(`--context must be an absolute path, got ${JSON.stringify(path)}`);
      return resolve(path);
    }),
  );
  console.log(grepped(directKickoff(prompt, context), term));
} else if (surface === "built") {
  if (
    parsed.single.has("prompt") ||
    parsed.flags.has("web-search") ||
    (parsed.repeated.get("context")?.length ?? 0) > 0
  ) {
    die("--surface built takes only --grep");
  }
  const bash = createBuiltBashTool({ policy: null, port: null, home: "/nonexistent-home" });
  const text = [
    "=== system prompt (universal part) ===",
    builtSystemPrompt(DEFAULT_HARNESS_SETTINGS.solveMs),
    "[the tool roster line and the bundle's operating guide follow here; both come from an adopted bundle]",
    "=== guide preamble ===",
    BUILT_GUIDE_PREAMBLE,
    "=== first turn template ===",
    BUILT_FIRST_TURN_TEMPLATE,
    "=== nudge (later turns) ===",
    BUILT_NUDGE,
    "=== bash description (shell preset) ===",
    bash.description,
    "=== bash parameters ===",
    JSON.stringify(bash.parameters),
  ].join("\n");
  console.log(grepped(text, term));
} else {
  die(
    "pass --surface system, kickoff or built (steering texts: read src/run/builder-campaign.ts directly — they are controller-derived per round and have no argument-free assembly)",
  );
}
