# Domain runbook — glamcleaners.net

Everything needed to put this domain on Cloudflare, publish the site, point its short address at
the link page, and get certificates onto them. Written for whoever does it next, who will not have the conversation that produced it.

Facts marked **observed** were read from DNS or the GitHub API on 2026-10-17 and should be re-read
before acting on them: see [Reading the current state](#reading-the-current-state).

Every account this depends on — the registrar, the old DNS and mail host, Cloudflare, GitHub and the
LLC account the domain came through — with where to sign in and which step needs it, is in
[ACCOUNTS.md](ACCOUNTS.md). Read that before step 1: this document names the steps, not the logins.

To run the move in one sitting, [CUTOVER.md](CUTOVER.md) is the checklist: the order the steps have
to happen in, who can do each one, what each leaves behind as proof, and the window between the
nameserver change and GitHub's certificate. This document stays the reference for the values and the
detail.

## The shape of it

| What | Where | How it publishes |
| --- | --- | --- |
| `glamcleaners.net` | `sgscrap/glam-team-cleaners` | GitHub Actions → Pages (`build_type: workflow`) |
| `links.glamcleaners.net` | the zone | one redirect rule — **301 to the link page** |
| The zone | Cloudflare (once moved) | records + one redirect rule, both written by `npm run dns:cloudflare` |

The link page exists once, at `/links/` on the site. `links.glamcleaners.net` is a short address for
it and nothing more: the rule answers every request there with a **301 to that page**, so a bio can
carry the short form while search engines only ever see one address. The second Pages site that used
to serve a copy of the page, `sgscrap/glam-links`, is retired — this repository no longer builds or
publishes it, and [Retiring the second site](#retiring-the-second-site) has the steps that remain.

## Where it is today (observed)

| Fact | Value |
| --- | --- |
| Registrar | DomainRegistry.com LLC (IANA ID 128) — bought with the LLC through **Northwest Registered Agent**; signed into at <https://www.domainregistry.com/login/> |
| Registered | 2026-09-17, expires 2027-09-17 (RDAP) |
| Nameservers | `NS1.HOSTING.BUSINESSIDENTITY.LLC`, `NS2.HOSTING.BUSINESSIDENTITY.LLC` |
| Apex A | `66.223.49.89` — a **forward**, not GitHub Pages |
| Wildcard | `*.glamcleaners.net` answers, with the same address |
| `www` | the same forwarding address |
| Mail | `MX 10 mailserver.businessidentity.llc`, SPF `include:spf.postal.businessidentity.llc`, DMARC `p=quarantine` |
| DKIM | **nothing published** — 153 selector names answer no TXT; see [Mail](#mail) |
| Pages, main site | `https_enforced: true`, **no custom domain attached** (`cname: null`) |
| Pages, links site | custom domain `links.glamcleaners.net`, `https_enforced: false` |

The registrar is worth a sentence of its own, because it is not the name anyone remembers buying
from. The domain came with the LLC, through Northwest Registered Agent — it is the "free matching
domain" on their [LLC lookup](https://www.northwestregisteredagent.com/llc-lookup) offer — and
Northwest's affiliated registrar is **DomainRegistry.com LLC**, which is what the registry reports
and where the nameservers are set. So the LLC lookup page is where this started, not where it is
finished: the nameservers are changed in the registrar's client portal,
<https://www.domainregistry.com/login/>, under the domain itself. Northwest's own site login is not
that place.

Two consequences, both worth knowing before touching anything. The forward rewrites **every path**
to one URL, so `/links/` lands on the homepage and every canonical on the site points at a URL that
immediately redirects away from itself. And the old provider's panel no longer has an address:
`businessidentity.llc`, `hosting.businessidentity.llc` and every `*` name under them answer with no
A record, so the records cannot be edited where they live. That is why the zone moves to Cloudflare.

## Target state

<!-- target state: generated from src/dns.js and src/cloudflare.js — do not edit -->
```
A      @      185.199.108.153  185.199.109.153  185.199.110.153  185.199.111.153
AAAA   @      2606:50c0:8000::153  2606:50c0:8001::153  2606:50c0:8002::153  2606:50c0:8003::153
CNAME  www    sgscrap.github.io         DNS only — GitHub must answer to issue the certificate
CNAME  links  sgscrap.github.io         proxied  — the redirect rule only sees proxied traffic
MX     @      10 mailserver.businessidentity.llc
TXT    @      "v=spf1 a mx include:spf.postal.businessidentity.llc ~all"
TXT    _dmarc "v=DMARC1; p=quarantine; rua=mailto:bounce@dmarc.businessidentity.llc; ruf=mailto:bounce@dmarc.businessidentity.llc; fo=1"

when (http.host eq "links.glamcleaners.net") then 301 → https://glamcleaners.net/links/  (query kept)
```
<!-- end target state -->

The block above is generated from `src/dns.js` and `src/cloudflare.js` — the same values that
render `dns/glamcleaners.net.zone` and that `npm run dns:cloudflare` writes — so the table cannot
say something the move will not do. Edit the code, not the table: `npm run build` rewrites it and
`npm run check` fails while it is stale.

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
It also removes the old web records at `@`, `www`, `links` and the wildcard `*`, which Cloudflare
imports when the zone is added — a zone holding both the forwarder's address and GitHub's answers
from whichever it likes. Only A, AAAA and CNAME records at those names go. Mail is never touched.

It prints the nameserver pair at the end. It also copies any DKIM key it finds, at
`<selector>._domainkey` — see [Mail](#mail). To answer that question on its own, without a token,
`npm run dkim` reads the live zone and writes nothing.

### 3. Point the registrar at Cloudflare

The apply run takes the mail baseline itself, before it writes the first record: what the domain
answers for MX, SPF, DMARC and each DKIM key while the old zone is still authoritative. It saves
that to `mail-baseline.json` (or the file `--baseline` names) and, at the end of the run, reads the
records back from Cloudflare and compares them with it. A zone that lost or reworded a mail record
fails the run — after the records are written, before it prints the nameserver pair. Keep the file:
it is the only reading that can prove the new zone answers identically.

Then the cutover, which is one field in one form: sign in at
<https://www.domainregistry.com/login/> — the domain is in the account Northwest Registered Agent
set up with the LLC — open `glamcleaners.net`, and replace its two
`NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` nameservers with the pair the script printed. The old zone
keeps answering until the registry publishes the change, so there is no gap and mail keeps flowing
to the same MX throughout — but once it is published the old zone is gone, which is why step 2's
comparison has to have passed first.

Once the zone is active, prove the mailbox came with it against that same baseline:

```sh
npm run mail:records -- --compare mail-baseline.json
```

It exits 1 on any difference in MX, SPF, DMARC or a DKIM key and prints both values; a DKIM
selector that appears after the snapshot is reported as a note rather than a failure, because
rotation is normal. Neither `--save` nor the apply run will replace an existing baseline — a
baseline that can be refreshed after the switch would agree with anything, so replacing it takes a
deliberate delete (or `--force`), which is what a genuinely new migration looks like.

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
- `TLS  links.glamcleaners.net — trusted certificate from …`
- `alias  no path  https://links.glamcleaners.net → 301 https://glamcleaners.net/links/`
- `alias  trailing slash  https://links.glamcleaners.net/ → 301 https://glamcleaners.net/links/`
- `alias  query kept  https://links.glamcleaners.net/?utm_source=bio&utm_medium=social → 301 https://glamcleaners.net/links/?utm_source=bio&utm_medium=social`
- `alias  path dropped  https://links.glamcleaners.net/promo → 301 https://glamcleaners.net/links/`

The alias is asked four times because the forms fail differently, and one of them passing says
nothing about the others: the bare name is what a bio contains, the trailing slash is what a
browser adds when it is pasted, the query string is attribution that must survive, and a deeper
path must be dropped rather than carried onto a page that does not exist. There is no `www.links.`
name and none is wanted: the alias is the www-less `links.`, and so is the target. A 302, or a 301
to any other address, is reported as that rather than as a pass.

If an alias line says the name *answers with a page*, the rule is not installed or the record is
still DNS-only — re-run step 2. If `TLS` says a browser would show a warning, Universal SSL has
not issued for `links.` and that is the same cause: a record that is not proxied is never seen by
Cloudflare at all.

The check is exercised in `npm test` against a loopback HTTPS server holding a certificate for the
alias and answering with the same 301, so its passing path has been run before the day the zone
turns it on — and so has its warning path, with that certificate untrusted.

### 5. Certificates

- **`links.glamcleaners.net`** — Cloudflare's Universal SSL covers first-level subdomains, and it is
  presented as soon as the record is proxied. Nothing to do; the `TLS` line in step 4 names the
  issuer and the days left, so a missing certificate is reported there rather than discovered in a
  browser.
- **`glamcleaners.net` and `www`** — GitHub issues these, and only once DNS answers, so this comes
  after step 4:

```sh
# 1. attach the domain — this starts a DNS check, and a certificate request once it passes
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=glamcleaners.net

# 2. enforce HTTPS — only after the certificate exists (Settings → Pages shows a check mark)
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -F https_enforced=true
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
one redirect. Send one message to a mailbox you can open, take its source, and run `npm run mail`
on it — DMARC should pass on SPF, and the header will show it.

Then finish the retirement in [Retiring the second site](#retiring-the-second-site): this
repository has stopped building and publishing the second site, but the site itself and the key it
was pushed with are still there, and deleting them is the step that cannot be undone.

## Publishing

`main` on `sgscrap/glam-team-cleaners` deploys this site, and nothing else. There is no second
repository to copy the link page into: `links.glamcleaners.net` is a redirect, so the page is
published once, at `/links/`.

What used to be here and is gone: the `links` job in the deploy workflow, `deploy/links-site/`, the
`links-site/` artifacts, `npm run links:publish`, and the code that kept the two copies' canonicals
in step. No deploy key is needed for a redirect.

## Retiring the second site

`sgscrap/glam-links` served the link page at the root of its own Pages site while GitHub held the
domain. The 301 replaces it. Nothing published from this repository reaches it any more, but a
Pages site keeps answering on its custom domain until it is told otherwise, so the name can still
resolve to a frozen copy at an address nobody updates — and a deleted repository is not restored by
`git revert`.

Do this only after `npm run domain` shows the four `alias` lines passing:

```sh
# 1. stop publishing the name; this also releases the custom domain
gh api -X DELETE repos/sgscrap/glam-links/pages

# 2. the key this repository no longer uses, on both sides
gh api repos/sgscrap/glam-links/keys              # list it, then DELETE by id
gh secret delete LINKS_DEPLOY_KEY -R sgscrap/glam-team-cleaners

# 3. the repository, if the history is not worth keeping
gh repo delete sgscrap/glam-links --yes
```

Step 1 is the one that matters for what an address serves; step 3 is the one this document cannot
undo. Falling back to the old arrangement — unproxying `links` and publishing that repository again
— is only possible while both still exist.

## Reading the current state

```sh
npm run preflight                  # all three checks below, in order, with one go/no-go verdict
npm run dkim                       # is anything published at <selector>._domainkey, and with what key
npm run mail:records               # MX, SPF, DMARC and the DKIM keys this domain answers with
npm run domain                     # the target state record by record, the two pages, the alias, and what disagrees
npm run registrar                  # registrar, status, expiry and the delegated nameservers, from the registry
npm run registrar:check            # the same facts, judged: fails when the expiry is within 60 days
npm run registrar:adopt            # what a renewal would change here; --apply writes it and proves it
node -e "import('node:dns/promises').then(d => d.resolve4('glamcleaners.net')).then(console.log)"
gh api repos/sgscrap/glam-team-cleaners/pages
gh secret list -R sgscrap/glam-team-cleaners
```

The registrar of record and the nameservers actually delegated come from the registry rather than
from anyone's memory: `npm run registrar` reads them from
<https://rdap.verisign.com/net/v1/domain/glamcleaners.net> — no login, no token — and compares them
with the values recorded in `src/registrar.js`, exiting 1 when the registry has moved on from them.
It answered `DomainRegistry.com LLC` (IANA ID 128) and the nameservers in
[Where it is today](#where-it-is-today) when this was read on 2026-10-17. That fact is the one step 3 turns on, and now the one command here
that does not depend on this domain answering.

That command compares, which is not the same as looking ahead: a recorded expiry that matches the
registry exactly still arrives one day, and every other guard in this repository is triggered by a
push. `npm run registrar:check` is the one that is not — `.github/workflows/registrar.yml` runs it
daily at 06:17 UTC and fails the run when the expiry is inside 60 days or has passed, and when the
status is no longer the one this document records. 60 days is the window: enough time to renew, or
to renew and move the nameservers in one decision, and short enough not to be missed. It writes
nothing, because renewing is a decision at the registrar's portal, not a step in CI.
`npm run registrar:check -- --as-of 2027-07-19` judges the live registry answer as if that day were
today, so the window can be seen before it opens rather than only on the morning it matters.

Recording the renewal is the other half, and it is one command: `npm run registrar:adopt` prints what
the registry has moved on from, and `--apply` writes both places the facts live — `REGISTRAR_FACTS`
and the three lines above that restate it — then rebuilds `ACCOUNTS.md` and runs the guard suite,
which is what proves nothing was missed. It refuses an answer that is incomplete, and it refuses a
*changed registrar of record*: that is a transfer rather than a renewal, and the paragraphs about
where this domain came from would then be about another company.

The answers are kept rather than overwritten: `registrar-history.json` is an append-only, dated
list of what the registry said, one entry per distinct answer. A renewal adds a line with the new
expiry and leaves the old one where it was; a hold adds another; the sequence is readable without
git. Adoption appends to it, and `npm run registrar:check -- --record` appends the current answer
without adopting it — after which the runbook lags the timeline, and `npm test` says so until it is
adopted. The head of the file has to be the answer `REGISTRAR_FACTS` states. The scheduled run does
not record: a commit pushed from a scheduled workflow needs write access on the branch it runs on
and would race the deploy, so the timeline is extended by a person.

A failure now reaches a person rather than an inbox rule: the run opens an issue titled
`Scheduled registrar check failed — glamcleaners.net`, comments the verdict on it, and the first
passing run closes it with the verdict that closed it — one issue per domain, so the comments are a
timeline of the dates rather than a snapshot of the last one. Its body is the sequence as a
checklist: renew, confirm the registry agrees, update the recorded facts, rebuild, verify. The boxes
are for the person working it — nothing in the workflow ticks them, so a closed issue is not a
statement that every step was done. Nothing is renewed from CI either: the issue is a notice, and the
renewal is still a decision at the registrar.

That is not the same as a guarantee that anything ran. GitHub disables schedules after 60 days
without activity on the default branch, and a workflow that stopped cannot open an issue. So each
run also writes a dated line to its job summary: read the workflow's history before concluding that
an absence of issues means the domain is fine.


`npm run domain` answers for the target state one record at a time: under each check, the records
it disagrees with and what the domain said instead — which of the four addresses is missing, which
name is answering where a CNAME belongs, and any record answering that the target state does not
know about. The mail records recorded below are asked the same way: one that answers differently is
reported and one that answers nothing fails.

`npm run preflight` runs DKIM, the domain and the mail records in that order, prints each one's
output as it is, and ends with one line: `GO` when nothing failed, `NO-GO` naming the checks that
did. Each check is judged by its own exit status, so DKIM passing with no key published is a pass
and says so. The mail check becomes a comparison when the baseline exists (`mail-baseline.json`, or
`--baseline <file>`); before the apply run there is nothing to compare, and the verdict says that
rather than counting it as a pass. `PREFLIGHT_TIMEOUT` (seconds, default 180) bounds each check.

## Mail

Mail is the part of this migration with no visible symptom when it goes wrong, so:

- MX, SPF, DMARC and **any DKIM key** are carried over **read from the live zone** at the moment
  `--apply` runs, not transcribed from a note.
- **Nothing is signed under this domain today.** On 2026-10-17, 153 conventional selector names
  (`<selector>._domainkey.glamcleaners.net`) answered with no TXT — `default`, `mail`, `dkim`,
  `postal`, `google`, `selector1`, `selector2`, `s1`, `s2`, and every size- and date-shaped name in
  `src/dkim.js`. The same 153 names under `3psolutions.net` answered the same way, and that domain
  is on the same mail servers: same MX, same nameservers, same `spf.postal` include. There is no
  `_domainkey` policy record and no `_domainkey` CNAME either. A key that is not published cannot
  verify a signature, so whatever the panel holds, this mailbox is not signing with
  `glamcleaners.net` — and there is nothing in the zone to lose in the move. Whether it signs with
  the provider's own domain is the provider's business, and that zone is not moving.
- **Absence is not proof for an invented selector.** If the control panel names one, ask about it by
  name; the move then copies whatever it finds:

  ```sh
  npm run dkim -- --selector <name>
  npm run dns:cloudflare -- --apply
  ```

  `--apply` refuses to run if `_domainkey` is delegated by a CNAME and no key answered through it,
  because recreating that delegation blindly would leave every selector unverifiable.
- **A key at the apex is not a key.** `outreachidaho.org`, another domain on this mail server,
  publishes `v=DKIM1; k=rsa; p=…` as a plain apex TXT, where DKIM never looks (`npm run dkim` says
  so if it finds one). That record verifies nothing; the move still copies apex TXT records as they
  are, because SPF lives there too.
- DMARC is `p=quarantine`. With no DKIM, alignment rests on SPF: the envelope domain is
  `glamcleaners.net`, and the provider's sending addresses (`66.223.49.91–93`) are named by the SPF
  include that is copied verbatim, so it still passes after the switch — but send a test message to
  confirm, because this is the part with no visible symptom when it goes wrong.

### Proving a signature without asking a receiver

`npm run mail` does not take a receiver's word for a signature when the paste includes the body:
`src/dkim-verify.js` recomputes the body hash, rebuilds the signed header set, and checks the
signature against the published key. That turns "the receiver said pass" into "this key signed this
message" — which is the claim a migration actually has to make, and the only one available when no
receiver has spoken yet.

```sh
npm run mail -- delivered.eml                     # the key comes from DNS
npm run mail -- outbound.eml \
  --key default._domainkey.glamcleaners.net='v=DKIM1; k=rsa; p=…'
```

The second form verifies against a record pasted in, so a key can be proved **before** it is
published — the order that avoids a window where the mailbox signs with a key nobody can fetch. It
exits 1 when a signature it actually checked does not verify, and claims nothing when it could not
check: a copy with no body, or a selector no nameserver answers for, is reported as exactly that.
- **Prove the records moved, not just that mail arrives.** Snapshot before the switch and compare
after it, as step 3 does; the comparison covers MX, the SPF string, the DMARC string and every DKIM
key, and names each difference with both values.
- **Read the first delivered message.** `npm run mail -- header.txt` (or `pbpaste | npm run mail`)
  takes a delivered message source and prints the DKIM `s=`/`d=`, whether that key is published,
  the receiver's SPF verdict, and DMARC alignment. A `dmarc=pass` from the receiver is the proof;
  a copy from Sent Mail has no receiver verdict, and the tool says so instead of treating the
  sender's own signature as a result. Use Gmail's *Show original* or Outlook's *View source*.

## Rollback

Nothing here is one-way except the nameserver change, and even that is reversible:

- **Mail or the site breaks after step 3**: put `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` back in the
  nameserver fields at <https://www.domainregistry.com/login/>. The old zone is untouched and still
  answers; the domain returns to the forward within the TTL.
- **The redirect misfires**: re-install it with `npm run dns:cloudflare -- --apply`. Removing the
  rule, or the record's proxy, no longer falls back to a served page: the second site is retired, so
  the name answers with GitHub's 404 until the rule is back. That is the cost of one copy instead of
  two, and it is why the rule is re-runnable.
- **A deploy was published wrongly**: `git revert` the commit and merge; the deploy republishes from
  `main`. The subdomain follows within a minute.

`dns/glamcleaners.net.zone` and `scripts/dns-cloudflare.js` are the description of the target state;
if they disagree with Cloudflare, one of them is wrong and `npm run check` will not tell you which —
compare with `gh api` or the dashboard.
