// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// https://astro.build/config
export default defineConfig({
	// The docs domain (same as CNAME): Starlight writes a sitemap and canonical URLs from
	// it. The site is built for a domain of its own, served from the root; there is no
	// `base` path, so links are written as `/guides/...`.
	site: 'https://docs.jamhooks.com',
	integrations: [
		starlight({
			title: 'JamHooks',
			description: 'Visual IVR call flows for Jambonz: build, test and run them.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jamhooks' }],
			// Hand-written pages are edited here. The synced reference pages set their own
			// `editUrl` (scripts/sync-reference.mjs), since their source is the app repo.
			editLink: { baseUrl: 'https://github.com/jamhooks/docs/edit/master/' },
			// Fails the build on a broken internal link or #anchor. That is also what catches
			// an app release that renamed a heading the manuals link to.
			plugins: [starlightLinksValidator()],
			sidebar: [
				{
					label: 'Getting started',
					items: [{ autogenerate: { directory: 'getting-started' } }],
				},
				{
					label: 'Reference',
					items: [{ autogenerate: { directory: 'reference' } }],
				},
			],
		}),
	],
});
