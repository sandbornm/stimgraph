# Bookmark MCP labels and where strict Biba stops

Spec version 1.0.0. Dated 2026-11-10. The tables, the access matrix, and the checked model are in the [security spec](mcp-security-spec.md).

## What this release is

Michael wants a private search over bookmarks he already stored, through an MCP client, without opening the web app on the tailnet. This release is a separate Rust process. It listens on loopback. It has three read tools. It binds each bearer token to one owner id.

The same shape is the pattern to copy later for another read-only tool. Keep a separate `Cargo.toml`, a loopback bind, a principal map, parameterized reads, and the official SDK. Do not fold that copy into the Next.js process.

## What a later product page would add

A later public product page can link to these docs, to the security spec, and to a registry entry. A person would then connect a compatible client, read their own Stimgraph, and later control that app and see the map in Stimgraph.

This repository does not add that page, that registry entry, or a control tool. It does not publish the server. It does not host the server next to a model. It does not add edit tools, a public listener, or a multi-user clearance. Tailscale in front of the web app is not a substitute for the bearer check in this process.

## Two lattices, because one will not say both things

Confidentiality and integrity are different orders.

Bell-LaPadula is the confidentiality order used here. No read up. No write down. An active principal sits at `owner` in one compartment, the owner id in its map row. It may read public errors and its own bookmarks. It may not read another owner's rows, and it may not read session or OAuth rows. Those credential rows are `secret`, above the principal's clearance. The process does not become cleared for every compartment. `authorize` returns one owner id, or a denial that carries no owner id. The SQLite authorizer then refuses every table except `bookmarks`, `topics`, and `bookmark_topics`.

Bell-LaPadula no write down stays thin here, and it should stay thin. There is no write tool. The connection is opened read-only, `query_only` is on, and the authorizer denies inserts and updates. A write-down story about a write path would describe a feature this crate does not have.

Biba is the integrity order. No read down. No write up. Low-integrity tool arguments must not change the principal map, the SQL text, or the database. That part holds. The arguments are parsed into a bounded `SearchQuery` or `PostId` and then used as predicates. They are not concatenated into SQL. They are not written back.

## The read that strict Biba forbids

Strict Biba also says a high-integrity subject does not read a low-integrity object. Bookmark text is low integrity. The service that chooses the SQL and the owner id is high integrity. Search is that forbidden read.

Calling the whole request lattice compliant would hide the conflict. The server does the read anyway, under an explicit exception.

The exception is the trusted read mediator, `ReadOnlyStore::search` and `ReadOnlyStore::get`. The mediator may read low-integrity columns for the single owner id that `authorize` already chose. It copies those columns into a `BookmarkView`. The server then places that view on a response channel labeled `owner` for confidentiality and `low` for integrity. The low label is the point. The response is data. It is not promoted into the instruction string. That string is a fixed constant in `server.rs`. The process does not send the text to a model and does not fetch the network.

A second, smaller exception is shape endorsement. Serde and the bound parsers accept a JSON shape. That endorses the shape only. The strings inside stay low integrity.

The trust anchor is the operator's principal map, read once from the environment at start. If an attacker controls that environment, the compartment binding is theirs, and the labels do not describe the process you think is running.

There is no declassification step that turns bookmark text into a public response. A denial is public because the server emits a fixed string and does not read the row. A not-found result is the same fixed object for a missing id and for another owner's id, so the public channel does not report which one it was.

## What this does not decide

The stored schema does not label one bookmark as more sensitive than another. Every bookmark of an owner is `owner` in that owner's compartment. A finer policy would be a new column and a new decision. This server does not guess one.

The tailnet identity header used by the web app is not an input here. Loopback binding is not a substitute for the bearer check.
