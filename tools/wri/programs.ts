/**
 * Which programs one solve's call ran (`programsOf`): the one reader of it, for the calls table
 * (`calls.ts`), a harness's parts (`parts.ts`), provenance and each solve's fold (`Solve.programs`,
 * `folds.ts`). It sits apart from `calls.ts` because the fold reads it and `calls.ts` reads the fold.
 *
 * A bash command splits into segments at a line, a list, a pipe, a subshell or a substitution; each
 * segment runs the program its first word names past assignments, shell words, redirections and
 * prefixes (`timeout 30`, `env -i`), into a shell's `-c` text and an interpreter's script or module.
 * A heredoc's body is data and never a command. A segment whose first word is a variable, a quoted
 * word or no program's name (`..`, the `i+1` of `$((i+1))`) counts as not attributed. A library a
 * script imports is not traced: it runs under the script's name.
 */
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";

/** A shell word a segment may open with that runs no program of its own. */
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
/** A segment opened by one of these runs no program: a directory change or a loop's or case's head. */
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
/** Words that run the program after them: their own options, and `timeout`'s duration, are skipped. */
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
/** Interpreters whose first file argument is the program run. */
const INTERPRETER = /^(python[\d.]*|bun|node|deno|ruby|perl|Rscript|php|tsx)$/;
const PROGRAM_WORD = /^[\w./+@:-]+$/;
/** A program's name, its path dropped: a letter or `_` somewhere, no leading `-`, and `+` only as a
 *  closing `++` (`g++`); so `..`, `1` and `i+1` name none. */
const NAME = /^(?!-)(?:[\w.@:-]*[A-Za-z_][\w.@:-]*|[\w.-]*[A-Za-z][\w.-]*\+\+)$/;
const ASSIGNMENT = /^\w+=/;
/** A heredoc's body, kept to the rest of its first line: its body is data, never a command. */
const HEREDOC = /(?<!<)<<-?\s*(['"]?)(\w+)\1([^\n]*)(?:\n(?:[^\n]*\n)*?[ \t]*\2[ \t]*(?=\n|$)|[\s\S]*$)/g;
const REDIRECTION = /^\d*(?:[<>]+|&>>?)&?/;

/** The programs one call ran: a `bash` call's, each once a segment, and any other tool's own name;
 *  `unattributed` counts the segments whose program the command's text does not name. */
export interface CallPrograms {
  readonly programs: readonly string[];
  readonly unattributed: number;
}

interface Word {
  readonly text: string;
  readonly quoted: boolean;
}

/** A command's words, segment by segment: a line, a list, a pipe, a subshell or a substitution ends one. */
function segmentsOf(command: string): Word[][] {
  const segments: Word[][] = [[]];
  let word = "";
  let quoted = false;
  let quote: string | null = null;
  const end = () => {
    if (word !== "" || quoted) segments.at(-1)?.push({ text: word, quoted });
    word = "";
    quoted = false;
  };
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at] ?? "";
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"') word += command[(at += 1)] ?? "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      quoted = true;
    } else if (char === "\\") word += command[(at += 1)] ?? "";
    else if (/\s/.test(char) && char !== "\n") end();
    else if (char === "&" && (/[<>]$/.test(word) || command[at + 1] === ">")) word += char;
    else if ("\n;|&()`".includes(char) || (char === "$" && command[at + 1] === "(")) {
      end();
      if (char === "$") at += 1;
      segments.push([]);
    } else word += char;
  }
  end();
  return segments.filter((segment) => segment.length > 0);
}

const base = (path: string) => path.replace(/^.*\//, "");

/** A script's or module's name where it can be one, else the interpreter's or shell's own. */
const named = (word: Word | undefined, fallback: string) =>
  word === undefined || !PROGRAM_WORD.test(word.text) || !NAME.test(base(word.text))
    ? fallback
    : base(word.text);

/** A segment's words less its redirections: `2>&1`, `>out` and `> out`, `<in`, wherever they stand. */
function withoutRedirections(words: readonly Word[]): Word[] {
  const kept: Word[] = [];
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at];
    if (word === undefined || word.quoted || !REDIRECTION.test(word.text)) {
      if (word !== undefined) kept.push(word);
      continue;
    }
    // An operator standing alone takes the next word for its file.
    if (word.text.replace(REDIRECTION, "") === "" && !/&\d$/.test(word.text)) at += 1;
  }
  return kept;
}

/** The program a segment's words run, past assignments, shell words and prefixes, into a shell's
 *  `-c` text and an interpreter's script; `null` where the text names none, `[]` where none runs. */
function segmentPrograms(all: readonly Word[]): readonly string[] | null {
  const words = withoutRedirections(all);
  let at = words.findIndex(
    ({ text, quoted }) => quoted || (!ASSIGNMENT.test(text) && !SHELL_WORDS.has(text)),
  );
  while (at >= 0 && at < words.length && PREFIXES.has(words[at]?.text ?? "")) {
    const prefix = words[at]?.text;
    at += 1;
    while (
      at < words.length &&
      ((words[at]?.text ?? "").startsWith("-") || ASSIGNMENT.test(words[at]?.text ?? ""))
    ) {
      at += 1;
    }
    if (prefix === "timeout" && /^\d/.test(words[at]?.text ?? "")) at += 1;
  }
  const first = words[at];
  if (first === undefined) return [];
  if (first.quoted || !PROGRAM_WORD.test(first.text)) return null;
  const program = base(first.text);
  if (NO_PROGRAM.has(program)) return [];
  if (!NAME.test(program)) return null;
  const rest = words.slice(at + 1);
  if (SHELLS.has(program)) {
    const inline = rest.findIndex(({ text, quoted }) => !quoted && /^-\w*c\w*$/.test(text));
    const body = inline === -1 ? undefined : rest[inline + 1];
    if (body !== undefined) return programsIn(body.text).programs;
    return [
      named(
        rest.find(({ text }) => !text.startsWith("-")),
        program,
      ),
    ];
  }
  if (INTERPRETER.test(program)) {
    const module = rest.findIndex(({ text }) => text === "-m");
    if (module !== -1 && rest[module + 1] !== undefined) return [named(rest[module + 1], program)];
    if (rest.some(({ text }) => text === "-c" || text === "-e")) return [program];
    return [
      named(
        rest.find(({ text }) => !text.startsWith("-") && text !== "run"),
        program,
      ),
    ];
  }
  return [program];
}

function programsIn(command: string): CallPrograms {
  const programs: string[] = [];
  let unattributed = 0;
  for (const segment of segmentsOf(command.replaceAll(HEREDOC, "$3"))) {
    const found = segmentPrograms(segment);
    if (found === null) unattributed += 1;
    else programs.push(...found);
  }
  return { programs, unattributed };
}

/** The programs one call ran (`CallPrograms`). */
export function programsOf(call: { readonly tool: string; readonly args: JsonValue }): CallPrograms {
  if (call.tool !== "bash") return { programs: [call.tool], unattributed: 0 };
  const command = asRecord(call.args)?.command;
  return isString(command) ? programsIn(command) : { programs: [], unattributed: 1 };
}
