# Domain runbook — glamcleaners.net

Everything needed to put this domain on Cloudflare, publish both addresses, and get certificates
onto them. Written for whoever does it next, who will not have the conversation that produced it.

Facts marked **observed** were read from DNS or the GitHub API on 2026-10-17 and should be re-read
before acting on them: see [Reading the current state](#reading-the-current-state).

## The shape of it

| What | Where | How it publishes |
| --- | --- | --- |
| `glamcleaners.net` | `sgscrap/glam-team-cleaners` | GitHub Actions → Pages (`build_type: workflow`) |
| `links.glamcleaners.net` | `sgscrap/glam-links` | **a branch** (`main`, root) — nothing is built there |
| The zone | Cloudflare (once moved) | records + one redirect rule, both written by `npm run dns:cloudflare` |

The link page is built once, in this repository, and published twice: at `/links/` on the site, and
copied into `sgscrap/glam-links` by this repository's deploy. Both copies name
`https://glamcleaners.net/links/` as canonical; the subdomain is meant to become a **301 to that
page**, so only one of them is ever indexed.

## Where it is today (observed)

| Fact | Value |
| --- | --- |
| Registrar | DomainRegistry.com LLC |
| Nameservers | `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` |
| Apex A | `66.223.49.89` — a **forward**, not GitHub Pages |
| Wildcard | `*.glamcleaners.net` answers, with the same address |
| `www` | the same forwarding address |
| Mail | `MX 10 mailserver.businessidentity.llc`, SPF `include:spf.postal.businessidentity.llc`, DMARC `p=quarantine` |
| DKIM | **no record at any usual selector** — see [Mail](#mail) |
| Pages, main site | `https_enforced: true`, **no custom domain attached** (`cname: null`) |
| Pages, links site | custom domain `links.glamcleaners.net`, `https_enforced: false` |

Two consequences, both worth knowing before touching anything. The forward rewrites **every path**
to one URL, so `/links/` lands on the homepage and every canonical on the site points at a URL that
immediately redirects away from itself. And the old provider's panel no longer has an address:
`businessidentity.llc`, `hosting.businessidentity.llc` and every `*` name under them answer with no
A record, so the records cannot be edited where they live. That is why the zone moves to Cloudflare.

## Target state

```
A      @      185.199.108.153  185.199.109.153  185.199.110.153  185.199.111.153
AAAA   @      2606:50c0:8000::153  2606:50c0:8001::153  2606:50c0:8002::153  2606:50c0:8003::153
CNAME  www    sgscrap.github.io            DNS only — GitHub must answer to issue the certificate
CNAME  links  sgscrap.github.io            proxied  — the redirect rule only sees proxied traffic
MX     @      10 mailserver.businessidentity.llc
TXT    @      "v=spf1 a mx include:spf.postal.businessidentity.llc ~all"
TXT    _dmarc "v=DMARC1; p=quarantine; rua=…; ruf=…; fo=1"

when (http.host eq "links.glamcleaners.net") then 301 → https://glamcleaners.net/links/  (query kept)
```

`dns/glamcleaners.net.zone` is the same site records as a zone file, generated from the same source
that the check compares against.

## The steps

### 1. Credentials

Add `glamcleaners.net` in the Cloudflare dashboard (free plan; **do not** enable Email Routing — it
replaces the MX). Then create an API token with:

- **Zone → DNS → Edit** — the records
- **Zone → Dynamic Redirect → Edit** — the redirect rule
- **Zone → Zone → Read** — looking the zone up by name

Save the two values outside the repository, at `~/.cloudflare-zone.env`:

```
CF_API_TOKEN=...
CF_ACCOUNT_ID=...
```

The script reads the environment first and that file second, and prints nothing from either.

### 2. Write the zone

```sh
npm run dns:cloudflare              # dry run: the records and the rule, no requests that write
npm run dns:cloudflare -- --apply
```

The dry run is safe at any time. `--apply` writes the records, installs the redirect rule, and then
proxies **only** the `links` record. It is idempotent: re-running adds nothing and changes nothing.
It also removes the old web records at `@`, `www`, `links` and the wildcard, which Cloudflare
imports when the zone is added — a zone holding both the forwarder's address and GitHub's answers
from whichever it likes. Mail is never touched.

It prints the nameserver pair at the end.

### 3. Point the registrar at Cloudflare

At DomainRegistry.com, replace the Business Identity nameservers with the pair the script printed.
This is the cutover: the old zone keeps answering until the registry publishes the change, so there
is no gap, and mail keeps flowing to the same MX throughout.

### 4. Verify

```sh
npm run domain
```

It exits 1 until everything is right, and says what each address is doing. Expected, in order:

- `DNS  glamcleaners.net A → the four GitHub Pages addresses`
- `DNS  www.glamcleaners.net → sgscrap.github.io`
- `DNS  links.glamcleaners.net → sgscrap.github.io`
- `DNS  no wildcard under glamcleaners.net`
- `HTTP https://glamcleaners.net/ serves index.html byte for byte`
- `HTTP https://glamcleaners.net/links/ serves links/index.html byte for byte`
- `alias  links.glamcleaners.net → 301 https://glamcleaners.net/links/`

The last line is the redirect working. If it instead says the alias *serves the page*, the rule is
not installed or the record is still DNS-only — re-run step 2.

### 5. Certificates

- **`links.glamcleaners.net`** — Cloudflare's Universal SSL covers first-level subdomains, and it is
  presented as soon as the record is proxied. Nothing to do.
- **`glamcleaners.net` and `www`** — GitHub issues these, and only once DNS answers, so this comes
  after step 4:

```sh
# 1. attach the domain — this starts a DNS check, and a certificate request once it passes
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=glamcleaners.net

# 2. enforce HTTPS — only after the certificate exists (Settings → Pages shows a check mark)
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f https_enforced=true
```

Attaching the custom domain makes the default Pages address (`sgscrap.github.io/glam-team-cleaners/`)
redirect to it, which is why it waits until the domain actually answers. The first call starts
certificate issuance; expect a few minutes to an hour, and the check mark beside the domain in
Settings → Pages is the confirmation. Do not set `https_enforced` before that check appears: the
same setting is unavailable in the dashboard until GitHub has the certificate, and the API reports
nothing useful if you ask early. The sequence is GitHub's own — DNS check, then certificate, then
enforcement. (`gh api … /pages` does not return the certificate object, so `Settings → Pages` is the
place to read its state.)

### 6. Afterwards

`https://glamcleaners.net/` and `https://links.glamcleaners.net/` should both serve, the second via
one redirect. Then, optionally, retire `sgscrap/glam-links`: with the redirect live, nothing reaches
its Pages site through any URL, because the default address redirects to the custom domain, which
301s onward. Its custom domain should be removed first if it is kept.

## Publishing

`main` on `sgscrap/glam-team-cleaners` deploys the site and then copies the built link page into
`sgscrap/glam-links`, so the subdomain follows the site within a minute. A deploy whose page did not
change writes no commit.

The `links` job pushes with a **deploy key** — the workflow's own token cannot write to another
repository. The key is registered on `glam-links` (title `Publish from glam-team-cleaners`, write
access) and its private half is the `LINKS_DEPLOY_KEY` secret here. Secrets cannot be read back, so
if it is lost, replace both halves:

```sh
ssh-keygen -t ed25519 -N '' -C 'publish links.glamcleaners.net' -f links_key
gh api -X POST repos/sgscrap/glam-links/keys \
  -f title="Publish from glam-team-cleaners" -f "key=$(cat links_key.pub)" -F read_only=false
gh secret set LINKS_DEPLOY_KEY -R sgscrap/glam-team-cleaners < links_key
rm links_key links_key.pub            # the private half now lives only in the secret
gh api repos/sgscrap/glam-links/keys  # list; delete the old one by id
```

Publish by hand with `npm run links:publish ../glam-links` against a checkout of that repository.

## Reading the current state

```sh
npm run domain                     # DNS, both pages, the alias, and what is missing
node -e "import('node:dns/promises').then(d => d.resolve4('glamcleaners.net')).then(console.log)"
gh api repos/sgscrap/glam-team-cleaners/pages
gh api repos/sgscrap/glam-links/pages
gh api repos/sgscrap/glam-links/keys
gh secret list -R sgscrap/glam-team-cleaners
```

## Mail

Mail is the part of this migration with no visible symptom when it goes wrong, so:

- MX, SPF and DMARC are carried over **read from the live zone** at the moment `--apply` runs, not
  transcribed from a note.
- **No DKIM record is published at any usual selector.** If the mailbox signs outbound mail with its
  own key under an unusual selector, that TXT must be recreated in Cloudflare before the nameserver
  switch, or receivers will start treating the mail differently. Whoever has the mailbox's control
  panel is the only source for it.
- DMARC is `p=quarantine`. SPF alone aligns, so this is not a stop-the-move risk — but it is the
  reason to check a test message after the switch.

## Rollback

Nothing here is one-way except the nameserver change, and even that is reversible:

- **Mail or the site breaks after step 3**: point the registrar back at
  `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC`. The old zone is untouched and still answers; the domain
  returns to the forward within the TTL.
- **The redirect misfires**: delete the rule in Cloudflare's dashboard (Rules → Redirect Rules), or
  remove the `links` record's proxy. The subdomain then serves the second Pages site again, exactly
  as it does today.
- **A deploy was published wrongly**: `git revert` the commit and merge; the deploy republishes from
  `main`. The subdomain follows within a minute.

`dns/glamcleaners.net.zone` and `scripts/dns-cloudflare.js` are the description of the target state;
if they disagree with Cloudflare, one of them is wrong and `npm run check` will not tell you which —
compare with `gh api` or the dashboard.
