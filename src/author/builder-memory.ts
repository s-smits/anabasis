/** Builder-owned Markdown notes, bounded when read and carried between epochs. The Builder edits
 *  them directly; they stay outside the accepted bundle and carry no correctness authority. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "../meta/filesystem.ts";
import { AGENT_DIR, CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import type { CampaignEpochEvidence } from "./campaign-epoch.ts";

/** The workspace under an epoch directory; carrying memory forward resolves a predecessor's. */
export const WORKSPACE_DIR = "workspace";

export const MEMORY_FILE = "MEMORY.md";
export const SCRATCHPAD_FILE = "SCRATCHPAD.md";
export const EXPERIMENT_FILE = "EXPERIMENT.json";

/**
 * Paths permitted in a candidate: directories end with "/", files match exactly. It drives both
 * `candidatePathAllowed` and the workspace exclusions in domain-repo.ts; every other path stays
 * untracked.
 */
export const CANDIDATE_INTERFACE: readonly string[] = [
  AGENT_DIR,
  CORRECTNESS_MODEL_DIR,
  MEMORY_FILE,
  SCRATCHPAD_FILE,
  EXPERIMENT_FILE,
];

/** Per-file size limits, applied both to inherited writes and to prompt reads. 8 KB is roughly
 *  two thousand tokens, read once per pass. */
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

/** Finds an existing cut marker, so a second cut replaces it rather than adding another line. */
const CUT_MARKER_PATTERN = /^<!-- memory cut to \d+ bytes: (\d+) older bytes dropped -->\n/;

/** Room reserved inside the limit for the cut marker line (about 60 bytes). */
const CUT_MARKER_RESERVE_BYTES = 96;

/** The carry-forward markers at the head of an inherited file. A newest-first cut would drop the
 *  head, so the cut keeps them explicitly; without them a predecessor's notes read as current. */
const CARRY_MARKER_PATTERN =
  /^(?:<!-- (?:carried forward from|This epoch is a CLIMB|scratch\/ holds)[^\n]*-->\n+)+/;

/** Small helper files at the top of `scratch/` cross epochs; directories and large files stay. */
const SCRATCH_DIR = "scratch";
const SCRATCH_FILE_LIMIT_BYTES = 256 * 1024;

/** Whether a tracked path may appear in a candidate's diff. */
export function candidatePathAllowed(path: string): boolean {
  return CANDIDATE_INTERFACE.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

/** Starter note files as domain-repo seeds them. */
export const STARTER_MEMORY_FILES: ReadonlyArray<readonly [string, string]> = FILES.map(
  ([name, starter]) => [name, starter] as const,
);

/** The authored body of one memory file, or "" when it is missing or still the starter text. */
function authoredBody(workspace: string, file: string, starter: string): string {
  let text: string;
  try {
    text = readFileSync(join(workspace, file), "utf8");
  } catch {
    return "";
  }
  return text.trim() === starter.trim() ? "" : text.trim();
}

/** Keeps one copy of each identical `## ` section and drops headings with nothing under them, so
 *  repeated appends do not spend the size limit. */
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

/**
 * Limits a memory file to `bytes`, keeping the newest text and cutting at a line boundary. A marker
 * states how many older bytes were dropped, merging any earlier marker's count, and carry-forward
 * markers are kept at the head.
 */
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
 * The memory block that opens a fresh session's first prompt; empty until a pass has written
 * beyond the starter text. Its header marks the notes as model-authored and possibly stale, and
 * says the instructions below take precedence. Reads apply the same size limits as carrying,
 * because the Builder can grow the files directly.
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

/**
 * Opens a successor epoch on its predecessor's MEMORY.md and small `scratch/` helpers, before the
 * workspace is seeded, so the inherited text lands in the root commit. A marker says the binding
 * changed and some lines may no longer hold. SCRATCHPAD.md does not cross: its open questions
 * belong to the old binding. Only into an unwritten slot, and never fatally.
 */
export function carryMemoryForward(campaignRoot: string, epoch: CampaignEpochEvidence): void {
  const from = epoch.supersedes;
  if (from === null) return;
  const prior = join(campaignRoot, from, WORKSPACE_DIR);
  // An epoch key never escapes its campaign root, and the root itself is no workspace.
  if (prior === campaignRoot || !containsPath(prior, campaignRoot)) return;
  const next = join(epoch.dir, WORKSPACE_DIR);
  let helpers: string[] = [];
  try {
    helpers = carryScratchHelpers(prior, next);
  } catch {
    // Helpers are a convenience; a failed copy leaves the Builder to rewrite them.
  }
  const marker = [
    `<!-- carried forward from ${from}: the binding changed, this memory did not. Correct what no longer holds. -->`,
    ...(helpers.length > 0
      ? [`<!-- scratch/ holds ${from}'s helper files, written for its binding: ${helpers.join(", ")}. -->`]
      : []),
  ].join("\n");
  try {
    // Drop the predecessor's own carry markers so they do not stack one line per epoch.
    const body = authoredBody(prior, MEMORY_FILE, STARTER_MEMORY).replace(CARRY_MARKER_PATTERN, "");
    if (body === "" || existsSync(join(next, MEMORY_FILE))) return;
    mkdirSync(next, { recursive: true });
    // Cap here so the successor opens on a file the read path passes through whole.
    writeFileSync(join(next, MEMORY_FILE), cappedToNewest(`${marker}\n\n${body}\n`, MEMORY_CAP_BYTES));
  } catch {
    // Inherited memory is never a precondition; the epoch starts empty instead.
  }
}
