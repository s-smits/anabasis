/** Builder-owned Markdown notes, bounded when read and carried between epochs.
 * The author edits these files in its existing session. No extra model turn rewrites them.
 * Notes stay outside the accepted bundle and carry no correctness authority. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "../meta/filesystem.ts";
import { AGENT_DIR, CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import type { CampaignEpochEvidence } from "./campaign-epoch.ts";

/** The workspace under an epoch directory. Named here because MEMORY.md is the one thing
 *  that crosses epochs and so must resolve a workspace it is not currently running in. */
export const WORKSPACE_DIR = "workspace";

export const MEMORY_FILE = "MEMORY.md";
export const SCRATCHPAD_FILE = "SCRATCHPAD.md";
export const EXPERIMENT_FILE = "EXPERIMENT.json";

/**
 * Paths permitted in a candidate: directories end with "/", files match exactly. This list
 * supplies both the diff check below and the workspace exclusions in domain-repo.ts.
 * Every other path stays untracked. Extra workspace files, such as run 50's
 * `starter-pack/gen.py` or run 53's helpers in the workspace root, therefore stay outside
 * the candidate diff.
 */
export const CANDIDATE_INTERFACE: readonly string[] = [
  AGENT_DIR,
  CORRECTNESS_MODEL_DIR,
  MEMORY_FILE,
  SCRATCHPAD_FILE,
  EXPERIMENT_FILE,
];

/** File-size limits keep memory short enough to reread: 8 KB is roughly two thousand tokens,
 *  included once per pass. Longer text is cut at a line boundary and marked so the author can
 *  see that older content was removed. One constant per file limits both inherited writes and
 *  prompt reads, including reads after the Builder has edited the file directly. */
export const MEMORY_CAP_BYTES = 8_000;
const SCRATCHPAD_CAP_BYTES = 2_000;

/** Headings keyed to what the Builder actually decides, so a pass finds its own section. */
export const STARTER_MEMORY = `# Builder memory

Keep the useful notes for this domain here. Update them when your understanding changes and keep
them short enough to read before each build. Checked domain rules live in correctness-model/brief.json; this
file records what the next build would otherwise need to learn again.

## Domain and representation

## Tools and verifier

## Task families

## Tools

## Access limits and constraints

## Known failures and fixes
`;

const STARTER_SCRATCHPAD = `# Scratchpad

Open questions and next steps for the next build. Remove a line when it is resolved.
`;

const FILES: ReadonlyArray<readonly [string, string, number]> = [
  [MEMORY_FILE, STARTER_MEMORY, MEMORY_CAP_BYTES],
  [SCRATCHPAD_FILE, STARTER_SCRATCHPAD, SCRATCHPAD_CAP_BYTES],
];

/** The marker a cut leaves at the top of the file, and the pattern that finds an existing one so a
 *  second cut replaces it instead of stacking another line of bookkeeping. */
const CUT_MARKER_PATTERN = /^<!-- memory cut to \d+ bytes: (\d+) older bytes dropped -->\n/;

/** Room reserved inside the ceiling for that marker line, which is about 60 bytes. */
const CUT_MARKER_RESERVE_BYTES = 96;

/** The carry-forward marker `carryMemoryForward` writes at the head of an inherited file, and the
 *  climb line beside it. Both state what the text below them no longer describes, so a cut that
 *  dropped them would leave a predecessor's notes reading as this epoch's own. They sit at the
 *  head, which is the end a newest-first cut takes, so the cut keeps them explicitly. */
const CARRY_MARKER_PATTERN =
  /^(?:<!-- (?:carried forward from|This epoch is a CLIMB|scratch\/ holds)[^\n]*-->\n+)+/;

