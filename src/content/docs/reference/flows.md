---
title: "Building flows"
sidebar:
  order: 1
---

What a flow is made of, what each component does, and how to try them all on a real
call. How a flow runs once Jambonz calls it is in [RUNTIME.md](/reference/runtime/).

## Concepts

- **Flow** (3CX "Callflow"): a nested tree of **components** across four handler paths,
  Main, Error, Disconnect and Call Status, plus any named subflows. In a flow's JSON
  (what the API takes and returns, the `flow` object of an export) they are the keys
  `main`, `error`, `disconnect`, `callstatus` and `subflows` (`{"<name>": …}`), each
  handler `{"components": […]}`. A key a flow doesn't have is ignored, so a flow sent
  with `on_error` is saved with an empty Error handler and no complaint. Linear flow is
  component order; branching is each component's `branches` map; cross-tree jumps use the
  `goto` (Connector) component. There are no edges and no `entrypoint`.
- **Per-handler components**: Main and Error allow all components; Disconnect and Call
  Status are non-interactive and allow side-effect components only (Flow Control +
  Application Tools, **no Call Control**), and nothing that works through the hook's
  response, which Jambonz ignores there: no Send SMS, and no Logger with its Jambonz
  alert ticked (a Logger that only logs is fine). The editor only shows valid components
  per tab; the compiler enforces it.
- **Webhook name**: a flow's name IS its identity and its organisation: a path-style
  slug (`acme/dev/inbound`, lowercase `[a-z0-9_-]` per segment) that appears verbatim in
  its webhook URL, `/webhooks/{flow_name}`. Names are globally unique; the dashboard
  groups flows into folders by their parent path. There is no separate group entity.
- **Version**: when version history is enabled (`VERSION_HISTORY_ENABLED`, default on),
  every `save` snapshots the flow's JSON so you can view, download and restore earlier
  revisions. Set it to `false` to disable snapshots entirely.
  A save also carries the version it started from, so if someone else deployed this
  webhook while your tab was open, Deploy stops with *"Changed elsewhere: reload"*
  instead of overwriting their work. Your edits stay in the editor; copy them out with
  **Edit JSON** before reloading if you need them. (API clients get a `409`; sending no
  `version` opts out of the check.)
- **Compiled flow**: the deterministic output of the compiler: the nested tree **flattened**
  into a `node_map` keyed by dotted-path ids (`main.menu.tsales`), with routing metadata.

## Components

Modelled on the 3CX Call Flow Designer; each compiles down to Jambonz verbs.

**Call Control:** `play_prompt` (say/play), `menu` (1-digit gather, per-digit branches),
`collect_input` (variable-length DTMF), `voice_input` (speech), `transfer` (dial),
`sip_refer` (blind transfer: hands the call off and drops out of the path),
`enqueue` / `dequeue` (call queues: the caller side and the agent side),
`conference` (multi-party room), `ai_agent` (`llm`, an LLM voice agent: OpenAI, Azure
OpenAI, Google, Deepgram, Ultravox or ElevenLabs, configured from a per-vendor starter
template whose API key is an obscure env var),
`record` (listen), `transcribe`, `pause` (timed wait), `send_dtmf`,
`dub` (background audio mixed alongside the flow), `call_config` (sticky call
settings: voice, recognition language, barge-in, hold music), `disconnect` (hangup).

**Flow Control:** `conditional` (ordered rules, one branch per rule, first match wins),
`date_time` (timezone + ordered weekly/single-date/date-range rules, first match wins; blank
timezone = UTC; an overnight window like Fri 18:00–08:00 belongs to the day it starts on, so
it covers Saturday 03:00),
`loop` (a Connector back to it from inside its body is the next pass; reaching it from
anywhere else starts it over), `goto` (Connector), `exit_callflow` (ends the call, inside a
subflow too).

**Application Tools:** `change_variable` (set/increase/decrease/replace/delete),
`http_request`, `json_parser`, `log` (Logger: writes a line to the server log; tick
*Also send to Jambonz Alerts page* and the same line is also raised as a Jambonz
application alert, listed against the call on the portal's Alerts page and through its
API, whatever the level), `send_message` (SMS), `subflow`.

Any other string is also accepted as a component `type` and stored as a raw Jambonz verb.

### Where a component is allowed

The Disconnect and Call Status handlers run from the call-status hook, whose response
Jambonz ignores. So besides Call Control, they refuse **Send SMS** (the message would never
be sent) and a **Logger with its alert ticked** (the alert goes to Jambonz in the response
too); a Logger that only logs is allowed everywhere. The same holds for anything those
handlers *lead to*: the save refuses Call Control, Send SMS and a ticked Logger reached
through a Subflow component or a Connector (into Main, the Error handler or a subflow),
exactly as if placed there directly. The error sits on the component that leads out, and
what it leads to stays usable from Main.

