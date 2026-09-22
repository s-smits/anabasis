/**
 * The model's download tool. The controller resolves and checks each public HTTPS address,
 * including redirects; the model receives a file named by its digest in the isolated workshop.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "../solve/define-tool.ts";
import type { VerifierWorkshop } from "./verifier-workshop.ts";

const Params = Type.Object({ url: Type.String() });

export function createPublicSourceTool(workshop: VerifierWorkshop): AgentTool<typeof Params> {
  return defineTool({
    name: "public_source",
    label: "Public source",
    description:
      "Download the exact public HTTPS archive or package you intend to inspect, build or use as checker evidence, by its exact address; it saves the download under its byte digest in the workshop downloads directory. Use verifier_workshop to unpack, build and test it offline, then export the tested binary or package into candidate .toolchain. A completed fetch proves only which public bytes were downloaded, not that they are authoritative or correct.",
    parameters: Params,
    executionMode: "sequential",
    run: ({ url }, signal) => workshop.fetch(url, signal),
  });
}