/**
 * A successor epoch opens on its predecessor's MEMORY.md instead of a blank starter. A climb changes
 * the kickoff, a changed binding writes a successor with a fresh workspace, and the engine and
 * representation lessons the next difficulty level most wants were exactly the ones being discarded (plan
 * review, 2026-07-27). Harness identity is untouched: memory sits outside both fingerprinted bundles
 * and enters no bundleSnapshot. Written before domain-repo seeds its starters, so the inherited text
 * lands in the successor's own root commit instead of arriving as an unexplained later edit.
 *
 * The marker is required rather than decoration: the binding changed, which is why this epoch
 * exists, so an inherited line may no longer hold and the Builder is told so instead of reading
 * the text as a description of its current ask. Only an authored file crosses, only into a slot
 * the successor has not written, and never fatally.
 *
 * A successor may come from a corrected request, engine identity or Builder condition.
 *
 * MEMORY.md alone crosses. SCRATCHPAD.md is the open-question list of one binding: its lines are
 * the questions that binding had not answered yet, so under a new binding they are neither
 * answered nor still open, only unattributable. It is dropped rather than migrated — a successor
 * that still needs a question keeps it in MEMORY.md, where the Builder had to decide it was worth
 * keeping.
 *
 * Beside the memory, the Builder's own helper scripts cross: small regular files at the top of
 * `scratch/` (generators, local checks, debug probes). Successor epochs rebuilt them from nothing,
 * about fifteen minutes each; in truss campaign -11 they were a few kilobytes while one output
 * directory beside them held 585 MB, so directories and large files stay behind. Scratch is
 * untracked, so nothing carried enters a candidate.
 */
const SCRATCH_DIR = "scratch";
const SCRATCH_FILE_LIMIT_BYTES = 256 * 1024;

/** The single owner of "this tracked path may appear in a candidate's diff". */
export function candidatePathAllowed(path: string): boolean {
  return CANDIDATE_INTERFACE.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

/** Starter files as domain-repo seeds them; one owner for the bytes and for "is this authored". */
export const STARTER_MEMORY_FILES: ReadonlyArray<readonly [string, string]> = FILES.map(
  ([name, starter]) => [name, starter] as const,
);

/** The authored body of one memory file, or "" when it is missing or still the untouched starter.
 *  Omit unwritten files from the prompt, so a first pass receives no empty memory section
 *  and keeps the same prompt it would receive without memory. */
function authoredBody(workspace: string, file: string, starter: string): string {
  let text: string;
  try {
    text = readFileSync(join(workspace, file), "utf8");
  } catch {
    return "";
  }
  return text.trim() === starter.trim() ? "" : text.trim();
}

/**
 * Limit one memory file to its declared size, keeping the newest bytes and cutting at a line
 * boundary. Run 52's MEMORY.md grew to 8,660 and then 10,174 bytes against an 8,000-byte limit.
 * Keeping the start of the file removed the notes that the L2 and L3 climb authors had just
 * appended, which were the ones the next session needed.
 *
 * The marker names how many older bytes went, so a writer sees that its file was cut instead of
 * finding a shorter file with no explanation. A file already carrying a marker adds its count to
 * the new one rather than growing a second marker line. A carry-forward marker is kept inside the
 * ceiling wherever the cut runs, so the write path and the read path preserve it by one rule
 * instead of the writer passing it in and the reader losing it.
 */
/**
 * A memory file that grew by appending the same headed section each pass (run c66e0d: three
 * identical "## Status" blocks) spends its byte cap on repetition. Keep one copy of each exact
 * section and drop a heading that carries nothing under it.
 */
export function withoutRepeatedSections(text: string): string {
  const seen = new Set<string>();
  const [head = "", ...sections] = `\n${text}`.split("\n## ");
  const kept: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed.includes("\n") || seen.has(trimmed)) continue;
    seen.add(trimmed);
    kept.push(section);
  }
  return [head, ...kept].join("\n## ").slice(1);
}

function cappedToNewest(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= bytes) return text;
  const prior = CUT_MARKER_PATTERN.exec(text);
  const uncut = prior === null ? text : text.slice(prior[0].length);
  const pinned = CARRY_MARKER_PATTERN.exec(uncut)?.[0] ?? "";
  const body = encoder.encode(uncut.slice(pinned.length));
  const budget = Math.max(0, bytes - encoder.encode(pinned).byteLength - CUT_MARKER_RESERVE_BYTES);
  const start = Math.max(0, body.byteLength - budget);
  const tail = new TextDecoder().decode(body.subarray(start));
  // Only a slice can open mid-line; an untouched body keeps its first line.
  const cut = start === 0 ? -1 : tail.indexOf("\n");
  const kept = `${(cut >= 0 ? tail.slice(cut + 1) : tail.replace(/^\uFFFD+/, "")).trim()}\n`;
  const dropped = Number.parseInt(prior?.[1] ?? "0", 10) + body.byteLength - encoder.encode(kept).byteLength;
  return `<!-- memory cut to ${bytes} bytes: ${dropped} older bytes dropped -->\n${pinned}${kept}`;
}

