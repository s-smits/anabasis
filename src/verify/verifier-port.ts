// Copied from v1 (github.com/s-smits/anabasis, 3f93d06b): src/verify/verifier-port.ts, only the two
// types the OS isolation reads, verbatim. The rest of that file types v1's correctness-model tool runs,
// which did not come over.

/**
 * What either wall mechanism is asked to confine: one resolved command and its arguments, the
 * directory it runs in, the exact files it may read and the roots those reads may come from.
 * Darwin, Bubblewrap, the read preparation the two share and the dispatch that selects between them
 * all read this one declaration rather than each spelling the five fields for themselves, because a
 * field added to one of four copies is a field the other three silently drop.
 */
export interface VerifierConfinementRequest {
  workdir: string;
  resolvedCommand: string;
  engineArgs: string[];
  attestedFiles: string[];
  sandboxReadRoots: string[];
}

/** What the host actually provided for one run. */
export type VerifierSandboxLevel = "workdir+env-allowlist" | "darwin-seatbelt/v1" | "linux-bwrap/v1";
