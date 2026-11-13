# AGENTS.md

Working guide for AI coding agents (and humans) in the Jamhooks docs site.

## What this is

The documentation website for [Jamhooks](https://github.com/jamhooks/jamhooks), a visual
IVR flow manager for Jambonz. Built with Astro + Starlight; deployed to GitHub Pages from
`master` (`.github/workflows/deploy.yml`).

## Commands

```bash
npm ci                 # install from package-lock.json
npm run dev            # http://localhost:4321
npm run build          # build into dist/; also fails on any broken internal link or #anchor
npm run sync           # re-sync the reference pages from ../jamhooks at jamhooks.version
npm run sync -- --latest            # ...from the newest release tag instead
npm run sync -- --version v1.6.0    # ...from a given tag
```

When starting the dev server from an agent, use `astro dev --background` and manage it
with `astro dev stop`, `astro dev status` and `astro dev logs`.

## Where content lives

| Path | What | Who edits it |
|---|---|---|
| `src/content/docs/getting-started/` | Tutorials: install, connect Jambonz, first flow | Here |
| `src/content/docs/guides/` | How-to manuals for one task each (add the sidebar group with the first page) | Here |
| `src/content/docs/concepts/` | Explanations: the component tree, how a call runs | Here |
| `src/content/docs/reference/` | **Generated.** The app's `docs/*.md` and `CHANGELOG.md` at one release tag | **Never here** |
| `jamhooks.version` | The app release the reference pages come from | `npm run sync` |

The reference pages are owned by the app repo: its tests read them and they change in the
same commit as the code. `scripts/sync-reference.mjs` copies them at a release tag, and
the `Sync reference` workflow opens a PR when a new release appears. To fix a reference
page, change the file in the app repo; it arrives here with the next release.

The rule for what goes where: if a test in the app repo could check it (a setting, an
endpoint, an alert), it is reference and lives in the app repo. Everything that teaches
lives here.

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