An Enter Queue **wait subflow** may only play, say, pause, tag or leave, so it can't raise
a Logger alert either.

### Branch outlets

One outlet per branch, per branching component:

| Component | Outlets |
|---|---|
| `conditional` | one per rule + `else` |
| `date_time` | `match`, `else` |
| `menu` | each digit + `timeout`, `invalid`, `default` |
| `collect_input` | `timeout`, `invalid` (input shorter than its minimum), `default` |
| `transfer` | `success`, `failure`, `timeout` |
| `enqueue` | the reported outcome (`bridged`, `hangup`, `leave`, `error`) + `default` |
| `dequeue` | the reported outcome (`complete`, `timeout`, `hangup`) + `default` |
| `loop` | `loop` (the body) |

`conference`, `sip_refer` and `ai_agent` suspend without branching: the flow resumes at
the next component, except that a blind transfer that **succeeded** ends the call there,
inside a subflow too, without returning to the component after its caller (the
components after it are its fallback).

A gather whose speech recognizer **fails** runs the flow's Error handler; a recognition
Jambonz flags as low-confidence, and User Input cut short by the finish key, take the
no-answer path (`invalid`, else `timeout`).

### Gathered input

Input from `menu` / `collect_input` / `voice_input` lands in the call variable named by
the component's **Store input in variable** field. It defaults to the Jambonz name
(`digits`, or `speech` for a speech gather), which the *next* gather overwrites. Type a
name of your own (e.g. `account_number` → `{{account_number}}`) and the input is copied
there as well, carried on the call, so it survives every later gather, transfer and hook.

### Voices and recognizers

**They default to the call's.** A Menu, User Input or Voice Input prompt can have its own
**Prompt voice** (vendor / language / voice, like Play's); blank means whatever the call is
using (the application's voice, or the last Call Settings), field by field, so a voice
set without a vendor is spoken by the call's vendor (in Play too, which used to drop it
with a warning). Voice Input's and Transcribe's recognizer fields work the same way:
blank inherits the application's speech settings. *(They used to prefill `google` /
`en-US`, which overrode the application; components saved with that prefill keep it
until the fields are cleared.)*

That includes the **speech credential**: with more than one credential for a vendor, the
application names one by label, and a prompt with its own voice (or Call Settings
changing it) keeps using that one; Jambonz would otherwise switch such a prompt to the
vendor's unlabelled credential, so the app writes the call's label in, as Jambonz
reported it on the call's first hook. A prompt that switches to *another* vendor uses
that vendor's unlabelled credential.

### HTTP Request URLs

**They encode what they interpolate.** A `{{var}}` in the URL's path, query or fragment
is percent-encoded, so a caller's input can't add path segments or query parameters:
`https://api.example.com/accounts/{{digits}}` with `1/../admin` requests
`/accounts/1%2F..%2Fadmin`, and `?phone={{from}}` sends `%2B31…` for `+31…`. Two places
are inserted as-is, because they say *where* to connect and are yours to build: a
placeholder that **starts** the URL (`{{env_vars.API_BASE}}/users/{{digits}}`), and
anything in the **scheme or host** part (`http://{{env_vars.API_HOST}}:{{env_vars.PORT}}/x`).

To insert any other value unencoded (a value that is meant to be several path segments),
write `{{var|raw}}`. Headers and the JSON body are unchanged: body values are always sent
JSON-escaped. *(This is a change: earlier versions spliced URL values in raw.)* The same
`|raw` opts a value out of Change Variable's regex escaping, where `{{var}}` is otherwise
matched literally.

### HTTP Request headers and body

The **method** sits in front of the **URL**, on one line, the way a request line reads.
**Headers** and **Body** are rows of a name and a value, such as `Authorization` →
`Bearer {{env_vars.TOKEN}}`, with `{{var}}` working in any value. Each has a
**Rows | JSON** switch: the JSON view edits the same object as written, and is the only
one for a value that isn't text (a number, `true`/`false`, a list, a nested object). Rows
can't show those, so such a body opens as JSON. An empty body sends no body at all.

Under a row, the editor says what the request won't do as you meant: a value with no name
isn't sent; of two rows with one name only the last is sent; and a header name with a
space, colon or quote fails the request. `Content-Type: application/json` pasted as the
name is one click from being split into name and value.

### Response mapping

An HTTP Request keeps what it needs from the JSON response in variables, one row per
value: a **Path** into the response and the variable to **Save as**. A path is keys and
list positions (from 0) joined by dots: `data.customer.name`, `data.items.0.id`. An empty
path keeps the whole response; a path that finds nothing leaves the variable empty. A
failed request sets `{{http_error}}` (empty after one that worked), for a Conditional to
branch on. JSON Parser's Mappings work the same way on a variable holding JSON.

