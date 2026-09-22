/**
 * The verifier workshop's model-facing interface. The execution code decides paths, phases,
 * evidence and typed non-results; this file defines the tool schema and routes its actions.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { defineTool } from "../solve/define-tool.ts";
import type { VerifierWorkshop } from "./verifier-workshop.ts";
import { hasText } from "../meta/text.ts";

const Params = Type.Object({
  action: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("read"),
    Type.Literal("write"),
    Type.Literal("run"),
    Type.Literal("export"),
  ]),
  path: Type.Optional(
    Type.String({ description: "Workshop-relative file or directory; required for read, write and export." }),
  ),
  destination: Type.Optional(
    Type.String({
      description:
        "export only: relative file path under candidate .toolchain, e.g. bin/checker. Must not already exist.",
    }),
  ),
  /** write only: exact text to replace the file with. */
  content: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  /** run only: exact text delivered to the process on standard input. */
  stdin: Type.Optional(Type.String()),
  /** read only: 1-based first line, defaulting to the start of the file. */
  offset: Type.Optional(Type.Number()),
  /** read only: how many lines to return, using the file reader's default when omitted. */
  limit: Type.Optional(Type.Number()),
});

export function createVerifierWorkshopTool(workshop: VerifierWorkshop): AgentTool<typeof Params> {
  return defineTool({
    name: "verifier_workshop",
    label: "Verifier workshop",
    description:
      "Build, test and export public verifier tools. public_source stages downloaded bytes in this offline .oss workshop; inspect/read locate source, write supplies text, and run unpacks, compiles and smoke-tests it with the workshop PATH. Supply public requests through run.stdin. write/run create safe missing directories. After testing, export copies one binary, script or package file (up to 64 MiB) into the candidate's .toolchain, preserves whether it is executable and returns the exact byte digest and installed path. Example: {action:'export',path:'build/checker',destination:'bin/checker'}. Export refuses existing destinations; manage upgrades with workspace tools. Native executables built in a VM must target the host architecture and OS. For libraries, export their package and unpack it with workspace tools. List the installed executable in execution.requiredToolIds for authored computation or execution.evidence.requiredToolIds for external evidence and call runtime.tools.run from that named check, then run correctness_check. Workshop commands cannot read the candidate workspace; copy candidate text with write. Ordinary workspace tools cannot read .oss; use this tool's actions. Run output labels truncation; read returns paged lines. These actions prove process execution and transferred bytes only, never verifier truth or candidate acceptance.",
    parameters: Params,
    executionMode: "sequential",
    run: async (params) => {
      switch (params.action) {
        case "inspect":
          return workshop.inspect(params.path);
        case "read":
          if (!hasText(params.path)) throw new Error("read requires path");
          return workshop.read(params.path, params.offset, params.limit);
        case "write":
          if (!hasText(params.path)) throw new Error("write requires path");
          if (params.content === undefined) throw new Error("write requires content");
          return workshop.write(params.path, params.content);
        case "run":
          if (!hasText(params.command)) throw new Error("run requires command");
          return workshop.run(params.command, params.cwd, params.stdin);
        case "export":
          if (!hasText(params.path) || !hasText(params.destination)) {
            throw new Error("export requires path and destination");
          }
          return workshop.export(params.path, params.destination);
      }
    },
  });
}
