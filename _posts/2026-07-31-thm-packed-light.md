---
layout: post
title: "THM: Packed Light"
date: 2026-07-31 18:00:00
category: "Digital Forensics"
difficulty: "Easy"
tags: [thm, hacker-holidays, forensics, wireshark, pcap, base64, xor, cyberchef, cryptography]
excerpt: "No box to attack this time, just a packet capture and a flag that was smuggled out one HTTP cookie at a time. Thirty fragments hidden in a session cookie, base64 on the outside, a single-byte XOR underneath, and one mistake of mine that made a simple cipher look far scarier than it was."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/packed-light-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for Packed Light. Category Forensics, difficulty Easy, 60 points. Tiny packets at odd hours, suspiciously regular, smuggling out the data equivalent of a hotel towel folded neatly inside ordinary traffic. A capture from the guest network is provided. The story tag notes a laptop pinging a random 8080 address every few seconds, with request headers that look off and a crypto layer on top.">
  <figcaption>The briefing lays out the whole room in flavour text: regular little packets hiding data inside ordinary-looking traffic, a beacon on port 8080, something odd in the HTTP headers, and a crypto layer to peel. That's the map for the entire solve.</figcaption>
</figure>

This is a network forensics room, so it breaks the usual pattern for this event.
There's no IP to scan and no shell to catch. Instead you're handed a single packet
capture, `traffic.pcapng`, and the whole job is to reconstruct something that was
smuggled out of a network by reading what the packets were carrying. It's part of
TryHackMe's Hacker Holidays 2026 event, filed under forensics and crypto, marked
Easy, and it stays in the Byte Lotus universe (the flag, when it finally drops, is
a little wink from the resort's ever-watching concierge). As always, this is a
deliberately built lab, the capture and everything in it are synthetic.

The framing is that some data was exfiltrated, and the brief drops a few hints in its
usual not-so-subtle way: something is beaconing on port 8080, the interesting stuff is
in the HTTP headers, and there's a "crypto" layer sitting on top of it. That's three
things to hold onto: HTTP, headers specifically, and at least one layer of encoding or
encryption to peel. Which turns out to be a decent map for the whole room.

## Opening the capture

First move is just to load the pcap into Wireshark and get a feel for the traffic:

```bash
wireshark traffic.pcapng
```

There's a lot of noise, as there always is, so the skill here is filtering down to the
part that matters rather than scrolling through thousands of packets by hand. The brief
already told me it was HTTP and that the headers were the point, so that's where I aimed.

## Finding the smuggled data

Exfiltration over HTTP loves to hide in places that look boring and legitimate, and one
of the most classic spots is a cookie. A cookie goes out on nearly every request, nobody
looks at it twice, and you can stuff arbitrary data into it. So I went hunting through the
request headers for a cookie that didn't look like a normal session token, and there it
was: a cookie called `hotel_sess_state` that was carrying the actual payload. Very on-theme
for a hotel box, and exactly the kind of innocuous name that's designed to not get a second
glance.

Once I knew the field, I could narrow Wireshark down to just the requests that carried it:

```
http.request && http contains "hotel_sess_state"
```

The trick that made this manageable was Wireshark's "Apply as Column" feature. Right-click
the cookie value in the packet detail, apply it as a column, and now every relevant packet
shows its fragment in a neat vertical list instead of you having to click into each one. The
data wasn't sent in one shot, it was broken into pieces and dribbled out across many requests,
which is exactly how real slow-exfil works, so it stays under the radar. I counted thirty
fragments in total.

The one thing you absolutely cannot get wrong here is order. The fragments have to be
reassembled in the sequence they were sent, because it's a stream that was chopped up. Wireshark
shows packets in time order by default, so as long as I read them top to bottom and didn't
re-sort, the ordering took care of itself. I harvested all thirty fragments in that time order
and concatenated them into one long string.

## Peeling the layers

Now for the "crypto" layer the brief promised. What I had was a big blob of text, and the
first tell was the `==` on the end. Trailing `=` (or `==`) is the padding base64 uses, so this
was almost certainly base64 on the outside. Decoding base64 gave me back raw bytes rather than
clean text, though, which is the sign that there's another layer underneath. Base64 is an
encoding, not encryption, so getting bytes-that-aren't-text out of it means something else was
applied before it was encoded.

The second layer was a single-byte XOR. XOR with one repeating byte is one of the most common
"lightweight obfuscation" tricks there is, and the nice thing about it is that if you know or can
guess any part of the plaintext, it falls over immediately. And I did know part of the plaintext:
every TryHackMe flag starts with `THM`. That's a crib, a known chunk of expected output you can
test a key against. In this case the key turned out to be a single byte, `0x48`, which is the
ASCII letter `H`. XOR the decoded bytes against `0x48` and out came the flag:

```
THM{[redacted]}
```

Redacted as always, the value isn't the point, the path is.

## The mistake that cost me the most time

I want to be honest about the part that actually slowed me down, because it's a genuinely
useful lesson and I'll hit it again if I'm not careful.

The tool I reached for on the decode side was CyberChef, which lets you chain operations into a
"recipe." My first recipe was just `From Base64` then an `XOR Brute Force`, and it produced
garbage. Not "wrong key" garbage either, it looked like the cipher was multi-byte, like a single
XOR key couldn't possibly explain the output. I nearly went off down a rabbit hole convinced I
was dealing with something more complicated than I was.

The actual problem was that my concatenated blob still had newlines in it from how I'd pulled the
fragments together. Base64 does not tolerate stray newlines and whitespace in the middle of its
input, it treats them as invalid and the decode comes out corrupted. So `From Base64` was already
producing junk before XOR ever got a look in, and that junk is what made a clean single-byte XOR
look like a scrambled mess. The fix was to strip the newlines first. In CyberChef terms, the recipe
that worked was:

```
Find / Replace (\n with nothing)  ->  From Base64  ->  XOR Brute Force (crib: THM)
```

Clean the input, then decode, then break the cipher. The moment I put a Find/Replace to kill the
newlines at the front of the recipe, the base64 decoded cleanly and the XOR brute force found
`0x48` in about a second, with the `THM` crib confirming it.

The lesson, which I've written on the metaphorical sticky note: **clean your data before you decode
it.** Garbage in genuinely does mean garbage out here, and worse, the garbage can disguise itself as
a harder problem than you actually have. If a decode step is producing nonsense, suspect your input
is dirty before you assume the algorithm is complicated.

## What I took away

- **Cookies are a classic exfil channel.** A boring-looking header like `hotel_sess_state` that
  rides along on every request is exactly where smuggled data likes to hide. When you're told to
  look at HTTP headers, the cookies are prime real estate.
- **"Apply as Column" in Wireshark is a superpower** for this kind of work. It turns "click into a
  hundred packets" into "read one tidy list," and it keeps the time ordering for you.
- **Order matters when you reassemble a stream.** Keep the fragments in the sequence they were
  captured, don't re-sort, or you'll reconstruct nonsense even with the right decode.
- **Read the layers from the outside in.** The `==` padding said base64; base64 giving back raw
  bytes said there's another layer under it; a crib (`THM`) cracked the single-byte XOR. Peel one
  layer at a time and let each result tell you what's next.
- **Clean before you decode.** Stray newlines broke my base64 and made a trivial XOR look like a
  monster. When a decode misbehaves, sanitise the input first.

This was my first proper network forensics room and it felt completely different to the boxes I've
been doing, more like patient reading than attacking. But the core habit is the same one that keeps
coming up: slow down, check the boring explanation first (dirty input, wrong ordering) before you
convince yourself the problem is exotic.

> Room: Packed Light on TryHackMe (Hacker Holidays 2026), Network Forensics / Cryptography, Easy.
> Flag left out on purpose. A great little room for getting comfortable with Wireshark filters and
> CyberChef recipe ordering if, like me, you're newer to the forensics side.
