---
layout: post
title: "THM: Overheard at Breakfast"
date: 2026-08-02
category: "OSINT"
difficulty: "Easy"
tags: [thm, hacker-holidays, osint, gravatar, email-hash, cyberchef, base64, social-media]
excerpt: "A screenshot of a breakfast-table chat, a free profile tool that starts with a G, and an email that turns out to be the whole key. The lesson that stuck: your email hash follows you around, so anyone with your address can find the Gravatar profile you thought you'd wiped."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/overheard-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for Overheard at Breakfast. Category OSINT, difficulty Easy, 60 points. A guest at a loud breakfast terrace overhears more of a conversation than they were meant to, grabs a screenshot before it disappears, and the itinerary is to analyse the conversation, extract the clues, locate the hidden account, and submit the flag.">
  <figcaption>The briefing tells you the shape of the whole room, as this event always does. There's a conversation, it contains enough to track down an account nobody was supposed to find, and the story tag spells out the real hint: "you actually need to READ what they said, not just skim it."</figcaption>
</figure>

After yesterday's box I needed this one. The day before was Beach Bar, a Boot2Root
that fought me for about ninety minutes, and almost none of that fight was the actual
hacking. It was VPN plumbing, a listener I kept killing, and a firewall on my own
laptop quietly eating my reverse shells. So sitting down to an OSINT room with zero
infrastructure, no VPN, no shell, no tooling to babysit, just a puzzle to read, was
genuinely a relief. And it's worth saying up front, because it's a lesson in itself:
a challenge feeling smooth or painful often has very little to do with how hard the
actual thinking is, and a lot to do with how much plumbing it drags along. This room
was pure puzzle and it was over quickly. Yesterday's was a simple exploit buried under
an hour of self-inflicted network problems.

It's part of TryHackMe's Hacker Holidays 2026 event, same Byte Lotus universe as the
rest, filed under OSINT and marked Easy. Standard disclaimer, this is a made-up
scenario with made-up people and a deliberately planted flag, nothing here is a real
person's data.

## The scenario: a chat you weren't meant to see

The entire brief is a single screenshot of a Discord-style chat between two people,
"Ponzi" and "Lambo." The room's whole trick is that everything you need is sitting in
that conversation, so the skill being tested is reading carefully rather than skimming.
The story tag even says it out loud, that you need to actually read what they said.

Lambo drops two things in the chat, and the room is built so that they look like two
separate details when they're really one:

- She mentions **a free tool that let her upload a profile and link her other media
  accounts, and it started with the letter "G"**. She also says she **wiped** it, which
  is the bit that's meant to make you think the trail is dead.
- She gives an email as her best point of contact: `lambobytelotushotel@gmail.com`.

On a skim these are just chatter. The room is that gap between "read" and "skim."

## Clue one: the tool that starts with G

A free profile that acts as a hub linking your other accounts, starts with a G. That's
**Gravatar**. It's the "globally recognized avatar" service, the thing that gives you
the same profile picture across a load of sites, and it also hosts a little public
profile page where you can list your linked social accounts. So far, so normal. The
harder part is what to do with it, because she said she wiped the profile.

## Clue two, and the actual insight: the email is the key

Here's the part that's genuinely worth learning, because it's a real privacy fact and
not just a CTF quirk. **Gravatar identifies profiles by a hash of the account's email
address.** Historically that's the MD5 of your email, lowercased and trimmed. When a
website shows your Gravatar, it doesn't send your email around, it hashes your email
and asks Gravatar for the picture belonging to that hash.

Once that clicks, the two clues collapse into one. The email in the chat isn't just a
way to contact Lambo, it's the lookup key for the Gravatar profile. The tool starting
with G and the email address are the same thread. You hash the email, and that hash is
the address of her profile. "Wiping" the profile's contents doesn't break the link
between the email, its hash, and the profile, so the page is still findable.

That connection is the whole difficulty of the room. There's nothing technical to
break. It's noticing that clue one and clue two are the same clue.

## Finding the profile

Looking up `lambobytelotushotel@gmail.com` through Gravatar resolved straight to a
profile at:

```
gravatar.com/cheerfullysongf28e3c3716
```

And there she was, a "Lambo / Byte Lotus Hotel" profile, right down to the little
crypto-bro avatar with the gold chain.

<figure>
  <img src="{{ '/assets/img/overheard-gravatar.png' | relative_url }}" alt="Gravatar profile page for Lambo, Byte Lotus Hotel, at gravatar.com/cheerfullysongf28e3c3716. The bio reads: Funny thing about email hashes, they follow you places you didn't expect. Glad you found the right corner of the internet, here is your prize, followed by a long base64 string.">
  <figcaption>The profile the email hash points to. The bio does the room's teaching for it: "Funny thing about email hashes, they follow you places you didn't expect." The prize is the base64 string underneath.</figcaption>
</figure>

## The prize, and a quick CyberChef decode

The bio came right out and told me what it was about, and then handed over the reward:

> Funny thing about email hashes, they follow you places you didn't expect. Glad you
> found the right corner of the internet! Here is your prize:

followed by a long string:

```
VEhNe1MzY3JlVF9Qcj...
```

That shape, all letters and numbers, mixed case, is textbook base64. I pasted it into
**CyberChef**, which auto-detected the encoding and suggested **From Base64**. One
click and it decoded to the flag:

```
THM{[redacted]}
```

Redacted as always. The value isn't the point, the path to it is.

## The lesson: your email hash follows you

The thing I want to keep from this room is a real-world privacy point, and the profile
bio said it better than I could. **An email hash follows you around.** Because Gravatar
keys profiles off the hash of your email, anyone who has your email address can compute
that hash and go looking for your Gravatar profile, and anything you linked on it. It's
a public-by-design lookup, that's the feature. The footgun is that people don't realise
their email, something they hand out freely, is effectively a permanent public
identifier for that profile.

And note what "wiped" did and didn't do. Clearing the profile's contents doesn't undo
the email-to-hash-to-profile link. The address is derived from the email, so as long as
the email exists and the profile exists, it's discoverable. If you genuinely want it
gone, you delete the profile, you don't just empty it.

There's a defensive habit in here too, which is that if you're doing OSINT on yourself,
checking what your own email resolves to on Gravatar is a five-second exercise that can
be quite sobering. And if you're the one building things, remember that hashing an
identifier is not the same as hiding it, MD5 of a known email is trivially
reproducible.

## What I took away

- **Read, don't skim.** The whole room lived in the gap between those two words. Two
  clues that looked separate were one clue, and only careful reading joins them.
- **Email hashes are an OSINT goldmine.** Gravatar publishes a profile keyed to the
  hash of an email, so an email address doubles as a way to find someone's linked
  accounts. That's a genuine privacy consideration, not just a puzzle.
- **Hashing is not hiding.** MD5 of a lowercased email is reproducible by anyone. If a
  system treats "we hashed it" as "it's private," it's wrong.
- **Smooth versus painful is often about plumbing, not difficulty.** This room was
  trivial to run and quick to solve. Yesterday's box was a simple exploit smothered in
  an hour of VPN and firewall pain. The friction lives in the infrastructure, not
  always in the hack.

A short, satisfying one, and a nice palate cleanser after a Boot2Root that mostly
taught me about my own laptop. Sometimes the whole challenge is just noticing that two
things you were told are actually the same thing.

> Room: Overheard at Breakfast on TryHackMe (Hacker Holidays 2026), OSINT, Easy, 60
> points. Flag left out on purpose. If you want a clean example of why an email address
> is more identifying than it looks, this is a good one.
