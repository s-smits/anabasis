/** `harness_reset`: on a reopen rebuild, returns one harness surface to the starter seed. Outside a
 *  reopen it refuses. */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { resetWorkspaceToStarter } from "../author/domain-repo.ts";
import { defineTool } from "../solve/define-tool.ts";

const Params = Type.Object({
  scope: Type.Union([Type.Literal("agent"), Type.Literal("correctness-model"), Type.Literal("all")]),
});

// Gate audit 2026-09-25 (docs/gate-audit.md, harness-reset-scope): kept: a fresh build has no seed to return to, and the per-scope marker keeps a resumed round from wiping its own work
export function createHarnessResetTool(binding: {
  workspace: string;
  resetKey?: string;
}): AgentTool<typeof Params> {
  return defineTool({
    name: "harness_reset",
    label: "Harness reset",
    description:
      "On a reopen rebuild only: return one harness surface to the starter seed in one controller commit. scope agent reopens the tooling and keeps the tasks, controls and checks; correctness-model reopens the evaluation and keeps the tooling; all starts from the starter. Git history keeps every replaced byte. The same scope applies once per reopen.",
    parameters: Params,
    run: ({ scope }) => {
      if (binding.resetKey === undefined) {
        return {
          text: "Refused: this round did not reopen the harness. Edit the workspace in place.",
          details: { scope, applied: false, receipt: { outcome: "refused" } },
        };
      }
      const applied = resetWorkspaceToStarter(binding.workspace, binding.resetKey, scope);
      const text = applied
        ? "Returned to the starter seed; the replaced bytes stay in git history."
        : "Refused: already reset this reopen; the workspace is as that reset left it plus your later edits.";
      return {
        text: `scope ${scope}: ${text}`,
        details: { scope, applied, receipt: { outcome: applied ? "completed" : "refused" } },
      };
    },
  });
}
