import type { DomainHarnessFactory } from "@ana/agent-bundle";

export const createDomainHarness: DomainHarnessFactory = (_task) => ({
  tools: [],
});
