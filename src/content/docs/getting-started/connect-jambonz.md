---
title: Connect Jambonz
description: Point a Jambonz application at a JamHooks flow and take a real call.
sidebar:
  order: 2
---

A Jambonz application calls two webhooks. JamHooks serves both for every flow, at a URL
built from the flow's name.

## Set the application's webhooks

In the Jambonz portal, open the application and set both webhooks, with method **POST**:

| Jambonz webhook | URL |
|---|---|
| Calling webhook | `<BASE_WEBHOOK_URL>/webhooks/<flow name>` |
| Call status webhook | `<BASE_WEBHOOK_URL>/webhooks/<flow name>/callstatus` |

`BASE_WEBHOOK_URL` is the public address Jambonz reaches JamHooks on. A flow's name
appears in its URL as it is, slashes included: a flow named `acme/dev/inbound` is served
at `/webhooks/acme/dev/inbound`. The flow's detail page shows both URLs.

:::note
Without the call status webhook, the flow's **Call Status** and **Disconnect** handlers
never run.
:::

## Make it reachable

Jambonz has to reach the instance over the network, so a copy running on `127.0.0.1`
won't do. Before you open it up, set the editor login and the webhook secret, and put TLS
in front: [Deploying for real](/reference/deployment/#deploying-for-real) goes through it
step by step.

## Try every component

The node test benches are flows with a keypad menu of tests, one per component group.
Load one from **New Flow** → **Load Example**, point a Jambonz application at it and call
it: see [Trying every component on a real call](/reference/flows/#trying-every-component-on-a-real-call).
