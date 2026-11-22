---- MODULE BookmarkMcp ----
\* One request at a time. Reset is the gap between requests, not a session.
\* Leak is false in the checked config. The leak config is a broken variant.

EXTENDS FiniteSets, TLC

CONSTANT Leak

VARIABLES phase, actor, disclosed, stored

vars == <<phase, actor, disclosed, stored>>

Db == ("owner_a" :> {"101", "102", "103"}) @@ ("owner_b" :> {"201"})
Posts == {"101", "102", "103", "201", "999"}
Owners == {"owner_a", "owner_b"}

OwnerOf(p) ==
  CASE p = "agent_a" -> "owner_a"
    [] p = "agent_b" -> "owner_b"
    [] OTHER -> "none"

PostOwner(post) ==
  CASE post \in Db["owner_a"] -> "owner_a"
    [] post \in Db["owner_b"] -> "owner_b"
    [] OTHER -> "none"

Row(owner, post) == [owner |-> owner, post |-> post]
RowsOf(owner) == { Row(owner, post) : post \in Db[owner] }
AllRows == UNION { RowsOf(owner) : owner \in Owners }

Init ==
  /\ phase = "idle"
  /\ actor = "none"
  /\ disclosed = {}
  /\ stored = Db

Reset ==
  /\ phase # "idle"
  /\ phase' = "idle"
  /\ actor' = "none"
  /\ disclosed' = {}
  /\ UNCHANGED stored

BadTransport ==
  /\ phase = "idle"
  /\ phase' = "transport_denied"
  /\ actor' = "anon"
  /\ disclosed' = {}
  /\ UNCHANGED stored

RejectAnon ==
  /\ phase = "idle"
  /\ phase' = "auth_denied"
  /\ actor' = "anon"
  /\ disclosed' = {}
  /\ UNCHANGED stored

RejectRevoked ==
  /\ phase = "idle"
  /\ phase' = "auth_denied"
  /\ actor' = "revoked"
  /\ disclosed' = {}
  /\ UNCHANGED stored

RejectUnknownTool ==
  /\ phase = "idle"
  /\ \E p \in {"agent_a", "agent_b"} :
       /\ phase' = "tool_denied"
       /\ actor' = p
       /\ disclosed' = {}
  /\ UNCHANGED stored

RejectBadInput ==
  /\ phase = "idle"
  /\ \E p \in {"agent_a", "agent_b"} :
       /\ phase' = "input_denied"
       /\ actor' = p
       /\ disclosed' = {}
  /\ UNCHANGED stored

Search ==
  /\ phase = "idle"
  /\ \E p \in {"agent_a", "agent_b"} :
       /\ phase' = "responded"
       /\ actor' = p
       /\ disclosed' = IF Leak THEN AllRows ELSE RowsOf(OwnerOf(p))
  /\ UNCHANGED stored

List ==
  /\ phase = "idle"
  /\ \E p \in {"agent_a", "agent_b"} :
       /\ phase' = "responded"
       /\ actor' = p
       /\ disclosed' = IF Leak THEN AllRows ELSE RowsOf(OwnerOf(p))
  /\ UNCHANGED stored

Detail ==
  /\ phase = "idle"
  /\ \E p \in {"agent_a", "agent_b"}, post \in Posts :
       /\ phase' = "responded"
       /\ actor' = p
       /\ LET own == OwnerOf(p)
          IN disclosed' =
               IF Leak /\ PostOwner(post) # "none"
               THEN { Row(PostOwner(post), post) }
               ELSE IF post \in Db[own] THEN { Row(own, post) } ELSE {}
  /\ UNCHANGED stored

Next ==
  \/ Reset
  \/ BadTransport
  \/ RejectAnon
  \/ RejectRevoked
  \/ RejectUnknownTool
  \/ RejectBadInput
  \/ Search
  \/ List
  \/ Detail

Spec == Init /\ [][Next]_vars

NoMutation == stored = Db

DeniedQuiet ==
  phase \in {"transport_denied", "auth_denied", "tool_denied", "input_denied"}
    => disclosed = {}

Separation ==
  phase = "responded" =>
    /\ actor \in {"agent_a", "agent_b"}
    /\ \A row \in disclosed : row.owner = OwnerOf(actor)

RevokedQuiet ==
  actor = "revoked" => phase = "auth_denied" /\ disclosed = {}

AnonQuiet ==
  actor = "anon" =>
    /\ phase \in {"transport_denied", "auth_denied"}
    /\ disclosed = {}

====
