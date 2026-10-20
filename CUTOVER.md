# Cutover plan — the apex serves the site, no redirect

`https://glamcleaners.net/` must serve this repository's page **itself**: HTTP 200, no `Location`
header, over a certificate GitHub issues. Today the same address answers 301 → the Pages URL, so
every canonical on the site names a URL that immediately redirects away from itself.

**The authority for the records is not this document.** The records, the rule and the proxy states
are generated into [DOMAIN.md](DOMAIN.md) from `src/dns.js` and `src/cloudflare.js`, held there by
`npm run check`, and rendered as `dns/glamcleaners.net.zone`. This file is the *order*, the *owner*
of each milestone, the *proof* each milestone leaves behind, and the window where the domain serves
nothing — read it with DOMAIN.md open beside it, which is also the authority if the two ever
disagree.

## Definition of done

```sh
npm run domain                                # exit 0: the four DNS lines, both pages byte for byte, the alias in all four forms
curl -sS -D - -o /dev/null https://glamcleaners.net/ | head -3   # HTTP/2 200, and no location: header
```

`npm run domain` reports any 3xx on the apex as a failure (*"it is a domain forward to the Pages
address"*), so it is the no-redirect test, not a proxy for one. Exit 0 also depends on rows beyond
the apex: the mail row (`DNS  the mail records recorded in the target state …`) and the alias TLS row
(`TLS  links.glamcleaners.net — trusted certificate from …`) fail the run as readily as a redirect
does. `https://www.glamcleaners.net/`
redirecting to the apex is expected and correct — that is GitHub's own redirect, and it is the
reason the `www` record exists. The `sgscrap.github.io` address redirecting to the domain once it is
attached is expected too.

## Where it stands today (read-only, 2026-10-17/18)

| Name | What answers | After the cutover |
| --- | --- | --- |
| apex `glamcleaners.net` | **301** → `https://sgscrap.github.io/glam-team-cleaners/` (`66.223.49.89`, the old forwarder) | the site itself, from GitHub's four A and four AAAA addresses |
| `www.glamcleaners.net` | the same forwarder; over https the connection closes after the certificate | `CNAME` to `sgscrap.github.io`, DNS only; GitHub then redirects to the apex |
| `links.glamcleaners.net` | the same forwarder (the wildcard is what answers) | `CNAME` to `sgscrap.github.io`, **proxied**, with the 301 rule in front of it |
| `*.glamcleaners.net` | answers — every subdomain lands on the homepage | **deleted**; an unconfigured name stops resolving |
| Mail | `MX 10 mailserver.businessidentity.llc`, SPF, DMARC `p=quarantine`; **no DKIM published** | identical records, copied from the live zone by the apply run |
| Pages, main site | `cname: null`, `https_enforced: true`, `protected_domain_state: null` | `cname: glamcleaners.net` |
| Registrar / delegation | DomainRegistry.com LLC (IANA 128), `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC`, `delegationSigned: false` | the Cloudflare nameserver pair; still unsigned |

## Reconciled with the runbook

**Its premise is right, and current.** The forward is real and unchanged (301 to the Pages URL,
above); the registry still delegates to the old pair (RDAP); the Pages API still reports
`cname: null`, so nothing is attached. `npm run domain` reports the state as nine blockers today,
four of them the `alias` rows — the forward answers `links` with a page rather than a 301, and the
wildcard is what answers that name. The old DNS host's panel really does have no address, and the
registrar is the only live control plane — which is why the zone has to be rebuilt somewhere
reachable instead of edited where it is. Nothing in DOMAIN.md is stale, and the plan below is its
steps, sequenced.

**Its step 4 gate sits one step later than its own actions.** Its step 4 wants all lines green, but
the two apex HTTP lines cannot pass until its step 5 has attached the custom domain: GitHub Pages
serves only the hostnames it has been configured with, so before the attach the apex gets GitHub's
"no site here" 404 no matter how correct DNS is. Read it as: once M3's nameservers are live, run
`npm run domain` and expect the four **DNS** lines and the four **alias** lines to pass while the
apex HTTP lines fail — that is the signal to attach — then run it again for the full pass. The
runbook's own repair text says "once DNS answers, attaching the domain is one call", so this is a
reading of the sequence, not a disagreement with it.

**It doesn't name the window.** Between the nameserver change and the certificate there is an
interval where the domain is not the site: the apex resolves to GitHub, GitHub has nothing for that
hostname yet, and no certificate for it exists either. It lasts from the registrar's publication
until GitHub's DNS check passes and its certificate is issued — minutes in the ordinary case, and
GitHub allows up to 24 hours before HTTPS enforcement becomes available. It cannot be designed away:
GitHub requests the certificate only after DNS points at it. It is the reason M3 should be done
when someone can stay for M4.

**A flag is already set.** The site carries `https_enforced: true` from its `github.io` life, and
GitHub does not document what that does for a custom domain whose certificate does not exist yet. If
it redirects http → https during the window, the apex is unreachable over both schemes until the
certificate lands. Clearing it just before the attach (M4's first command) leaves `http://`
serving the site during the window and degrades only https — a judgement call, not a documented
requirement, and the plan marks it as optional.

**Two things the runbook never mentions.** There is no Pages ownership record anywhere: an
unverified domain can be claimed by another GitHub account, which would then serve its content at
`glamcleaners.net` and its immediate subdomains — M6 below adds
`_github-pages-challenge-sgscrap.glamcleaners.net`. And DNSSEC is unmentioned but settled by
reading RDAP: the registry reports `delegationSigned: false`, so there is **no DS record to remove**
before the nameservers move, and the move cannot break resolution that way. Do not turn on
Cloudflare's DNSSEC during the cutover; if it is ever turned on, the DS record goes in at the
registrar.

## Why this and not something else

The only way to change what the apex answers is to host its zone somewhere whose records can be
edited. The registrar is alive but only sets nameservers; the host that serves the forward has no
address that answers, and a forward is all it can do — it cannot be asked to serve instead of
redirect. So: build the zone at Cloudflare (free, and the only place in this move that also gives
`links` a redirect rule that costs nothing to run) and point the registrar at it. Leaving the domain
as it is keeps the redirect, which is the thing this plan exists to remove; transferring the
registrar would not touch DNS and is not needed.

## The milestones

| Milestone | What | Who can do it | Proof |
| --- | --- | --- | --- |
| M0 | Read the starting state | anyone, no login | the expected nine failures, and the wildcard as a warning |
| M1 | Cloudflare zone + token | **Cloudflare login** | the dry run exits 0 |
| M2 | Write the zone, take the mail baseline | token (owner) | exit 0, nameserver pair printed |
| M3 | Point the registrar at Cloudflare | **registrar login** | the new pair answers |
| M4 | Attach the domain, certificate, enforce HTTPS | **GitHub owner** (`gh` here is admin) | the apex answers 200 |
| M5 | Prove it | anyone | `npm run domain` exit 0, mail compare 0 |
| M6 | Verify the domain for Pages | **GitHub account** + a Cloudflare record | the TXT answers |
| M7 | Retire the second site | GitHub owner | the alias lines still pass |
| M8 | Record the new state | anyone | `npm run registrar` exits 0 |

### M0. Read the starting state

```sh
npm run registrar        # registrar, status, expiry, delegated nameservers — from RDAP, no login
npm run domain           # expect exit 1: nine blockers — the three DNS rows, both HTTP rows and the four alias rows
npm run preflight        # expect NO-GO, naming the checks above
npm run dkim             # expect: nothing published
gh api repos/sgscrap/glam-team-cleaners/pages
```

Done when the failures are the expected ones — the three DNS rows (apex, `www`, `links`), both HTTP
rows and the four alias rows, the nine the run counts — and nothing new. The wildcard is reported
too, as a `!` warning rather than a failure, and the absent AAAA records as a `·` note: neither adds
to the count. If the repository's own build or tests fail, stop and fix that first: the site has to
be green before its address moves.

### M1. Cloudflare zone and token — **owner only**

Add `glamcleaners.net` in the Cloudflare dashboard (free plan). **Do not enable Email Routing**: it
replaces the MX records, and the mailbox has to survive this move. Create an API token with the
three permissions DOMAIN.md's step 1 lists and save the two values to `~/.cloudflare-zone.env`.

Done when `npm run dns:cloudflare` (the dry run) exits 0 and prints the records and the rule. The dry
run needs the token too — **this machine currently has no Cloudflare credentials** (no
`~/.cloudflare-zone.env`), so M1 gates everything after M0. The zone is not authoritative until
M3, so nothing done at Cloudflare is visible to anyone yet; if the dashboard imported the old
records, M2 deletes the web ones.

### M2. Write the zone

```sh
npm run dns:cloudflare -- --apply
```

It writes, from the same source that generates DOMAIN.md's table:

- `A  @` and `AAAA  @` — GitHub's four addresses of each, **DNS only** (grey). The apex stays a
  literal address list here, which is this repository's choice rather than a GitHub constraint:
  GitHub documents an ALIAS/ANAME record at the apex, pointed at `sgscrap.github.io`, as an equal
  alternative to the address set, and Cloudflare's equivalent to one is a flattened CNAME. If either
  is substituted it still has to be DNS-only and still has to resolve to those addresses;
  `npm run domain` checks them one by one.
- `CNAME  www  sgscrap.github.io` — DNS only.
- `CNAME  links  sgscrap.github.io` — written grey, then **flipped to proxied** once the rule exists,
  because Cloudflare sees no traffic for a grey name and Universal SSL covers that first-level
  subdomain as soon as it is orange.
- The mail records read from the live zone at that moment — MX, the apex SPF TXT, the `_dmarc` TXT,
  and any `<selector>._domainkey` key it finds — copied verbatim.
- The redirect rule: when `http.host eq "links.glamcleaners.net"` then **301** to
  `https://glamcleaners.net/links/`, query string preserved.
- It **deletes** the imported web records at `@`, `www`, `links` and `*` — A, AAAA and CNAME only.
  Mail is never touched; any other name in the zone is listed under "Left alone — not part of this
  move" and should be read before M3.

**A copy, for convenience only.** The addresses, as [DOMAIN.md](DOMAIN.md#target-state)'s generated
block holds them — `A` `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`;
`AAAA` `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`;
both CNAMEs to `sgscrap.github.io`. The original is that block: `npm run build` renders it from
`src/dns.js` and `npm run check` holds it. Nothing checks this copy, and the block is right if the
two ever disagree.

Load-bearing: this run takes the **mail baseline before its first write** and compares the zone
against it before printing the nameserver pair. It must therefore run while the old zone is still
answering DNS — i.e. before M3 — and it should run *before* the nameservers move so the zone is
already right the instant it becomes authoritative.

Done when the run exits 0 (a lost or reworded mail record exits 1 and prints both values) and

```sh
npm run mail:records -- --compare mail-baseline.json   # still against the old zone: DNS has not moved
```

exits 0. Keep the baseline file: it is the only reading that can prove the new zone answers
identically, and it is never refreshed.

### M3. Point the registrar at Cloudflare — **owner only**

<https://www.domainregistry.com/login/> → `glamcleaners.net` → replace
`NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` with the pair M2 printed.

Load-bearing: the old zone keeps answering until the registry publishes the change, so mail has no
gap — but from that publication the forward is gone and the apex points at GitHub until M4
attaches the domain. Do this when someone can stay for M4, not before a weekend. No DS record to
clear first (`delegationSigned: false`).

Done when the new pair answers —

```sh
node -e "import('node:dns/promises').then(d=>d.resolveNs('glamcleaners.net')).then(console.log)"
```

— and `npm run domain` shows the four DNS lines and the four alias lines passing while the apex
HTTP lines fail. That failure is the expected state, not a fault: it is what M4 fixes.

### M4. Attach the domain, wait for the certificate, enforce HTTPS — **owner**

```sh
# optional, and explained above: carry no enforcement through the certificate window
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -F https_enforced=false

# attach: starts the DNS check, and queues the certificate when it passes
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -f cname=glamcleaners.net

# then, once Settings → Pages shows the domain's check mark:
gh api -X PUT repos/sgscrap/glam-team-cleaners/pages -F https_enforced=true
```

Load-bearing, both directions: attaching **before** M3 risks a loop — the default Pages address
redirects to the custom domain and the domain still forwards to the Pages address — and it fails
GitHub's DNS check either way; leaving the attach until after the certificate is not possible,
because GitHub requests the certificate only after the domain is attached and DNS answers for it. The
check mark in Settings → Pages is the confirmation, and the Pages API does not return the
certificate, so that page (or a TLS probe) is the only place to read its state.

Done when `curl -sS -D - -o /dev/null https://glamcleaners.net/ | head -3` shows `HTTP/2 200` with
no `location:`.

### M5. Prove it

```sh
npm run domain                                    # exit 0 — the definition of done above
npm run mail:records -- --compare mail-baseline.json   # now against Cloudflare
npm run preflight                                 # GO
curl -sSI https://www.glamcleaners.net/           # 301 to the apex, GitHub's own redirect
```

Then one message to a mailbox you can open, and `npm run mail -- delivered.eml`: DMARC should pass
on SPF alignment. The `TLS links.glamcleaners.net` line can lag the zone going active by a few
minutes while Universal SSL issues — a warning there is a timing fact, not a DNS one.

### M6. Verify the domain for the GitHub account — **owner only**

GitHub → Settings → Pages → **Add a domain** → `glamcleaners.net` → copy the value it shows, and
create a TXT record in Cloudflare: name `_github-pages-challenge-sgscrap` (the dashboard appends the
domain), value as shown. TXT records are never proxied. The apply run does not write this record —
it is not part of the site's zone — so it goes in by hand, in the same zone.

Why: an unverified domain can be claimed by another GitHub account, which would then serve its own
content at `glamcleaners.net` and its immediate subdomains. Nothing in this repository checks it,
and the Pages API cannot say whether that has already happened: `protected_domain_state` reports
this site's own protection state and is null here because no custom domain is attached yet — that is
not the same as the domain being unclaimed. If M4's attach reports the domain already in use,
verifying it is also the documented way to release it. It is not required for the site to serve; do
it the same day.

Done when the record answers and GitHub's page shows the domain as verified. The lookup prints the
value once the record exists and the state before that as a sentence rather than a stack trace — and
exits 1 until it does:

```sh
node -e "import('node:dns/promises').then(d=>d.resolveTxt('_github-pages-challenge-sgscrap.glamcleaners.net')).then(txt=>console.log(txt.flat().join(''))).catch(e=>{ console.log('nothing published at this name yet —', e.code); process.exitCode = 1 })"
```

Run against the live zone on 2026-10-18, before the move, it printed

```
nothing published at this name yet — ENODATA
```

and exited 1. `ENODATA` is what the wildcard makes of that name today; with the wildcard deleted the
code can be `ENOTFOUND` instead, and the sentence reads the same either way.

### M7. Retire the second site — **owner only**

Only after the alias lines pass, and only as DOMAIN.md's [Retiring the second site](DOMAIN.md#retiring-the-second-site)
lists them: delete the `sgscrap/glam-links` Pages site (which is what still claims
`links.glamcleaners.net` — the API shows `cname: links.glamcleaners.net` today), remove the deploy
key and the `LINKS_DEPLOY_KEY` secret, and delete the repository only if its history is not worth
keeping. This is not required for the apex; it is required for the single-address promise. The stale
claim is harmless while `links` is proxied with the rule in front of it, which is why M2
installs the rule before the nameservers move.

### M8. Record the new state

After M3, `npm run registrar` fails once, on purpose: the facts this repository records still name
the old nameserver pair. `npm run registrar:adopt -- --apply` rewrites the facts it owns —
`REGISTRAR_FACTS`, the three places in DOMAIN.md that restate them (the sentence that dates the
reading, the `Registered` row and the `Nameservers` row), and `registrar-history.json` — then
rebuilds `ACCOUNTS.md` and runs the guards.

The rest of DOMAIN.md's "Where it is today" is prose and stays wrong: the apex-A, wildcard, `www`,
and `cname: null` rows describe the *before* state and have to be updated by hand, or the table
renamed as the before-picture. The same is true here: this document's "What answers" column and its
nine-blocker line describe the day before the move, and nothing in the repository updates them.
`npm run build && npm test` stays green either way.

## The order that is load-bearing

- **The mail baseline before any write, and before M3.** A baseline taken after the nameservers
  move is a reading of the new zone, and it would agree with anything. Mail is the failure with no
  symptom until weeks later.
- **M2 before M3.** The zone must be complete the moment it becomes authoritative — the
  imported forwarder records and the wildcard are still in it until M2 deletes them.
- **The rule and the proxy for `links` in the same run as the records.** Without the rule, `links`
  answers GitHub's 404 at best; with the record grey, Cloudflare never sees the traffic at all.
- **M3 before M4.** Attaching first fails GitHub's DNS check and risks the redirect loop.
- **The attach before "no redirect" can be true.** GitHub serves only hostnames it has been
  configured with.
- **Enforce HTTPS after the certificate.** Before it, the enforcement redirects to an https that
  cannot complete a handshake.
- **Retire `glam-links` after the alias lines pass.** It is the repository that still claims the
  name; deleting it early buys nothing and loses the fallback.
- **No Cloudflare DNSSEC during the move.** A DS record at the registrar with no matching key
  configured breaks resolution for every name at once.

## What cannot be done or confirmed from this machine

- **Add the Cloudflare zone or mint the token.** No Cloudflare credentials here
  (`~/.cloudflare-zone.env` is absent), and the dry run needs them too — everything from M1
  onward is blocked until the owner does it.
- **Change the nameservers at the registrar**, or know how long the registry takes to publish the
  change. The portal is a login this machine does not hold.
- **Read GitHub's certificate state.** The Pages API does not return the certificate; Settings →
  Pages is the only place, and the DNS check is asynchronous.
- **Read the Pages ownership TXT value** (it is in the account's own settings) or receive GitHub's
  mail about it.
- **Prove mail end to end.** That needs a mailbox to send to and the delivered message's source;
  `npm run mail` can only judge a copy it is given.
- **See the domain from anywhere but here.** Every probe runs on this machine's resolver and TLS
  stack — where the old forwarder's renegotiation makes Node's `fetch` fail on names it answers
  perfectly well to `curl`, which is why the repository's probes are hand-written.
- **Time the windows.** Certificate issuance and the registrar's publication are other people's
  clocks; the plan can bound them, not schedule them.

## Rollback

- **Before M3** — nothing to undo. The zone at Cloudflare is not authoritative and no one sees
  it; deleting it changes nothing.
- **After M3** — put `NS1/NS2.HOSTING.BUSINESSIDENTITY.LLC` back at the registrar. The old zone
  still holds the forward and the mail records, so the domain returns to forwarding to the Pages
  address — the status quo this plan exists to end, but a working site.
- **After M4** — unset the custom domain in Settings → Pages (one field; the API's removal form
  is a `PUT` with `cname` null). The site goes back to serving at the default Pages address.
- **The redirect** — `npm run dns:cloudflare -- --apply` re-installs it and is idempotent. With the
  second site retired, removing the rule or the proxy leaves `links` answering GitHub's 404 until it
  is back; that is the cost of one copy instead of two.
