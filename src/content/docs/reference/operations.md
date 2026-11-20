---
title: "Operations"
sidebar:
  order: 5
---

Running one instance in production: the reverse proxy in front of it, backups,
upgrades, health checks and logs, monitoring and alerts, capacity and sizing, secret
rotation, and what "one instance" means. First-time setup is in [DEPLOYMENT.md](/reference/deployment/); what the
app stores and logs about callers is in [PRIVACY.md](/reference/privacy/).

Commands assume the stock docker-compose.yml, run from the
directory that holds it.

## One instance per store

The JSON file store has **one writer**. At startup the app takes an exclusive advisory
lock (`flock`) on `<store>/.lock`; a second process pointed at the same store refuses
to start rather than corrupt it. So:

- **One instance per store**, `UVICORN_WORKERS=1` (compose pins it). There is no
  read-only or webhook-only instance mode: every instance serves the editor and the API
  too, and can write.
- **A copy of the store is not a replica.** A second instance on a copy is a second,
  independent installation: its editor writes to its copy, and the two drift apart from
  the first save. The call runtime keeps no call state in the app (variables ride on the
  call, see [PRIVACY.md](/reference/privacy/)), but that only means *any* instance could serve a
  hook; it does not make two stores one.
- **Orchestrators: `replicas: 1` and a stop-before-start rollout** (Kubernetes
  `strategy: Recreate`, a `ReadWriteOnce` volume). A rolling update starts the new pod
  while the old one still holds the lock; the new one then fails to start.
- **Put the store on a local or block volume** (a Docker named volume, a local disk,
  a cloud block device). `flock` on NFS, CIFS/SMB and some FUSE filesystems may not be
  enforced across machines, so two hosts on a shared mount can both believe they hold
  the lock.
- **High availability is a future platform concern** (see
  ARCHITECTURE-DIRECTION.md), not something to assemble
  from copies. Today, availability comes from a quick restart: the container starts in
  a couple of seconds and `restart: unless-stopped` brings it back after a crash or a
  reboot.

## Reverse proxy

The app speaks plain HTTP on port 5001. Compose publishes it on `127.0.0.1` only
(`APP_PUBLISH`), so a proxy on the same host reaches it and the network doesn't.
Whatever the proxy, it has to:

- **Upgrade websockets** on `/ws/`: the editor's Debug pane opens `/ws/trace/<flow id>`.
- **Pass the browser's `Host` through.** The app's CSRF check compares a request's
  `Origin` with its `Host`; a proxy that sends its upstream address instead makes every
  save a "cross-origin" `403`.
