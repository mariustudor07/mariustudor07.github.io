---
layout: post
title: "THM: Towel on the Sunbed"
date: 2026-08-03 18:30:00
category: "Web Exploitation"
difficulty: "Medium"
tags: [thm, hacker-holidays, web, race-condition, toctou, double-spend, burp-suite, single-packet-attack, business-logic]
excerpt: "A crypto rewards portal that lets you claim once every 24 hours, and a Whale Vault that unlocks at 150 coins. The whole box is one race condition: fire enough claim requests at the exact same instant and they all pass the timer check before any of them updates it. The real lesson was a single menu item in Burp, sequence versus parallel, the difference between total failure and the flag."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/towel-sunbed-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for Towel on the Sunbed. Category Web, difficulty Medium, 90 points. Ponzi found the resort's wellness portal running a little side project called Ponzi, a crypto rewards poolside edition. He set his towel down, claimed his daily reward, and went to reapply sunscreen. He came back to find the sunbed had been claimed three times over while he wasn't looking. He's convinced the app owes him a spot in the Whale Vault. The app disagrees, politely, once every 24 hours. Somewhere between his request and the server's clock there's a gap wide enough to walk a whale through. Itinerary: create a guest account and explore the daily reward mechanism, work out standing versus Whale Vault status, and retrieve the flag from the vault. Below it, a note from 0xMia: the ponzi guy has been refreshing his dashboard for an HOUR waiting on this timer, bro really thinks the clock is the only thing checking him.">
  <figcaption>The briefing for Towel on the Sunbed. Read it as a spec and the exploit is already written down: "claimed three times over" is a double spend, and "a gap wide enough to walk a whale through" between his request and the server's clock is the race window. Even the flavour joke, 0xMia mocking a guy who "thinks the clock is the only thing checking him," is telling you the only guard is a beatable timer.</figcaption>
</figure>

Every room in this Hacker Holidays event hides the vulnerability in holiday language, but
this is the first one where the briefing basically handed me the whole exploit in plain
English, if I knew how to read it. That's the thing I want to lead with, because learning
to translate the themed flavour text into "this is a race condition" was more useful than
any single click I made. The actual winning move came down to one menu item in Burp Suite,
and getting that wrong is what turned a five minute box into a much longer afternoon.

It's a TryHackMe Medium in the Byte Lotus universe, this time a crypto rewards portal
called "Ponzi, Wellness Rewards" on port 3000. Standard disclaimer, this is a deliberately
vulnerable lab built to be broken for practice, nothing here is a real service, and the
"crypto" is fake internet points called PONZI.

*One note before you read on. There's one grey bar like <span class="spoiler">this</span>
further down, covering the single Burp setting that actually wins the race. I explain the
whole idea around it in the open, then cover just the literal answer so you can try to
name it yourself before you peek. Click it (or tab to it and press Enter) to reveal.
Hints, not answers off the rip.*

## Reading the briefing as a spec

Before any tooling, here's the briefing translated line by line, because this is the
transferable skill:

- **"the sunbed had been claimed three times over while he wasn't looking"** is a
  **double spend**. One one-time action succeeding several times. That's the goal.
- **"once every 24 hours. Somewhere between his request and the server's clock, there's a
  gap wide enough to walk a whale through"** is a **race condition**, specifically a
  time-of-check-to-time-of-use (TOCTOU) gap. There's a window between the server checking
  the timer and the server updating it.
- **0xMia's story, "refreshing his dashboard for an HOUR... really thinks the clock is the
  only thing checking him"** is the box mocking anyone who waits passively. It's telling
  you the timer is the only guard, and that refreshing achieves nothing.

So before I'd fired a single request I already suspected the whole box was: beat the 24
hour claim limit by racing it, stack enough coins to pass the vault gate, read the flag.
That turned out to be exactly it.

## Recon and the vault economy

Full scan first:

```bash
sudo nmap -sC -sV -A <TARGET_IP>
```

Two ports, one of them the app:

```
22/tcp   open  ssh   OpenSSH 9.6p1 Ubuntu
3000/tcp open  http  Node.js Express framework
|_http-title: Ponzi Portfolio - Login
```

Node/Express on 3000, and the login lives at `/auth/login`. Directory busting the app:

```bash
gobuster dir -u http://<TARGET_IP>:3000 \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
```

```
/dashboard   (Status: 401)
/vault       (Status: 401)
/css /js     (Status: 301)
```

