/** Builder-owned Markdown notes, bounded when read and carried between epochs. The Builder edits
 *  these files in its existing session, so no extra model turn is spent rewriting them, and they
 *  stay outside the accepted bundle and carry no correctness authority: memory is what a build
 *  would otherwise have to learn again, never evidence about a candidate. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "../meta/filesystem.ts";
import { AGENT_DIR, CORRECTNESS_MODEL_DIR } from "../meta/bundle-layout.ts";
import { join } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { type CampaignEpochEvidence, type EpochSuccession, epochSuccession } from "./campaign-epoch.ts";

/** The workspace under an epoch directory. It is named here rather than left to the caller because
 *  MEMORY.md is the one thing that crosses epochs, so this file has to resolve a workspace it is
 *  not currently running in. */
export const WORKSPACE_DIR = "workspace";

export const MEMORY_FILE = "MEMORY.md";
export const SCRATCHPAD_FILE = "SCRATCHPAD.md";

/**
 * Paths permitted in a candidate: directories end with "/", files match exactly. One list supplies
 * both the diff check below and the workspace exclusions in domain-repo.ts, so the two cannot
 * disagree about what a candidate is. Every other path stays untracked, which means the Builder's
 * own working files — a generator script it wrote, a helper in the workspace root — sit beside the
 * bundle without ever entering the candidate diff.
 */
export const CANDIDATE_INTERFACE: readonly string[] = [
  AGENT_DIR,
  CORRECTNESS_MODEL_DIR,
  MEMORY_FILE,
  SCRATCHPAD_FILE,
];

/** File-size limits that keep memory short enough to reread: 8 KB is roughly two thousand tokens,
 *  included once per pass. Longer text is cut at a line boundary and marked, so the author can see
 *  that older content went rather than meeting a shorter file with no explanation. One constant per
 *  file bounds both the inherited write and the prompt read, including a read after the Builder has
 *  edited the file directly, because two constants would mean the write path and the read path
 *  disagreeing about what fits. */
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

## Access limits and constraints

## Known failures and fixes

## Risk
<!-- One line: what most threatens the next battery's reading. -->
`;

const STARTER_SCRATCHPAD = `# Scratchpad

