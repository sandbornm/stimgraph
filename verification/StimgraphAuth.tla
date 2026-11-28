---------------------------- MODULE StimgraphAuth ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Isolates, Tokens,
          BugOrphanGrant, BugNoOriginCheck, BugMemoryLock

None == "none"
Live == "live"
Expired == "expired"
Pending == "pending"

ASSUME Isolates # {}
ASSUME Tokens # {}
ASSUME BugOrphanGrant \in BOOLEAN
ASSUME BugNoOriginCheck \in BOOLEAN
ASSUME BugMemoryLock \in BOOLEAN

VARIABLES clock, issued, durable, startedAt, createdAt,
          deletedAt, cookie, importLog, inflight,
          loadImport, hasConnected, legitDisconnect, legitDelete

vars == <<clock, issued, durable, startedAt, createdAt,
           deletedAt, cookie, importLog, inflight,
           loadImport, hasConnected, legitDisconnect, legitDelete>>

Fresh == {t \in Tokens : durable[t] = None /\ t \notin issued
                          /\ \A i \in Isolates : inflight[i] # t}

TypeOK ==
  /\ clock \in Nat
  /\ issued \subseteq Tokens
  /\ durable \in [Tokens -> {None, Live, Expired, Pending}]
  /\ startedAt \in [Tokens -> Nat]
  /\ createdAt \in [Tokens -> Nat]
  /\ deletedAt \in Nat
  /\ cookie \in {None} \cup Tokens
  /\ importLog \subseteq [token: Tokens, started: Nat, created: Nat,
                           deletedThen: Nat, expired: BOOLEAN, revoked: BOOLEAN]
  /\ inflight \in [Isolates -> {None} \cup Tokens]
  /\ loadImport \in [Isolates -> {None} \cup Tokens]
  /\ hasConnected \in BOOLEAN
  /\ legitDisconnect \in BOOLEAN
  /\ legitDelete \in BOOLEAN

Init ==
  /\ clock = 1
  /\ issued = {}
  /\ durable = [t \in Tokens |-> None]
  /\ startedAt = [t \in Tokens |-> 0]
  /\ createdAt = [t \in Tokens |-> 0]
  /\ deletedAt = 0
  /\ cookie = None
  /\ importLog = {}
  /\ inflight = [i \in Isolates |-> None]
  /\ loadImport = [i \in Isolates |-> None]
  /\ hasConnected = FALSE
  /\ legitDisconnect = FALSE
  /\ legitDelete = FALSE

StartAndExchange(i, t) ==
  /\ inflight[i] = None
  /\ t \in Fresh
  /\ clock' = clock + 1
  /\ inflight' = [inflight EXCEPT ![i] = t]
  /\ issued' = issued \cup {t}
  /\ startedAt' = [startedAt EXCEPT ![t] = clock]
  /\ durable' = IF BugOrphanGrant THEN durable ELSE [durable EXCEPT ![t] = Pending]
  /\ UNCHANGED <<createdAt, deletedAt, cookie, importLog, loadImport,
                 hasConnected, legitDisconnect, legitDelete>>

ProfileOrSealFails(i, t) ==
  /\ inflight[i] = t
  /\ inflight' = [inflight EXCEPT ![i] = None]
  /\ durable' = IF BugOrphanGrant
                THEN durable
                ELSE [durable EXCEPT ![t] = IF durable[t] = None THEN Pending ELSE durable[t]]
  /\ UNCHANGED <<clock, issued, startedAt, createdAt, deletedAt, cookie,
                 importLog, loadImport, hasConnected, legitDisconnect, legitDelete>>

DeletedBeforeStore(t) == deletedAt # 0 /\ startedAt[t] <= deletedAt

StoreLive(i, t) ==
  /\ inflight[i] = t
  /\ t \in issued
  /\ ~DeletedBeforeStore(t)
  /\ inflight' = [inflight EXCEPT ![i] = None]
  /\ durable' = [durable EXCEPT ![t] = Live]
  /\ createdAt' = [createdAt EXCEPT ![t] = clock]
  /\ cookie' = t
  /\ hasConnected' = TRUE
  /\ UNCHANGED <<clock, issued, startedAt, deletedAt, importLog, loadImport,
                 legitDisconnect, legitDelete>>

StoreRejectedRevokeFails(i, t) ==
  /\ inflight[i] = t
  /\ DeletedBeforeStore(t)
  /\ inflight' = [inflight EXCEPT ![i] = None]
  /\ durable' = IF BugOrphanGrant
                THEN [durable EXCEPT ![t] = None]
                ELSE [durable EXCEPT ![t] = IF durable[t] = Live THEN durable[t] ELSE Pending]
  /\ UNCHANGED <<clock, issued, startedAt, createdAt, deletedAt, cookie,
                 importLog, loadImport, hasConnected, legitDisconnect, legitDelete>>

InsertIgnoresTombstone(i, t) ==
  /\ BugMemoryLock
  /\ inflight[i] = t
  /\ DeletedBeforeStore(t)
  /\ inflight' = [inflight EXCEPT ![i] = None]
  /\ durable' = [durable EXCEPT ![t] = Live]
  /\ createdAt' = [createdAt EXCEPT ![t] = clock]
  /\ cookie' = t
  /\ hasConnected' = TRUE
  /\ UNCHANGED <<clock, issued, startedAt, deletedAt, importLog, loadImport,
                 legitDisconnect, legitDelete>>

CanImport(t) ==
  /\ durable[t] = Live
  /\ t \in issued
  /\ \/ deletedAt = 0
     \/ startedAt[t] > deletedAt

LoadPoll(i, t) ==
  /\ loadImport[i] = None
  /\ inflight[i] = None
  /\ CanImport(t)
  /\ loadImport' = [loadImport EXCEPT ![i] = t]
  /\ UNCHANGED <<clock, issued, durable, startedAt, createdAt, deletedAt,
                 cookie, importLog, inflight, hasConnected, legitDisconnect, legitDelete>>

ImportRecord(t) ==
  [token |-> t, started |-> startedAt[t], created |-> createdAt[t],
   deletedThen |-> deletedAt, expired |-> durable[t] # Live, revoked |-> t \notin issued]

CompleteImport(i, t) ==
  /\ loadImport[i] = t
  /\ loadImport' = [loadImport EXCEPT ![i] = None]
  /\ IF BugMemoryLock \/ CanImport(t)
     THEN importLog' = importLog \cup {ImportRecord(t)}
     ELSE UNCHANGED importLog
  /\ UNCHANGED <<clock, issued, durable, startedAt, createdAt, deletedAt,
                 cookie, inflight, hasConnected, legitDisconnect, legitDelete>>

ClearCookieIf(t) == IF cookie = t THEN None ELSE cookie

ClearLoads(t) == [i \in Isolates |-> IF loadImport[i] = t THEN None ELSE loadImport[i]]

RevokeOk(t) ==
  /\ t \in issued
  /\ issued' = issued \ {t}
  /\ durable' = [durable EXCEPT ![t] = None]
  /\ cookie' = ClearCookieIf(t)
  /\ loadImport' = ClearLoads(t)
  /\ UNCHANGED <<clock, startedAt, createdAt, deletedAt, importLog, inflight,
                 hasConnected, legitDisconnect, legitDelete>>

RetryRevoke(t) ==
  /\ durable[t] \in {Pending, Expired}
  /\ t \in issued
  /\ \A i \in Isolates : inflight[i] # t
  /\ RevokeOk(t)

LegitDisconnectOk(t) ==
  /\ cookie = t
  /\ durable[t] \in {Live, Expired, Pending}
  /\ t \in issued
  /\ legitDisconnect' = TRUE
  /\ issued' = issued \ {t}
  /\ durable' = [durable EXCEPT ![t] = None]
  /\ cookie' = None
  /\ loadImport' = ClearLoads(t)
  /\ UNCHANGED <<clock, startedAt, createdAt, deletedAt, importLog, inflight,
                 hasConnected, legitDelete>>

LegitDisconnectFail(t) ==
  /\ cookie = t
  /\ durable[t] = Live
  /\ t \in issued
  /\ legitDisconnect' = TRUE
  /\ durable' = [durable EXCEPT ![t] = Expired]
  /\ UNCHANGED <<clock, issued, startedAt, createdAt, deletedAt, cookie,
                 importLog, inflight, loadImport, hasConnected, legitDelete>>

LegitDisconnectRetry(t) ==
  /\ cookie = t
  /\ durable[t] = Expired
  /\ t \in issued
  /\ legitDisconnect' = TRUE
  /\ issued' = issued \ {t}
  /\ durable' = [durable EXCEPT ![t] = None]
  /\ cookie' = None
  /\ loadImport' = ClearLoads(t)
  /\ UNCHANGED <<clock, startedAt, createdAt, deletedAt, importLog, inflight,
                 hasConnected, legitDelete>>

CrossSiteDisconnect(t) ==
  /\ BugNoOriginCheck
  /\ cookie = t
  /\ durable[t] \in {Live, Expired}
  /\ t \in issued
  /\ \/ /\ durable' = [durable EXCEPT ![t] = None]
        /\ issued' = issued \ {t}
        /\ cookie' = None
        /\ loadImport' = ClearLoads(t)
        /\ UNCHANGED <<clock, startedAt, createdAt, deletedAt, importLog, inflight,
                       hasConnected, legitDisconnect, legitDelete>>
     \/ /\ durable[t] = Live
        /\ durable' = [durable EXCEPT ![t] = Expired]
        /\ UNCHANGED <<clock, issued, startedAt, createdAt, deletedAt, cookie,
                       importLog, inflight, loadImport, hasConnected,
                       legitDisconnect, legitDelete>>

DeleteAccount ==
  /\ \/ deletedAt = 0
     \/ \E t \in Tokens : durable[t] = Live /\ startedAt[t] > deletedAt
  /\ legitDelete' = TRUE
  /\ clock' = clock + 1
  /\ deletedAt' = clock
  /\ issued' = issued \ {t \in Tokens : durable[t] \in {Live, Expired}}
  /\ durable' = [t \in Tokens |->
        IF durable[t] \in {Live, Expired} THEN None ELSE durable[t]]
  /\ cookie' = None
  /\ loadImport' = IF BugMemoryLock
        THEN loadImport
        ELSE [i \in Isolates |->
          IF loadImport[i] # None /\ durable[loadImport[i]] \in {Live, Expired}
          THEN None ELSE loadImport[i]]
  /\ UNCHANGED <<startedAt, createdAt, importLog, inflight, hasConnected, legitDisconnect>>

Next ==
  \/ \E i \in Isolates, t \in Tokens :
        \/ StartAndExchange(i, t)
        \/ ProfileOrSealFails(i, t)
        \/ StoreLive(i, t)
        \/ StoreRejectedRevokeFails(i, t)
        \/ InsertIgnoresTombstone(i, t)
        \/ LoadPoll(i, t)
        \/ CompleteImport(i, t)
        \/ RetryRevoke(t)
        \/ LegitDisconnectOk(t)
        \/ LegitDisconnectFail(t)
        \/ LegitDisconnectRetry(t)
        \/ CrossSiteDisconnect(t)
  \/ DeleteAccount

Spec == Init /\ [][Next]_vars

InvStoredOrRevoked ==
  \A t \in Tokens :
    (t \in issued) =>
      \/ durable[t] \in {Pending, Live, Expired}
      \/ \E i \in Isolates : inflight[i] = t

InvNoImportDeleted ==
  \A rec \in importLog : rec.deletedThen = 0 \/ rec.started > rec.deletedThen

InvNoImportExpiredOrRevoked ==
  \A rec \in importLog : ~rec.expired /\ ~rec.revoked

InvSafeFromCrossSite ==
  \/ ~hasConnected
  \/ legitDisconnect
  \/ legitDelete
  \/ \E t \in Tokens : cookie = t /\ durable[t] = Live /\ t \in issued

ClockBound == clock <= 5

=============================================================================
