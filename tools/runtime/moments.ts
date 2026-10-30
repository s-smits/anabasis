/**
 * Supply area-specific guidance before a coding tool call, once per area per session.
 *
 * Claude Code and Codex invoke this hook through their repository configuration. Each ROUTES entry
 * matches a command or edited path and supplies invariants and documentation links through
 * hookSpecificOutput.additionalContext. The hook informs; it never blocks and exits 0 on bad input.
 *
 * On 30 October, AGENTS.md was reduced from 34,150 tokens to about 8,600 by moving detail into four
 * skills with the same section numbers. About 4,400 tokens had already been repeated in skills.
 * This hook points to the relevant guidance when an area is first used. Sessions that never enter
 * an area receive none of its hook text. Add a row for a new area and update stale pointers when
 * their owners change.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";

/** One area: what it matches, and what a session is told on entering it. */
interface Route {
  readonly id: string;
  readonly command?: RegExp;
  readonly path?: RegExp;
  readonly said: string;
  /** The skill that owns the area, which the session is told to read first; null where none does. */
  readonly skill: string | null;
}

/** Hook input fields: a shell command, possibly an argument list, and edited file paths. */
export interface ToolInput {
  readonly command?: string | readonly string[];
  readonly file_path?: string;
  readonly notebook_path?: string;
}

/** A tool call as the hook reads it: the shell command it runs, and the paths it edits. */
interface Call {
  readonly command: string;
  readonly paths: readonly string[];
}

