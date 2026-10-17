# links.glamcleaners.net

The link-in-bio page, served at the root of its own subdomain.

This repository holds no page. It holds a workflow that builds the page from
[sgscrap/glam-team-cleaners](https://github.com/sgscrap/glam-team-cleaners) and publishes the
result as a GitHub Pages site, so there is one copy of the business's details and one place to
change them.

## Why a second repository

GitHub Pages gives each site **one** custom domain, and its documentation lists using both an apex
domain and a custom subdomain as unsupported — the `CNAME` file can name only one host. So
`glamcleaners.net` and `links.glamcleaners.net` cannot be one Pages site; the subdomain is a second
site, and a Pages site lives in a repository.

## What it publishes

`links-site/` in the main repository, committed there and checked by `npm run check`:

| File | What it is |
| --- | --- |
| `index.html` | The link page, built by `src/links.js` from `src/data.js` |
| `CNAME` | `links.glamcleaners.net` — Pages reads the custom domain from this file |
| `favicon.ico`, `assets/favicon.svg`, `apple-touch-icon.png` | The same icons the main site ships |

The page's canonical and `og:url` name the subdomain; everything below the head — the number, the
mailbox, the channels, the hours — is the same source as `/links/` on the main site.

## Changing the page

Edit `src/links.js` or `src/data.js` in the main repository, run `npm run build && npm run check`
there, and merge. This site rebuilds from `main` on a schedule (daily) and on demand:

```sh
gh workflow run pages.yml -R sgscrap/glam-links
```

## DNS

One record, at whoever holds the domain's DNS:

```
links   CNAME   sgscrap.github.io
```

The zone file in the main repository (`dns/glamcleaners.net.zone`) carries it alongside the apex
and `www` records. `npm run domain` in the main repository checks it, and fails when the wildcard
record is still answering for the subdomain instead.

## Pages settings

- Source: **GitHub Actions**
- Custom domain: `links.glamcleaners.net`
- Enforce HTTPS: once GitHub has issued the certificate, which needs the CNAME above to answer
