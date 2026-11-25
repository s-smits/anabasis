/**
 * What every handler is given and may throw, apart from the router (`api.ts`), so a handler module
 * and the router do not import each other.
 */
import type { AnswerOf, Endpoint, Query, Tier } from "../models.ts";

/** Where the campaigns are found: every worktree of the repository (`runs`,
 *  `tools/runs/registry.ts`), or one directory holding `.ana/d2/<name>/log.jsonl` (`serve.ts --repo
 *  <dir>`). */
export type Trees = "worktrees" | "directory";

export interface Reading {
  readonly repo: string;
  readonly trees: Trees;
  readonly tier: Tier;
  readonly now?: (() => number) | undefined;
}

export type Handler<Name extends Endpoint> = (reading: Reading, query: Query<Name>) => AnswerOf<Name>;

/** A request a handler cannot answer as asked: an unknown campaign, move, solve, task or harness
 *  file, or an unreadable parameter. The router answers with its status. */
export class Unanswerable extends Error {
  readonly status: 400 | 404;
  constructor(status: 400 | 404, message: string) {
    super(message);
    this.status = status;
  }
}
