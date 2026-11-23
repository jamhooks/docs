---
title: "API"
sidebar:
  order: 8
---

The JSON REST API the editor uses, and the webhook routes Jambonz calls. The REST routes
take the same authentication as the editor ([CONFIGURATION.md](/reference/configuration/)); the
webhooks have their own ([HARDENING.md](/reference/hardening/)).

## REST

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/flows` | List flows |
| `POST` | `/api/flows` | Create a flow |
| `GET` | `/api/flows/{id}` | Get a flow |
| `PUT` | `/api/flows/{id}` | Replace a flow |
| `POST` | `/api/flows/{id}/save` | Save + snapshot a version |
| `DELETE` | `/api/flows/{id}` | Delete a flow |
| `POST` | `/api/flows/{id}/compile` | Compile a flow |
| `POST` | `/api/flows/{id}/validate` | Validate a flow |
| `GET` | `/api/flows/{id}/versions` | List versions |
| `GET` | `/api/flows/{id}/versions/{n}` | Get a version |
| `GET` | `/api/flows/{id}/versions/{n}/download` | Download a version's JSON |
| `GET` | `/api/flows/{id}/export` | Export a flow as a portable JSON bundle |
| `POST` | `/api/flows/import` | Import a flow bundle (optional `?name=` override) |
| `POST` | `/api/flows/{id}/duplicate` | Copy a flow under a new name |
| `POST` | `/api/flows/{id}/versions/{n}/restore` | Restore a version |
| `POST` | `/api/flows/{id}/simulate` | Dry-run a flow with test input (no call placed) |
| `WS` | `/ws/trace/{flow_id}` | Live per-node trace of calls to a flow (the editor's Debug pane) |

A save that won't compile is a `422` whose `issues` lists what is wrong; a name already
taken is a `409`, as is a save based on a version someone else has since replaced.

Until the install has a license key, every REST route answers `403` with an `error`
naming the License page. With one, a create, import or duplicate that the license doesn't
allow (it is at its webhook limit) is a `403` whose `error` says so; nothing else is
limited ([License](/reference/license/)).

`/validate` (the editor's live check, on the stored flow or on a candidate sent as the
body) answers like `/compile` without building anything, plus `variables`: every name the
flow's components store into, in flow order. The editor needs that list to draw a
`{{name}}` that nothing sets in red.

## Webhooks

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/webhooks/{flow_name}` | The application's calling webhook |
| `OPTIONS` | `/webhooks/{flow_name}` | Application env-var schema (fetched by Jambonz) |
| `POST` | `/webhooks/{flow_name}/continue/{node_id}` | Action hook (set by the app on each waiting verb) |
| `POST` | `/webhooks/{flow_name}/callstatus` | The application's call status webhook: Call Status handler, and Disconnect on the final status |
| `POST` | `/webhooks/{flow_name}/error` | Runs the Error handler (compatibility only; Jambonz has no error hook) |
| `POST` | `/webhooks/{flow_name}/disconnect` | Runs the Disconnect handler (compatibility only; Jambonz has no disconnect hook) |
| `POST` | `/webhooks/{flow_name}/subflows/{name}` | Run a named subflow |

`{flow_name}` is the flow's full path-style name, so it may contain `/`
(`/webhooks/acme/dev/inbound`). How these hooks fit together is in
[RUNTIME.md](/reference/runtime/).
