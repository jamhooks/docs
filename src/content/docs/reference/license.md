---
title: "License"
description: The license key JamHooks needs, what each license allows, and what the install sends to check it.
sidebar:
  order: 4.5
---

JamHooks needs a license key. Until one is entered, every page of the editor opens on
the **License** page and the API answers `403`. Webhooks that already exist keep
answering calls: the license never stops a call.

## Get a key

Keys come from the [JamHooks Portal](https://jamhooks.app). Register your company there
and start the trial, or e-mail [support@jamhooks.com](mailto:support@jamhooks.com) to buy
Pro. A key looks like `JH-XXXXX-XXXXX-XXXXX-XXXXX` and is listed on the portal's
**Licenses** page.

## Enter the key

Sign in as the admin and open the **License** page: the editor sends you there until a
key is entered, and afterwards the dashboard's **License** button opens it. Paste the
key and choose **Save key**. The install checks it with the portal straight away:

- A key the portal doesn't know, has revoked, or that is already active on another
  install is refused on the spot, with the portal's reason. Nothing is saved.
- If the portal can't be reached, the key is kept and the Free limits apply until a
  check-in gets through.

There is no environment variable for the key: the License page is the only place to
set it. The read-only account sees the page but can't change the key.

## What each license allows

| License | Webhooks | |
|---|---|---|
| Free | 3 | Also what applies when a license has expired, been revoked or can't be confirmed |
| Trial | No limit | Started once per company in the portal |
| Pro | No limit | |

At the limit, **New**, **Duplicate**, **Import** and **Load Example** are refused with
the reason, and the API answers `403`. Webhooks you already have keep working, can still
be edited and deployed, and are never deleted: an install with more webhooks than its
license allows keeps them all, and can add one again once it is under the limit.

## Check-ins

The install checks in with the portal when the key is entered, at every start and then
about once a day. The portal answers with a **lease**: a statement of the license,
signed by the portal and checked against the portal's public key built into the image.
The install trusts a lease for **14 days** without a check-in, so:

- The host needs **outbound HTTPS to `license.jamhooks.app`**, the portal's license
  server.
- When the portal can't be reached, nothing changes for 14 days; after that the Free
  limits apply until a check-in gets through. Calls are never affected.

A check-in sends the license key, this install's id, the host name in
`BASE_WEBHOOK_URL` and the JamHooks version: nothing about flows, calls or callers
([Personal data](/reference/privacy/#what-the-app-sends-elsewhere)).

The License page shows the last check-in, its result and when the next one is due. The
log has a line for each: `INFO` when it brings a lease, `WARNING` when the portal can't
be reached or refuses the key, `ERROR` when its answer can't be trusted (which the
monitoring stack alerts on).

## What the License page shows

| Badge | Meaning | Limits |
|---|---|---|
| Active | The portal confirmed the license | The license's |
| Not confirmed | The portal hasn't confirmed the key yet, or has revoked it | Free |
| Expired | The license has run out | Free |
| Not checked in | No check-in has got through for 14 days | Free, until one does |

## Moving the key to another install

A key is active on as many installs as its license allows (usually one). To move it,
choose **Remove key** on the old install: that releases its seat in the portal and locks
that editor again (its calls are still answered). An owner or admin can also release an
install on the portal's Licenses page, if the old install is gone. Then enter the key on
the new one.

The key, the last lease and this install's id live in the store volume (`license.json`
and `.install-id`), so a [backup](/reference/operations/#backup-and-restore) carries
them: a restored volume is the same install, with the same key.
