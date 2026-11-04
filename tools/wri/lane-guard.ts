/**
 * The hook the `wri-lane` agent type (`.claude/agents/wri-lane.md`) runs before each of its tool
 * calls: it refuses a write anywhere but the lane's own report or the synthesis, a shell command that
 * would spend, start a seat or move a campaign, and a read of an env file. Everything else passes.
 *
 * The hard rules of a whole-run investigation ("never write under the campaign's folder", "start no
 * solve, session, round or check run", `AGENTS.md` section 10 item 5) were text in every lane prompt
 * until 4 November 2026, and a lane session kept them by reading them. The operator asked for a Claude
 * agent type of its own for the lanes, so the rules a tool call can break are now refused in code,
 * and the prompt keeps only those a call cannot show (quote nothing behind the walls). A refusal
 * names its reason, so a lane that needed the call says so in its report.
 */
import { realpathSync } from "../../src/meta/filesystem.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { basename, resolve } from "../../src/meta/path.ts";
import { runtimeProcess } from "../../src/meta/process.ts";

/** A lane writes its report, and the synthesis session its note, both inside an investigation. */
const WRITABLE = /\/\.ana\/wri\/[^/]+\/(?:lanes\/\d{2}-report\.md|synthesis\.md)$/u;

/** Scratch a lane keeps for itself, which the hard rules put in a temporary directory of its own. */
const SCRATCH = [tmpdir(), realpathSync(tmpdir()), "/tmp", "/private/tmp"];

/** Commands that spend, start a seat or a solve, write a log, or move what a campaign holds. */
const REFUSED: readonly (readonly [RegExp, string])[] = [
  [/\b(?:harness-builder|live-seat|word|promote|settle|accept)\.ts\b/u, "a campaign command"],
  [/\bcompare-systems\b|\bgpt-sessions\.ts\b/u, "a paid session"],
  [/\bruns\s+(?:launch|fresh|continue|keep|move|stop|pause|retire|copy|rehearse|on)\b/u, "a run's life"],
  [/\bwri\.ts\s+(?:start|lanes|collect|synthesis|derive)\b/u, "the primary's step"],
  [/\bgit\s+(?:commit|push|checkout|switch|reset|stash|rebase|merge|worktree)\b/u, "a change to the tree"],
  [
    /(?:>|\btee\b|\bcp\b|\bmv\b|\brm\b|\btrash\b|\bsed\s+-i)[^|;&]*(?:\.ana\/d2|data\/runs|\/states\/|\/exams\/)/u,
    "a write under a campaign",
  ],
  [/(?:^|[\s/'"=])\.env(?:\.runs)?(?=$|[\s'"])/u, "an env file"],
];

/** The fields of a tool call's input the guard reads, each unparsed until it is read. */
interface Input {
  readonly file_path?: unknown;
  readonly notebook_path?: unknown;
  readonly command?: unknown;
}

/** Why the call is refused, or null where it may run. */
export function refusalOf(tool: string, input: Input): string | null {
  const path = [input.file_path, input.notebook_path].find(isString);
  if (tool === "Read") {
    return path !== undefined && /^\.env(?:\.runs)?$/u.test(basename(path)) ? "an env file" : null;
  }
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    const at = path === undefined ? "" : resolve(path);
    return WRITABLE.test(at) || SCRATCH.some((root) => at.startsWith(`${root}/`))
      ? null
      : "a write outside the lane's report";
  }
  if (tool !== "Bash" || !isString(input.command)) return null;
  for (const [pattern, why] of REFUSED) if (pattern.test(input.command)) return why;
  return null;
}

// Exit 2 with the reason on stderr is the refusal a subagent's own hook is documented to give.
if (import.meta.main) {
  const call: unknown = capturedJsonParse(await Bun.stdin.text());
  const input = isRecord(call) && isRecord(call.tool_input) ? call.tool_input : {};
  const why = isRecord(call) && isString(call.tool_name) ? refusalOf(call.tool_name, input) : null;
  if (why !== null) {
    console.error(
      `wri-lane refuses ${why}: a lane reads, and writes its own report only (whole-run-investigation, "Hard rules"). Say in the report what this call would have settled.`,
    );
    runtimeProcess.exitCode = 2;
  }
}
