/**
 * What a coding session is told when a tool call enters an area of the repository: that area's
 * invariants, the skill and section that hold its full account, and the skill that owns its
 * procedure. Claude Code runs it before each Bash, Edit and Write call (`.claude/settings.json`),
 * and Codex before each shell call and patch (`.codex/config.toml`). Both read the reply's
 * `hookSpecificOutput.additionalContext`. It informs and never refuses, and it exits 0 on any input.
 *
 * On 30 October `AGENTS.md` went from 34,150 tokens to about 8,600. Every session loads it whole,
 * while a skill loads only when invoked, and the skills already stated about 4,400 of its tokens.
 * The detail moved to four skills that keep its section numbers (`design-and-seats`,
 * `campaign-mechanics`, `comparison-reading`, `repository-practice`), which a model loads by their
 * descriptions. A rule that matters only at one moment, such as rule 3 while a prompt is edited or
 * `stack-pr` before a push, is now named at that moment, once per session, and costs nothing in a
 * session that never reaches it.
 *
 * Each row of `ROUTES` matches a shell command or an edited path and says its facts once. A new
 * area worth a pointer is a new row; a row whose pointer has left the tree is dead text, like a
 * sentence of `AGENTS.md`.
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
}

/** The fields of a hook's `tool_input` it reads: Bash's command (a list in Codex), an edit's path,
 *  and a Codex patch, whose text is its command. */
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
    said: "Stack and pull requests (AGENTS.md section 11): read `.claude/skills/stack-pr/SKILL.md` before you branch and before you push, and read the stack's top first (`bun .claude/skills/stack-pr/scripts/stack.ts`). A change that fixes an open pull request's own code belongs to it. Run `/simplify` before a commit of code. A pull request carries one `importance:I0`-`I3` label and a category, and its claims follow `attribution-and-proof`. `bun .claude/skills/repository-practice/scripts/preflight.ts` prints what the diff owes: the tests the static gate picks, whether `ui:gate` is owed, size and prose findings, and a label.",
  },
  {
    id: "run",
    command:
      /\bbun run runs (fresh|launch|continue|keep|move|pause|stop|copy|retire)\b|tools\/d2\/(harness-builder|round|session|checkpoint|promote|import|word)\.ts|live-seat/u,
    said: "A real-model run (AGENTS.md section 10; skill `run-management`) needs the operator's word, which names it. It runs from a clean worktree of its own, never a main checkout. Prove its path without a model first, and put one prediction on record before the first solve. Never print a `--env-file`. A login at its limit is rule 15, not a defect.",
  },
  {
    id: "reading",
    command: /\bbun run runs (view|replay|source|status|pulse|active)\b|tools\/wri\//u,
    said: "Reading a run (AGENTS.md section 9; skill `whole-run-investigation`): a run is evidence only about the code it ran (`bun run runs source --has <text>`). Read the log's events and the report before any agent's prose, keep the counts apart, and word a claim by `attribution-and-proof`.",
  },
  {
    id: "rehearsal",
    command: /\bbun run runs (rehearse|seed)\b|--dry-run\b/u,
    said: "A path proved without a model (skill `system-path-simulation`): a rehearsal shows that the path runs and writes its events, and nothing about a model. Its Referee seat is empty, so a scripted rejection stays unruled.",
  },
  {
    id: "suite",
    command: /\bbun (run (test|gate)|test)\b/u,
    said: "Checks (AGENTS.md section 11): use `bun run test -- <paths>`, never bare `bun test`, and while editing only the owning test files. Run one full suite at a time on a host. `bun run gate` is the CI gate. Where the wall's tests fail without user namespaces, name them, and do not call the suite green.",
  },
  {
    id: "credentials",
    command: /(^|[\s'"/=])\.env\b|--env-file/u,
    path: /(^|\/)\.env(\.[^/]*)?$/u,
    said: "Credentials (AGENTS.md sections 10 and 11): never open, print or copy `.env` or a `--env-file`, and never copy one into another checkout to make a command start.",
  },
  {
    id: "seats",
    path: /(^|\/)src\/(builder|examiner|solver|referee|harness)\/|(^|\/)tools\/d2\/(campaign-actions|harness-builder)\.ts$/u,
    said: "A seat's view (rule 3; `design-and-seats`, sections 2 and 3): with a changed hidden value, check or won held-out task, everything a Builder or solver reads must stay byte-identical (`test/builder.test.ts`, `test/builder-led.test.ts`). A pull request touching such a message says how it checked this; `bun .claude/skills/design-and-seats/scripts/seat-view.ts` names the seats a diff reaches and their wall tests. Give a model facts, never a course.",
  },
  {
    id: "measurement",
    path: /(^|\/)src\/kernel\/(compare|reports|size|solve)\.ts$|(^|\/)src\/campaign\/(comparison|round|decide|admission|climb|ground)\.ts$/u,
    said: "The measurement (`comparison-reading`, section 7; rules 1, 4, 5 and 12): terms are fixed before the first solve, both sides are solved afresh, and each decision has one owner. Honesty is never traded for less code. Prove a changed reader with `bun run runs replay`. `bun .claude/skills/comparison-reading/scripts/size.ts` says what a size can show, and `reading.ts <log|name>` prints a log's readings side by side.",
  },
  {
    id: "campaign",
    path: /(^|\/)src\/campaign\/|(^|\/)tools\/d2\//u,
    said: "A campaign's commands (`campaign-mechanics`, section 6): endings, admissions, the setting and practice release. Prove a changed round or campaign with `bun run runs rehearse` on a seed. `bun .claude/skills/campaign-mechanics/scripts/ending.ts <name>` says why a campaign ended and how the table reads its log now.",
  },
  {
    id: "wall",
    path: /(^|\/)src\/wall\/|(^|\/)src\/tools\/command\.ts$/u,
    said: "The OS wall (`repository-practice`, section 10): Seatbelt on macOS and Bubblewrap on Linux. A suite run on one says nothing about the other. Grant whole folders. An unavailable wall is a typed non-result.",
  },
  {
    id: "log",
    path: /(^|\/)src\/kernel\/(log|task|condition|trace)\.ts$/u,
    said: "The log (`campaign-mechanics`, section 5): add no second store or second reader. Old event kinds stay readable in `EVENT_KINDS`. Read through the existing folds and `bun run runs` readers.",
  },
  {
    id: "code",
    path: /(^|\/)(src|tools|test|packages)\/.*\.tsx?$/u,
    said: "Code (AGENTS.md section 12): read `tools/oxlint/HABITS.md` whole before the first line. The strict lint adds no finding. Production code imports `node:` only through `src/meta`. A test checks facts, never wording. Run `/simplify` on the diff before the commit.",
  },
  {
    id: "untouched",
    path: /(^|\/)(\.ana|data\/runs|vendor|node_modules|\.accounts)\//u,
    said: "Never touched (AGENTS.md section 11, rule 2): `.ana/`, `data/runs/`, packs, check programs, kept harnesses, credentials and installed dependencies. `vendor/` changes only by a sed of upstream.",
  },
  {
    id: "prose",
    path: /(^|\/)(AGENTS\.md|docs\/.*\.md|\.claude\/skills\/.*\.md)$/u,
    said: "Writing (AGENTS.md section 13): plain British English, no em dashes, identifiers in backticks, absolute dates. Each fact lives in one place: its invariant in AGENTS.md, its account in the skill that keeps the same section number, and its procedure in its skill.",
  },
  {
    id: "ui",
    path: /(^|\/)packages\/ui\//u,
    said: "The UI (`packages/ui/DESIGN.md`) renders the production folds and reads nothing for itself. Its own gate is `bun run ui:gate`.",
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
  // The routes a session has been told, in a file named by its id; an id that could name a path
  // keeps none, and every call is told afresh.
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
  const additionalContext = routes.map((route) => route.said).join("\n\n");
  return capturedJsonStringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } });
}

if (import.meta.main) {
  try {
    const said = main(await Bun.stdin.text());
    if (said !== "") console.log(said);
  } catch {
    // A hook that cannot read its input says nothing: it informs, and must never hold a tool call.
  }
}
