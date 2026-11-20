---
title: "Configuration"
sidebar:
  order: 3
---

All configuration is environment variables, read by app/config.py
(and from a `.env` file, when there is one). .env.example lists every
setting with a comment and is the place to start a deployment's `.env` from (see
[DEPLOYMENT.md](/reference/deployment/)).

Bad configuration is reported, never refused: the app always starts. A numeric setting
below what it accepts (negative, or `0` where `0` is not listed as "disables") is
replaced by its default with a warning, so a typo never switches a guard off. An unsafe
combination is logged at `ERROR` on every start, with a `SECURITY:` or `CONFIG:` prefix.

| Variable | Default | Description |
|----------|---------|-------------|
| `STORE_DIR` | `./data/store` | Root directory for the JSON file store (flows, compiled flows, versions) |
| `VERSION_HISTORY_ENABLED` | `true` | Snapshot the previous state on every save (restorable); `false` disables history |
| `HISTORY_MAX_VERSIONS` | `100` | Max snapshots kept per flow (oldest pruned); ignored when history off. At least `1`; to keep none, set `VERSION_HISTORY_ENABLED=false` |
| `APP_HOST` | `0.0.0.0` | Bind host |
| `ALLOWED_HOSTS` | _(unset)_ | Host names the editor and API answer to, comma-separated (the Host check ignores ports); `*` = any. Unset: any host behind a login (or `TRUSTED_USER_HEADER`), but an **open** editor only answers to `localhost` / `127.0.0.1` / `[::1]` and the `BASE_WEBHOOK_URL` host; others get `400` (the DNS-rebinding guard). Webhooks and `/health` are exempt. Listed names also count as this app's own origin for the cross-site checks (a proxy that rewrites `Host`), and there the port counts: `ivr.example.com` is the page on the standard port (`https://ivr.example.com`), `ivr.example.com:8443` the page on 8443 |
| `APP_PORT` | `5001` | Bind port |
| `BASE_WEBHOOK_URL` | `http://127.0.0.1:5001` | Public URL for Jambonz actionHook callbacks (the 127.0.0.1 default works only when Jambonz runs on the same host). Left at loopback while `APP_HOST` listens on the network, every start logs a `CONFIG:` error: calls would die at their first menu |
| `DEBUG` | `false` | Dev conveniences: auto-reload + live browser refresh (set `true` for local dev) |
| `LOG_FORMAT` | `text` | `text` (human-readable) or `json` (structured, for aggregation); anything else warns and uses `text` |
| `LOG_LEVEL` | `INFO` | Root log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`); a typo warns and uses `INFO` |
| `WEBHOOK_SECRET` | _(unset)_ | The account's webhook signing secret (from the Jambonz portal); when set, every webhook's `Jambonz-Signature` is verified. Comma-separate multiple secrets (multi-account / rotation) |
| `WEBHOOK_BASIC_AUTH_USER` / `WEBHOOK_BASIC_AUTH_PASSWORD` | _(unset)_ | Require basic auth on **webhook** routes only (both required): the same credentials configured on the application's webhooks in Jambonz. Not on the `OPTIONS` env-var schema request: Jambonz sends that one without credentials, so the schema (names, types, descriptions, non-obscure defaults) is public |
| `AUTH_ADMIN_USER` / `AUTH_ADMIN_PASSWORD` | _(unset)_ | Editor login with full access (both required; setting them is what enables UI/API auth) |
| `AUTH_READONLY_USER` / `AUTH_READONLY_PASSWORD` | _(unset)_ | Optional second account that may view everything but change nothing (both required) |
| `SESSION_IDLE_TIMEOUT` | `3600` | Seconds a sign-in survives without a request. Working in the editor keeps it alive; an attached Debug feed closes when it ends. Must be positive |
| `SESSION_MAX_LIFETIME` | `43200` | The most a sign-in can last, in seconds (12 h), however busy. Counted from sign-in, never extended. `0` disables. Signing out also revokes the session server-side, so an earlier copy of the cookie stops working; that list is per process and forgotten on restart, where this and the idle timeout bound what is left |
| `SESSION_COOKIE_SECURE` | _(follows `BASE_WEBHOOK_URL`)_ | Mark the sign-in cookie `Secure` (HTTPS only). Unset: on when `BASE_WEBHOOK_URL` is `https://`. Set `false` if the editor is reached over plain http while Jambonz uses an https URL |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_SECONDS` | `5` / `900` | Failed sign-ins one client address may make within the lockout window before it is refused for that long (`429`). Per address, not per account; `0` attempts disables |
| `LOGIN_GLOBAL_MAX_ATTEMPTS` | `20` | Failed sign-ins from **all** browsers that have never signed in here, together, within the lockout window: what guessing spread over many addresses runs into. Reaching it pauses sign-in for those browsers only; one that has signed in before keeps working. `0` disables |
| `TRUSTED_USER_HEADER` | _(unset)_ | Delegate auth to a gateway: trust this identity header (e.g. `X-Forwarded-User`) on UI/API. Takes precedence over the login accounts |
| `TRUSTED_USER_HEADER_SECRET` | _(unset)_ | Have the gateway also send `X-Trusted-Proxy-Secret: <this value>`; the identity header is then honoured only alongside it (constant-time compare), and the secret is stripped before the app or a flow sees it. Unset, anyone who can reach the port can claim any identity; startup warns |
| `HTTP_REQUEST_TIMEOUT` | `10.0` | Total deadline (s) for one `http_request` node call: DNS, connect, TLS and the whole body together, so an upstream that trickles bytes can't hold a call past it. Never later than the end of the hook's `MAX_HOOK_SECONDS` budget |
| `HTTP_REQUEST_MAX_BYTES` | `1048576` | Max response body the `http_request` node will read; over it the node fails with `{{http_error}}`. `0` = unlimited |
| `HTTP_REQUEST_ALLOW_PRIVATE` | `true` | Allow `http_request` to reach private/loopback IPs. Set `false` to turn the SSRF guard on (blocks every address that is not globally routable: private, loopback, link-local, reserved, shared 100.64.0.0/10, incl. cloud metadata) |
| `COMPILED_CACHE_TTL` | `30.0` | Per-process TTL (s) for the webhook path's caches (the compiled flow and the name→id lookup); `0` disables |
| `MAX_REQUEST_BYTES` | `1048576` | Max request body size; larger requests get `413`. `0` disables |
| `MAX_CALL_STATE_BYTES` | `65536` | Max size (bytes of JSON) of the variables a call carries between hooks. Jambonz echoes them back on every hook, so state near `MAX_REQUEST_BYTES` would make the next hook a `413` and drop the call; over this cap the flow's Error handler runs instead, and the largest variables are logged by name and size. `0` disables |
| `MAX_HOOK_SECONDS` | `8.0` | Wall-clock budget for one webhook, Error handler (and the call-status hook's Disconnect handler) included, under Jambonz's ~10 s wait for an answer. HTTP requests are clamped to what is left of it; over it the hook routes to the flow's Error handler, which runs on the remainder. `0` disables (and lifts the clamp). Above ~9 it buys nothing |
| `WEBHOOK_MAX_CONCURRENCY` | `100` | Webhooks executing at once (each holds a worker thread). Beyond it a hook is shed immediately rather than queued. A slot mostly waits on an HTTP Request's API; size it with `scripts/load_test.py` ([OPERATIONS.md](/reference/operations/#capacity-and-sizing)) |
| `CALLER_UNAVAILABLE_MESSAGE` | `Sorry, this service is unavailable. Please try again later.` | Spoken (then a hangup) when the app can't serve a call: an unknown flow, one that won't load, a missing subflow. The log names the reason; the caller never hears it. Empty = hang up without a word |
| `CALLER_BUSY_MESSAGE` | `Sorry, the system is busy. Please try again shortly.` | Spoken (then a hangup) when a caller-facing hook is shed under load. Empty = hang up without a word |
| `CALL_TRACE_ENABLED` | `true` | Whether the editor's **Debug** pane may attach to live calls. Not the on switch: tracing runs only while a pane is attached (its Start button), and nothing is ever stored; `false` refuses every trace socket |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per-IP req/min on UI+API (webhooks + `/health` exempt); `0` disables |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Read by uvicorn: which proxy addresses (or CIDR ranges) may set `X-Forwarded-For` / `X-Forwarded-Proto`. Set to the proxy's address behind a reverse proxy, or every caller shares one rate-limit bucket and one failed sign-in count. Avoid `*`: it believes the left-most `X-Forwarded-For` entry, which a client writes itself unless the proxy overwrites the header (see [OPERATIONS.md](/reference/operations/#which-address-to-trust)) |
| `UVICORN_WORKERS` | `1` | Worker processes (container entrypoint only) |

The monitoring stack and the container have settings of their own: `COMPOSE_PROFILES`,
`LOG_RETENTION`, `GRAFANA_ADMIN_PASSWORD`, `APP_PUBLISH` and others. They are in
.env.example, and explained where they are used:
[DEPLOYMENT.md](/reference/deployment/) and [OPERATIONS.md](/reference/operations/#monitoring).
