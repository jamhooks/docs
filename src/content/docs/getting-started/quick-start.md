---
title: Quick start
description: Run JamHooks on your own machine and build a first call flow.
sidebar:
  order: 1
---

JamHooks is a visual editor for IVR call flows on [Jambonz](https://jambonz.org). You
build a flow from components (Menu, Play Prompt, Transfer, Conditional, AI Agent and
more). JamHooks stores and versions it, compiles it into Jambonz verbs, and serves it as
the webhooks a Jambonz application calls.

This page gets an instance running on your own machine, for evaluation. To run it for
real callers, follow [Deployment](/reference/deployment/) afterwards.

## Run it

You need Docker with Compose.

```bash
git clone https://github.com/jamhooks/jamhooks.git
cd jamhooks
docker compose up --build
```

Open `http://127.0.0.1:5001`. The first start downloads the editor's front-end assets
once.

:::caution
Without a `.env` file this instance runs **open**: there is no editor login, and anyone
who can reach it can call its webhooks. Docker publishes the port on `127.0.0.1` only, so
nothing beyond this machine can reach it. Keep it that way until you have followed
[Deploying for real](/reference/deployment/#deploying-for-real).
:::

## Build a first flow

1. Choose **New Flow**, then **Load Example**, and pick one of the examples. Each is a
   complete flow you can take apart.
2. Click a component on the canvas to see its settings in the side panel. Components run
   top to bottom; a component with outcomes (a Menu's keys, a Conditional's rules) holds a
   branch per outcome.
3. Open **Simulate** and **Run** the flow with typed input, such as the digits a caller
   would press. Nothing is called; you see the path the call would take.
4. Click **Deploy** to save it. Every deploy is a version you can view and restore later.

[Building flows](/reference/flows/) explains every component and how branching works.

## Next

- [Connect Jambonz](/getting-started/connect-jambonz/) to take a real call on the flow.
- [Deployment](/reference/deployment/) before anyone else can reach the instance.
