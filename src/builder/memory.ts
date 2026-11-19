/**
 * The Builder's notes across the sessions of one campaign, on claude-mem's base
 * (github.com/thedotmack/claude-mem, `vendor/claude-mem/`): each session's notes are one item of
 * the campaign's own store, kept when the session ends, and a session opens on the items of the
 * sessions before it, newest first, as many as fit in claude-mem's context limit. The Builder writes
 * the notes in its own session, so no model turn is spent on them, and they are no part of the
 * harness that is frozen and measured.
 *
 * A campaign is claude-mem's project. Its store is the folder `memory/` beside its log, one folder a
 * session holding that session's `MEMORY.md`, and a session reads only the folders of sessions its
 * own campaign's log started before it. Upstream names a project from the working directory's git
 * root and keeps every project in one SQLite database, with a worker that writes observations a
 * model distils from each tool call; none of that is taken. What is taken is how the store reaches
 * a session: claude-mem's fitter (`fitContextToBudget`), which renders the block, measures it and
 * gives up whole items from the end of the list until it fits, and its head-and-tail excerpt
 * (`retainTextHeadTail`) for one item too long to fit whole.
 *
 * The host is outside the Builder's wall, and what it reads here reaches the next opening message:
 * a notes file is read only where it is a plain file, never through a link, which would carry a
 * file the wall denies. A failed keep or read leaves a session without notes and never fails it.
 */
import { CONTEXT_OUTPUT_LIMIT, fitContextToBudget } from "../../vendor/claude-mem/ContextBudget.ts";
import { retainTextHeadTail } from "../../vendor/claude-mem/text-truncation.ts";
import type { ContextConfig } from "../../vendor/claude-mem/types.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";

/** One session's notes, as the opening block lists them. */
interface Kept {
  readonly session: string;
  readonly text: string;
}

/** The file a Builder writes its notes in, in its home, and the one the campaign keeps of it. */
export const MEMORY_FILE = "MEMORY.md";

/** The files of a home whose text is kept: a session begun on the release before claude-mem's base
 *  wrote its notes in `SCRATCHPAD.md` as well, and a stop from this tree would otherwise lose them. */
const HOME_NOTES = [MEMORY_FILE, "SCRATCHPAD.md"];

/** claude-mem's timeline settings at the values that leave its fitter one thing to give up: whole
 *  items from the end of the list, which are the oldest sessions' notes. */
const TIMELINE: ContextConfig = {
  totalObservationCount: 0,
  fullObservationCount: 0,
  sessionCount: 0,
  showReadTokens: false,
  showWorkTokens: false,
  observationTypes: new Set(),
  observationConcepts: new Set(),
  fullObservationField: "narrative",
  showLastSummary: false,
  showLastMessage: false,
  mainAgentOnly: false,
};

/** Rendered first in the opening message, ahead of the public rules and the host's own statements:
 *  below them, the oldest text would read as the latest instruction. */
const HEADER = [
  `Historical notes, model-authored and possibly stale: what earlier sessions of this campaign left in ${MEMORY_FILE},`,
  `newest first, each under its session's id, as many as fit in ${String(CONTEXT_OUTPUT_LIMIT)} characters.`,
  "Nothing here is checked by the host. Everything below this block is current and overrides it.",
].join("\n");

/** Room for the line a cut leaves in place of what it removed. */
const CUT_LINE_RESERVE = 40;

/** The block that shows `shown`, in their order. */
const render = (shown: readonly Kept[]) =>
  [HEADER, ...shown.map(({ session, text }) => `--- ${session} ---\n${text}`)].join("\n\n");

/** `text` in at most `chars` characters: whole where it fits, and otherwise two thirds from its head
 *  and the rest from its tail around a line that counts what went, since Builders differ on whether
 *  the newest note goes first or last. */
function within(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const room = Math.max(0, chars - CUT_LINE_RESERVE);
  const { head, tail } = retainTextHeadTail(text, (room * 2) / 3, room / 3);
  return `${head}\n[${String(text.length - head.length - tail.length)} characters cut here]\n${tail}`;
}

/** The notes kept for `session`: its folder's plain Markdown files in name order, so a folder kept
 *  before claude-mem's base, which holds `SCRATCHPAD.md` beside `MEMORY.md`, opens on both. "" where
 *  there are none or the folder cannot be read. */
function keptOf(root: string, session: string): string {
  const folder = join(root, session);
  try {
    if (lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return "";
    return readdirSync(folder)
      .filter((name) => name.endsWith(".md") && lstatSync(join(folder, name)).isFile())
      .toSorted(compareCodeUnits)
      .map((name) => readFileSync(join(folder, name), "utf8").trim())
      .filter((text) => text !== "")
      .join("\n\n");
  } catch {
    return "";
  }
}

/**
 * The block that opens a session's first message: the notes kept for `sessions`, the sessions this
 * campaign's log started before it, oldest first, read from the campaign's own store `root`. Empty
 * where none left notes, so a first session receives the message it would without memory.
 */
export function builderMemoryBlock(root: string, sessions: readonly string[]): string {
  const items = sessions.toReversed().flatMap((session): Kept[] => {
    const text = keptOf(root, session);
    return text === "" ? [] : [{ session, text }];
  });
  if (items.length === 0) return "";
  const fitted = fitContextToBudget(items, TIMELINE, render);
  const newest = items.at(0);
  if (!fitted.overBudget || newest === undefined) return fitted.text;
  // The newest notes alone are over the limit: cut them by what the block is over.
  const over = fitted.text.length - CONTEXT_OUTPUT_LIMIT;
  return render([
    {
      session: newest.session,
      text: within(newest.text, newest.text.length - over),
    },
  ]);
}

/**
 * Keep what session `session` left in the notes files of `home` (`HOME_NOTES`), the home it worked in, as its item of
 * the campaign's store `root`, cut to what a block holds of it shown alone. Every session opens in a
 * new home, so this is the one way its notes reach the next. Nothing is kept of an empty file, and a
 * session already kept is not written again: a stop keeps a cut session's notes (`keepCutNotes`) and
 * its own end may follow. Cut to the whole limit, the header and the session's line would put a
 * lone note over it, and the read would cut it again under a line counting only the second cut.
 */
export function keepMemory(home: string, root: string, session: string): void {
  try {
    if (existsSync(join(root, session))) return;
    const text = HOME_NOTES.map((name) => join(home, name))
      // The entry itself, never what a link there points at.
      .filter((notes) => lstatSync(notes, { throwIfNoEntry: false })?.isFile() === true)
      .map((notes) => readFileSync(notes, "utf8").trim())
      .filter((part) => part !== "")
      .join("\n\n");
    if (text === "") return;
    mkdirSync(join(root, session), { recursive: true });
    const room = CONTEXT_OUTPUT_LIMIT - render([{ session, text: "" }]).length;
    writeFileSync(join(root, session, MEMORY_FILE), `${within(text, room)}\n`);
  } catch {
    // Notes are a convenience, never a precondition: a session whose notes could not be kept leaves
    // the next to open without them, where failing it would cost the round.
  }
}