`/dashboard` and `/vault` both exist but return 401 with no session. So there's a members
area and, more interestingly, a `/vault` worth gating. Honest confession here: out of pure
habit I actually started typing up a `users.txt` list of likely usernames to go brute
force the login, before I stopped, reread the briefing, and reminded myself this is a race
condition room, not a credential room. Old instincts. The briefing had already told me
where to look, I just needed to trust it.

<figure class="figure-narrow">
  <img src="{{ '/assets/img/towel-sunbed-login.png' | relative_url }}" alt="The Ponzi Portfolio login page. A dark themed card with a gold bank icon, the heading 'Ponzi Portfolio', the tagline 'Stack your bags. Claim your yield.', a username field, a password field, a gold Sign In button, and a line reading 'No account? Register'.">
  <figcaption>The Ponzi Portfolio login. The "Register" link is the whole point of entry: I don't need anyone's credentials, I can just make my own guest account, and as it turns out I'll need to make a few fresh ones.</figcaption>
</figure>

There's a "Register" link, so I made my own guest account instead of attacking the login.
Signed in, the dashboard laid out the economy plainly:

- Balance starts at **50 PONZI**, tier **SHRIMP**.
- A **Claim Reward** button gives **+50 PONZI**, but only **once every 24 hours**
  (it fires `POST /claim`).
- The **Whale Vault** unlocks at **150 PONZI**, and the vault reward is the flag.
- `GET /vault` returns **403** once you're logged in but under the threshold (and 401 with
  no session at all). The check is server-side. There's no client-side toggle to flip, no
  hidden field, no "isWhale=true" cookie. You genuinely have to get the balance to 150.

So the maths is simple and the intent is obvious. Start at 50, one honest claim gets you to
100, and then the timer locks you out for 24 hours, one claim short of the 150 you need.
The only way to 150 without waiting is to make that single claim pay out more than once.
Which is exactly what the briefing promised.

## What a race condition actually is

Quick beginner explainer, because this clicked properly for me on this box. The claim
endpoint does something like this, in order:

```
1. check: has 24 hours passed since this user's last claim?   (read the timestamp)
2.        [ ...a tiny gap in time... ]
3. act:   grant +50 PONZI and update last_claim to "now"       (write the timestamp)
```

The bug is that step 1 and step 3 are not atomic, there's a real gap between reading the
timer and writing it. Normally you never notice, because your requests arrive one after
another: request A reads, grants, writes, and only then does request B read and get
rejected. But if you can get many requests to land in that gap **at the same time**, every
one of them runs step 1 before any of them has run step 3. They all see "yes, 24 hours has
passed, this user is eligible," because none of them has written the new timestamp yet. So
they all grant the reward. One eligibility window, cashed in twenty times over. That is the
"claimed three times over" from the briefing, and it's a classic time-of-check-to-time-of-use
flaw.

The hard part is the "at the same time." Human timing is in milliseconds to seconds. The
gap here is microseconds. You cannot click a button fast enough, and you can't even release
intercepted requests by hand fast enough. You need the requests to arrive within
microseconds of each other, and that needs a specific tool.

## The exploit: Burp's single-packet attack

Burp Suite has a feature built for exactly this, and it's almost embarrassingly little
work once you know the technique:

1. Register a **fresh** account whose 24 hour timer has never been touched (this matters, a
   lot, see the gotchas).
2. In the browser, log in as that account, and make one normal `POST /claim` so Burp
   captures the request in its proxy history. Actually, capture it **without** letting it
   complete if you can, but the clean way is to grab the raw request and cancel, because
   you want the very first claim to be part of the volley, not before it. More on that
   below too.
3. Send that `POST /claim` to **Repeater**.
4. Duplicate the Repeater tab about **25 times** so you have 25 identical claim requests,
   and add them all to a Repeater **tab group**.
5. Send the whole group with the parallel option. This is Burp's **single-packet attack**:
   it holds back the final synchronising bytes of all 25 requests and then releases them
   together, so all 25 arrive at the server within microseconds. Tight enough that they all
   pile into the check-then-act gap at once.

The result was immediate and honestly quite satisfying. The balance didn't tick up by 50,
it leapt straight past 150 in a single volley, a whole stack of `+50`s from one eligibility
window. The tier flipped off SHRIMP, the Whale Vault gate opened, and `GET /vault` stopped
returning 403 and returned the reward:

```
GET /vault  ->  200
# flag: THM{[redacted]}
```

I'm redacting it like always (TryHackMe's rules ask you not to publish flags), but I'll
say the flag text itself is the punchline: it literally spells out "double spent," which is
exactly what a claim race is. A one-time payout, spent more than once.

