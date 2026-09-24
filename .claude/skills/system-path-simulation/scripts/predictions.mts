/**
 * The prediction note's three mechanical duties, so none of them is done by hand again.
 *
 *   --hash      record a checksum for the pre-registered part (everything above `## Resolutions`)
 *   --verify    prove the pre-registered part still matches that checksum
 *   --resolve   append one resolution row under `## Resolutions`, after verifying
 *   --unresolved verify the frozen part and list every declared row id (P1, R4, A2, ...) that has
 *               no resolution yet
 *
 * The recorded failures: four conditions finished with their predictions unresolved; the sha256 was
 * computed by hand in a shell whose policy then blocked the append, so the resolution went through
 * a throwaway Python script. A row id is any `X<n> —` at the start of a line in the pre-registered
 * part; a resolution is a line starting with `- X<n>` (or `- X<n>–X<m>`) below `## Resolutions`.
 * The checksum is an integrity check for this simulation's advisory projection. The campaign's
 * frozen prediction/event ledger remains the only authority for launch, consumption and adjudication;
 * this helper cannot create or replace that ledger. Every read, including the close-like
 * `--unresolved` query, verifies the projection checksum. There is deliberately no override that
 * can append a verdict to a changed pre-registered note; start a new note when the question changed.
 *
 *   bun .claude/skills/system-path-simulation/scripts/predictions.mts --file /abs/predictions.md --hash
 *   bun .claude/skills/system-path-simulation/scripts/predictions.mts --file /abs/predictions.md \
 *     --resolve "P3: refuted — 25 of 25 case rows carry no per-case instant; patched on #331"
 */

import { existsSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { sha256 } from "#src/meta/digest.ts";
import { isAbsolute, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";

const die: ExitWith = exitWith("predictions");

const RESOLUTIONS_HEADING = /^## Resolutions\b.*$/m;
const ROW_ID = /^([A-Z]\d+) —/gm;
const RESOLVED_ID = /^- ([A-Z])(\d+)(?:[–-]([A-Z])?(\d+))?\b/gm;
const RESOLUTION_HEAD =
  /^- ([A-Z]\d+)(?:[–-][A-Z]?\d+)?:\s*(sufficed|partial|refuted|untriggered|inconclusive)\b/;

const parsed = parseOrDie(die, {
  values: ["file", "resolve"],
  flags: ["hash", "verify", "unresolved"],
});

const fileOption = parsed.single.get("file");
export interface SplitNote {
  preRegistered: string;
  resolutions: string | null;
}

if (fileOption === undefined || !isAbsolute(fileOption)) {
  die("--file must be an absolute path to the prediction note");
}
const file = resolve(fileOption);
if (!existsSync(file)) die(`${file} does not exist`);
/** `<file>.sha256` is written by --hash; a hand-written `<stem>.sha256` beside it is also read. */
const checkCandidates = [`${file}.sha256`, file.replace(/\.md$/, ".sha256")];
const checksumPath =
  checkCandidates.find((path) => existsSync(path)) ?? checkCandidates[0] ?? `${file}.sha256`;

const modes = [
  parsed.flags.has("hash") ? "hash" : null,
  parsed.flags.has("verify") ? "verify" : null,
  parsed.flags.has("unresolved") ? "unresolved" : null,
  parsed.single.has("resolve") ? "resolve" : null,
].filter((mode): mode is string => mode !== null);
if (modes.length !== 1) die("pass exactly one of --hash, --verify, --unresolved or --resolve <row>");
const mode = modes[0];

/** Everything above the `## Resolutions` heading is the frozen part (digested without trailing
 *  whitespace, so the blank line before an appended heading changes nothing); below is appendable. */
export function splitNote(text: string): SplitNote {
  const match = RESOLUTIONS_HEADING.exec(text);
  if (match === null) return { preRegistered: text, resolutions: null };
  return { preRegistered: text.slice(0, match.index), resolutions: text.slice(match.index) };
}

export function declaredRows(preRegistered: string): string[] {
  return preRegistered
    .matchAll(ROW_ID)
    .map((row) => row[1] ?? "")
    .filter((id) => id !== "")
    .toArray();
}

export function resolvedRows(resolutions: string | null): Set<string> {
  const ids = new Set<string>();
  if (resolutions === null) return ids;
  for (const row of resolutions.matchAll(RESOLVED_ID)) {
    const letter = row[1] ?? "";
    const from = Number(row[2]);
    const to = row[4] === undefined ? from : Number(row[4]);
    if ((row[3] ?? letter) !== letter) continue;
    for (let n = from; n <= to; n += 1) ids.add(`${letter}${n}`);
  }
  return ids;
}

function resolutionIds(row: string): string[] {
  const match = /^([A-Z])(\d+)(?:[–-]([A-Z])?(\d+))?:\s*/.exec(row);
  if (match === null) {
    die(
      'a resolution must name one declared row or a same-letter range, for example "P3: sufficed — evidence"',
    );
  }
  const letter = match[1] ?? "";
  const from = Number(match[2]);
  const endLetter = match[3] ?? letter;
  const to = match[4] === undefined ? from : Number(match[4]);
  if (endLetter !== letter) die(`resolution range ${letter}${from}-${endLetter}${to} crosses row letters`);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) {
    die(`resolution range ${letter}${from}-${letter}${to} is not ascending`);
  }
  return Array.from({ length: to - from + 1 }, (_, index) => `${letter}${from + index}`);
}

/**
 * The row ids a resolution names, refused when one is undeclared or already taken.
 *
 * Both callers ask the same two questions and differ only in what "taken" means: inside one
 * append it is a sibling row in the same block, across appends it is the ledger, and the clause
 * says which so the failure is legible.
 */
function claimedIds(
  row: string,
  known: ReadonlySet<string>,
  taken: ReadonlySet<string>,
  clause: string,
): string[] {
  const ids = resolutionIds(row);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    die(`${unknown.join(", ")} is not a declared row; declared: ${[...known].join(" ")}`);
  }
  const duplicate = ids.find((id) => taken.has(id));
  if (duplicate !== undefined) {
    die(
      `${duplicate} ${clause}; create an immutable successor prediction note instead of overwriting or contradicting it`,
    );
  }
  return ids;
}

