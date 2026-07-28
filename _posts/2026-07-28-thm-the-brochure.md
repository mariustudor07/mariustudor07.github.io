---
layout: post
title: "THM: The Brochure"
date: 2026-07-28
category: "OSINT"
difficulty: "Easy"
tags: [thm, hacker-holidays, osint, instagram, base64, cyberchef]
excerpt: "A single hotel brochure, one line telling me to find them on Instagram, and a follower trail that ends at a concierge posting a flag three fragments at a time. No tools really, just reading what's in front of me and following who follows who."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/the-brochure.jpg' | relative_url }}" alt="Byte Lotus Resorts brochure: a luxury hotel at sunset, with a concierge named VERA and a line telling you to find them on Instagram.">
  <figcaption>The whole room. Everything you need is printed on it.</figcaption>
</figure>

The whole room is one image. A glossy brochure for a made-up luxury hotel called
**Byte Lotus Resorts**, and a couple of task questions. That's the warm-up room
for TryHackMe's Hacker Holidays event, and the point of it is to get you thinking
like an OSINT investigator: the answer isn't hidden in the file, it's hidden in
plain sight in what the file is *pointing at*.

I'll be honest, my first instinct was wrong, and I think that's worth writing
down because it's the more useful lesson than the solve itself.

<figure>
  <img src="{{ '/assets/img/brochure-recon.jpg' | relative_url }}" alt="Room storyline comic: a hooded figure researching the Byte Lotus hotel online before arriving, finding suspiciously glowing reviews.">
  <figcaption>The room's own framing: you're just doing your pre-booking homework. The hotel is already saying more than it means to.</figcaption>
</figure>

## First instinct: treat it like a stego challenge

I saw an image, so I did what I always do with a CTF image. Ran it through the
usual pipeline:

```bash
exiftool thebrochure.png
strings -n 6 thebrochure.png | grep -iE 'flag|http|base64|secret'
binwalk thebrochure.png
```

Nothing. The EXIF is just standard PNG fields (dimensions, gamma, sRGB), no
comment field, no GPS, no author. `strings` is all compressed-image noise.
`binwalk` finds no appended archive. There's no hidden data in the file.

That's actually the room teaching you a lesson: **OSINT isn't stego.** The clue
was never going to be baked into the bytes. It was in the words printed on the
brochure, which I'd skimmed past on my way to the "real" tools.

## Reading the brochure properly

Once I stopped treating the image as a container and started treating it as a
document, the leads were right there on the page:

- The hotel name: **Byte Lotus Resorts**
- A concierge named **VERA** ("CONCIERGE: VERA can assist you with further
  information")
- And the line that matters: *"Some things aren't posted. Some clues are. Find
  us on Instagram... or not."*
- Plus the footer: *"LUXURY. SIGNALS. SECRETS. Some stays leave a signal."*

That's not decoration. It's the objective written out. Go to Instagram, find the
hotel, and expect the trail to continue somewhere the hotel itself doesn't
advertise ("...or not").

## Following the trail on Instagram

Searched Instagram for the resort and found the account:

```
@thebytelotusresort
```

Two posts (the brochure itself and a plain sunset shot), and nothing useful in
the captions. On a normal profile you'd stop here, but the brochure told me the
clue lives one hop away, so the useful move on an account this empty is to look
at the numbers up top: **2 posts, 374 followers, and 1 following.** Following
exactly one account is the tell. A brand that follows a single thing is basically
leaving an arrow.

<figure>
  <img src="{{ '/assets/img/brochure-ig-resort.jpg' | relative_url }}" alt="Instagram profile for @thebytelotusresort showing 2 posts, 374 followers, and 1 following.">
  <figcaption>@thebytelotusresort: two posts, and following exactly one account. That "1 following" is the whole pivot.</figcaption>
</figure>

Open that one follow and it's the concierge:

```
@veratheconcierge
```

Same VERA from the brochure. That name being consistent across the brochure and
the follow list is the confirmation you're on the right path and not just chasing
a random lookalike account.

## The flag, in pieces

VERA's profile has three public posts. Each one is the same sunset image with a
chunk of text laid over it, and each chunk is a fragment of what's very obviously
a Base64 string (the character set gives it away, and the fragments only make
sense joined up).

<figure>
  <img src="{{ '/assets/img/brochure-ig-vera.jpg' | relative_url }}" alt="Instagram profile for @veratheconcierge showing three sunset posts, each with a Base64 fragment overlaid (redacted here).">
  <figcaption>@veratheconcierge, three posts, each carrying a slice of the Base64 string. I've blanked the text; that's the flag, and the room's rules (and mine) say you go and decode it yourself.</figcaption>
</figure>

The gotcha is order. The posts show newest-first on the grid, so you have to work
out the correct sequence and stitch the three fragments back together into one
string rather than just concatenating them top to bottom. Once you've got the
full string, it's a straight Base64 decode. I used CyberChef because it's quick,
but `base64 -d` does the same job:

```bash
echo 'PASTE_THE_FULL_STRING_HERE' | base64 -d
```

Out comes the flag. Drop it in the answer box and the room's done.

## Takeaways

- **Reach for the right discipline first.** An image in an OSINT room is a
  document, not a container. I burned time on exiftool/binwalk out of habit when
  the answer was printed on the brochure in plain English.
- **Read the flavour text as instructions.** "Find us on Instagram... or not"
  and "some stays leave a signal" aren't set dressing, they're literally the
  method. Room authors hide the walkthrough in the theme.
- **Follows and following lists are gold.** An empty account that follows one
  thing is pointing at that thing. The whole pivot from the resort to VERA was
  just checking a following list.
- **Watch the ordering when data is split across posts.** Instagram grids are
  newest-first, so three fragments across three posts need reassembling in the
  right order before any decode will work. Base64 that decodes to garbage usually
  means the pieces are in the wrong sequence, not that you've got the wrong data.

> Room: [The Brochure](https://tryhackme.com/room/hh-thebrochure-081f3e36) on
> TryHackMe (Hacker Holidays). The accounts and the encoded string are part of
> the room's setup; I've left the actual flag out so you get to walk the trail
> yourself.
