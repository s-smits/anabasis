/**
 * Context-compaction policy and summary-cost tracking for `pi-durable`. The campaign log remains
 * the authoritative record, so this module captures committed summary token usage (including
 * failed compaction attempts) at the commit publication boundary before the next generation starts.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  CompactionTask,
  hook,
  UsageDoc,
  type CommitPublication,
  type CompactionPolicy,
  type UsageState,
  type TaskId,
} from "@earendil-works/pi-durable";
import { SWEEP_COMPACT_WINDOW, servedByClaude } from "./claude.ts";
import { durableSpend, type Ledger, minus } from "../../kernel/meter.ts";

interface Compacted {
  readonly tokensBefore: number;
  readonly seconds: number;
  /** Summary token spend across the compaction task, including failed attempts. */
  readonly spent: Ledger;
  readonly error: string | null;
}

/** Computes the compaction policy, expanding `reserveTokens` so models with larger context windows
 *  still compact at the 300K campaign window. Because `pi-durable` also uses `reserveTokens` as
 *  the summary output cap, the solve condition records it explicitly. */
export function compactionPolicy(model: Pick<Model<Api>, "provider" | "contextWindow">): CompactionPolicy {
  return {
    enabled: !servedByClaude(model.provider),
    reserveTokens: 16_384 + Math.max(0, model.contextWindow - SWEEP_COMPACT_WINDOW),
    keepRecentTokens: 20_000,
    backgroundTokens: 0,
  };
}

export function durableCompactionMode(model: Pick<Model<Api>, "provider" | "contextWindow">): string {
  const policy = compactionPolicy(model);
  return `durable window=${String(Math.min(model.contextWindow, SWEEP_COMPACT_WINDOW))} reserve=16384 keep=${String(policy.keepRecentTokens)} summaryReserve=${String(policy.reserveTokens)} background=off`;
}

/** Creates a per-session observer that attributes compaction cost as the delta in `pi.usage`
 *  between `beforeCompact` and the terminal `CompactionTask` commit, avoiding double-counting
 *  ordinary generation turns. */
export function compactionTrace(record: (event: Compacted) => void) {
  let totals: Ledger = {};
  const active = new Map<TaskId, { at: number; tokens: number; from: Ledger }>();
  return {
    hook: hook(CompactionTask, {
      beforeCompact: (event, api) => {
        active.set(api.taskId, {
          at: performance.now(),
          tokens: estimateContextTokens(event.messages).tokens,
          from: totals,
        });
      },
    }),
    committed: ({ changes }: CommitPublication) => {
      for (const change of changes) {
        if (
          change.type === "document" &&
          change.kind === "change" &&
          change.record.kind === UsageDoc.definition.kind
        ) {
          // SAFETY: `change.value` is a revision of `pi-durable`'s internal `UsageDoc` rather than model output.
          totals = durableSpend(change.value as UsageState).ledger;
        }
      }
      const task = changes.find(
        (change) => change.type === "task" && change.value.kind === CompactionTask.definition.name,
      );
      const pending = task?.type === "task" ? active.get(task.value.id) : undefined;
      if (task?.type !== "task" || task.value.state.status !== "terminal" || pending === undefined) return;
      active.delete(task.value.id);
      const { outcome } = task.value.state;
      record({
        tokensBefore: pending.tokens,
        seconds: (performance.now() - pending.at) / 1000,
        spent: minus(totals, pending.from),
        error: outcome.status === "completed" ? null : (outcome.error?.message ?? outcome.status),
      });
    },
  };
}
