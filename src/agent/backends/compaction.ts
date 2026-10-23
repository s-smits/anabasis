/**
 * Durable's compaction policy and its summary spend. The campaign log remains the durable store:
 * observe committed summary usage, including failed attempts, before the next generation starts.
 * There is no summariser hook in durable 1.4.0, so the commit publication is the billing boundary.
 */
import type { Api, Model, Usage } from "@earendil-works/pi-ai";
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

interface Compacted {
  readonly tokensBefore: number;
  readonly seconds: number;
  readonly usages: readonly Usage[];
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

/** One observer a session. The generation and compaction commits both update pi.usage; only the
 * latter's delta belongs to a summary, so ordinary turns are never counted twice. */
export function compactionTrace(record: (event: Compacted) => void) {
  const totals = new Map<string, Usage>();
  const active = new Map<TaskId, { at: number; tokens: number; usages: Usage[] }>();
  return {
    hook: hook(CompactionTask, {
      beforeCompact: (event, api) => {
        active.set(api.taskId, {
          at: performance.now(),
          tokens: estimateContextTokens(event.messages).tokens,
          usages: [],
        });
      },
    }),
    committed: ({ changes }: CommitPublication) => {
      const task = changes.find(
        (change) => change.type === "task" && change.value.kind === CompactionTask.definition.name,
      );
      const pending = task?.type === "task" ? active.get(task.value.id) : undefined;
      for (const change of changes) {
        if (change.type !== "document" || change.record.kind !== "pi.usage" || change.value === null) {
          continue;
        }
        // SAFETY: pi.usage is durable's own UsageState document, not model output.
        const state = change.value as UsageState;
        for (const [key, usage] of Object.entries(state.models)) {
          const previous = totals.get(key);
          if (pending !== undefined) pending.usages.push(usageDifference(usage, previous));
          totals.set(key, usage);
        }
      }
      if (task?.type !== "task" || task.value.state.status !== "terminal" || pending === undefined) return;
      active.delete(task.value.id);
      const { outcome } = task.value.state;
      record({
        tokensBefore: pending.tokens,
        seconds: (performance.now() - pending.at) / 1000,
        usages: pending.usages,
        error: outcome.status === "completed" ? null : (outcome.error?.message ?? outcome.status),
      });
    },
  };
}

function usageDifference(usage: Usage, previous: Usage | undefined): Usage {
  return {
    input: usage.input - (previous?.input ?? 0),
    output: usage.output - (previous?.output ?? 0),
    cacheRead: usage.cacheRead - (previous?.cacheRead ?? 0),
    cacheWrite: usage.cacheWrite - (previous?.cacheWrite ?? 0),
    cacheWrite1h: (usage.cacheWrite1h ?? 0) - (previous?.cacheWrite1h ?? 0),
    totalTokens: usage.totalTokens - (previous?.totalTokens ?? 0),
    cost: {
      input: usage.cost.input - (previous?.cost.input ?? 0),
      output: usage.cost.output - (previous?.cost.output ?? 0),
      cacheRead: usage.cost.cacheRead - (previous?.cost.cacheRead ?? 0),
      cacheWrite: usage.cost.cacheWrite - (previous?.cost.cacheWrite ?? 0),
      total: usage.cost.total - (previous?.cost.total ?? 0),
    },
  };
}
