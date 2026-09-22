# Solve Lifecycle

Use this reference when the artifact contract reaches checkpoint, resume, attempts, or terminal
acceptance. Tool roster design and isolation remain with their own skills.

## One accepted-byte path

```text
PublicTask → registered tools → DraftStore → SubmissionPort → SubmissionAuthority
```

- `DraftStore` is the only mutable artifact state.
- An artifact writer calls `setArtifact()` to canonicalise the public output once per prepared
  answer and bind it to its source sequence, writer, and call identity.
- The inherited `submit` tool accepts those exact stored bytes only while the prepared artifact is
  current. Assistant text and regenerated objects are not submissions.
- A missing or stale artifact returns a public, repairable rejection without changing accepted
  state.
- The controller retains `SubmissionAuthority`; generated solve code receives only its narrow port.

## Attempts and terminal state

- `maxAttempts` is a positive finite integer. An attempt beyond it is refused as
  `attempts-exhausted` without moving state.
- Keep `TerminalKind` (`artifact | clarification | refusal`) as the checkpoint and evidence
  vocabulary. The active submit tool accepts artifacts only.
- Restore the same authority, prepared submission, sequence, attempt count, and terminal identity.
  Reject a checkpoint whose counters move backwards or exceed the configured limit.
- Do not replay completed calls after resume. Accepted terminal state cannot reopen.

## Prove

1. Restart preserves authority, submission, sequence, attempt, and terminal identity.
2. Stale or absent prepared bytes are rejected with a public remedy.
3. Attempts after the limit do not mutate state.
4. Accepted bytes and their hash remain unchanged after later workspace writes.
5. Completed calls are not replayed and terminal acceptance cannot reopen.
