---
layout: post
title: "THM: CryptoCabana"
date: 2026-08-04 17:00:00
category: "Cloud"
difficulty: "Medium"
tags: [thm, hacker-holidays, cloud, azure, blob-storage, sas-token, key-vault, service-principal, secret-versioning]
excerpt: "My first proper Azure box, and easily the twistiest thing I've done. A seed-phrase backup kiosk that hands you a storage credential for free in its own network traffic, an over-scoped SAS token that reaches far past the one file the page writes, a service principal hiding in a backup, and finally a Key Vault where the real answer is a previous version of a secret. I got lost more than once. Most of the lessons are in the dead ends."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/cryptocabana-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for CryptoCabana. Category Cloud, difficulty Medium, 90 points. By the time he made it back from the breakfast buffet, his wallet had already moved on without him. The transaction was signed, properly signed, just not by him. He'd backed his seed phrase up weeks ago, into the CryptoCabana kiosk's vault, the one whose landing page promised, in exactly four words, Backed up. Sleep easy. Somewhere between that promise and this morning, something else got a good look at what was supposed to stay behind glass. Objective: find out what the kiosk is quietly trusting to reach into storage on its own, and see how much further that trust actually extends. Room access target is a web.core.windows.net static site. Itinerary: pull apart what the kiosk hands out for free before you've even clicked anything, follow that trust somewhere the kiosk's own page never once points, and find a second more valuable set of keys plus a vault that won't give up the real values on the first ask. 0xMia's story: the backup kiosk is so confident, sleep easy it says, reader do not sleep easy, and if a value looks freshly rotated ask yourself what it looked like five minutes before.">
  <figcaption>The briefing for CryptoCabana. Read as a spec, the whole box is in here: "what the kiosk is quietly trusting to reach into storage" is a leaked credential, "how much further that trust extends" is an over-scoped token, and 0xMia's "ask what it looked like five minutes before" is the versioning trick that finishes it.</figcaption>
</figure>

This was my first real Azure box, and I want to be honest up front: it was long, I got lost
in the middle for a good while, and most of what I learned came out of the dead ends rather
than the clean path. So this writeup is going to include the wrong turns on purpose, because
untangling them is where the actual understanding lived. It's a TryHackMe Cloud Medium from
the Hacker Holidays event, the Byte Lotus universe again, this time a seed-phrase backup
kiosk called CryptoCabana. Standard disclaimer, it's a deliberately vulnerable lab, the
"crypto wallet" and the seed phrases are all fake, nothing here is a real service or a real
key.

*One note before you read on. There's one grey bar like <span class="spoiler">this</span>
lower down, covering the single command that resolves the final puzzle. I explain the whole
idea around it in the open so you can try to work it out yourself before you peek. Click it
(or tab to it and press Enter) to reveal. Hints, not answers off the rip.*

## Reading the briefing as a spec

Every room in this event writes the vulnerability into the flavour text, and by now I look
for that first. CryptoCabana spelled out the entire path:

- **"find out what the kiosk is quietly trusting to reach into storage on its own"** is a
  leaked credential. The website itself holds a key it uses to talk to storage, and it's
  going to hand that key to me.
- **"see how much further that trust actually extends"** means the credential is scoped too
  widely. It can do more than the one thing the page uses it for.
- **The itinerary**, in order: "pull apart what the kiosk hands out for free before you've
  even clicked anything" (read the traffic), "follow that trust somewhere the kiosk's own
  page never once points" (use the credential beyond its intended job), and "a second, more
  valuable set of keys, and a vault that won't give up the real values on the first ask" (a
  second store of secrets with a catch).
- **0xMia's line, "if a value looks freshly rotated, ask yourself what it looked like five
  minutes before,"** is the ending given away: when you find the vault, the current value is
  a decoy and the real one is an older version.

So before touching anything I already expected: the site leaks a storage credential, that
credential is over-privileged, it leads to a second secret store, and in that store I'll
need to read the previous version of something. That is exactly how it played out.

