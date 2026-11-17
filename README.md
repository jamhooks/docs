# JamHooks docs

The documentation website for [JamHooks](https://github.com/jamhooks/jamhooks): manuals,
guides and the reference, built with [Astro Starlight](https://starlight.astro.build).

```bash
npm ci
npm run dev      # http://localhost:4321
npm run build    # into dist/, validating every internal link
```

The pages under `src/content/docs/reference/` are generated from the app repo at the
release named in `jamhooks.version`; edit those in the app repo, not here. Everything else
is written here. [AGENTS.md](AGENTS.md) has the details.
