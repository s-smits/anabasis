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

interface Kept {
  readonly session: string;
  readonly text: string;
}

export const MEMORY_FILE = "MEMORY.md";

const HOME_NOTES = [MEMORY_FILE, "SCRATCHPAD.md"];

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

export function builderMemoryBlock(root: string, sessions: readonly string[]): string {
  const items = sessions.toReversed().flatMap((session): Kept[] => {
    const text = keptOf(root, session);
    return text === "" ? [] : [{ session, text }];
  });
  if (items.length === 0) return "";
  const fitted = fitContextToBudget(items, TIMELINE, render);
  const newest = items.at(0);
  if (!fitted.overBudget || newest === undefined) return fitted.text;
  const over = fitted.text.length - CONTEXT_OUTPUT_LIMIT;
  return render([
    {
      session: newest.session,
      text: within(newest.text, newest.text.length - over),
    },
  ]);
}

export function keepMemory(home: string, root: string, session: string): void {
  try {
    if (existsSync(join(root, session))) return;
    const text = HOME_NOTES.map((name) => join(home, name))
      .filter((notes) => lstatSync(notes, { throwIfNoEntry: false })?.isFile() === true)
      .map((notes) => readFileSync(notes, "utf8").trim())
      .filter((part) => part !== "")
      .join("\n\n");
    if (text === "") return;
    mkdirSync(join(root, session), { recursive: true });
    const room = CONTEXT_OUTPUT_LIMIT - render([{ session, text: "" }]).length;
    writeFileSync(join(root, session, MEMORY_FILE), `${within(text, room)}\n`);
  } catch {
    // Ignore note persistence failures so a round is never aborted over optional memory.
  }
}