## Step 1: the kiosk hands you a credential for free

The room's target isn't a normal web server, it's a static website hosted straight out of
Azure Storage (the giveaway is the `web.core.windows.net` domain). The page is a "back up
your seed phrase" kiosk: paste your recovery phrase, click a button, and it promises to
stash it in "your own private vault, never stored on your device, never shared."

The itinerary said to pull apart what it hands out "before you've even clicked anything," so
I opened Firefox devtools on the Network tab first. And here's a detail worth knowing: you
do **not** need a real 12-word seed phrase for this. The page fires its backup request
regardless of what you type, so even garbage in the box is enough to make the interesting
traffic appear. What appears is a `PUT` (and a CORS `OPTIONS` preflight) straight to Azure
Blob Storage:

```
PUT https://cryptocabanaf5scjagc.blob.core.windows.net/backups/backup-<timestamp>.txt??sv=2022-11-02&ss=b&srt=sco&sp=rl&se=2099-12-31T23:59:59Z&st=2024-01-01T00:00:00Z&spr=https&sig=<SAS_SIGNATURE>
```

<figure>
  <img src="{{ '/assets/img/cryptocabana-kiosk-sas.png' | relative_url }}" alt="The CryptoCabana seed-phrase backup page with Firefox devtools open on the Network tab. The recovery phrase textarea is blacked out. The request list shows repeated PUT and OPTIONS calls to cryptocabanaf5scjagc.blob.core.windows.net/backups/backup-<timestamp>.txt with SAS query parameters, several marked CORS Missing Allow Origin. The Headers panel on the right shows the full request URL with the SAS parameters sv, ss=b, srt=sco, sp=rl, se=2099 and a blacked-out signature, and a 403 CORS status. The page itself shows 'Backup failed, network error'.">
  <figcaption>The kiosk leaking its own storage credential. I blacked out my seed words and the signature, but the point is the whole SAS token is sitting in the request URL in plain sight. The backup itself "fails" in the browser (that's just CORS blocking the cross-origin call), but by then the token has already leaked. The page did the one thing it was never supposed to do: show me the key.</figcaption>
</figure>

The backup visibly failed in the page ("Backup failed, network error"), and the Network tab
was full of red "CORS Missing Allow Origin" entries. For a while I thought that meant I'd
hit a wall. It doesn't. CORS only stops the browser's JavaScript from reading a cross-origin
response, it does nothing to stop me taking that credential and using it myself from a
terminal. The failed request had already handed me everything I needed.

## What a SAS token is, and why this one is dangerous

That long query string on the URL is a **SAS token**, a Shared Access Signature. It's Azure's
way of granting temporary, signed access to storage without handing over the account keys.
Everything the token is allowed to do is encoded in its own parameters, and reading them is
the whole game here:

- `ss=b`, the service it works on: **b**lob.
- `srt=sco`, the resource types: **s**ervice, **c**ontainer, **o**bject. Signing over the
  service and container levels (not just objects) makes this an **account SAS**, the broad
  kind.
- `sp=rl`, the permissions: **r**ead and **l**ist.
- `se=2099-12-31`, expires in the year 2099. Effectively never.
- `st=2024-01-01`, `spr=https`, `sv=2022-11-02`, valid-from date, HTTPS only, and the API
  version.

Put together, this is the "how much further that trust extends" line made concrete. The page
only ever uses the token to write one backup file. But the token itself grants **read and
list across the whole blob service**, with an expiry seventy-odd years out. It can enumerate
containers, list every blob in them, and read their contents. That is enormously more than
"back up one file," and it's the actual vulnerability: a credential shipped to the client,
scoped far past its job.

## Step 2: following the trust the page never points at

Itinerary item two is to follow that credential somewhere the page never goes. The page only
ever touches `backups/backup-<timestamp>.txt`. But with read and list, I can list the whole
container and see everything else in it:

```
https://cryptocabanaf5scjagc.blob.core.windows.net/backups?restype=container&comp=list&<SAS>
```

And this is where I got properly stuck, so here are the dead ends, because they taught me
more than the answer did.

**The signature transcription nightmare.** I first tried retyping the token by reading it off
the URL bar, and I kept getting authentication failures. The reason was stupid and it cost me
a lot of time: the signature is base64, and base64 contains characters that look identical in
a lot of fonts. I had a capital `I` versus a lowercase `l` I could not tell apart, and I kept
guessing wrong. Do not retype a SAS signature by eye. The fix that finally killed the
guessing was to copy it exactly: right-click the request in the Network tab and use **Copy
as cURL** (or Copy URL), so the byte-exact signature comes across with zero transcription.

**The double question mark.** The URL the app built had a suspicious `??` in it
(`backup-<ts>.txt??sv=...`). That malformed pair sent me down a rabbit hole about whether the
second `?` was meaningful. For the REST list call it isn't, you want a single `?` before
`restype`, and rewriting the path cleanly from the copied request sidestepped the whole
thing.

**"Signature fields not well formed."** Once I stopped mistyping the signature, the error
changed to this, and it's a genuinely useful message. It isn't "wrong signature," it's
"these SAS parameters don't match the operation you're asking for." That was the nudge to
actually read the parameters (the `srt=sco` account-SAS detail above) rather than keep
brute-forcing characters.

**CORS, again.** Trying to do the listing from the browser kept failing the preflight. Same
lesson as before: stop using the browser for this. A plain `curl` or Azure Cloud Shell has no
CORS, no same-origin policy, nothing. The token works fine the moment you take it out of the
browser.

Once I was copying the exact token and running it from a terminal instead of the browser, the
list call finally returned XML, and it listed **more than the single backup the page had ever
written**. That's the "somewhere the page never points" payoff: the backups the kiosk quietly
kept were all sitting there, readable, because the token it leaked could list and read them
all.

## Step 3: the pivot into a service principal

*(This is the one connective step I'm reconstructing from memory rather than a saved log, so
treat the exact details lightly.)* Among the blobs the listing exposed was a backup that
should never have been in reachable storage: it held the credentials for an Azure **service
principal** (an app registration's ID, its client secret, and the tenant). A service
principal is a non-human identity, basically a login for an application, and these creds had
been "backed up" into the very storage the leaked SAS could read. That's the second, more
valuable set of keys the briefing promised.

With those, I could authenticate as that identity properly, not with a storage token but as a
real Azure principal:

```bash
az login --service-principal -u <APP_ID> -p <CLIENT_SECRET> --tenant <TENANT_ID>
```

From there, enumerating what this principal could see turned up an Azure **Key Vault**,
`ccabana-kv-f5scjagc`. Key Vault is Azure's managed secret store, and getting to it meant I'd
climbed exactly the ladder the briefing described: leaked storage token, to a backed-up
identity, to the vault that identity guards.

## Step 4: the vault, and the "five minutes before" trick

Listing the vault's secrets gave four of them:

```bash
az keyvault secret list --vault-name ccabana-kv-f5scjagc -o table
```

- `master-key`, marked expired on 2020-01-01, and when I tried to read it: **Forbidden**.
  The service principal simply isn't authorised for that one. This is a deliberate rabbit
  hole. The expired date and the tempting name are bait, and I did waste a little time poking
  at it before accepting it was a dead end. Leave it.
- `key-shard-1`, `key-shard-2`, `key-shard-3`, the actual objective, a value split into
  three shards.

Reading the shards straight off:

```bash
az keyvault secret show --vault-name ccabana-kv-f5scjagc --name key-shard-1 --query value -o tsv
```

gave me the ends of something that was clearly one string cut into three:

- `key-shard-1` → the opening of the flag (the `THM{` and the first chunk).
- `key-shard-3` → the closing chunk, the part that ends in `}`.
- `key-shard-2` → not a flag chunk at all, but a note: *"Rotated this after IT flagged it,
  old value should still be recoverable if you know where to look."*

So the middle piece was missing, and shard-2's current value was openly telling me it was a
decoy left behind after a rotation. This is 0xMia's hint made literal: "if a value looks
freshly rotated, ask yourself what it looked like five minutes before." Azure Key Vault keeps
the **history of every secret**. Rotating a secret doesn't delete the old value, it just adds
a new version on top, and every previous version is still there and still readable if you have
access. So the real middle shard wasn't gone, it was one version back.

The move, then: list all versions of `key-shard-2`, find the older one, and read that
specific version instead of the current decoy:

```bash
az keyvault secret list-versions --vault-name ccabana-kv-f5scjagc --name key-shard-2 -o table
# grab the older version's id, then:
```

<span class="spoiler"><code>az keyvault secret show --vault-name ccabana-kv-f5scjagc --name key-shard-2 --version &lt;OLDER_VERSION_ID&gt; --query value -o tsv</code></span>

(Quick honest aside: my first attempts at this failed because I left the literal placeholder
text `SECRETNAME` and `OLD_VERSION_ID` in the commands instead of substituting real values.
If your `list-versions` or `show` behaves strangely, check you actually filled in the slots.)

Reading that previous version gave the middle chunk, and stitching the three shards back
together in order (shard-1, then the recovered older shard-2, then shard-3) produced the flag:

```
THM{[redacted]}
```

Redacted as always (TryHackMe's rules ask you not to publish flags), but the assembled text
is a crypto in-joke that also happens to be the entire moral of the box: "not your keys, not
your coins." The one time it was literally true, the keys weren't guarded nearly well enough.

## How to actually fix this box

Every step here maps to a real Azure misconfiguration, and the fixes are worth stating:

- **Never ship a SAS token in client-side code.** Anything the browser can use, an attacker
  can read. Storage writes from a web app should go through a backend the client never sees
  the credentials of.
- **Scope SAS tokens to the minimum.** This one was an account SAS with read and list over
  the whole blob service, valid until 2099. It should have been a single-object, write-only,
  short-lived token, and it should not have been able to list or read anything else.
- **Don't back up secrets into storage that token can reach.** A service principal's
  credentials sitting in a readable blob is how the whole thing unravelled. Secrets belong in
  a secret manager with tight access, not in a backups container.
- **Remember that rotation is not deletion.** Key Vault keeps old versions. If a secret is
  truly compromised, rotating it leaves the old value readable to anyone with access, so you
  have to disable or purge the old versions, and tighten who can read version history in the
  first place.
- **Least privilege on the principal.** That it could even list the vault's secrets is the
  root of the ending.

## What I took away

- **The briefing was the exploit, again.** "What the kiosk is trusting to reach into storage"
  and "how much further that trust extends" described a leaked, over-scoped credential before
  I ran a thing.
- **A leaked credential doesn't care that the request failed.** The backup erroring out on
  CORS was irrelevant, the SAS token had already leaked in the request URL. CORS protects the
  browser, not the secret.
- **Read the SAS parameters.** `ss`, `srt`, `sp`, `se` told me it was an account-level
  read-and-list token good until 2099. The permissions are printed right on the token.
- **Get credentials out of the browser to use them.** curl and Cloud Shell have no CORS and no
  same-origin policy. Most of my "it doesn't work" time was me fighting the browser.
- **Never retype a signature by eye.** Copy as cURL. The `I`-versus-`l` guessing game cost me
  more time than the entire rest of the box.
- **Rotation leaves history.** In Key Vault the real value can be one version back. "What did
  it look like five minutes before" is a genuine technique, not just flavour.

> Room: CryptoCabana on TryHackMe (Hacker Holidays 2026), Cloud, Medium, 90 points. My first
> Azure box and a properly twisty one. Flag left out as always, though it spells out "not your
> keys, not your coins," which is the whole point. Most of the value was in the dead ends, so
> I left them in.
