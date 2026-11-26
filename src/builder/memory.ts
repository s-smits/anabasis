import { CONTEXT_OUTPUT_LIMIT } from "../../vendor/claude-mem/ContextBudget.ts";
import { retainTextHeadTail } from "../../vendor/claude-mem/text-truncation.ts";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";

interface Kept {
  readonly session: string;
  readonly text: string;
}

export const MEMORY_FILE = "MEMORY.md";

const HEADER = [
  `Historical notes, model-authored and possibly stale: what earlier sessions of this campaign left in ${MEMORY_FILE},`,
  `newest first, each under its session's id, as many as fit in ${String(CONTEXT_OUTPUT_LIMIT)} characters.`,
  "Nothing here is checked by the host. Everything below this block is current and overrides it.",
].join("\n");

const CUT_LINE_RESERVE = 40;

const render = (shown: readonly Kept[]) =>
  [HEADER, ...shown.map(({ session, text }) => `--- ${session} ---\n${text}`)].join("\n\n");

function within(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const room = Math.max(0, chars - CUT_LINE_RESERVE);
  const { head, tail } = retainTextHeadTail(text, (room * 2) / 3, room / 3);
  return `${head}\n[${String(text.length - head.length - tail.length)} characters cut here]\n${tail}`;
}

function noteAt(path: string): string {
  try {
    return lstatSync(path, { throwIfNoEntry: false })?.isFile() === true
      ? readFileSync(path, "utf8").trim()
      : "";
  } catch {
    return "";
  }
}

export function builderMemoryBlock(root: string, sessions: readonly string[]): string {
  const shown: Kept[] = [];
  for (const session of sessions.toReversed()) {
    const folder = join(root, session);
    if (lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
    const text = noteAt(join(folder, MEMORY_FILE));
    if (text === "") continue;
    if (render([...shown, { session, text }]).length > CONTEXT_OUTPUT_LIMIT) {
      if (shown.length === 0) shown.push({ session, text: within(text, roomFor(session)) });
      break;
    }
    shown.push({ session, text });
  }
  return shown.length === 0 ? "" : render(shown);
}

const roomFor = (session: string) => CONTEXT_OUTPUT_LIMIT - render([{ session, text: "" }]).length;

export function keepMemory(home: string, root: string, session: string): void {
  try {
    if (existsSync(join(root, session))) return;
    const text = noteAt(join(home, MEMORY_FILE));
    if (text === "") return;
    mkdirSync(join(root, session), { recursive: true });
    writeFileSync(join(root, session, MEMORY_FILE), `${within(text, roomFor(session))}\n`);
  } catch {
    // Ignore note persistence failures so a round is never aborted over optional memory.
  }
}
