# AGENTS.md

Working guide for AI coding agents (and humans) in the JamHooks docs site.

## What this is

The documentation website for [JamHooks](https://github.com/jamhooks/jamhooks), a visual call flow
designer for Jambonz. Built with Astro + Starlight; deployed to GitHub Pages from
`master` (`.github/workflows/deploy.yml`).

## Commands

```bash
npm ci                 # install from package-lock.json
npm run dev            # http://localhost:4321
npm run build          # build into dist/; also fails on any broken internal link or #anchor
```

When starting the dev server from an agent, use `astro dev --background` and manage it
with `astro dev stop`, `astro dev status` and `astro dev logs`.

## Where content lives

| Path | What | Who edits it |
|---|---|---|
| `src/content/docs/getting-started/` | Tutorials: install, connect Jambonz, first flow | Here |
| `src/content/docs/guides/` | How-to manuals for one task each (add the sidebar group with the first page) | Here |
| `src/content/docs/concepts/` | Explanations: the component tree, how a call runs | Here |
| `src/content/docs/reference/` | Reference: flows, runtime, configuration, deployment, operations, hardening, privacy, API, changelog | Here |

All user and operator documentation lives in this repo, the reference included. The app
repo (`jamhooks/jamhooks`) keeps only what an agent or developer needs to change the app
(`AGENTS.md`, `agent-docs/`) and its own `CHANGELOG.md`.

The docs describe the **latest released** version of the app. A change for an unreleased
app version waits on a branch until that release is tagged; then, in one PR:

- bump the release in `reference/deployment.md` (the tag to check out, the image name,
  `APP_VERSION`);
- copy the release's section of the app's `CHANGELOG.md` into `reference/changelog.md`;
- merge the held-back doc changes for that release.

Nothing checks the reference against the app any more, so when you document a setting,
an endpoint, an alert title or a log field, take the name from the app's code at the
release tag (`app/config.py`, `.env.example`, `monitoring/grafana/provisioning/alerting/rules.yaml`).

## Writing rules

- Link to pages with absolute paths and a trailing slash: `/reference/flows/`,
  `/reference/deployment/#deploying-for-real`. The build validates them, including the
  anchor; relative links (`../foo/`) fail the build.
- Every page needs a `title` in its frontmatter (Starlight renders it as the `#` heading,
  so the body starts at `##`), and a `description`. Order pages with `sidebar.order`.
- Use Starlight asides (`:::note`, `:::tip`, `:::caution`, `:::danger`), not GitHub's
  `> [!NOTE]`.
- Name UI controls in bold exactly as the editor shows them: **Deploy**, **Simulate**,
  **Load Example**.
- Never write the em-dash character; rewrite the sentence instead.
- Never put real personal data in examples (phone numbers, names, recordings). Use
  placeholders and the `example.com` domain.

## Pins

Every workflow action is pinned to a full commit SHA with the release in a comment, and
the runner is pinned (`ubuntu-24.04`); Dependabot proposes the bumps. Never replace a pin
with a tag. Node's version is in `.node-version`.

Full Astro docs: https://docs.astro.build. Starlight: https://starlight.astro.build.
