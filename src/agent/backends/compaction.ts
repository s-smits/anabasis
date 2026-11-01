/**
 * Durable's compaction policy and its summary spend. The campaign log remains the durable store:
 * observe committed summary usage, including failed attempts, before the next generation starts.
 * There is no summariser hook in durable 1.4.0, so the commit publication is the billing boundary.
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  CompactionTask,
  hook,
  type CommitPublication,
  type CompactionPolicy,
  type UsageState,
  type TaskId,
} from "@earendil-works/pi-durable";
import { SWEEP_COMPACT_WINDOW, servedByClaude } from "./claude.ts";
import { type Ledger, ledgerOf, minus } from "../../kernel/meter.ts";

interface Compacted {
  readonly tokensBefore: number;
  readonly seconds: number;
  /** What the summary spent, failed attempts included. */
  readonly spent: Ledger;
  readonly error: string | null;
}

/** Adjust the reserve to retain the campaign's 300K window on models serving a larger context.
 * Durable also uses this reserve for its summary's output cap; the condition records that cap. */
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

/** One observer a session. The generation and compaction commits both update pi.usage; a summary's
 * spend is what the ledger gained between the compaction's start and its end, so ordinary turns are
 * never counted twice. */
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
        if (change.type === "document" && change.record.kind === "pi.usage" && change.value !== null) {
          // SAFETY: pi.usage is durable's own UsageState document, not model output.
          totals = ledgerOf(Object.entries((change.value as UsageState).models));
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
