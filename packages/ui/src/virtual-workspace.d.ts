declare module "virtual:ana-workspace" {
  import type { WorkspaceSnapshot } from "./models.js";
  const snapshot: WorkspaceSnapshot;
  export default snapshot;
}
