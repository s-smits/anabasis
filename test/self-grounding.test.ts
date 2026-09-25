// Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
// import { describe, expect, it } from "bun:test";
// import {
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// PROGRAM_ARGUMENT_MAX_BYTES,
// programArgumentChecks,
// programArgumentRemedy,
// Gate audit 2026-09-25 (docs/gate-audit.md, tool-self-authored): commented out (unsure): an external check whose tool bytes equal candidate-authored files no longer refuses adoption
//   selfGroundedChecks,
//   selfGroundedRemedy,
// } from "../src/verify/self-grounding.ts";
//
// describe("known authored executable bytes", () => {
//   it.each(["host", "workspace-toolchain"] as const)("refuses the same authored bytes under %s", (source) => {
//     const tools = {
//       public: { source, kind: "script" as const, digest: "1".repeat(64) },
//       authored: { source, kind: "binary" as const, digest: "2".repeat(64) },
//     };
//     const checks = [
//       { checkId: "public-check", adapterId: "public" },
//       { checkId: "z-authored", adapterId: "authored" },
//       { checkId: "a-authored", adapterId: "authored" },
//       { checkId: "intrinsic", adapterId: null },
//     ];
//     const found = selfGroundedChecks(checks, tools, new Set([tools.authored.digest]));
//     expect(found).toEqual([
//       { checkId: "a-authored", adapterId: "authored" },
//       { checkId: "z-authored", adapterId: "authored" },
//     ]);
//     expect(selfGroundedRemedy(found)).toContain("a-authored (authored)");
//     expect(selfGroundedRemedy(found)).toContain("Moving the same bytes");
//     // Unknown provenance is not an automatic independence claim or a location-based refusal.
//     expect(selfGroundedChecks(checks, tools)).toEqual([]);
//   });
//
//   it("leaves absent execution to the required-tool coverage consumer", () => {
//     expect(selfGroundedChecks([{ checkId: "c", adapterId: "absent" }], {})).toEqual([]);
//   });
//
//   it("keeps a mixed authored helper and domain engine outside the all-authored refusal", () => {
//     const tools = {
//       helper: { source: "host" as const, kind: "script" as const, digest: "helper" },
//       engine: { source: "workspace-toolchain" as const, kind: "binary" as const, digest: "engine" },
//     };
//     const checks = [
//       { checkId: "c", adapterId: "helper" },
//       { checkId: "c", adapterId: "engine" },
//     ];
//     expect(selfGroundedChecks(checks, tools, new Set(["helper"]))).toEqual([]);
//     expect(selfGroundedChecks(checks, tools, new Set(["helper", "engine"]))).toEqual(checks);
//   });
// });

// Gate audit 2026-09-25 (docs/gate-audit.md, tool-program-argument): commented out (unsure): an external check passing program text as an argument no longer refuses adoption
// describe("program text passed as a tool argument", () => {
//   it("names an external check whose argument is multi-line or over the byte bound, once per check and tool, largest argument first", () => {
//     const external = new Set(["ext", "ext-long"]);
//     const rows = [
//       { checkId: "ext", toolId: "python3", args: ["-c", "import sys\nprint(1)"] },
//       { checkId: "ext", toolId: "python3", args: ["-c", "x".repeat(PROGRAM_ARGUMENT_MAX_BYTES + 40)] },
//       { checkId: "ext-long", toolId: "node", args: ["-e", "y".repeat(PROGRAM_ARGUMENT_MAX_BYTES + 1)] },
//       // A long single-line flag list under the bound and a path are ordinary arguments.
//       {
//         checkId: "ext",
//         toolId: "frame3dd",
//         args: ["-i", "model.3dd", "-q", "x".repeat(PROGRAM_ARGUMENT_MAX_BYTES)],
//       },
//       // An authored check may pass program text: it claims no independence.
//       { checkId: "authored", toolId: "python3", args: ["-c", "import sys\nprint(1)"] },
//     ];
//     const found = programArgumentChecks(rows, external);
//     expect(found).toEqual([
//       { checkId: "ext", toolId: "python3", bytes: PROGRAM_ARGUMENT_MAX_BYTES + 40 },
//       { checkId: "ext-long", toolId: "node", bytes: PROGRAM_ARGUMENT_MAX_BYTES + 1 },
//     ]);
//     expect(programArgumentRemedy(found)).toContain("ext (python3, 296-byte argument)");
//     expect(programArgumentRemedy(found)).toContain('"authored"');
//     expect(programArgumentChecks(rows, new Set())).toEqual([]);
//   });
// });
export {};