Only dots are read: `$.data.items[0].id` (JSONPath), `data["items"]` or `/data/items/0`
find nothing, so the editor offers the dotted form under the row; likewise a `{{name}}`
typed where the name goes. **Pick from a sample** takes an example of the JSON (from the
API's documentation, say) and lists every value in it; click one to add its row, with a
variable name made from its key that clashes with nothing the flow already uses. The
sample is only used there; it isn't saved with the flow.

The examples that make HTTP requests (`account_lookup`, `priority_routing` and the
`data_tools` bench) call the JamHooks example API at `https://example.jamhooks.com`, which
answers them with sample data. Its source is public at
[github.com/jamhooks/example-api](https://github.com/jamhooks/example-api); to run your own
copy, change the account lookup's URL or the `CRM_URL` and `ECHO_URL` env vars.

In every field the runtime fills in, `{{variables}}` are shown in **green** when the name
resolves. That is a call field (`{{from}}`, `{{digits}}`, `{{call_sid}}`, …), a flow
variable, a declared env var (`{{env_vars.NAME}}`), or a variable some component stores
into (Start, Change Variable, a mapping, a gather's result, a Loop's counter). They are
shown in **red**, with a wavy underline, when nothing sets them: at run time they would be
empty. Hovering the field
names the red ones. A name a component stores into turns green a moment after it is
typed, once the editor's live check has run.

## Conditions

A **Conditional** holds an ordered list of rules (each owns one branch and carries its own
conditions), evaluated top to bottom, first match wins, with `else` catching everything else.
One rule is the plain If true / If false case, which is what a new Conditional starts as.

Conditions compare with a *type*: `Automatic` follows the variable's own type (the call
context holds real booleans and numbers, e.g. a boolean env var), or pin it to text / number
/ yes-no; `is set`, `is empty`, `is true` and `is false` take no value. The value may be a
variable: `pin equals {{env_vars.PIN}}`. An empty value (a gather that timed out) is never
less or greater than anything. See
examples/priority_routing.json.

A **Template** condition is a small expression: `{{digits}} == '1' and {{attempts}} < 3`,
`not ({{speech}} contains 'agent')`, `{{vip}} == true`. Operators are `==` `!=` `<` `>` `<=`
`>=` `contains`, combined with `and`, `or`, `not` and parentheses; text goes in quotes,
numbers and `true`/`false` as they are, variables as `{{name}}`. A caller's input is always
a value, never part of the expression. A template with no operator (just `{{flag}}`) is true
when the value is set and isn't `false`/`0`. *(This is a change: a template like
`{{x}} == 'y'` used to be always true.)*

## Trying every component on a real call

Seven **node test benches** in `examples/` (`nodes_*.json`) use every
component between them. Load one from *New Flow → Load Example*, point a Jambonz
application's call hook at `<BASE_WEBHOOK_URL>/webhooks/<name>` (status hook:
`…/callstatus`), set its env vars in the portal, and call it. A bench is a keypad menu:
each key runs one test, says which outlet it took, and comes back to the menu.

| Bench (`example/nodes/…`) | Tests | Needs |
|---|---|---|
| `prompts` | Play Prompt (SSML, repeat, style prompt, audio file), Pause, Dub, Send DTMF, Call Settings | `AUDIO_URL` (preset to a public MP3) |
| `caller_input` | Menu, User Input, Voice Input, a Conditional on a PIN | a speech recognizer, for Voice Input |
| `data_tools` | Start, JSON Parser, every Change Variable operation, Loop, HTTP Request, Conditional (template), Date & Time, Logger + alert | `ECHO_URL` (preset to the example API); no keypad (it also runs end to end in Simulate) |
| `queues_and_conference` | Enter Queue (all outlets, its wait subflow, a raw `leave` verb), Dequeue, Conference | two phones |
| `transfers_and_sms` | Transfer, Blind Transfer, Send SMS | `TRANSFER_TO`, `REFER_TO`, `SMS_TO` |
| `streaming_and_ai` | Record, Transcribe, AI Agent | `RECORD_WS_URL`, `TRANSCRIPT_HOOK_URL`, `OPENAI_API_KEY` |
| `subflow_calls` | Subflow (returns, nested), Exit Call Flow and a Connector inside a subflow, Call Status handler | nothing |

The queue bench's wait URL is relative (`/webhooks/example/nodes/queues_and_conference/subflows/hold`),
so Jambonz resolves it against the call hook's host. Behind a proxy that adds a path
prefix, make it absolute.
`tests/test_node_examples.py` walks each bench through the
simulator and fails when a palette component appears in no example.
