import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";

const SHELL_WORDS: ReadonlySet<string> = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "esac",
  "!",
  "{",
  "}",
]);
const NO_PROGRAM: ReadonlySet<string> = new Set([
  "cd",
  "for",
  "case",
  "select",
  "export",
  "set",
  "source",
  ".",
]);
const PREFIXES: ReadonlySet<string> = new Set([
  "env",
  "time",
  "timeout",
  "nice",
  "nohup",
  "exec",
  "command",
  "xargs",
  "stdbuf",
  "sudo",
]);
const SHELLS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash"]);
const INTERPRETER = /^(python[\d.]*|bun|node|deno|ruby|perl|Rscript|php|tsx)$/;
const PROGRAM_WORD = /^[\w./+@:-]+$/;
const NAME = /^(?!-)(?:[\w.@:-]*[A-Za-z_][\w.@:-]*|[\w.-]*[A-Za-z][\w.-]*\+\+)$/;
const ASSIGNMENT = /^\w+=/;
const HEREDOC = /(?<!<)<<-?\s*(['"]?)(\w+)\1([^\n]*)(?:\n(?:[^\n]*\n)*?[ \t]*\2[ \t]*(?=\n|$)|[\s\S]*$)/g;
const REDIRECTION = /^\d*(?:[<>]+|&>>?)&?/;
const FD_DUP = /&\d$/;
const INLINE_FLAG = /^-\w*c\w*$/;
const DIGIT_START = /^\d/;
const SPACE_CHARS: ReadonlySet<string> = new Set([" ", "\t", "\r", "\f", "\v"]);
const BREAK_CHARS: ReadonlySet<string> = new Set(["\n", ";", "|", "&", "(", ")", "`"]);

export interface CallPrograms {
  readonly programs: readonly string[];
  readonly unattributed: number;
}

interface Word {
  readonly text: string;
  readonly quoted: boolean;
}

const REDIR_END = /[<>]$/;

function segmentsOf(command: string): Word[][] {
  const segments: Word[][] = [];
  let current: Word[] = [];
  let [word, quoted, inDouble] = ["", false, false];
  const end = () => {
    if (word !== "" || quoted) current.push({ text: word, quoted });
    [word, quoted] = ["", false];
  };
  const flush = () => {
    end();
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at] ?? "";
    if (inDouble) {
      if (char === '"') inDouble = false;
      else word += char === "\\" ? (command[(at += 1)] ?? "") : char;
    } else if (char === "'") {
      quoted = true;
      const close = command.indexOf("'", at + 1);
      const stop = close === -1 ? command.length : close;
      word += command.slice(at + 1, stop);
      at = stop;
    } else if (char === '"') [inDouble, quoted] = [true, true];
    else if (char === "\\") word += command[(at += 1)] ?? "";
    else if (SPACE_CHARS.has(char)) end();
    else if (char === "&" && (REDIR_END.test(word) || command[at + 1] === ">")) word += char;
    else if (BREAK_CHARS.has(char) || (char === "$" && command[at + 1] === "(")) {
      if (char === "$") at += 1;
      flush();
    } else word += char;
  }
  flush();
  return segments;
}

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const named = (word: Word | undefined, fallback: string) =>
  word === undefined || !PROGRAM_WORD.test(word.text) || !NAME.test(base(word.text))
    ? fallback
    : base(word.text);

function withoutRedirections(words: readonly Word[]): Word[] {
  const kept: Word[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at];
    if (word === undefined) continue;
    if (
      word.quoted ||
      (!word.text.includes(">") && !word.text.includes("<")) ||
      !REDIRECTION.test(word.text)
    ) {
      kept.push(word);
    } else if (word.text.replace(REDIRECTION, "") === "" && !FD_DUP.test(word.text)) {
      at += 1;
    }
  }
  return kept;
}

function afterPrefixes(words: readonly Word[]): number {
  let at = words.findIndex(
    ({ text, quoted }) => quoted || (!ASSIGNMENT.test(text) && !SHELL_WORDS.has(text)),
  );
  while (at >= 0) {
    const prefix = words[at]?.text;
    if (prefix === undefined || !PREFIXES.has(prefix)) return at;
    at += 1;
    while (at < words.length && /^[-]|^\w+=/.test(words[at]?.text ?? "")) at += 1;
    if (prefix === "timeout" && DIGIT_START.test(words[at]?.text ?? "")) at += 1;
  }
  return -1;
}

const firstTarget = (words: readonly Word[], skip = "") =>
  words.find(({ text }) => !text.startsWith("-") && text !== skip);

function segmentPrograms(all: readonly Word[]): readonly string[] | null {
  const words = withoutRedirections(all);
  const at = afterPrefixes(words);
  const first = words[at];
  if (first === undefined) return [];
  if (first.quoted || !PROGRAM_WORD.test(first.text)) return null;
  const program = base(first.text);
  if (NO_PROGRAM.has(program)) return [];
  if (!NAME.test(program)) return null;
  const rest = words.slice(at + 1);
  if (SHELLS.has(program)) {
    const inline = rest.findIndex(({ text, quoted }) => !quoted && INLINE_FLAG.test(text));
    const body = inline === -1 ? undefined : rest[inline + 1];
    return body === undefined ? [named(firstTarget(rest), program)] : programsIn(body.text).programs;
  }
  if (INTERPRETER.test(program)) {
    const module = rest.findIndex(({ text }) => text === "-m");
    if (module !== -1 && rest[module + 1] !== undefined) return [named(rest[module + 1], program)];
    if (rest.some(({ text }) => text === "-c" || text === "-e")) return [program];
    return [named(firstTarget(rest, "run"), program)];
  }
  return [program];
}

function programsIn(command: string): CallPrograms {
  const programs: string[] = [];
  let unattributed = 0;
  const body = command.includes("<<") ? command.replaceAll(HEREDOC, "$3") : command;
  for (const segment of segmentsOf(body)) {
    const found = segmentPrograms(segment);
    if (found === null) unattributed += 1;
    else programs.push(...found);
  }
  return { programs, unattributed };
}

export function callPrograms(call: { readonly tool: string; readonly args: JsonValue }): CallPrograms {
  if (call.tool !== "bash") return { programs: [call.tool], unattributed: 0 };
  const command = asRecord(call.args)?.command;
  return isString(command) ? programsIn(command) : { programs: [], unattributed: 1 };
}