Open questions and next steps for the next build. Remove a line when it is resolved.
`;

const FILES: ReadonlyArray<readonly [string, string, number]> = [
  [MEMORY_FILE, STARTER_MEMORY, MEMORY_CAP_BYTES],
  [SCRATCHPAD_FILE, STARTER_SCRATCHPAD, SCRATCHPAD_CAP_BYTES],
];

/** The line a cut leaves where it removed text, and the pattern that finds every earlier one, so a
 *  second cut folds their counts into its own line instead of stacking bookkeeping. */
const CUT_MARKER_PATTERN = /<!-- memory cut to \d+ bytes: (\d+) bytes dropped here -->\n?/g;

/** Room reserved inside the ceiling for that marker line, which is about 60 bytes. Reserving it is
 *  what keeps a cut file inside the limit it was cut to. */
const CUT_MARKER_RESERVE_BYTES = 96;

/** The share of a cut file's budget kept from its head; the rest comes from its tail. */
const HEAD_SHARE = 2 / 3;

/** Where each end of a cut may stop: after a line break, or after any whitespace. */
const WHOLE_UNITS = { head: [/^([\s\S]*\n)/, /^([\s\S]*\s)/], tail: [/\n([\s\S]*)$/, /\s([\s\S]*)$/] };

/** The controller lines at the head of a notes file: the markers `carryMemoryForward` writes to
 *  say where an inherited file came from and which helper files crossed beside it, and the
 *  `controller:` line `noteAtMemoryHead` writes about how this workspace was seeded. A cut that
 *  dropped a carry marker would leave a predecessor's notes reading as this epoch's own, so the cut
 *  keeps them whole ahead of its head share. Every one of them describes the epoch that wrote it,
 *  so the next carry strips them all. A cut's own marker is not among them: it sits where the text
 *  went and stays true of the text in any epoch. A file holding nothing else ends on the last
 *  marker's `-->`, because the read trims it. */
const HEAD_MARKER_PATTERN =
  /^(?:<!-- (?:carried forward from|scratch\/ holds|controller:)[^\n]*-->(?:\n+|$))+/;

/** The Builder's own helper scripts — generators, local checks, debug probes — sit at the top of
 *  `scratch/`, and a successor epoch otherwise rebuilds each one from nothing, so they cross. Only
 *  regular files at the top level and only under this size: the helpers are kilobytes, while an
 *  output directory beside them can hold hundreds of megabytes that a recursive copy would carry.
 *  Scratch is untracked, so nothing that crosses can enter a candidate. */
export const SCRATCH_DIR = "scratch";
const SCRATCH_FILE_LIMIT_BYTES = 256 * 1024;

/** How many helper names the carry marker spells out; the rest are counted. A predecessor can leave
 *  a hundred helpers, and naming each one spent a third of the memory ceiling on a file listing the
 *  Builder can read with ls. */
const HELPER_NAMES_SHOWN = 5;

/** The line at the head of a carried file, by what changed between the two epochs. */
const CARRIED: Record<EpochSuccession, (from: string) => string> = {
  pass: (from) =>
    `<!-- carried forward from ${from}, an earlier pass on this same request. Correct what no longer holds. -->`,
  binding: (from) =>
    `<!-- carried forward from ${from}: the binding changed, this memory did not. Correct what no longer holds. -->`,
};

/** The single owner of "this tracked path may appear in a candidate's diff", so that no caller
 *  re-derives the rule from `CANDIDATE_INTERFACE` and gets the directory suffix wrong. */
export function candidatePathAllowed(path: string): boolean {
  return CANDIDATE_INTERFACE.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
}

/** Starter note files exactly as domain-repo seeds them. One owner for the bytes and for the
 *  question "has this been authored", because `authoredBody` decides that by comparing against
 *  these same strings: a second copy of the starter text would make an untouched file look
 *  written. */
export const STARTER_MEMORY_FILES: ReadonlyArray<readonly [string, string]> = FILES.map(
  ([name, starter]) => [name, starter] as const,
);

/** The authored body of one memory file, or "" when it is missing or still the untouched starter.
 *  An unwritten file is omitted from the prompt entirely, so a first pass receives the same prompt
 *  it would receive if memory did not exist, rather than an empty memory section inviting it to
 *  treat the headings as a form to fill in. A starter under controller lines is just those lines. */
function authoredBody(workspace: string, file: string, starter: string): string {
  let text: string;
  try {
    text = readFileSync(join(workspace, file), "utf8");
  } catch {
    return "";
  }
  const markers = HEAD_MARKER_PATTERN.exec(text)?.[0] ?? "";
  return (text.slice(markers.length).trim() === starter.trim() ? markers : text).trim();
}

/** A memory file grows by appending, so the same headed section arrives once per pass and several
 *  identical copies of it spend the byte cap on text the next session already knows. Keep one copy
 *  of each exact section and drop a heading that carries nothing under it. */
function withoutRepeatedSections(text: string): string {
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

/** One end of a cut, back to whole lines unless that keeps under half the slice, and then to whole
 *  words; either way a character the byte slice split goes with the partial unit. A line cut alone
 *  emptied a note written as one paragraph: run custom-sol-20260929T132256243Z-2d7812 carried none
 *  of a 2,052-byte next-experiment plan over a 72-byte overflow. */
function wholeUnits(slice: string, end: keyof typeof WHOLE_UNITS): string {
  const [line = "", word = ""] = WHOLE_UNITS[end].map((unit) => unit.exec(slice)?.[1] ?? "");
  return line.length * 2 >= slice.length ? line : word;
}

/**
 * Limit one memory file to its declared size, keeping both ends and cutting the middle at line
 * boundaries. Which text survives is the whole decision, and Builders do not agree on where the
 * newest note goes: most write newest-first or under a title and fixed section headings, so a cut
 * that kept only the tail dropped exactly the note the last pass wrote, while an append-only writer
 * puts it at the end. Two thirds of the budget go to the head and the rest to the tail, so either
 * convention keeps its newest note, and the Risk section, which closes the starter layout, stays
 * too.
 *
 * The marker sits where the text went and names how many bytes went, so a writer sees that its file
 * was cut instead of meeting a shorter file with no explanation; earlier markers fold into the new
 * count. The controller lines at the head are kept inside the ceiling wherever the cut falls, so the
 * write path and the read path preserve them by one rule.
 */
function cappedToEnds(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= bytes) return text;
  const pinned = HEAD_MARKER_PATTERN.exec(text)?.[0] ?? "";
  let earlier = 0;
  const unmarked = text.slice(pinned.length).replace(CUT_MARKER_PATTERN, (_line, dropped: string) => {
    earlier += Number.parseInt(dropped, 10);
    return "";
  });
  const body = encoder.encode(unmarked);
  const budget = Math.max(0, bytes - encoder.encode(pinned).byteLength - CUT_MARKER_RESERVE_BYTES);
  const decoder = new TextDecoder();
  const head = wholeUnits(decoder.decode(body.subarray(0, Math.floor(budget * HEAD_SHARE))), "head");
  const headBytes = encoder.encode(head).byteLength;
  const tailSlice = decoder.decode(
    body.subarray(Math.max(headBytes, body.byteLength - (budget - headBytes))),
  );
  const tail = wholeUnits(tailSlice, "tail");
  const dropped = earlier + body.byteLength - headBytes - encoder.encode(tail).byteLength;
  return `${pinned}${head}<!-- memory cut to ${bytes} bytes: ${dropped} bytes dropped here -->\n${tail}`;
}

/** One line saying a notes file is over the size a fresh session reads whole, or null when it fits.
 *  The cut happens on the next read, so the line is what lets the Builder shorten the file itself
 *  before the controller chooses which middle to drop. */
export function memoryOverCapNotice(workspace: string): string | null {
  const over = FILES.flatMap(([file, , cap]) => {
    const size = existsSync(join(workspace, file)) ? Bun.file(join(workspace, file)).size : 0;
    return size > cap ? [`${file} is ${String(size)} bytes, over its ${String(cap)}-byte limit`] : [];
  });
  if (over.length === 0) return null;
  return `${over.join("; ")}: the next round reads its head and tail and drops the middle, so shorten it now.`;
}

/**
 * The memory block that opens a fresh session's first prompt. A resumed conversation gets none,
 * because it still holds the round in which it read these notes. The block is empty until a pass
 * has written something beyond the starter text, so a first build receives the same prompt a build
 * without memory would, with no empty memory section added to its instructions.
 *
 * It is rendered first in the round prompt, ahead of the request and the controller's statements.
 * Below them instead, under the current request, task condition and session limit, the oldest text
 * reads as the latest instruction. The header says the model wrote these notes, that they may
 * describe an earlier condition, and that everything below overrides them; the workspace path and
 * the carried file's epoch marker say where they came from, which is already the history a reader
 * needs, so the block adds no further identity field.
 *
 * The size limit is applied on the read as well as on the carry. `carryMemoryForward` bounds what
 * it stores, but the Builder can grow MEMORY.md afterwards through ordinary file edits, so a read
 * that trusted the stored size would put an unbounded file into a prompt. Both paths use the same
 * rule, keep both ends and mark what went, rather than choosing separate limits or cutting
 * different parts of the file.
 */
export function builderMemoryBlock(workspace: string): string {
  const blocks = FILES.values()
    .map(([file, starter, cap]) => [file, authoredBody(workspace, file, starter), cap] as const)
    .filter(([, body]) => body !== "")
    .map(([file, body, cap]) => `--- ${file} ---\n${cappedToEnds(withoutRepeatedSections(body), cap)}`)
    .toArray();
  if (blocks.length === 0) return "";
  return [
    "Historical notes, model-authored and possibly stale. You wrote these files in earlier passes",
    `in ${workspace}; a "carried forward from <epoch>" marker inside a file names the earlier`,
    'epoch it came from, and a "controller:" line says how this workspace was seeded. Nothing here',
    "is controller-checked. Everything below this block is current and overrides it.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/** Put one controller line at the head of MEMORY.md, for a fact about this workspace the Builder
 *  cannot observe and would otherwise meet as a tool that is missing or a file it did not write:
 *  what seeding did to the tool tree. The file is the right carrier because it is what every round
 *  reads first when it opens in a workspace new to its conversation, including a session reopened
 *  after a restart, and because the Builder may delete the line once it has acted on it. The line
 *  shares the carry markers' pattern, so a cut keeps it and the next epoch's carry drops it, since
 *  that workspace is seeded afresh and gets its own. */
export function noteAtMemoryHead(workspace: string, line: string): void {
  const file = join(workspace, MEMORY_FILE);
  const text = existsSync(file) ? readFileSync(file, "utf8") : STARTER_MEMORY;
  writeFileSync(file, cappedToEnds(`<!-- controller: ${line} -->\n${text}`, MEMORY_CAP_BYTES));
}

function helperMarker(from: string, helpers: readonly string[]): string {
  const shown = helpers.slice(0, HELPER_NAMES_SHOWN).join(", ");
  const rest = helpers.length - HELPER_NAMES_SHOWN;
  return `<!-- scratch/ holds ${from}'s ${String(helpers.length)} helper files: ${shown}${rest > 0 ? ` and ${String(rest)} more` : ""}. -->`;
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
 * A successor epoch opens on its predecessor's notes instead of blank starters. Every measured
 * round reopens the product under a new authoring pass, and a new pass opens a new epoch with a
 * fresh workspace, so this is the ordinary way one round hands its notes to the next; a corrected
 * request or another Builder condition opens one too, more rarely. Harness identity is untouched:
 * the notes sit outside both fingerprinted bundles. They are written before domain-repo seeds its
 * starters, so the inherited text lands in the successor's own root commit.
 *
 * The epoch record says which succession this is, and that decides what crosses. A new pass on the
 * same request and Builder carries both files, because SCRATCHPAD.md holds the open questions and
 * next steps written for exactly this next build. A changed binding carries MEMORY.md alone: the
 * scratchpad's lines were the questions that binding had not answered, so under another one they
 * are neither answered nor open, only unattributable, and a question still worth asking is one the
 * Builder already moved into MEMORY.md. Either way each file opens on a marker naming where it came
 * from, and a binding change says so, so an inherited line is never read as a description of the
 * current ask. Only an authored file crosses, only into a slot the successor has not written, and
 * never fatally.
 */
