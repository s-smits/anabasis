/**
 * Supplies area-specific guidance before a coding tool call, once per area per session.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";

/** One repository area: matchers, core invariants, primary skill, and related skills by trigger. */
interface Route {
  readonly id: string;
  readonly command?: RegExp;
  readonly path?: RegExp;
  readonly said: string;
  readonly skill: string | null;
  readonly also?: readonly (readonly [string, string])[];
}

export interface ToolInput {
  readonly command?: string | readonly string[];
  readonly file_path?: string;
  readonly notebook_path?: string;
}

interface Call {
  readonly command: string;
  readonly paths: readonly string[];
}

const ROUTES: readonly Route[] = [
  {
    id: "stack",
    command:
      /\b(git (worktree add|push|rebase|commit)|gh (pr (create|edit|ready)|stack)|bun run (land|follow|split)|republish\.ts)\b/u,
    said: "Stack & PRs (AGENTS.md §11): inspect `bun .claude/skills/stack-pr/scripts/stack.ts` first. Stack new draft PRs on the cycle's top (`gh pr create --draft --base <top>`, linked via `bun run land -- <new top> --sanitize`); extend an open PR for fixes to its own code. Label with `importance:I0`–`I3` + category; run `bun .claude/skills/repository-practice/scripts/preflight.ts`.",
    skill: "stack-pr",
    also: [
      ["whole-stack regrouping", "consolidate-stack"],
      ["source cleanup", "simplify"],
      ["compartment rewrite", "commit-r"],
      ["complexity deltas", "reduce-complexity"],
      ["evidence claims", "attribution-and-proof"],
    ],
  },
  {
    id: "run",
    command:
      /\bbun run runs (fresh|launch|continue|keep|move|pause|stop|copy|retire|bench)\b|tools\/campaign\/(harness-builder|round|session|checkpoint|promote|import|signal|close)\.ts|tools\/eval\/(accept|examine|draft)\.ts|live-seat/u,
    said: "Paid runs (AGENTS.md §10): obtain authorisation for the named run, launch in a dedicated clean worktree (never main), prove the path model-free and record one falsifiable prediction before solving. Never print `--env-file`; account limits follow rule 15.",
    skill: "run-management",
    also: [
      ["pausing, evicting or forking", "decision-points"],
      ["WRI2P2 cycles or runs bench", "run-improvement-campaign"],
      ["kept-harness audit or handover", "harness-audit"],
    ],
  },
  {
    id: "reading",
    command:
      /\bbun run runs (view|replay|source|status|pulse|active|zip)\b|tools\/wri\/|wri2p2\.ts|studies\/harness2\/(score|compare)\.ts|\blog\.jsonl\b/u,
    said: "Run evidence (AGENTS.md §9): a run proves only its own commit (`bun run runs source --has <text>`). Prefer owning folds (`runs view`, `table.ts`, `reading.ts`, `starter-reads.ts`, `harness-versions.ts`, or `src/kernel/log.ts:read`, where log events wrap payloads under `{ at, kind, data }`); separate outcome counts with denominators.",
    skill: "whole-run-investigation",
    also: [
      ["claims", "attribution-and-proof"],
      ["WRI2P2 steps", "run-improvement-campaign"],
      ["pause or eviction thresholds", "decision-points"],
      ["comparison or external-bench diagnosis", "comparison-review"],
      ["cross-solver evaluation", "compare-systems"],
      ["archiving a run", "zip-run"],
      ["external review bundle", "oracle-handover"],
    ],
  },
  {
    id: "rehearsal",
    command: /\bbun run runs (rehearse|seed)\b|--dry-run\b/u,
    said: "Rehearsals prove code paths and log events, not model behaviour (Auditor is empty, so scripted rejections remain unruled).",
    skill: "system-path-simulation",
    also: [
      ["archive scoring or decision replay", "promotion-tuner"],
      ["cross-solver seed comparison", "compare-systems"],
    ],
  },
  {
    id: "suite",
    command: /\bbun (run (test|gate)|test)\b/u,
    said: "Checks (AGENTS.md §11): run owning tests via `bun run test -- <paths>` (not bare `bun test`, so the router places runs) and `bun run gate` at the top. Missing-userns wall failures count as real failures.",
    skill: "local-checks",
  },
  {
    id: "credentials",
    command: /(^|[\s'"/=])\.env\b|--env-file/u,
    path: /(^|\/)\.env(\.[^/]*)?$/u,
    said: "Credentials (AGENTS.md §10–11): never open, print or copy `.env` or `--env-file`, and never copy one into another checkout to unblock a command.",
    skill: null,
  },
  {
    id: "seats",
    path: /(^|\/)src\/(builder|examiner|solver|audit|harness)\/|(^|\/)tools\/campaign\/(campaign-actions|campaign-status|campaign-terms|harness-builder)\.ts$/u,
    said: "Seat wall (rule 3; AGENTS.md §2–3): perturbing hidden values, checks or held-out winners must leave Builder and solver messages byte-identical (`test/builder.test.ts`, `test/builder-led.test.ts`). Verify with `bun .claude/skills/design-and-seats/scripts/seat-view.ts` (`builder-view.ts <name>` inspects Builder openings). Give models facts, not directives.",
    skill: "design-and-seats",
    also: [
      ["Examiner difficulty calibration", "examiner-complexity"],
      ["harness layout or HARNESS.md audit", "harness-audit"],
      ["path rehearsal", "system-path-simulation"],
    ],
  },
  {
    id: "measurement",
    path: /(^|\/)src\/kernel\/(compare|reports|size|solve)\.ts$|(^|\/)src\/campaign\/(comparison|round|scheduler|admission|climb|state)\.ts$/u,
    said: "Evaluation (AGENTS.md §7; rules 1, 4, 5, 12): pre-register terms, solve both arms afresh, keep one owner per decision. Verify reader changes with `bun run runs replay` and replay decision-rule changes over `data/runs/` before editing (`size.ts`, `reading.ts`, `draw.ts`, `starter-reads.ts`).",
    skill: "comparison-reading",
    also: [
      ["archive decision or scoring replay", "promotion-tuner"],
      ["comparison diagnosis", "comparison-review"],
      ["evidence claims", "attribution-and-proof"],
    ],
  },
  {
    id: "campaign",
    path: /(^|\/)src\/campaign\/|(^|\/)tools\/(campaign|eval)\//u,
    said: "Campaign control (AGENTS.md §6): endings, admissions, settings and practice release. Rehearse changed round or campaign paths with `bun run runs rehearse` (`ending.ts <name>` shows endings and stop state).",
    skill: "campaign-mechanics",
    also: [
      ["model-free rehearsal", "system-path-simulation"],
      ["live fleet ops", "run-management"],
      ["pause or eviction thresholds", "decision-points"],
    ],
  },
  {
    id: "wall",
    path: /(^|\/)src\/sandbox\/|(^|\/)src\/tools\/command\.ts$/u,
    said: "OS isolation (AGENTS.md §10): Seatbelt on macOS, Bubblewrap on Linux (`src/sandbox/`). One platform's suite proves nothing on the other; grant whole folders; an unavailable sandbox yields a typed non-result.",
    skill: "repository-practice",
  },
  {
    id: "log",
    path: /(^|\/)src\/kernel\/(log|task|condition|trace)\.ts$/u,
    said: "Campaign log (AGENTS.md §5): one store, one reader per fact, preserve historical `EVENT_KINDS` (`conditions.ts <name>` lists solve settings).",
    skill: "campaign-mechanics",
  },
  {
    id: "lint",
    path: /(^|\/)(tools\/oxlint\/|\.oxlintrc\.json$)/u,
    said: "Lint rules (`tools/oxlint/HABITS.md` §12.13): register in `tools/oxlint/plugins.ts` and `.oxlintrc.json`, include `meta.docs.examples`, state `no fix` when report-only, update `FIXER-DECISIONS.md`, and verify with `test/lint-registry.test.ts` and `test/rule-examples.test.ts`.",
    skill: "simplify",
  },
  {
    id: "outside",
    path: /(^|\/)studies\/harness2\//u,
    said: "External benchmarks (AGENTS.md §1 & §10): measure out-of-distribution transfer rather than gating promotions; verify experimental conditions and Starter rollout variance before attributing deficits to a harness.",
    skill: "comparison-review",
    also: [
      ["WRI2P2 external evaluation", "run-improvement-campaign"],
      ["cross-solver comparison", "compare-systems"],
    ],
  },
  {
    id: "code",
    path: /(^|\/)(src|tools|test|packages)\/.*\.tsx?$/u,
    said: "Code (AGENTS.md §12): read `tools/oxlint/HABITS.md`; keep strict lint, `bun run simplify -- --gate` and `tools/loc/source-policy.ts` at zero. Import `node:` only through `src/meta`, never import helpers from production (`direction.ts`), and test observable behaviour.",
    skill: "repository-practice",
    also: [
      ["cleanup", "simplify"],
      ["complexity deltas", "reduce-complexity"],
      ["compartment rewrite", "commit-r"],
      ["full repo audit", "system-audit"],
    ],
  },
  {
    id: "untouched",
    // An investigation's and a cycle's folders under `.ana/wri/` are their sessions' to write.
    path: /(^|\/)(\.ana\/(?!wri\/)|data\/runs\/|vendor\/|node_modules\/|\.accounts\/)/u,
    said: "Protected files (AGENTS.md §11, rule 2): never edit campaign records under `.ana/`, `data/runs/`, packs, check programs, kept harnesses, credentials or dependencies (`vendor/` changes only via documented upstream provenance).",
    skill: null,
  },
  {
    id: "prose",
    path: /(^|\/)(AGENTS\.md|docs\/.*\.md|\.claude\/skills\/.*\.md)$/u,
    said: "Writing (AGENTS.md §13): keep invariants in AGENTS.md, mechanisms in numbered skill refs and procedures in owning skills; use §14 canonical terms and inline backticks.",
    skill: "repository-practice",
  },
  {
    id: "checks",
    path: /(^|\/)(\.github\/|\.githooks\/)/u,
    said: "Checks & CI (AGENTS.md §11): GitHub Actions runs only `ci.yml` (dispatched by `land --merge`). Keep other checks local and count Actions runs with `bun .claude/skills/local-checks/scripts/actions.ts`.",
    skill: "local-checks",
  },
  {
    id: "ui",
    path: /(^|\/)packages\/ui\//u,
    said: "UI (`packages/ui/DESIGN.md`): render production folds rather than re-deriving state; validate with `bun run ui:gate`.",
    skill: null,
  },
];

/** File headers inside a Codex patch (`*** Add|Update|Delete File: <path>`). */
const PATCHED = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu;

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

/** The routes `input` enters that `seen` lacks, in table order. */
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
  // Unsafe session ids create no state, so guidance repeats.
  const session = hook.session_id;
  const file =
    isString(session) && /^[\w-]{1,128}$/u.test(session) ? join(tmpdir(), "ana-moments", session) : null;
  const seen = new Set(file !== null && existsSync(file) ? readFileSync(file, "utf8").split("\n") : []);
  const routes = momentsOf(hook.tool_input, seen);
  if (routes.length === 0) return "";
  if (file !== null) {
    mkdirSync(join(tmpdir(), "ana-moments"), { recursive: true });
    appendFileSync(file, routes.map((route) => `${route.id}\n`).join(""));
  }
  const additionalContext = routes
    .map(({ said, skill, also }) => {
      const read = skill === null ? "" : ` Before acting, read \`.claude/skills/${skill}/SKILL.md\`.`;
      const related =
        also === undefined || also.length === 0
          ? ""
          : ` Related: ${also.map(([when, name]) => `${when} -> \`.claude/skills/${name}/SKILL.md\``).join("; ")}.`;
      return `${said}${read}${related}`;
    })
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