const ROUTES: readonly Route[] = [
  {
    id: "stack",
    command:
      /\b(git (worktree add|push|rebase|commit)|gh (pr (create|edit|ready)|stack)|bun run (land|follow))\b/u,
    said: "Stack and pull requests (AGENTS.md section 11): inspect the current stack (`bun .claude/skills/stack-pr/scripts/stack.ts`). A fix to an open PR's own code belongs to that PR. Run `/simplify` before a code commit. Each PR needs one `importance:I0`-`I3` label and a category; claims follow `attribution-and-proof`. `bun .claude/skills/repository-practice/scripts/preflight.ts` lists suggested tests, UI checks, size and prose findings, and labels.",
    skill: "stack-pr",
  },
  {
    id: "run",
    command:
      /\bbun run runs (fresh|launch|continue|keep|move|pause|stop|copy|retire)\b|tools\/d2\/(harness-builder|round|session|checkpoint|promote|import|word)\.ts|live-seat/u,
    said: "Paid runs (AGENTS.md section 10; `run-management`): obtain authorisation for the named run. Use a clean, dedicated worktree rather than the main checkout. Prove the path without a model and record one prediction before solving. Never print a `--env-file`. Account limits follow rule 15 and are expected operating conditions.",
    skill: "run-management",
  },
  {
    id: "reading",
    command: /\bbun run runs (view|replay|source|status|pulse|active)\b|tools\/wri\//u,
    said: "Run evidence (AGENTS.md section 9; `whole-run-investigation`): a run supports claims about its own code (`bun run runs source --has <text>`). Read log events and reports before agent summaries. Separate outcome counts and follow `attribution-and-proof` when making claims.",
    skill: "whole-run-investigation",
  },
  {
    id: "rehearsal",
    command: /\bbun run runs (rehearse|seed)\b|--dry-run\b/u,
    said: "Rehearsals (`system-path-simulation`) establish that a path runs and writes its events. They do not establish model behaviour. The Referee seat is empty, so scripted rejections remain unruled.",
    skill: "system-path-simulation",
  },
  {
    id: "suite",
    command: /\bbun (run (test|gate)|test)\b/u,
    said: "Checks (AGENTS.md section 11): use `bun run test -- <paths>` for the owning tests while editing. Avoid bare `bun test`. Run at most one full suite per host. `bun run gate` runs the CI gate. Report wall-test failures caused by missing user namespaces; such a suite has not passed.",
    skill: null,
  },
  {
    id: "credentials",
    command: /(^|[\s'"/=])\.env\b|--env-file/u,
    path: /(^|\/)\.env(\.[^/]*)?$/u,
    said: "Credentials (AGENTS.md sections 10 and 11): never open, print or copy `.env` or a `--env-file`. Never copy one into another checkout to make a command start.",
    skill: null,
  },
  {
    id: "seats",
    path: /(^|\/)src\/(builder|examiner|solver|referee|harness)\/|(^|\/)tools\/d2\/(campaign-actions|harness-builder)\.ts$/u,
    said: "Seat information (rule 3; `design-and-seats`, sections 2 and 3): changing hidden values, checks or which held-out task was won must leave Builder and solver messages byte-identical (`test/builder.test.ts`, `test/builder-led.test.ts`). A PR changing these messages states how it checked this. `bun .claude/skills/design-and-seats/scripts/seat-view.ts` traces imports and identifies wall tests; `builder-view.ts <name>` prints what a Builder opening is told of the past. Give models facts rather than a prescribed course.",
    skill: "design-and-seats",
  },
  {
    id: "measurement",
    path: /(^|\/)src\/kernel\/(compare|reports|size|solve)\.ts$|(^|\/)src\/campaign\/(comparison|round|decide|admission|climb|ground)\.ts$/u,
    said: "Evaluation (`comparison-reading`, section 7; rules 1, 4, 5 and 12): fix terms before solving, solve both sides afresh and keep one owner per decision. Preserve measurement honesty when simplifying. Check changed readers with `bun run runs replay`. `bun .claude/skills/comparison-reading/scripts/size.ts` reports sample-size figures; `reading.ts <log|name>` compares recorded readings; `draw.ts <log|name>` shows what the next comparison would score.",
    skill: "comparison-reading",
  },
  {
    id: "campaign",
    path: /(^|\/)src\/campaign\/|(^|\/)tools\/d2\//u,
    said: "Campaign control (`campaign-mechanics`, section 6) covers endings, admissions, settings and practice release. Check a changed round or campaign path with `bun run runs rehearse` on a seed. `bun .claude/skills/campaign-mechanics/scripts/ending.ts <name>` lists recorded endings and current stopping conditions.",
    skill: "campaign-mechanics",
  },
  {
    id: "wall",
    path: /(^|\/)src\/wall\/|(^|\/)src\/tools\/command\.ts$/u,
    said: "OS isolation (`repository-practice`, section 10) uses Seatbelt on macOS and Bubblewrap on Linux. A suite passing on one platform supplies no evidence about the other platform's wall. Grant whole folders. An unavailable wall produces a typed non-result.",
    skill: "repository-practice",
  },
  {
    id: "log",
    path: /(^|\/)src\/kernel\/(log|task|condition|trace)\.ts$/u,
    said: "Campaign log (`campaign-mechanics`, section 5): keep one store and one reader per fact. Preserve old event kinds in `EVENT_KINDS`. Reuse the existing folds and `bun run runs` readers. `bun .claude/skills/campaign-mechanics/scripts/conditions.ts <name>` shows the settings a log's solves ran under.",
    skill: "campaign-mechanics",
  },
  {
    id: "code",
    path: /(^|\/)(src|tools|test|packages)\/.*\.tsx?$/u,
    said: "Code (AGENTS.md section 12): read `tools/oxlint/HABITS.md` before editing. Add no strict-lint findings. Production imports `node:` through `src/meta` only, and never helper code (`bun .claude/skills/repository-practice/scripts/direction.ts`). Tests check facts rather than wording. Run `/simplify` on the diff before committing.",
    skill: "repository-practice",
  },
  {
    id: "untouched",
    path: /(^|\/)(\.ana|data\/runs|vendor|node_modules|\.accounts)\//u,
    said: "Protected files (AGENTS.md section 11, rule 2): do not edit `.ana/`, `data/runs/`, packs, check programs, kept harnesses, credentials or installed dependencies. `vendor/` changes only through a documented sed of upstream.",
    skill: null,
  },
  {
    id: "prose",
    path: /(^|\/)(AGENTS\.md|docs\/.*\.md|\.claude\/skills\/.*\.md)$/u,
    said: "Writing (AGENTS.md section 13): use plain British English, inline code for identifiers and absolute dates. Avoid em dashes. Keep invariants in AGENTS.md, mechanisms in the corresponding numbered skill references, and procedures in their owning skills.",
    skill: "repository-practice",
  },
  {
    id: "ui",
    path: /(^|\/)packages\/ui\//u,
    said: "UI (`packages/ui/DESIGN.md`): render production folds rather than deriving a second interpretation. Validate with `bun run ui:gate`.",
    skill: null,
  },
];

/** A patch names each file it touches on a line of its own (`*** Update File: <path>`). */
const PATCHED = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu;

/** The command and the edited paths of a hook's `tool_input`, whichever agent sent it. */
function callOf(input: unknown): Call {
  if (!isRecord(input)) return { command: "", paths: [] };
  const { command, file_path: file, notebook_path: notebook } = input;
  const shell = isString(command)
    ? command
    : Array.isArray(command)
      ? command.filter(isString).join(" ")
      : "";
  const patched = Object.values(input)
    .filter(isString)
    .flatMap((text) => [...text.matchAll(PATCHED)].map((match) => match[1] ?? ""));
  return { command: shell, paths: [file, notebook, ...patched].filter(isString) };
}

/** The routes a call enters that `seen` does not hold yet, in table order. */
export function momentsOf(input: unknown, seen: ReadonlySet<string>): Route[] {
  const { command, paths } = callOf(input);
  return ROUTES.filter(
    (route) =>
      !seen.has(route.id) &&
      ((route.command?.test(command) ?? false) || paths.some((path) => route.path?.test(path) ?? false)),
  );
}

function main(text: string): string {
  const hook = capturedJsonParse(text);
  if (!isRecord(hook)) return "";
  // Remember delivered routes by session id. Unsafe ids create no state, so guidance repeats.
  const session = hook["session_id"];
  const file =
    isString(session) && /^[\w-]{1,128}$/u.test(session) ? join(tmpdir(), "ana-moments", session) : null;
  const seen = new Set(file !== null && existsSync(file) ? readFileSync(file, "utf8").split("\n") : []);
  const routes = momentsOf(hook["tool_input"], seen);
  if (routes.length === 0) return "";
  if (file !== null) {
    mkdirSync(join(tmpdir(), "ana-moments"), { recursive: true });
    appendFileSync(file, routes.map((route) => `${route.id}\n`).join(""));
  }
  const additionalContext = routes
    .map(({ said, skill }) =>
      skill === null ? said : `${said} Before acting, read \`.claude/skills/${skill}/SKILL.md\`.`,
    )
    .join("\n\n");
  return capturedJsonStringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } });
}

if (import.meta.main) {
  try {
    const said = main(await Bun.stdin.text());
    if (said !== "") console.log(said);
  } catch {
    // Invalid input must not block the tool call.
  }
}
