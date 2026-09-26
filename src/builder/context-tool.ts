/**
 * The `context` tool: one question over everything an authoring round may consult, answered with
 * the lines that bear on it and a citation for each.
 *
 * It replaced a list/read/search tool over the `--context` files alone, which 160 recorded Builder
 * sessions called six times, every time over an empty corpus, because no run ever supplied one. The
 * material a Builder actually needed sat elsewhere: the solver traces of cases that passed, which no
 * session read because nothing granted a path to them, and the recorded batteries, behind a paging
 * mode of `harness_inspect`. So the tool now holds five sources and always has content, and the
 * caller states what it wants to know and which decision the answer settles, which is what the
 * scoring and the evidence record both read.
 *
 * Every document is recorded public data, the Builder's own notes or the solver's own record of a
 * solve. Nothing here opens verifier output, a hidden expectation, a reference artifact or a
 * per-check result: history and trace documents are built by readers that name the fields they
 * copy, and a field they do not name never reaches the text.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { existsSync, readdirSync, readFileSync, statSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import { defineTool } from "../solve/define-tool.ts";
import { eachFileLine, readFileCharacterWindow, readFileWindow } from "./file-window.ts";
import { truncateLine } from "../meta/truncate.ts";
import { characterLimit, characterWindow, LIST_WINDOW_ROWS, readWindow, windowNote } from "./read-window.ts";
import type { PreparedUserContext, UserContextFile } from "./user-context.ts";

type ContextSource = "round" | "workspace" | "history" | "traces" | "user";

/** One consultable document. `text` is read when a question reaches the document, so a history
 *  page nobody asks about is never projected. A user file is streamed from its admitted snapshot
 *  instead, because the corpus may be 200 MB. */
export type ContextDocument = {
  id: string;
  source: ContextSource;
  title: string;
} & ({ text: () => string } | { file: UserContextFile });

export interface ContextBinding {
  /** The text this round opened with: its contract, the climb readout and the advice. */
  round: string;
  /** The round plan's compact view with this round's rehearsal evidence; absent before a plan is
   *  asked for. */
  plan?: () => string;
  workspace: string;
  /** Recorded batteries of this product, newest first; absent before anything was measured. */
  history?: () => ContextDocument[];
  /** Passing measured cases' solver traces and submitted artifacts. */
  traces?: () => ContextDocument[];
  rehearsals: RehearsalTraces;
  user: PreparedUserContext;
}

type Cited = { id: string; line: number; score: number; text: string };

const WORKSPACE_FILES = ["EXPERIMENT.json", "MEMORY.md", "SCRATCHPAD.md", "STARTER.md"];
const STARTER_PACK = "starter-pack";
const CITED_DEFAULT = 30;
const MIN_TERM = 3;
const STOPWORDS = new Set(
  "the and for are was were that this with from what which when where does did how why who can could should would will into than then them they their there these those have has had not but its any all our your you about over under after before between only also more most each other some such very".split(
    " ",
  ),
);

const Params = Type.Object({
  question: Type.String({ description: "What you want to know, in your own words." }),
  decides: Type.String({ description: "The decision the answer will settle." }),
  source: Type.Optional(
    Type.Union(
      [
        Type.Literal("round"),
        Type.Literal("workspace"),
        Type.Literal("history"),
        Type.Literal("traces"),
        Type.Literal("user"),
      ],
      {
        description: "Restrict to one source; omit to ask all of them.",
      },
    ),
  ),
  depth: Type.Optional(
    Type.Union([Type.Literal("overview"), Type.Literal("cited"), Type.Literal("page")], {
      description:
        "cited (default): matching lines with citations. overview: the documents. page: one id, exactly.",
    }),
  ),
  id: Type.Optional(Type.String({ description: "One document id: required for page, optional for cited." })),
  offset: Type.Optional(
    Type.Number({ description: "1-based first line (page), citation (cited) or document (overview)." }),
  ),
  limit: Type.Optional(Type.Number({ description: "Lines, citations or documents to return." })),
  characterOffset: Type.Optional(Type.Number({ description: "Exact character page for one long line." })),
});