/**
 * The memory block for a session prompt. The persistent Builder receives it once per pass,
 * in builder-session.ts's firstPrompt. Later turns can read it in the same session context
 * without another copy, and the cached system prompt stays unchanged.
 * The block is empty until a pass has written something beyond the starter text.
 * A first build therefore receives the same prompt as a build without memory, with no empty
 * memory section added to its instructions.
 *
 * Rendered first in the kickoff. Previously, notes from an earlier pass or run condition appeared
 * below the current request, task condition, session limit and controller checks. That placement
 * could make the oldest text look like the latest instruction. The header now explains that
 * the model wrote these notes, that they may describe an earlier condition, and that the current
 * instructions below take precedence. The workspace path and the carried file's epoch marker
 * identify where the notes came from. They already provide the needed history, so the memory
 * block does not add another identity field.
 *
 * Apply the size limit when reading as well as when carrying notes forward. carryMemoryForward
 * limits what it stores, but the Builder can make MEMORY.md larger through direct file edits.
 * Prompt reads therefore apply the same per-file limits, preserve the newest text and mark
 * any removed content. Both operations use the same rule rather than choosing separate
 * limits or cutting different ends of the file.
 */
export function builderMemoryBlock(workspace: string): string {
  const blocks = FILES.values()
    .map(([file, starter, cap]) => [file, authoredBody(workspace, file, starter), cap] as const)
    .filter(([, body]) => body !== "")
    .map(([file, body, cap]) => `--- ${file} ---\n${cappedToNewest(withoutRepeatedSections(body), cap)}`)
    .toArray();
  if (blocks.length === 0) return "";
  return [
    "Historical notes, model-authored and possibly stale. You wrote these files in earlier passes",
    `in ${workspace}; a "carried forward from <epoch>" marker inside a file names the epoch it came`,
    "from, before the current binding. Nothing here is controller-checked. Everything below this",
    "block is current and overrides it.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function carryScratchHelpers(prior: string, next: string): string[] {
  const from = join(prior, SCRATCH_DIR);
  const to = join(next, SCRATCH_DIR);
  if (!existsSync(from) || existsSync(to)) return [];
  const names = readdirSync(from, { withFileTypes: true })
    .filter((entry) => entry.isFile() && Bun.file(join(from, entry.name)).size <= SCRATCH_FILE_LIMIT_BYTES)
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) return [];
  mkdirSync(to, { recursive: true });
  for (const name of names) writeFileSync(join(to, name), readFileSync(join(from, name)));
  return names;
}

export function carryMemoryForward(campaignRoot: string, epoch: CampaignEpochEvidence): void {
  const from = epoch.supersedes;
  if (from === null) return;
  const prior = join(campaignRoot, from, WORKSPACE_DIR);
  // An epoch key never escapes its campaign root, even in a hand-damaged epochs.json. The root
  // itself is not a workspace either, so the equal case refuses exactly as before.
  if (prior === campaignRoot || !containsPath(prior, campaignRoot)) return;
  const next = join(epoch.dir, WORKSPACE_DIR);
  let helpers: string[] = [];
  try {
    helpers = carryScratchHelpers(prior, next);
  } catch {
    // Helpers are a convenience like memory: a failed copy leaves the Builder to rewrite them.
  }
  const marker = [
    `<!-- carried forward from ${from}: the binding changed, this memory did not. Correct what no longer holds. -->`,
    ...(helpers.length > 0
      ? [`<!-- scratch/ holds ${from}'s helper files, written for its binding: ${helpers.join(", ")}. -->`]
      : []),
  ].join("\n");
  try {
    // The predecessor's own carry markers named its predecessor; this epoch names
    // only the file it inherits from. Kept, they stacked one line per epoch (run 1093c9
    // opened its fourth epoch on three of them).
    const body = authoredBody(prior, MEMORY_FILE, STARTER_MEMORY).replace(CARRY_MARKER_PATTERN, "");
    if (body === "" || existsSync(join(next, MEMORY_FILE))) return;
    mkdirSync(next, { recursive: true });
    // The predecessor's file may already be over the ceiling, and the marker adds to it. Cap here
    // so the successor opens on a file the read path passes through whole.
    writeFileSync(join(next, MEMORY_FILE), cappedToNewest(`${marker}\n\n${body}\n`, MEMORY_CAP_BYTES));
  } catch {
    // Inherited memory is a convenience, never a precondition: the epoch starts empty instead.
  }
}