export function carryMemoryForward(campaignRoot: string, epoch: CampaignEpochEvidence): void {
  const from = epoch.supersedes;
  const succession = epochSuccession(campaignRoot, epoch);
  if (from === null || succession === null) return;
  const prior = join(campaignRoot, from, WORKSPACE_DIR);
  // An epoch key never escapes its campaign root, even in a hand-damaged epochs.json, and the root
  // itself is not a workspace either, so the equal case refuses as well.
  if (prior === campaignRoot || !containsPath(prior, campaignRoot)) return;
  const next = join(epoch.dir, WORKSPACE_DIR);
  let helpers: string[] = [];
  try {
    helpers = carryScratchHelpers(prior, next);
  } catch {
    // Helpers are a convenience like the notes themselves: a failed copy leaves the Builder to
    // rewrite them, which costs minutes, while failing the epoch over them would cost the round.
  }
  const helperLine = helpers.length === 0 ? [] : [helperMarker(from, helpers)];
  for (const [file, starter, cap] of FILES) {
    if (succession === "binding" && file !== MEMORY_FILE) continue;
    const marker = [CARRIED[succession](from), ...(file === MEMORY_FILE ? helperLine : [])].join("\n");
    try {
      // The predecessor's own markers name its predecessor, while this epoch names only the file it
      // inherits from. Kept, they would stack one line per epoch at the head of the file.
      const body = authoredBody(prior, file, starter).replace(HEAD_MARKER_PATTERN, "");
      if (body === "" || existsSync(join(next, file))) continue;
      mkdirSync(next, { recursive: true });
      // The predecessor's file may already be over its ceiling, and the marker adds to it. Cap here
      // so the successor opens on a file the read path passes through whole.
      writeFileSync(join(next, file), cappedToEnds(`${marker}\n\n${body}\n`, cap));
    } catch {
      // Inherited notes are a convenience, never a precondition: the epoch starts on the starter
      // instead of failing to open over notes it would have been able to rewrite.
    }
  }
}
