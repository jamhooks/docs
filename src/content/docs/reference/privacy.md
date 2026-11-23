---
title: "Personal data"
sidebar:
  order: 7
---

What this app stores, logs and passes on about callers and about the people who use
the editor: the technical input for a record of processing activities (GDPR art. 30)
or a DPIA. It describes the stock image and configuration; the operator decides the
purposes, the retention of logs and backups, and what flow authors may put in a flow.

## In short

- **The app keeps no call records.** No caller numbers, digits, speech, recordings or
  call history are written to its store, not even temporarily.
- **Its own log lines identify calls, not callers**: they carry the flow, the Jambonz
  call sid, the hook and the node id; never digits, speech or phone numbers. The
  routing lines add which branch a call took at each component (the menu option, a
  timeout), by the names the flow gives them. Flow authors can change that with a
  **Log** node, which writes exactly what they tell it to.
- **The live trace stores nothing.** The editor's Debug pane shows live calls only
  while someone has it attached, and keeps the rows only in that browser tab.
- **Call variables travel with the call, through Jambonz** (`customerData`), not
  through the app's storage.

## Callers

### What arrives

On each webhook Jambonz posts the call's details: the call sid, the calling and called
numbers, the direction, and (after a menu, input or speech step) the digits pressed
or the speech transcript. A flow can add more: an **HTTP Request** response, a
**JSON Parser** result, variables set by **Change Variable**.

### What happens to it

All of it lives in memory for the length of one webhook: the app answers Jambonz and
forgets the request. Nothing about the call is written to the store.

**Between webhooks, the call's variables ride on the call.** Before the app hands the
call back to Jambonz to wait for input or a transfer, it sends the flow's working
variables in a Jambonz `tag` verb (under `customerData.internal`); Jambonz returns them
with the next webhook. That set is: the flow's variables, a component's *Store input in
variable* target (gathered digits or speech copied under a name the author chose),
values mapped from HTTP responses, and the application environment variables
(including any marked *obscure*). So this data is held by **Jambonz** for the duration
of the call, and whatever Jambonz logs or keeps is part of the processing. Check its
configuration (call detail records, debug logging, recordings). The default
`{{digits}}` / `{{speech}}` variables are *not* carried. Because a `tag` replaces the
call's `customerData`, the same verb also passes on whatever else the call already
carried there (data your own system attached when it placed the call through
Jambonz's REST API, say) unchanged; the app stores none of it.

**"Obscure" hides a value in this app, not from Jambonz.** An environment variable
marked *obscure* travels in `customerData` like the rest (its value as Jambonz
delivered it, or the default the flow fell back to) on every webhook of the call. So
Jambonz has it in clear: in the responses it receives and the requests it sends back,
in its portal's call traces (with OpenTelemetry tracing on, the request body is recorded
as `http.body`) and in its call records. In this app it is masked in the Debug and
Simulate panes and in everything the read-only account can read, and never logged. A
secret that must not be visible to whoever operates or can read the Jambonz platform
doesn't belong in a flow's env vars.

**Outbound requests are the author's.** An HTTP Request node sends what the author
configured (typically including caller data) to the URL they chose. Each such
endpoint is a recipient of personal data in its own right.

### What is logged

The runtime's own log lines name **the flow, the call sid, the hook and the node**,
stamped onto every line written while a call is being handled. They do not contain
digits, speech, or the calling or called number. A call sid identifies nothing by
itself, but Jambonz can map it to the caller's number, so it is **pseudonymous
personal data**: treat the logs accordingly.