const DESCRIPTION =
  "Ask one question of everything this round may consult; the answer is the lines that bear on it, each cited as id:Lnn. Sources: round (this round's contract, climb readout and advice, and the plan view: your EXPERIMENT.json read back with this round's rehearsal verdicts, effort and any advice), workspace (EXPERIMENT.json, MEMORY.md, SCRATCHPAD.md, STARTER.md and starter-pack/*.md, read live), history (every measured battery of this product, newest first, and each one's public tasks), traces (the solver's own record of each passing measured case and passing rehearsal: its turns, tool calls and effort against the solve wall, and the artifact it submitted) and user (files supplied with --context, when any were). State the question and the decision it settles. depth cited is the default; overview lists document ids; page reads one id exactly. Workspace files are also readable with read or bash; history, traces and user files only here. All of it is public data or your own notes, never verifier output.";

/** The solves of this round's passing rehearsals, filled by `harness_trial` as they finish and read
 *  here. One object per round, held by the controller, so the two tools share it without either
 *  owning the other. */
export class RehearsalTraces {
  private readonly documents: ContextDocument[] = [];

  add(id: string, title: string, lines: readonly string[]): void {
    const text = lines.join("\n");
    this.documents.push({ id, source: "traces", title, text: () => text });
  }

  /** A passing rehearsal's trace, and the bytes it submitted as a measured pass's are offered:
   *  withholding them left a paid battery as a round's only way to read what its own solver found. */
  addPass(ordinal: number, taskId: string, traceLines: readonly string[], artifact: string | null): void {
    const id = `traces/rehearsal-${String(ordinal)}/${taskId}`;
    this.add(id, `the passing rehearsal of ${taskId}`, traceLines);
    if (artifact !== null) {
      this.add(`${id}/artifact`, `the artifact the passing rehearsal of ${taskId} submitted`, [artifact]);
    }
  }

  list(): ContextDocument[] {
    return [...this.documents];
  }
}

function workspaceDocuments(workspace: string): ContextDocument[] {
  const packDir = join(workspace, STARTER_PACK);
  const pack = existsSync(packDir)
    ? readdirSync(packDir)
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => `${STARTER_PACK}/${name}`)
    : [];
  return [...WORKSPACE_FILES, ...pack].flatMap((rel) => {
    const path = join(workspace, rel);
    if (!existsSync(path) || !statSync(path).isFile()) return [];
    return [
      { id: `workspace/${rel}`, source: "workspace", title: rel, text: () => readFileSync(path, "utf8") },
    ];
  });
}

function documentsOf(binding: ContextBinding): ContextDocument[] {
  return [
    {
      id: "round/opening",
      source: "round",
      title: "this round's opening context",
      text: () => binding.round,
    },
    ...(binding.plan === undefined
      ? []
      : [
          {
            id: "round/plan",
            source: "round" as const,
            title: "the round plan and its evidence",
            text: binding.plan,
          },
        ]),
    ...workspaceDocuments(binding.workspace),
    ...(binding.history?.() ?? []),
    ...(binding.traces?.() ?? []),
    ...binding.rehearsals.list(),
    ...binding.user.files.map((file) => ({
      id: file.id,
      source: "user" as const,
      title: `${file.label} sha256:${file.sha256}`,
      file,
    })),
  ];
}

function eachLine(doc: ContextDocument, visit: (line: string, number: number) => void): void {
  if ("file" in doc) {
    eachFileLine(doc.file.path, visit);
    return;
  }
  doc
    .text()
    .split(/\r?\n/)
    .forEach((line, index) => visit(line, index + 1));
}

/** The lines sharing the question's distinct content words, best match first, with those words. */
function cite(docs: readonly ContextDocument[], question: string) {
  const words = question.toLocaleLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [];
  const terms = [
    ...new Set(
      words.flatMap((raw) => {
        const word = raw.replaceAll(/^[.-]+|[.-]+$/g, "");
        return word.length >= MIN_TERM && !STOPWORDS.has(word) ? [word] : [];
      }),
    ),
  ];
  if (terms.length === 0) throw new Error("the question names no word of three or more letters to match");
  // One matching term is noise once a question names three or more, so a line must share two.
  const need = terms.length >= 3 ? 2 : 1;
  const hits: Cited[] = [];
  for (const doc of docs) {
    eachLine(doc, (line, number) => {
      const lower = line.toLocaleLowerCase();
      const score = terms.filter((term) => lower.includes(term)).length;
      if (score >= need) hits.push({ id: doc.id, line: number, score, text: truncateLine(line.trim()).text });
    });
  }
  // Stable: equal scores keep document order, then line order.
  return { terms, hits: hits.toSorted((a, b) => b.score - a.score) };
}

