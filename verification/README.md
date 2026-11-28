# Stimgraph auth model (TLA+)

This model covers OAuth start and callback (code exchange, profile or seal failure, storing the session, and a failed revoke after a delete), disconnect (success, failure, and retry), account delete with a tombstone, poller import, and two isolates that do not share an in-memory lock.

Properties, in plain words:

- **InvStoredOrRevoked.** Every refresh token obtained from X is stored (live, expired, or pending revoke) or has already been confirmed revoked. No orphan grants.
- **InvNoImportDeleted.** Nothing imports for a deleted owner using a sign-in that started at or before the delete.
- **InvNoImportExpiredOrRevoked.** Nothing imports with an expired or revoked session.
- **InvSafeFromCrossSite.** A cross-site POST cannot disconnect or revoke a session that the user has not themselves disconnected or deleted.

`StimgraphAuth.cfg` is the fixed design (all bug flags false). The `mutants/` configs each turn on one of the three findings from the review of b203496 and must fail:

- `OrphanGrant.cfg` — after the code exchange, a later failure drops the only copy of the refresh token.
- `DisconnectOrigin.cfg` — disconnect does not require a same-origin request.
- `InMemoryLock.cfg` — the delete-versus-import or insert guard is only an in-memory lock, so another isolate can import or store a session for a deleted owner.

Run `./run.sh` from this directory. It downloads a pinned `tla2tools.jar` if needed, checks the fixed spec, and checks that each mutant violates the expected invariant. Java 21+ is required.

The model is a bounded design (two isolates, one token, `clock <= 5`). It does not prove the TypeScript is correct, and it leaves out cookie names, encryption, and X HTTP details. TLC is not part of CI (no Java there); run it locally with `./run.sh`.
