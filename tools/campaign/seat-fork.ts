import type { Api, Model } from "@earendil-works/pi-ai";
import { servedByClaude } from "#src/agent/backends/claude.ts";
import { CLAUDE_SESSIONS_DIR } from "#src/agent/backends/claude-transcript.ts";
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { traceOf } from "#src/kernel/trace.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { SEED_FILE } from "../runs/registry.ts";

export const FORK_OPTIONS = {
  "fork-from": { type: "string" },
  "at-turn": { type: "string" },
  nudge: { type: "string" },
} as const;

interface ForkFlags {
  readonly "fork-from"?: string | undefined;
  readonly "at-turn"?: string | undefined;
  readonly nudge?: string | undefined;
}

type SeatKind = "exam" | "draft" | "build";

function transcriptOf(dirs: readonly string[], seat: SeatKind, session: string, atTurn: number) {
  if (session.endsWith(".jsonl")) return { transcript: session, atTurn };
  if (!isSafePathSegment(session)) throw new Error(`--fork-from ${session}: name a session or a .jsonl path`);
  for (const dir of dirs) {
    const events = read(join(dir, LOG_FILE));
    const started = events.find(({ kind, data }) => kind === `${seat}.started` && data.session === session);
    const root = isString(started?.data.conversation) ? started.data.conversation : session;
    const transcript = join(dir, CLAUDE_SESSIONS_DIR, `${root}.jsonl`);
    if (!existsSync(transcript)) continue;
    const turn = root === session ? atTurn : traceOf(events, seat, session).turns[atTurn - 1]?.turn;
    if (turn === null || turn === undefined) {
      throw new Error(`--at-turn ${String(atTurn)}: session ${session} recorded fewer ${seat} turns`);
    }
    return { transcript, atTurn: turn };
  }
  throw new Error(`--fork-from ${session}: no ${CLAUDE_SESSIONS_DIR}/ transcript in ${dirs.join(" or ")}`);
}

export function seatFork(log: string, seat: SeatKind, model: Model<Api>, flags: ForkFlags) {
  const { "fork-from": from, "at-turn": at, nudge } = flags;
  if (from === undefined && at === undefined && nudge === undefined) return null;
  const folder = dirname(log);
  if (from === undefined || at === undefined || !basename(folder).startsWith("sim-")) {
    throw new Error(
      "--fork-from and --at-turn go together, with an optional --nudge, on a simulation seed (sim-<what>)",
    );
  }
  if (!servedByClaude(model.provider)) {
    throw new Error(`--fork-from needs a Claude seat, not ${model.provider}`);
  }
  const atTurn = Number(at);
  if (!Number.isInteger(atTurn) || atTurn < 1) {
    throw new Error(`--at-turn ${at}: expected a positive integer`);
  }
  const seed = parseJsonAs<{ readonly from: string }>(readFileSync(join(folder, SEED_FILE), "utf8"));
  const text = nudge?.trim() ?? "";
  return {
    seat: {
      persistDir: join(folder, CLAUDE_SESSIONS_DIR),
      fork: transcriptOf([folder, seed.from], seat, from, atTurn),
    },
    resumeWith: text === "" ? "Continue from where you left off." : text,
  };
}