/** The document list, paged like a read so a corpus of thousands of user files stays under the tool
 *  ceiling and the offset it names is the one that continues. */
function overview(docs: readonly ContextDocument[], offset?: number, limit?: number): string {
  const listing = docs.map((doc) => `- ${doc.id} (${doc.source}): ${doc.title}`).join("\n");
  const window = readWindow(listing, offset, limit ?? LIST_WINDOW_ROWS);
  return `${windowNote(window, "documents")}:\n${window.text}`;
}

function page(doc: ContextDocument, offset?: number, limit?: number, characterOffset?: number): string {
  if ("file" in doc) {
    const { file } = doc;
    const lines = characterOffset === undefined ? readFileWindow(file.path, file.lines, offset, limit) : null;
    const chars =
      characterOffset !== undefined || lines?.cut === true
        ? readFileCharacterWindow(file.path, file.characters, characterOffset, characterLimit(limit))
        : null;
    const window = chars ?? lines;
    if (window === null) throw new Error("context page window was not constructed");
    const note = windowNote(
      window,
      chars === null ? "lines" : "characters",
      chars === null ? "offset" : "characterOffset",
    );
    return `${doc.id} ${doc.title} — ${note}\n\n${window.text}`;
  }
  const text = doc.text();
  const lines = characterOffset === undefined ? readWindow(text, offset, limit) : null;
  const chars =
    characterOffset !== undefined || lines?.cut === true
      ? characterWindow(text, characterOffset, characterLimit(limit))
      : null;
  const window = chars ?? lines;
  if (window === null) throw new Error("context page window was not constructed");
  const note = windowNote(
    window,
    chars === null ? "lines" : "characters",
    chars === null ? "offset" : "characterOffset",
  );
  return `${doc.id} ${doc.title} — ${note}\n\n${window.text}`;
}

export function createContextTool(binding: ContextBinding): AgentTool<typeof Params> {
  return defineTool({
    name: "context",
    label: "Context",
    description: DESCRIPTION,
    parameters: Params,
    run: async (params) => {
      const depth = params.depth ?? "cited";
      const all = documentsOf(binding);
      const scoped = all.filter(
        (doc) =>
          (params.source === undefined || doc.source === params.source) &&
          (params.id === undefined || doc.id === params.id),
      );
      if (params.id !== undefined && scoped.length === 0) {
        throw new Error(`unknown context id: ${params.id}; call with depth overview for the ids`);
      }
      let text: string;
      let cited = 0;
      if (depth === "overview") {
        text = overview(scoped, params.offset, params.limit);
      } else if (depth === "page") {
        const [doc] = scoped;
        if (params.id === undefined || doc === undefined) throw new Error("depth page requires id");
        text = page(doc, params.offset, params.limit, params.characterOffset);
      } else {
        const { terms, hits } = cite(scoped, params.question);
        const from = Math.max(1, Math.trunc(params.offset ?? 1));
        const shown = hits.slice(from - 1, from - 1 + Math.max(1, Math.trunc(params.limit ?? CITED_DEFAULT)));
        cited = shown.length;
        const to = from - 1 + shown.length;
        text =
          hits.length === 0
            ? `No line shares enough of the terms ${terms.join(", ")}. Documents asked:\n${overview(scoped)}`
            : [
                `Citations ${from}-${to} of ${hits.length} over ${scoped.length} document(s), best match first${to < hits.length ? `; continue with offset ${to + 1}` : ""}. Page an id for the surrounding lines.`,
                ...shown.map((hit) => `[${hit.id}:L${hit.line}] ${hit.text}`),
              ].join("\n");
      }
      const resultDigest = sha256(text);
      return {
        text,
        details: {
          question: params.question,
          decides: params.decides,
          depth,
          documents: scoped.length,
          cited,
          receipt: { outcome: "completed", resultDigest },
        },
      };
    },
  });
}