## The gotchas, which are the actual value of this box

The exploit above reads clean, but I did not get it on the first try, and the mistakes are
where the real learning was. If you take one thing from this writeup, take this section.

**Sequential versus parallel is the entire game.** When you send a Repeater group, Burp
gives you two options, and they look almost the same in the menu. One of them sends the
requests one at a time down separate connections. The other releases them together. My
first attempt used the sequential one, "Send group in sequence (separate connections)," and
it failed exactly the way a patched server would: the first claim landed, set the timer,
and the other 24 were all correctly rejected. Net result +50, no race, and for a minute I
thought the box just wasn't vulnerable. It absolutely was. I'd just delivered the requests
in a way that gave the server time to write the timestamp between each one, which is the one
thing you must not do. The setting that actually wins, the one that fires them together:

<span class="spoiler"><code>Send group in parallel (single-packet attack)</code></span>

That single menu choice is the difference between total failure and the flag. I cannot
stress enough how small the visible difference is and how total the difference in outcome
is. When a race "fires but only one wins," suspect your delivery method before you conclude
the target is safe.

**Account state matters just as much.** A race on the claim endpoint only works while the
account is actually eligible. The moment any single claim lands, that account's 24 hour
timer is set, and no amount of perfect parallelism will help it, every future request just
fails the check honestly. So the parallel volley has to be that account's very **first**
claim, fired into a timer that's still at zero. I learned this the annoying way by burning a
couple of accounts: I'd registered, clicked claim once to "test" it, and thereby locked the
account out before I ever raced it. The fix was to register a completely fresh account (I
ended up on one I called `ddd`) and make sure the parallel group was the first thing that
account ever did to `/claim`. Fresh, eligible, untouched timer, then the volley.

**Don't fall for the refresh trap.** The briefing openly mocks the guy refreshing his
dashboard for an hour, and it's a genuine hint. Hammering `GET /dashboard/api/me` or
reloading the page does nothing, it just reads your balance, it never grants anything. The
action that pays out is `POST /claim`, and the only thing worth racing is that. Passive
noise on read-only endpoints is wasted effort.

## How to actually fix this box

The fix for a race condition is to make the check and the update **atomic**, so there's no
gap to squeeze into. Instead of "read the timestamp, decide, later write the timestamp,"
you do it in one indivisible database operation, for example an update guarded by a
condition:

```sql
UPDATE users
SET balance = balance + 50, last_claim = NOW()
WHERE id = :user AND last_claim < NOW() - INTERVAL '24 hours';
```

That statement only touches the row if the 24 hour condition is still true at the instant it
runs, and the database guarantees two of these can't both succeed on the same row at once.
You then grant the reward only if the update actually affected a row. A row lock or a proper
transaction gets you the same guarantee. The bug was never the timer value, it was reading
and writing it as two separate steps with daylight in between.

## Reflection

This felt like a fair Medium, and a really instructive one. The vulnerability itself is a
single well-known class, but the box tests whether you can actually pull it off, and pulling
it off hinges on two unglamorous details: choosing parallel over sequential, and racing a
fresh eligible account. Neither is a clever payload. Both are the kind of thing you only get
right once you understand precisely what's happening under the hood, which is why fumbling
them and having to reason out why the race "half worked" was the most valuable part.

## What I took away

- **Themed briefings are often the exploit in plain English.** "Claimed three times over"
  and "a gap between his request and the server's clock" was a double spend via a race
  condition, spelled out. Learn to translate the flavour text.
- **A race condition is a check and an act with a gap between them.** Land many requests in
  that gap and they all pass the check before any of them commits the act.
- **The single-packet attack is how you hit microsecond timing.** Human clicks and manual
  intercept-release are far too slow. Let Burp release the requests together.
- **Sequence versus parallel is the make-or-break toggle in Burp.** Sequential gives the
  server time to update between requests and your race quietly fails. Parallel wins.
- **Race a fresh, eligible account.** Once one claim sets the timer, that account is done.
  The volley must be its first claim.
- **When a race half works, suspect your delivery and your account state** before you decide
  the target isn't vulnerable. That diagnosis was the real Medium-level skill here.

> Room: Towel on the Sunbed on TryHackMe (Hacker Holidays 2026), Web, Medium, 90 points.
> Flag left out as always, though its text is a punchline about double spending worth
> earning yourself. One race, one menu item, one afternoon of learning why "at the same
> time" is harder than it sounds.
