import {
  type ContractFinding,
  type GeneratedExecutionClassification,
  controllerValidatedFinding,
} from "./brief.ts";

/**
 * A module-load failure, with the owner named in one controller-written sentence.
 *
 * Loading a generated module runs only Builder-authored bytes through the bundler and the module
 * loader; no task, hidden expectation or verifier output is involved yet. Its diagnostic is
 * therefore authored and crosses in full. Earlier the author read only
 * "generated-correctness-model-load": truss run dffb11 spent two previews on an evaluator import of
 * ../core/, and an unmatched message still hid the cause.
 *
 * A diagnostic alone cannot distinguish a host denial from a source defect. Run w34's first
 * iteration recorded 36 findings, every one of them `xcode-select: error ... Operation not
 * permitted`; run 52 lost seven iterations and w29 four to an unresolvable `@ana/*` specifier
 * in a symlinked workspace, repairing code that was never broken. A known signature therefore
 * leads the detail with the classification and its sentence.
 */

/** One signature and the sentence it selects. */
const LOAD_FAULT_NOTES: readonly (readonly [RegExp, string])[] = [
  // The bundler's own refusal, first so a refused `@ana/` specifier is not read as a host fault.
  // Truss run 805bcc spent two previews on reference/index.ts importing ../rules.ts while told
  // only "generated-correctness-model-load".
  [
    /import outside its bundle or public contract|generated source escapes its/,
    "an import left its package: reference/ is loaded alone by the reference solve, so files there import only reference/ and the public @ana packages; the evaluator imports only files under correctness-model/",
  ],
  [
    /cannot import private operand data/,
    "the evaluator imported a data file outside reference/; read private operands from the check request, or put public support data in reference/",
  ],
  [
    /@ana\//,
    "the controller's own vendored packages did not resolve in this workspace; this is a host fault, not your code, and rewriting your module will not fix it",
  ],
  [
    /Operation not permitted|EPERM|xcode-select/,
    "the operating system refused the toolchain a path it needs; this is a host fault, not your code, and rewriting your module will not fix it",
  ],
  [
    /ERR_MODULE_NOT_FOUND|Cannot find module/,
    "a module specifier did not resolve; check that every file you import exists in the bundle under the exact path you wrote",
  ],
  [/SyntaxError/, "the file did not parse; the failure is in your source text rather than in what it does"],
];

/** The finding for a module that would not load, led by the owner sentence when the diagnostic
 *  matches a known signature. */
export function loadFailureFinding(
  finding: { code: string; path: string; detail: string },
  classification: GeneratedExecutionClassification,
): ContractFinding {
  const note = LOAD_FAULT_NOTES.find(([signature]) => signature.test(finding.detail))?.[1];
  return controllerValidatedFinding(
    finding,
    note === undefined
      ? `${classification}: ${finding.detail}`
      : `${classification}; ${note}. ${finding.detail}`,
  );
}
