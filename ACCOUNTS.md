# Accounts this domain depends on

<!-- generated from src/accounts.js — do not edit; npm run build rewrites this file -->

Several companies stand between this domain and a working site, and the runbook assumes the operator
already knows which login belongs to which step. This is that map: 5 accounts, what
each one is for, where to sign in, and which step of [DOMAIN.md](DOMAIN.md) needs it.

Facts here were read on 2026-10-17 — the zone from DNS, the Pages settings from the
GitHub API, and the rest from the two providers' own pages. The registrar's row is the exception: it
comes from [RDAP](https://rdap.verisign.com/net/v1/domain/glamcleaners.net), read on 2026-10-17,
where `npm run registrar` re-reads it and fails when it has changed, and
`npm run registrar:adopt` records a renewal into the facts both documents render from.

| Account | Sign in | Needed by |
| --- | --- | --- |
| DomainRegistry.com LLC | <https://www.domainregistry.com/login/> | step 3 — [Point the registrar at Cloudflare](DOMAIN.md#point-the-registrar-at-cloudflare), [Rollback](DOMAIN.md#rollback) |
| Northwest Registered Agent | <https://www.northwestregisteredagent.com/> | _nothing in the runbook_ (it is not a place this move touches) |
| Cloudflare | <https://dash.cloudflare.com/> | step 2 — [Write the zone](DOMAIN.md#write-the-zone) |
| Business Identity | _none — the panel has no address_ | step 2 — [Write the zone](DOMAIN.md#write-the-zone), step 3 — [Point the registrar at Cloudflare](DOMAIN.md#point-the-registrar-at-cloudflare) |
| GitHub — sgscrap | <https://github.com/sgscrap> | step 4 — [Verify](DOMAIN.md#verify), step 5 — [Certificates](DOMAIN.md#certificates), [Publishing](DOMAIN.md#publishing) |

Two of these are traps worth reading twice. **Northwest Registered Agent** is where the domain *started*:
the LLC came first, the domain came with it, and its lookup page is not a place anything about the
domain is changed. **Business Identity** has no working address at all any more, so the mail
records could only be read from DNS — which is exactly why the apply run takes its mail baseline
itself, and compares the zone against it before it prints anything about moving the nameservers.

None of these can be signed into by anything here, but one can be read: the registry answers
without a login, which is what `npm run registrar` uses to check the registrar, the status, the
dates and the delegated nameservers against what this page records. Everything else needs the login
above — and the commands that come closest are in
[Reading the current state](DOMAIN.md#reading-the-current-state).

## DomainRegistry.com LLC

**Registrar of record (IANA ID 128).**

- **Sign in:** <https://www.domainregistry.com/login/> — the client portal — the domain is in the account Northwest Registered Agent set up with the LLC
- **Needed by:** step 3 — [Point the registrar at Cloudflare](DOMAIN.md#point-the-registrar-at-cloudflare), [Rollback](DOMAIN.md#rollback)
- **What it is for:** Holds the domain's nameservers, which makes step 3 the one form in this migration that is not a script: replace the two Business Identity nameservers with Cloudflare's pair and the zone changes hands.
- **What is needed from it:** No token and no key — the login is the whole requirement. The registry says status `active`, DNSSEC not signed, registered 2026-09-17, expiring 2027-09-17: `npm run registrar` reads all of that back from the registry and fails when it has moved on from what this page records. The expiry is not only compared but watched: `npm run registrar:check` runs daily in CI and fails 60 days before it, opening an issue on this repository — so the login is needed long before the date is, not on it. When it is renewed, `npm run registrar:adopt -- --apply` records the registry's answer into those same facts.

## Northwest Registered Agent

**Where the LLC was formed, and where the domain came with it.**

- **Sign in:** <https://www.northwestregisteredagent.com/> — the account the LLC lives in
- **Needed by:** _nothing in the runbook_ (it is not a place this move touches)
- **What it is for:** The domain arrived through this account: it is the "free matching domain" on their [LLC lookup](https://www.northwestregisteredagent.com/llc-lookup) offer, which is why the registrar of record is DomainRegistry.com LLC rather than Northwest.
- **What is needed from it:** Nothing this migration needs. It is listed because it is the account someone will look in first — the LLC lookup page is where the domain started, not where its nameservers are changed, and Northwest's own login is not the registrar's portal.

## Cloudflare

**The DNS host, once the zone has moved.**

- **Sign in:** <https://dash.cloudflare.com/> — the zone, its records and the redirect rule
- **Needed by:** step 2 — [Write the zone](DOMAIN.md#write-the-zone)
- **What it is for:** Owns the zone after step 2: the site and mail records, the 301 rule that turns `links.` into one address for the link page, and the proxy state that lets that rule see traffic at all.
- **What is needed from it:** An API token, not a password: `CF_API_TOKEN` and `CF_ACCOUNT_ID`, kept outside the repository in `~/.cloudflare-zone.env`. The token must carry, and only need: Zone → DNS → Edit (the records), Zone → Dynamic Redirect → Edit (the redirect rule), Zone → Zone → Read (looking the zone up by name).

## Business Identity

**The zone that answers today, and the mailbox behind it.**

- **Sign in:** _no address answers_ — no address answers: `businessidentity.llc`, `hosting.businessidentity.llc` and every `*` name under them resolve to nothing
- **Needed by:** step 2 — [Write the zone](DOMAIN.md#write-the-zone), step 3 — [Point the registrar at Cloudflare](DOMAIN.md#point-the-registrar-at-cloudflare)
- **What it is for:** The old DNS host and the mail platform in one: `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` answer for the zone, and `MX 10 mailserver.businessidentity.llc` is where the mailbox is.
- **What is needed from it:** Nothing can be fetched from it, which is why the mail records were read out of DNS rather than from a panel: the MX, SPF and DMARC steps 2 and 3 carry, and the baseline the apply run takes while this zone is still authoritative. A DKIM key would have to come from here too — none is published, so there is nothing to lose, and nothing that can verify a signature under this domain.

## GitHub — sgscrap

**The repository, the publish workflow, and Pages.**

- **Sign in:** <https://github.com/sgscrap> — admin on `sgscrap/glam-team-cleaners`
- **Needed by:** step 4 — [Verify](DOMAIN.md#verify), step 5 — [Certificates](DOMAIN.md#certificates), [Publishing](DOMAIN.md#publishing)
- **What it is for:** Actions builds and publishes the site; Pages serves it, and once the custom domain is attached it is also where the certificate is issued and HTTPS is enforced.
- **What is needed from it:** Repository admin and nothing else: attaching the domain is one API call (`gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=...`) and the setting after it is a checkbox in Settings → Pages. No repository secret is involved — the deploy authenticates with OIDC (`id-token: write`) and publishes with the `pages` permission, so there is nothing here to rotate.