- **Set `X-Forwarded-For` and `X-Forwarded-Proto`**, and the app has to be told to
  believe them: **set `FORWARDED_ALLOW_IPS` to the proxy's address.** uvicorn only
  reads those headers from the addresses listed there, and its default, `127.0.0.1`,
  never matches in Docker: a proxy on the host reaches the container from the Docker
  network's gateway (`172.17.0.1`, `172.18.0.1`, …), not from loopback. Without it every
  caller shares one rate-limit bucket and one failed-sign-in count, the log shows the
  gateway's address for everyone, and the app thinks every request was plain http.
  See [Which address to trust](#which-address-to-trust).
- **Overwrite `X-Forwarded-For`, don't append to it.** The header is a list, and a proxy
  that appends (nginx's `$proxy_add_x_forwarded_for`, the snippet most guides copy)
  passes on whatever the client wrote there first. Whether that matters depends on
  `FORWARDED_ALLOW_IPS`: set to the proxy's address, uvicorn reads the list from the
  right and stops at the first address that isn't a trusted proxy, the one your proxy
  wrote; set to `*`, it takes the **left-most** entry, the client's own claim. Then
  every request picks its own address: it slips the per-address rate limit and sign-in
  lockout, writes whatever address it likes into the failed-sign-in log lines, and costs
  the rate limiter memory for every address it invents. The examples below overwrite
  the header *and* trust an address, so either mistake alone is harmless.
- **Cap request bodies at `MAX_REQUEST_BYTES`** (1 MiB by default). The app enforces
  its own limit too; keeping the two equal means neither surprises you. Raise both
  together (a large flow import is the usual reason).
- **Wait longer than `MAX_HOOK_SECONDS`** (8 s by default) for a response. A webhook
  answers within about that long (its HTTP requests are clamped to it and the Error
  handler runs on what is left), but only if the proxy is still waiting for it; a shorter
  proxy timeout turns it into a `502`/`504` and the caller hears the line drop. (Jambonz
  itself waits about 10 s, which is why the budget is 8.)

### Which address to trust

The proxy's address **as the container sees it**. With the stock compose file and the
proxy on the host, that is the compose network's gateway; Docker's port publishing
hands the connection to the container from there, whatever address the proxy dialled:

```bash
docker network inspect jamhooks_default \
  --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'      # e.g. 172.18.0.1
```

(The network is `<compose project>_default`; `docker network ls` shows it.) Docker picks
that address when it creates the network, so it can change when the network is
recreated (`docker compose down` removes it). To avoid tracking it, trust Docker's
private range instead, `FORWARDED_ALLOW_IPS=172.16.0.0/12` (add `192.168.0.0/16` if
Docker has run out of 172.x networks): with the port published on loopback, nothing
outside this host connects from it. A proxy in a container on the same network is that
container's address; a proxy on another machine is that machine's.

`*` was the advice here once, on the grounds that only the host can reach a
loopback-published port. That much is true, but `*` also makes uvicorn believe the
left-most `X-Forwarded-For` entry, so it is only safe as long as the proxy overwrites
the header, one copied line of proxy config away from letting every client choose its
address. Trust the address instead.

### Caddy

Caddy obtains and renews the certificate itself, passes `Host` through, sets
`X-Forwarded-For` / `X-Forwarded-Proto`, and upgrades websockets without being asked.
Its `X-Forwarded-For` holds the one address Caddy saw: it discards whatever a client
sent unless that client is listed in Caddy's `trusted_proxies`, which by default nobody
is, so this needs no forwarding line of its own. (That is Caddy 2.5 and later; Ubuntu
24.04 and Debian 12 package 2.6. An older Caddy appends to what the client sent, which
is still harmless while `FORWARDED_ALLOW_IPS` names the proxy rather than `*`.)

```caddy
ivr.example.com {
	# = MAX_REQUEST_BYTES (1 MiB by default). Raise the two together.
	request_body {
		max_size 1MiB
	}

	reverse_proxy 127.0.0.1:5001 {
		transport http {
			# Caddy sets no response timeout by default, which is fine. If you
			# set one, keep it above MAX_HOOK_SECONDS (8 s).
			response_header_timeout 60s
		}
	}
}
```

### nginx

```nginx
# Connection header for the websocket upgrade (the editor's Debug pane,
# /ws/trace/<flow id>); a plain request gets "close".
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ivr.example.com;
    return 301 https://$host$request_uri;
}

server {
    # `http2` on the listen line, not the `http2 on;` directive: that one needs
    # nginx 1.25.1, and `nginx -t` refuses it on what Ubuntu 24.04 (1.24) and
    # Debian 12 (1.22) ship. Newer nginx accepts this form with a deprecation
    # warning.
    listen 443 ssl http2;
    server_name ivr.example.com;

    ssl_certificate     /etc/letsencrypt/live/ivr.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ivr.example.com/privkey.pem;

    # = MAX_REQUEST_BYTES (1 MiB by default). Raise the two together.
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;

        # The app compares a form's Origin with Host (its CSRF check): pass the
        # browser's Host through, or every save is refused as cross-origin.
        proxy_set_header Host              $host;
        # The address nginx saw, replacing, not appending to ($proxy_add_x_forwarded_for),
        # whatever the client sent. Behind another proxy or a CDN, configure the realip
        # module so $remote_addr is the client's again.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Websocket upgrade for the Debug pane.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Longer than MAX_HOOK_SECONDS (8 s), so a slow webhook ends in the
        # flow's Error handler rather than a 504 from here. 60 s, not ~10,
        # because the Debug socket pings every 25 s and this keeps an idle
        # one open.
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

With either, `.env` gets the public URL and the proxy's address (see
[Which address to trust](#which-address-to-trust)):

```ini
BASE_WEBHOOK_URL=https://ivr.example.com
FORWARDED_ALLOW_IPS=172.18.0.1
```

**Check it worked:** sign in through the proxy. The log line for a failed sign-in
should show your own address, not `172.x.0.1`, and no warning about a `Secure` cookie
sent over plain http should appear. Then check that a client can't choose its address.
This is one failed sign-in, and its log line must still name *your* address, not
`192.0.2.1`:

```bash
curl -s -o /dev/null https://ivr.example.com/login \
  -H 'X-Forwarded-For: 192.0.2.1' -d 'username=check&password=check'
docker compose logs app | grep 'Failed sign-in' | tail -1
```

## Backup and restore

Everything the app keeps is in the `storedata` volume (`/app/data` in the container):

| Path | What | In a backup |
|------|------|-------------|
| `store/flows/<id>.json` | Each flow: the source of truth | Yes |
| `store/versions/<id>/<n>.json` | Version history (`HISTORY_MAX_VERSIONS` per flow) | Yes |
| `store/compiled/<id>.json` | Compiled flows: regenerated on save, safe to lose | Optional |
| `store/.sesskey` | The key that signs sign-in sessions and known-browser cookies | Yes, **a secret** |
| `store/.lock` | The single-writer lock file (empty) | Harmless |

There is no database to dump. The volume holds no call records and no caller data
(see [PRIVACY.md](/reference/privacy/)), but **treat every backup as a secret**: with
`.sesskey`, whoever holds it can forge a sign-in cookie for this instance. Keep backups
encrypted or access-controlled, and if one leaks, rotate the key (see
[Rotation](#rotation)).

**Stop the app for the copy.** The store is written by one process that also caches
flows in memory; a copy taken while it saves can catch a flow and its version history
half-way, and a restore under a running app is overwritten by its next save. A stop is
a few seconds without service (calls that arrive meanwhile fail), so pick a quiet
moment.

Two scripts do it, and CI runs both against every image it builds, so the procedure
here is the one that is tested. Run them on the Docker host from the checkout (they
drive the `docker-compose.yml` beside them, wherever you call them from).

**Back up:**

```bash
scripts/backup.sh                          # writes ./ivr-store-<date>.tgz
scripts/backup.sh /var/backups/ivr/ivr-$(date +%F-%H%M).tgz
```

It stops the app, copies the volume, checks the archive reads back whole and starts
the app again, **also when the copy fails**, so a failed backup never leaves the IVR
down. An app that wasn't running is left stopped. The archive belongs to you and is
readable only by you (`0600`): the copy runs as root inside the app's own image,
because the store's files belong to the container's user and are owner-only, and your
shell writes the archive. It never overwrites an existing archive and never leaves a
partial one; any failure exits non-zero, so a scheduler can alert on it.

To schedule it (at a quiet hour, since it stops the app) from cron (`%` must be
escaped there):

```cron
30 3 * * * cd /srv/jamhooks && scripts/backup.sh /var/backups/ivr/ivr-$(date +\%F).tgz
```

Copy the archives off the host, and prune old ones: nothing here does either.

**Restore** (replaces everything in the volume):

```bash
scripts/restore.sh ivr-store-2026-10-11.tgz
```

It checks the archive first (and changes nothing if it isn't a store backup), stops
the app, unpacks into a staging directory on the volume and swaps it in only once that
worked (a failed restore leaves the old store as it was) and starts the app again.
The files get back their owner and modes. **On a new host:** clone the repo, check out
the release the backup came from, write `.env`, run `scripts/restore.sh <archive>` (it
creates the volume), then `docker compose up -d`.

Then open the dashboard and check the flows are there. The restore brings back the
backup's `.sesskey` too, so sign-ins made under any other key end.

The [monitoring](#monitoring) volumes are not in the archive (see
[Upgrades, backups and the Docker socket](#upgrades-backups-and-the-docker-socket)).

**Per-flow copies** are also available while the app runs: `GET /api/flows/{id}/export`
downloads a portable bundle and `POST /api/flows/import` loads one (with new component
ids). Useful for moving a flow between instances; not a substitute for the volume
backup, since it carries no version history.

## Upgrade and rollback

An upgrade is a new image and a restart. There is **no migration step**: each flow is
one JSON document, and a newer version reads what an older one wrote.

Each release builds its own local image, **`jamhooks:<version>`** (the
`image:` in `docker-compose.yml`, bumped in every release), so the one you are running
stays on the host when you build the next: a rollback needs no rebuild and no
network. `docker image ls jamhooks` lists them. Deploy from release tags: a
build of an untagged commit carries the last release's version and replaces that
release's image.

1. Read [CHANGELOG.md](/reference/changelog/) for the release, including its upgrade notes.
2. **Back up the volume** (above). It is the only way back if a newer version saves
   flows an older one doesn't understand.
3. Build the new version and swap it in:

   ```bash
   git fetch --tags && git checkout vX.Y.Z
   docker compose build --build-arg APP_REVISION="$(git rev-parse HEAD)"
   docker compose up -d
   ```

   The `--build-arg` records the commit in the image, for the app to report; without
   it the image says `unknown`. `up -d` stops the old container (it gets up to
   `stop_grace_period` to finish the webhooks it is running) and starts the new one.
   In between (a few seconds) new calls fail, and a call waiting on a menu or a
   transfer loses its next step (its resume hook has nowhere to go, or lands on a flow
   that moved). **Upgrade in a quiet window.**

4. Check the startup log:

   ```bash
   docker compose logs app | grep -E "SECURITY:|Editor login|ERROR"
   ```

   You want `Editor login enabled` and **no** `SECURITY:` line. A `SECURITY:` line
   means a protection is off, usually a setting that didn't reach the container.

**Roll back** to the release you came from:

```bash
git checkout vX.Y.W                  # the previous release's tag
docker compose up -d --no-build      # starts jamhooks:X.Y.W, still on this host
```

If that image has been removed since, `docker compose up -d --build` rebuilds it from
the checkout. Remove an old image (`docker image rm jamhooks:<version>`)
only once you are sure you won't go back to it; keep at least the previous one.

Flows nobody saved since the upgrade need nothing. A flow *saved* on the newer
version may use a field or component the older one doesn't know: the older one ignores
unknown fields (and drops them on its next save of that flow) and treats an unknown
component type as a raw Jambonz verb. Run **Validate** on such flows, or restore the
pre-upgrade backup.

## Health and logs

**Health.** `GET /health` asks whether the store can take a write *now*, by making
one: it writes 64 KiB to a file in the store, fsyncs it and deletes it. `200` means it
could; `503` means it couldn't (a full disk, a volume remounted read-only, a store
directory left with the wrong owner by a hand-made restore), and the log line
`Health check failed: …` says which (the response doesn't, since it needs no sign-in).
The image's `HEALTHCHECK` polls it every 30 s, and `docker ps` shows the container
`healthy` or `unhealthy`. Docker and compose only **report** that: neither restarts an
unhealthy container (`restart: unless-stopped` acts only when the process exits).

**`/health` is for alerting a human, not for restarting the app.** A store that can't
take a write means saves fail; it doesn't mean calls do. A webhook writes nothing to
answer a call (it reads the compiled flow, which the app also keeps in memory), so an
instance on a full or read-only store goes on serving calls. A restart fixes none of
the causes and drops every call in progress; on a store the app can't read it may not
come back at all, because the app reads (or creates) its session key there when it
starts. So:

- **Alert on it.** The [monitoring](#monitoring) profile does (*Store can't take a
  write*). Without it, poll `/health` from your own monitoring, or the container's state,
  `docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)"`. Fix the
  cause (free some space, remount, put the owner back, or redo the restore with
  `scripts/restore.sh`, which sets owners and modes) and the next probe answers `200`;
  nothing needs restarting.
- **Don't restart on it**: no cron job or systemd timer that restarts an `unhealthy`
  container, no watchdog container such as `autoheal`.
- **Under an orchestrator, keep the store out of its probes.** A liveness probe on
  `/health` is that restart, automated. If you want a liveness probe, make it a TCP
  check on port 5001 (Kubernetes `tcpSocket`), which fails only when nothing is
  listening. Don't make `/health` the readiness probe either: there is exactly one
  instance ([One instance per store](#one-instance-per-store)), and failing readiness
  takes the only instance out of the Service, so the calls it could still answer reach
  nothing. Docker Swarm *does* act on the image's `HEALTHCHECK` (it replaces an
  unhealthy task), so switch it off in the stack file (`healthcheck: disable: true`)
  and alert on `/health` instead.

**Logs are the metrics.** There is no metrics endpoint: every webhook ends with one
completion line (`hook … finished: status=… duration_ms=… verbs=… outcome=…`; with
`LOG_FORMAT=json` each is a top-level field), and rates, latencies and failures are
read from those. Where callers go is read from the **routing lines** beside them (logger
`app.routing`): one when a hook leaves the call waiting at a Menu, User Input, Transfer,
queue or other component that waits for an answer (`Waiting at main.menu …`), one when
that answer comes back and is routed, and one when a Conditional or Date & Time picks
its branch (`Routed main.menu (menu 'Main menu'): 2 -> 2`), roughly one or two more
lines per webhook. They name the component and its outlet, never what the caller typed
or said ([Reading the Routing panels](#reading-the-routing-panels)). Both are INFO
lines, so a `LOG_LEVEL` above `INFO` leaves the dashboard empty. Docker itself keeps only **5 × 10 MB** of them per container (days
on a busy instance, not weeks) and deletes a container's logs with the container, so
every `docker compose up -d` that recreates it (an `.env` change, an upgrade) starts
that history again. The [monitoring](#monitoring) profile keeps them for
`LOG_RETENTION` (30 days by default) and draws the dashboard and the alerts from them.
To send them somewhere else instead:

- set `LOG_FORMAT=json`, and let a collector read the container's output (Vector,
  Fluent Bit, Grafana Alloy, an agent from your log service; they read Docker's log
  files or its API), or
- hand them to a Docker logging driver that forwards (`journald`, `syslog`, `fluentd`,
  `gelf`, `awslogs`, `gcplogs`, …), in a `docker-compose.override.yml` beside the
  stock file, so an upgrade doesn't overwrite it:

  ```yaml
  services:
    app:
      logging:
        driver: journald
  ```

Wherever they go, the logs carry call sids and the addresses of sign-in attempts, and
their retention there is yours to set ([PRIVACY.md](/reference/privacy/)). A container started
with plain `docker run` gets Docker's default `json-file` driver with **no** size
limit unless the daemon sets one; pass `--log-opt max-size=10m --log-opt max-file=5`
(the command in [DEPLOYMENT.md](/reference/deployment/#without-compose) does).

## Monitoring

Four services under the compose profile `monitoring` keep the app's logs, draw a
dashboard from them and alert on them. A deployment made from
.env.example has the profile on (`COMPOSE_PROFILES=monitoring`); the
bare quick start (`docker compose up` with no `.env`) is still the one container.

| Service | Does | Keeps |
|---------|------|-------|
| `loki` | Stores the app's log lines | For `LOG_RETENTION` (default `30d`), then deletes them |
| `alloy` | Reads the app container's log through the Docker API and sends it to Loki; probes `/health` every 30 s | Nothing (a small position file) |
| `prometheus` | Stores the `/health` probe results | For `LOG_RETENTION` |
| `grafana` | The dashboard and the alert rules; sends the notifications | Its own accounts, contact points and alert state (`grafanadata` volume) |

The app doesn't depend on any of them: with the monitoring services stopped, broken or
never started, calls are answered exactly as before. None of them calls out to the
internet (usage reports, update checks and plugin downloads are switched off), and only
Grafana publishes a port, on `127.0.0.1:3000`. At idle the four use about 400 MB of
memory between them, and their images about 2.5 GB of disk; the log store grows with
call volume (`docker system df -v` shows the `lokidata` volume; watch it the first
weeks).

### Turning it on

1. In `.env`: `COMPOSE_PROFILES=monitoring`, `LOG_FORMAT=json` (the dashboard and the
   alerts read JSON lines; text lines are stored but nothing on the dashboard can read
   them) and a generated `GRAFANA_ADMIN_PASSWORD` (`openssl rand -base64 32`). Grafana
   refuses to start without the password rather than come up as `admin`/`admin`; the
   log line says so.
2. `docker compose up -d`.
3. Check it, from the checkout, once a minute or two has passed:

   ```bash
   GRAFANA_PASSWORD='<the password>' python3 scripts/check_monitoring.py --wait 180
   ```

   It confirms the app's lines reach Loki as JSON, the `/health` probe reaches
   Prometheus, both keep data for `LOG_RETENTION`, every alert rule is loaded and
   evaluates without an error, and every dashboard query runs. CI runs the same check
   against every change. Add `--expect-webhook` after a call (or any webhook) to also
   require a per-hook line.

To turn it off, remove the `COMPOSE_PROFILES` line and remove the services and their
data (logs included):

```bash
docker compose --profile monitoring rm --stop --force loki prometheus alloy grafana
docker volume rm "$(basename "$PWD")_lokidata" "$(basename "$PWD")_promdata" \
  "$(basename "$PWD")_alloydata" "$(basename "$PWD")_grafanadata"
```

(The volume names start with the compose project name, the directory's name unless
`COMPOSE_PROJECT_NAME` says otherwise; `docker volume ls` lists them.)

### Opening Grafana

It listens on `127.0.0.1:3000` only. From your own machine, through SSH:

```bash
ssh -L 3000:127.0.0.1:3000 ivr-host      # then open http://127.0.0.1:3000
```

Or give it a hostname on the reverse proxy (Caddy, beside the app's site block):

```caddy
grafana.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

and set `GRAFANA_ROOT_URL=https://grafana.example.com/` and `GRAFANA_COOKIE_SECURE=true`
in `.env` (the root URL is what the links in alert notifications point at). With nginx,
proxy the whole host to `127.0.0.1:3000` with the same websocket upgrade the app's
`/ws/` location has. Grafana is an admin surface over every log line (call sids, the
addresses of sign-in attempts; see [PRIVACY.md](/reference/privacy/)), so a published one wants a
long password, and sign-up and anonymous access stay off (compose sets both).

The dashboard is under **Dashboards → JamHooks**: calls and webhooks, the
outcome flags (shed, unknown flow, node errors, …), latency, answers by status, calls
per flow, where callers go and where they hang up (the Routing row), `/health`, the
active alerts, and the log itself, with errors and warnings, a search box (paste a call
sid to see one call from start to end) and the audit trail of flow changes. It is
provisioned from monitoring/grafana/dashboards/
and read-only in Grafana; save a copy under another name to change it.

### Reading the Routing panels

Both count the routing lines over the dashboard's time range, one row per component;
the **Flow** box at the top narrows them to one flow (its name, or a regular expression
such as `acme/.*`; `.*` is every flow). A component is named by its label, its type and
its place in the flow (`main.menu`, `main.menu.transfer`: the dotted id the Debug pane
and the log lines use too).

- **Where callers go**: every routing decision, with two columns that usually agree.
  **Result** is what happened: the option pressed (only an option the Menu has), `timeout`,
  `invalid`, `default` (an answer that isn't a choice: an account number, recognised
  speech), a transfer's `success` / `failure` / `timeout`, how a caller left a queue
  (`bridged`, `hangup`, `leave`, `error`) or a dequeue went, `transferred` (a blind
  transfer went through), `error` (the speech recognizer failed), a Conditional rule
  (its name under **Rule**) or `else`, a Date & Time's `match` / `else`. **Outlet** is
  where the call went: the result's own branch when it is wired, otherwise the fallback
  the component chose (`default`, `failure`, …) or `next` (no branch for it, so the call
  went on to whatever follows the component). `end` means the result ended the call,
  `error_handler` that the component failed on its answer and the Error handler took the
  call (or hung up, without one). A Menu row with Result `timeout` and Outlet `next` is
  callers who pressed nothing and fell through (worth a timeout branch).
- **Hung up while waiting**: per component that waits for an answer, the calls that
  waited there and never came back: the caller hung up while it waited, or during the
  prompt before it (the prompt and the wait are one response). It is waits minus
  answers, so it is approximate at the edges of the range: a call still waiting at the
  end counts, and an answer to a wait from before the start can hide one. A queue
  reports a caller who gives up waiting itself; that is Result `hangup` under *Where
  callers go*, not a row here. A component moved or deleted by a deploy while calls
  waited at it also counts its waiting calls here, since their answers can't reach it.

There is no alert on either: how many callers hang up at a menu is a question about the
flow, with no operator action behind a threshold.

### Where alerts go

The rules come with the stack; where a firing alert is sent is yours to set, once, in
Grafana: **Alerting → Contact points**. Edit the default one (`grafana-default-email`)
or add a Microsoft Teams, Slack, webhook or other contact point and choose it under
**Alerting → Notification policies** as the default policy's contact point. **Test**
sends a sample. Email needs an SMTP server: set `GRAFANA_SMTP_HOST` (`host:port`),
`GRAFANA_SMTP_USER`, `GRAFANA_SMTP_PASSWORD` and `GRAFANA_SMTP_FROM` in `.env` and run
`docker compose up -d`. Until a contact point is set up, alerts show on the dashboard
and under **Alerting → Alert rules**, and reach no one.

| Alert | Severity | Fires when | What to do |
|-------|----------|------------|------------|
| JamHooks unreachable | critical | `/health` has had no HTTP answer for 2 minutes, or there are no probe results at all | Calls are failing. `docker compose ps`, `docker compose logs app`. If the app is fine, `alloy` or `prometheus` is down and nothing is watching it |
| Webhooks shed | critical | Any webhook in 5 minutes was refused because every slot was busy | Callers heard the busy message. Look at the latency panel (a slow HTTP Request API holds slots) and at `WEBHOOK_MAX_CONCURRENCY` |
| Webhook answers failing | critical | Any webhook in 5 minutes answered 5xx (not counting shed ones) or couldn't be rendered | Jambonz dropped a call or a status event. The error lines name the flow and the cause |
| Webhooks slow | warning | The slowest 5% of webhooks took over 5 s, for 5 minutes | Jambonz waits about 10 s, and at `MAX_HOOK_SECONDS` (8) the call goes to the Error handler. Usually an HTTP Request node's API |
| Webhooks for an unknown flow | warning | 5 or more in 15 minutes for a flow, node or subflow that doesn't exist | Callers heard the unavailable message. A Jambonz application points at a renamed or deleted flow |
| Store can't take a write | warning | `/health` logged that the store can't take a write | Saves fail, calls don't. Free space or remount; don't restart ([Health and logs](#health-and-logs)) |
| Sign-in paused for unrecognised browsers | warning | Failed sign-ins from many addresses paused sign-in for new browsers | Likely distributed password guessing; the warnings list the addresses |
| Started with an unsafe configuration | warning | The app logged a `SECURITY:` or `CONFIG:` error in the last hour | Fix the setting the line names in `.env`, `docker compose up -d` |
| Errors logged | warning | Any other `ERROR` line in 10 minutes | A node failed in a call, a flow is served from its previous compile, a save didn't complete, … The dashboard's error panel has the line |

The rules live in
monitoring/grafana/provisioning/alerting/rules.yaml
and are read-only in Grafana. To change a threshold, copy the directory, edit the copy
and mount it over the stock one in a `docker-compose.override.yml` beside the stock
file, so an upgrade doesn't overwrite your edit:

```yaml
services:
  grafana:
    volumes:
      - ./monitoring-local/alerting:/etc/grafana/provisioning/alerting:ro
```

The monitoring runs on the same host as the app, so it can't tell you the host itself is
down. For that, add an outside uptime check on `https://<your host>/health` (any uptime
service; it is unauthenticated and exempt from the rate limit).

### Retention

`LOG_RETENTION` (default `30d`; any duration such as `90d` or `720h`) is how long Loki
keeps the app's log lines and Prometheus the probe results. Loki's compactor deletes
what has expired every 10 minutes, so a line is gone within a few hours of turning
`LOG_RETENTION` old. A change applies from the next `docker compose up -d`; lengthening
it doesn't bring back what was already deleted. `scripts/check_monitoring.py` reports
what both are actually set to.

Two other places hold log lines, on their own terms:

- **Docker's copy** of the app's output (what `docker compose logs` reads): 5 × 10 MB,
  rotated by **size**, not age, and deleted with the container, which every upgrade and
  every `.env` change recreates. On a quiet instance it can still hold lines older than
  `LOG_RETENTION`. If your retention policy covers it too, send the app's output to
  journald instead (the override above, `driver: journald`) and set
  `MaxRetentionSec=30day` in `/etc/systemd/journald.conf`. Docker reads the journal back
  for `docker compose logs` and for Alloy, so the monitoring is unaffected; note that
  journald's limit applies to the whole host's journal.
- **Grafana** stores no log lines: its database holds its accounts, contact points and
  the history of alert states (rule names, labels and counts).

### Upgrades, backups and the Docker socket

- **Upgrades.** The four images are pinned by version and digest in
  `docker-compose.yml`, and Dependabot proposes the bumps (CI's monitoring job runs each
  one). `git checkout` of a newer release and `docker compose up -d` pulls and starts
  them; their data volumes carry over.
- **Backups.** `scripts/backup.sh` copies the store, not the monitoring volumes: the logs
  expire anyway, and the dashboard and rules come from the repo. What you set up in
  Grafana (contact points, policies, extra users) lives in the `grafanadata` volume;
  note it down, or copy that volume the same way if it would be a chore to redo.
- **The Docker socket.** Alloy reads the app's log through `/var/run/docker.sock`
  (`DOCKER_SOCKET` for rootless Docker), and whoever controls a process holding that
  socket controls Docker on this host, read-only mount or not. Alloy publishes no port
  and runs a pinned image with this repo's configuration, read-only; if that trade is
  still not acceptable, leave the profile off and ship the logs with a forwarding
  logging driver (above).

## Capacity and sizing

How many calls one instance takes depends on the flow and on the host, so measure it
on yours; a number from another machine doesn't transfer. Two things run out:

- **The slots**: `WEBHOOK_MAX_CONCURRENCY` (default 100), how many webhooks run at
  once. A hook holds a slot for as long as it runs: milliseconds for most, but as long as
  an HTTP Request node's API takes to answer. With every slot busy the next hook is
  **shed** at once: a caller hears `CALLER_BUSY_MESSAGE` and is hung up, a status hook
  gets `503`. Each one logs `Shedding webhook: N/N slots busy …` at ERROR, and the
  *Webhooks shed* alert fires on it ([Where alerts go](#where-alerts-go)).
- **The process's CPU.** One instance is one process: one event loop reads every
  request, and the flows run as Python, about one core's worth at a time. Past that,
  hooks wait to be *read* before they ever reach a slot: latency climbs, often with
  nothing shed, and more slots don't help. There is no second instance to add
  ([One instance per store](#one-instance-per-store)), so this is the instance's ceiling.

**Slots needed ≈ hook rate × hook duration.** A flow whose lookup API answers in 0.5 s,
at 10 calls a second, keeps 5 slots busy on average for the lookups alone. Calls arrive
at random, so the slots have to cover the bursts, not the average: shedding is the
classic loss system, and the Erlang B formula says how many slots keep it under a target
(the load test does the sum).

### Running the load test

`scripts/load_test.py` plays Jambonz at an instance: whole calls (the inbound hook,
each continuation the app hands back, the call's status events, and the other leg's for
a transfer) with Jambonz's payloads and signature, arriving at the rate you set whether
or not the instance keeps up (as callers do). Point it at **your own** instance, at a
quiet time or on a staging copy: every call runs the flow for real. From a checkout of
the release you run (`uv sync` once):

```bash
set -a; . ./.env; set +a      # WEBHOOK_SECRET, AUTH_ADMIN_* for the script
uv run python scripts/load_test.py --url http://127.0.0.1:5001 --import \
    --rate 5,10,20,40 --step-seconds 30 --slots 100
```

- `--import` signs in as the admin and imports the bundled flow,
  `scripts/load_test_flow.json`, as `loadtest/ivr` (a
  flow of that name already there is left alone). Or import the file in the editor
  yourself. Delete it when you are done.
- That flow is a greeting, a menu, an account number, an HTTP lookup, a Conditional on
  the answer and a transfer: four caller-facing hooks per call, the lookup in the third.
  Its URL is the `LOADTEST_API_URL` env var, which the script sends on the first hook,
  pointing at its own **built-in upstream**; `--upstream-delay 0.5` makes that a slow API.
  The app must be able to reach it. In Docker, the container's `127.0.0.1` is the
  container itself, so listen on the host and give the flow the host's address on the
  container's network:

  ```bash
  GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' \
       "$(docker compose ps -q app)")
  uv run python scripts/load_test.py … --upstream-bind 0.0.0.0:8099 \
      --upstream-url "http://$GW:8099"
  ```

  (and allow that port from the Docker network in the host's firewall). The probe call
  says so if the lookup never arrived.
- **Your own flow**: `--flow acme/main`, what the caller enters at each gather with
  `--input` (`--input 1,1234 --input 2` alternates two kinds of call), its env values with
  `--env NAME=VALUE`. Every transfer ends `--dial-status completed` unless you say
  otherwise. Its HTTP Request nodes call their real APIs, at the test's rate.
- `--slots` is your `WEBHOOK_MAX_CONCURRENCY`; the report compares against it.
- Run the load generator on another machine if you can. On the same host it takes CPU
  from the app, and the report says when it fell behind.
- `--secret` and `--basic-auth` default to `WEBHOOK_SECRET` and
  `WEBHOOK_BASIC_AUTH_*` from the environment, the sign-in for `--import` to
  `AUTH_ADMIN_*`, hence the `set -a` line, which keeps them out of your shell history
  (a value in `.env` with a space in it needs quotes for the shell to read it).

Before the measured run it places one probe call and stops (exit status `2`) if that
didn't complete, saying why: a refused signature, an unknown flow (the unavailable
message), no answer. Ctrl-C ends a run early and still reports what finished.

### Reading the report

Each step reports the calls placed against the rate offered, how many completed, and
why the others failed; the hooks per second and how many were **open** (sent and not
yet answered, on average and at the peak) against the slots; and a table per hook kind:

| Column | Means |
|--------|-------|
| p50 … max | How long the load generator waited for the answer |
| `shed` | Answered by the load shedding. Every shed answer carries `X-Jamhooks-Shed: 1`, so this counts right whatever `CALLER_BUSY_MESSAGE` says, or if it is empty |
| `>10s` | Answered after Jambonz stops waiting (about 10 s): on a real call, that call failed |
| `non-200` | Any other refusal: `403` is the signature, `401` basic auth |
| `unavail` | The unavailable message: the flow is unknown or doesn't compile |
| `errors` | No answer at all (refused connection, timeout) |

Then **What it suggests**, which reads the steps for three patterns:

- **Shedding began at step N.** The slots ran out. Look at the app's CPU during that step
  (`docker stats`): well short of one core, the slots were waiting (on an API, usually),
  so raise `WEBHOOK_MAX_CONCURRENCY`; the report says to about how many (Erlang B, for
  fewer than 1 hook in 1,000 shed at that rate). Near one core, see the next point.
- **Hooks queued in front of the slots.** Latency rose far above the first step's, or
  more hooks were open than there are slots: the process was out of CPU. Raising
  `WEBHOOK_MAX_CONCURRENCY` won't help; the step before is roughly what the instance
  takes of this flow. A faster core, or less work per hook, raises it.
- **Slow.** Caller-facing p95 over 5 s, or answers after 10 s: whatever the slots, the
  flow's API is too slow. At `MAX_HOOK_SECONDS` (8 s) the call goes to the Error handler.

And a **sizing** line from the busiest step that ran clean: how long one call held a slot
in all (its hooks' durations added up), so how many slots a rate keeps busy on average and
how many cover its bursts. `--size-for 12` adds the same for 12 calls a second, your
busiest hour's rate.

**When to change `WEBHOOK_MAX_CONCURRENCY`.** Raise it when the test sheds with CPU to
spare (flows that wait on slow APIs) to the number the report gives for your busiest
hour. A slot is a worker thread that mostly waits, so a few hundred cost little. Don't
raise it to cure latency that rose with nothing shed: those hooks were waiting for the
CPU, not for a slot. Lowering it buys no capacity; it only makes the instance shed
sooner. In production, the *Webhooks shed* alert and the `Shedding webhook` log line are
the sign that the sizing no longer fits.

For a gate (a pre-release check, say), run one fixed rate: the exit status is `0` when
at most `--max-failed-pct` (default 1%) of the calls failed (and, with `--max-p99-ms`,
the caller-facing p99 stayed under it), `1` when not, and `2` when the test couldn't
run.

## Rotation

Every change to `.env` needs `docker compose up -d`, which recreates the container.
`docker compose restart` keeps the environment the container was created with.

**Webhook signing secret** (`WEBHOOK_SECRET`). Jambonz issues the secret; regenerating
it (the account page in the portal, or
`GET /Accounts/{AccountSid}/WebhookSecret?regenerate=true`) switches Jambonz to the
new one immediately. The app accepts a comma-separated list, so:

1. Regenerate the secret in Jambonz and copy it.
2. Set `WEBHOOK_SECRET=<old>,<new>` in `.env` and `docker compose up -d`.
3. Once the log shows no `Webhook signature mismatch` warnings, set
   `WEBHOOK_SECRET=<new>` and `docker compose up -d` again.

Webhooks that arrive between steps 1 and 2 fail their signature check, so do it in a
quiet window, and keep step 2 short. Keeping `<old>` in the list covers anything still
signed with it.

**Editor passwords** (`AUTH_ADMIN_PASSWORD`, `AUTH_READONLY_PASSWORD`). Generate a new
one (`openssl rand -base64 32`), put it in `.env`, `docker compose up -d`. Every session
signed in with the old password ends on its next request, and the browser's
known-browser cookie stops counting.

**Webhook basic auth** (`WEBHOOK_BASIC_AUTH_PASSWORD`). Only one pair is accepted at a
time: change it in `.env`, `docker compose up -d`, and enter the same value on the
application's two webhooks (calling and call status) in Jambonz straight away. Hooks in
between are refused, except the env-var schema request (`OPTIONS`), which Jambonz sends
without credentials and is exempt.

**Grafana's admin password** (`GRAFANA_ADMIN_PASSWORD`). Grafana reads it only when its
database is first created, so changing `.env` alone changes nothing. Change it in
Grafana (the profile menu → *Change password*), or:

```bash
docker compose exec grafana grafana cli admin reset-admin-password '<new>'
```

then put the same value in `.env`, where `scripts/check_monitoring.py` and the next
fresh start read it.

**Session key** (`store/.sesskey`). After a backup leaked, or to sign everybody out:

```bash
docker compose stop app
docker compose run --rm --no-deps --entrypoint rm app -f /app/data/store/.sesskey
docker compose start app
```

The app writes a new key on start. Every session and every known-browser cookie made
with the old one stops working.