function validateResolutions(resolutions: string | null, preRegistered: string): void {
  if (resolutions === null) return;
  const known = new Set(declaredRows(preRegistered));
  const seen = new Set<string>();
  for (const line of resolutions.split(/\r?\n/)) {
    const content = line.trim();
    if (!content.startsWith("- ") || !/^- [A-Z]\d+/.test(content)) continue;
    const row = content.slice(2);
    const head = RESOLUTION_HEAD.exec(content);
    if (head === null) die(`malformed resolution row ${JSON.stringify(content)}`);
    for (const id of claimedIds(row, known, seen, "has more than one resolution")) seen.add(id);
  }
}

function readChecksum(): string {
  if (!existsSync(checksumPath)) die(`${checksumPath} is missing — run --hash before the condition starts`);
  const raw = readFileSync(checksumPath, "utf8");
  const checksum = raw.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/.test(checksum)) die(`${checksumPath} does not hold a sha256`);
  return checksum;
}

/** Returns null when the checksum matches, otherwise the one-line description of the change. */
function checksumMismatch(text: string): string | null {
  const checksum = readChecksum();
  const part = splitNote(text).preRegistered;
  // A checksum computed by hand before this script existed may cover the trailing newline.
  const actual = sha256(part.trimEnd());
  if (actual === checksum || sha256(part) === checksum) return null;
  return `the pre-registered part changed after its checksum was recorded (recorded ${checksum.slice(0, 12)}, now ${actual.slice(0, 12)})`;
}

function verify(text: string): string {
  const note = splitNote(text);
  const checksum = readChecksum();
  const mismatch = checksumMismatch(text);
  if (mismatch !== null) die(`${mismatch}; do not edit above ## Resolutions`);
  validateResolutions(note.resolutions, note.preRegistered);
  return checksum;
}

const text = readFileSync(file, "utf8");

if (mode === "hash") {
  const note = splitNote(text);
  // The projection checksum is one-way. A changed note starts a new campaign-owned ledger entry;
  // this helper never selects a condition, consumes a campaign allowance or promotes a result.
  if (existsSync(checksumPath)) {
    const checksum = verify(text);
    const rows = declaredRows(note.preRegistered);
    console.log(`${checksum}  ${rows.length} row(s): ${rows.join(" ")} (projection checksum unchanged)`);
  } else {
    const rows = declaredRows(note.preRegistered);
    // A note with no parsable row binds no predictions. On 2026-09-06 five rows written as "- P1: …"
    // were hashed, and the first --resolve found the declared list empty after the conditions ran.
    if (rows.length === 0) die('no declared row; a row starts its line as "P1 — <prediction>"');
    const digest = sha256(note.preRegistered.trimEnd());
    writeFileSync(checksumPath, `${digest}  ${file}\n`);
    console.log(`${digest}  ${rows.length} row(s): ${rows.join(" ")} (projection checksum)`);
  }
} else if (mode === "verify") {
  const checksum = verify(text);
  console.log(`verified ${checksum.slice(0, 12)} — advisory projection unchanged`);
} else if (mode === "unresolved") {
  // Listing open rows is a read of the frozen ledger, not a best-effort convenience. A changed
  // pre-registered part must not be allowed to look like a clean close merely because no append
  // was requested.
  verify(text);
  const note = splitNote(text);
  const resolved = resolvedRows(note.resolutions);
  const open = declaredRows(note.preRegistered).filter((id) => !resolved.has(id));
  console.log(open.length === 0 ? "UNRESOLVED: none" : `UNRESOLVED: ${open.join(" ")}`);
  runtimeProcess.exit(open.length === 0 ? 0 : 1);
} else {
  const row = (parsed.single.get("resolve") ?? "").trim();
  const head = /^([A-Z]\d+)(?:[–-][A-Z]?\d+)?:\s*(sufficed|partial|refuted|untriggered|inconclusive)\b/.exec(
    row,
  );
  if (head === null) {
    die('a resolution reads "P3: sufficed|partial|refuted|untriggered|inconclusive — evidence"');
  }
  verify(text);
  const note = splitNote(text);
  const known = new Set(declaredRows(note.preRegistered));
  claimedIds(row, known, resolvedRows(note.resolutions), "already has a resolution");
  const record = new Date().toISOString().slice(0, 10);
  const heading = note.resolutions === null ? `\n## Resolutions (appended from ${record})\n\n` : "";
  const body = text.endsWith("\n") ? text : `${text}\n`;
  writeFileSync(file, `${body}${heading}- ${row}\n`);
  console.log(`appended ${head[1]} (${head[2]})`);
}
