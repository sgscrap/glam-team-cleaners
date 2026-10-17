# links.glamcleaners.net

The link-in-bio page, served at the root of its own subdomain.

Nothing here is written by hand. Every deploy of
[sgscrap/glam-team-cleaners](https://github.com/sgscrap/glam-team-cleaners) copies the page it
builds into this repository, so the subdomain follows the site within a minute — there is no
schedule and no second copy of the business's details to fall out of date.

## Why a second repository

GitHub Pages gives each site **one** custom domain, and its documentation lists using both an apex
domain and a custom subdomain as unsupported — the `CNAME` file can name only one host. So
`glamcleaners.net` and `links.glamcleaners.net` cannot be one Pages site; the subdomain is a second
site, and a Pages site lives in a repository.

## What is here

| File | What it is |
| --- | --- |
| `index.html` | The link page, built by `src/links.js` in the main repository |
| `CNAME` | `links.glamcleaners.net` — Pages reads the custom domain from this file |
| `favicon.ico`, `assets/favicon.svg`, `apple-touch-icon.png` | The same icons the main site ships |

## Two addresses, one page

The link page is served at this subdomain **and** at `https://glamcleaners.net/links/`. Only the
second one is indexed: both copies carry
`<link rel="canonical" href="https://glamcleaners.net/links/">`, because that is where the main
site's own links, sitemap and structured data point, so authority stays on the one host a search
engine has a property for.

That makes this subdomain an alias — short enough to put in a bio, and not a second page for a
crawler to index. `npm run check` in the main repository fails if the two copies ever name different
canonicals. Once the domain's DNS is on Cloudflare, a redirect rule from this host to `/links/`
would consolidate further still; until then the alias serves the page directly, with no hop.

Everything below the head — the number, the mailbox, the channels, the hours — is the same source
as `/links/` on the main site.

## Pages settings

- Source: **Deploy from a branch** → `main` → `/ (root)`
- Custom domain: `links.glamcleaners.net`
- Enforce HTTPS: once GitHub has issued the certificate, which needs the CNAME below to answer

## DNS

One record, at whoever holds the domain's DNS:

```
links   CNAME   sgscrap.github.io
```

The zone file in the main repository (`dns/glamcleaners.net.zone`) carries it alongside the apex
and `www` records. `npm run domain` in the main repository checks it, and fails when a wildcard is
answering for the subdomain instead.

## Changing the page

Edit `src/links.js` or `src/data.js` in the main repository, run `npm run build && npm run check`
there, and merge. The deploy workflow publishes the result here; `npm run links:publish <checkout>`
does the same copy by hand.
