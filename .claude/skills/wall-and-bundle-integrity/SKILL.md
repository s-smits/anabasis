---
name: wall-and-bundle-integrity
description: "Use when designing, reviewing, or reporting Anabasis's three isolation layers, candidate validation, fingerprint, and immutable bundle identity. Covers executed refusal probes, combined access rules, candidate workspace access rules, typed public projection, controller-held authority, and honest disclosure of any boundary that is still contractual."
---

# Isolation and bundle snapshot integrity

Name the evidence for each boundary. A scan detects; it does not deny. A policy object is not an
active OS boundary. Report the weakest live layer.

## The three isolations

1. The Builder may read the user request, admitted public context, approved public sources, and its candidate tree.
2. The Built Harness sees only the public task projection and registered solve tools.
3. The verifier runs at the host boundary on artifact-only requests.

## Evidence for an isolation

`IsolationStrength` is `physical | contractual`. Tool absence or prompt wording alone is `isolation: none`.
Missing, stale, or mismatched evidence is a typed non-result, never a score.

The probe must prove both sides: the denied read is refused under the deny profile and the control
read returns the canary under the permissive profile. If the probe cannot run, use
`available: false`; this is different from a leak. Both are `contractual`.

`composedIsolation` is `physical` only when the executed probe is physical and the session handshake
shows the built role used the isolated permissions profile.

## Candidate workspace access rules

`execFile`, path containment, bounded output, and a scrubbed environment do not make the Builder
toolkit isolated. `bun install` and `uv add` can run package lifecycle code. The research and install
interface needs an executed OS-isolation check. `proveCandidateIsolation` returns proof, refusal, or
unavailable. Unavailable is not proof.

## Bundle snapshot identity

`validate candidate → fingerprint bytes → create bundle snapshot → evaluate`.

Candidate validation checks the bundle before acceptance. Fingerprinting gives its bytes a stable
identity. The immutable bundle snapshot binds later evaluation and scores to those exact bytes.
Executed means that the evaluated snapshot carries the matching fingerprint.

- `agentHash`: solve side.
- `correctnessModelHash`: `correctness-model/` except `tasks.json`.
- `taskSetHash`: `correctness-model/tasks.json`, ids, and content.

Keep task identity out of `correctnessModelHash`, otherwise a task edit looks like verifier drift. A candidate
that fails validation has no accepted fingerprint. `Claim.create()` requires all three hashes.

## What each layer proves

| Evidence | Claim |
|---|---|
| import or token scan | named imports are statically refused |
| allowlisted projection | known public fields cross |
| scrubbed environment | named and shaped secrets are removed from this child |
| executed deny read and control read | tested reads are denied under that profile |
| session profile handshake | verified session used the declared profile |
| provider session outside sandbox | provider confinement is unproven |
| post-run scan | later tampering is detectable |

Do not call detection prevention or generalise process evidence into full per-case isolation.

## Public projection and authority

Build public objects by allowlist:

```ts
const publicTask = {
  taskId: hidden.taskId,
  visibleSpec: structuredClone(hidden.visibleSpec),
};
```

Do not clone hidden data and delete known secrets. New hidden fields would leak. Break references
so solve-side mutation cannot reach evaluator state.

The controller keeps the submission handle and reads accepted facts from it. Generated code gets a
narrow port and may propose but cannot create the accepted fact. Generated verification code may name a pinned engine but
cannot choose a command.

## Threats and checks

Treat solve code, tool arguments, model text, retrieved pages, generated files, and verifier stdout
as untrusted. Protect hidden expectations and control literals, verifier inputs and raw findings,
credentials, sibling workspaces and evidence, controller handles, and immutable evidence.

- [ ] Build public tasks by allowlist.
- [ ] Keep protected material out of solve-side roots and grants.
- [ ] Expose only the reconciled tool and backend interface.
- [ ] Keep secrets out of prompts, logs, evidence, hashes, and child environments.
- [ ] Require controller handles for submission and identity facts.
- [ ] Test the active platform boundary.
- [ ] Name provider, network, search, and subagent gaps separately.
- [ ] Bind isolation evidence to the verified session profile.
- [ ] Re-derive bundle snapshot hashes from the immutable snapshot bytes.
- [ ] Return boundary failures as non-results.