**The routing lines** (logger `app.routing`, the dashboard's Routing panels) record the
path a call takes through the flow: that it waited at a component, and which outlet it
took there (the component's id, type and label, a *result* and an *outlet*). Those are
names from the flow: the Menu option pressed (only when the Menu has that option), or
words such as `timeout`, `invalid`, `default`, `success`, `failure`, a queue's
`hangup`, a Conditional rule's key and name. Never the digits themselves (an account
number typed into User Input is `default`), never the speech, a number or a variable's
value; a queue result the component doesn't know is written as `default`, whatever the
request said. The label and the rule's name are whatever the flow's author typed. With
the call sid on every line, they describe one call's path through the menus, so they
are kept, and readable, exactly like the rest of the log. A dry run (Simulate) writes
none.

Three things can put more than that in the log:

- **The Log node** writes its message, with `{{variables}}` filled in, at the level the
  author picks. `Caller {{from}} entered {{account_number}}` puts both in the log. That
  is the author's choice, and the only place the app writes caller data on request.
  With *Also send to Jambonz Alerts page* ticked, the same text also goes to Jambonz as
  an application alert, which Jambonz stores against the call and shows on its portal's
  Alerts page and API, kept under Jambonz's retention, not this app's, and visible to
  whoever can read that account's alerts, obscure values included if the message names
  one.
- **HTTP Request failures** are logged with the request's method, the host it went to,
  and the path *as the author wrote it* (`/customers/{{from}}`, not the caller's
  number), never the query string or any credentials in the URL, which is where
  interpolated caller input and API keys usually go. Successful requests are not logged
  (the HTTP client library's own per-request INFO line is switched off).
- **Error lines** carry the exception's message. When a node fails on a value (a
  response that won't parse, say), the message can quote it.

The container runs uvicorn **without an access log**, so there is no per-request line
with client addresses. (Running the app directly with `uv run main.py` does keep
uvicorn's access log.)

Logs go to the container's stdout, and from there to two places:

- **The monitoring stack** (the compose profile `monitoring`, on in a deployment made
  from `.env.example`; [OPERATIONS.md](/reference/operations/#monitoring)) keeps every line in
  Loki for **`LOG_RETENTION` (30 days by default)** and then deletes it (within a few
  hours of expiry). Anyone signed in to its Grafana can read them; Grafana's own
  database holds no log lines, only its accounts, alert settings and the history of
  alert states. Its `/health` probe results, kept as long, hold no personal data.
- **Docker's own copy** (what `docker compose logs` shows): the stock
  `docker-compose.yml` keeps at most five 10 MB files per container, rotated by size,
  and deletes them with the container, on every upgrade or `.env` change. On a quiet
  instance that copy can hold lines older than `LOG_RETENTION`; OPERATIONS.md
  ("Retention") says how to bound it by age instead.

Anything shipped elsewhere (with `LOG_FORMAT=json` to your own aggregator) is retained
under that system's policy.

### The live trace (Debug pane)

The editor's Debug pane streams what live calls do (per node, the outcome and the
verbs sent to Jambonz, which can include interpolated text such as a prompt that reads
back an account number) to whoever has it attached. On the server it is **held in
memory and forgotten**: no buffer, no history, no catch-up; with nobody attached, no
trace is built at all. In the browser the rows live in that tab only (at most the last
300) and are gone when it closes.

Anyone signed in can attach it, including the read-only account. Values of environment
variables marked *obscure* are masked in it, by name and wherever the value appears in a
verb.
`CALL_TRACE_ENABLED=false` refuses every trace connection, for a deployment that must
not have live call data on a screen.

**Simulate** (the dry run) uses inputs typed by the author and writes nothing. It masks
the values of *obscure* environment variables the same way.

## People using the editor

- **Accounts**: two fixed accounts configured in `.env` (an admin and an optional
  read-only one). Usernames are not stored anywhere else.
- **Cookies** (both needed for sign-in):
  - the session cookie (signed, not encrypted): username, role, a fingerprint of the
    password it was signed in with, a random session id, when it was signed in and the
    time of the last request. It expires after `SESSION_IDLE_TIMEOUT` (one hour by
    default) without a request, and `SESSION_MAX_LIFETIME` (12 hours) after sign-in
    regardless; signing out also revokes it on the server (until the app restarts;
    the 12-hour limit bounds it after that);
  - a `known_browser` cookie, sent only to `/login`, kept for 180 days after a
    successful sign-in, so that a browser that has signed in before isn't locked out by
    someone else's failed guesses.
- **Logs**: sign-ins and sign-outs (username); failed sign-ins and lockouts (the
  client's IP address and whether the name tried was a configured account; never the
  text typed, which is sometimes a password in the wrong field); a read-only account
  refused an action (username and path); and an **audit line for every change to a
  flow** (create, save, rename, restore, import, duplicate, delete), naming the account
  (or the gateway's identity) that made it, the flow and its version.
- **Version history** records which account saved each version.
- **In memory only**: failed sign-in counts per IP address (for `LOGIN_LOCKOUT_SECONDS`)
  and request counts per IP address (for one minute), each for at most 10,000
  addresses, for rate limiting.

## What the app sends elsewhere

Besides what flows send (an HTTP Request node's requests, the verbs Jambonz receives),
the app itself sends one thing: the **license check-in** to the JamHooks Portal's
license server (`license.jamhooks.app`), when the key is entered, at every start and about once a day. It
carries the license key, this install's random id, the host name in `BASE_WEBHOOK_URL`
and the JamHooks version: no caller, call or flow data, and no account names
([License](/reference/license/#check-ins)).

## The store and backups

The `storedata` volume holds flows, their version history (up to
`HISTORY_MAX_VERSIONS` earlier copies per flow), compiled flows, the session-signing
key and the license (its key, the portal's last lease and this install's id). **It holds no caller data**, unless an author puts some in a flow: a list of
caller numbers in a Conditional, an employee's number in a Transfer, a name in a
prompt. Those then sit in the flow and in its version history, which also records the account
that saved each version. Deleting a flow deletes its version history with it.

The same goes for a secret: the **default of an *obscure* environment variable** is
stored in clear in the flow, its version history and every backup. The read-only
account sees a placeholder instead, and an export or version download leaves it out
(importing one leaves the default empty), but the copies on the volume remain, which is
why a save warns about one. Set secrets in the Jambonz portal's application environment
variables instead.

Backups are copies of that volume (see [OPERATIONS.md](/reference/operations/#backup-and-restore)):
they contain whatever the flows contain, plus the session-signing key, and should be
protected and retained accordingly.

## Requests from data subjects

For a caller, the app itself has nothing to search, export or erase: it keeps no call
records. Look in the logs (by call sid, which Jambonz can give you for a caller's
number; the dashboard's *Log search* finds every line of a call; Loki deletes them
after `LOG_RETENTION`), in Jambonz, in the systems the flows' HTTP Request nodes call, and
(if authors put personal data in flows) in the flows and their version history.
