---
layout: post
title: "HTB Writeup Template (retired boxes)"
date: 2026-06-28
category: "HTB Writeups"
difficulty: "Easy"
tags: [linux, web, privesc]
excerpt: "A skeleton I copy for each retired Hack The Box machine: recon, enumeration, foothold, privesc, takeaways."
---

> This is my template, not a real solve. I copy this file, rename it, and replace
> the placeholders with my own work on a **retired** box or finished competition.

## Recon

Start with a full port scan and note what's exposed.

```bash
nmap -p- --min-rate 5000 -oA all-ports 10.10.10.10
nmap -sC -sV -p 22,80 -oA detail 10.10.10.10
```

| Port | Service | Version |
|------|---------|---------|
| 22   | SSH     | OpenSSH 8.2p1 |
| 80   | HTTP    | nginx 1.18.0 |

## Enumeration

What I found poking at each service: directory busting, source review, default creds.

```bash
ffuf -u http://10.10.10.10/FUZZ -w /usr/share/wordlists/dirb/common.txt
```

> The one detail that unlocked the box: `/backup` was listable and contained a
> `.git` folder that leaked credentials in an old commit.

## Foothold

The initial exploit and how I turned it into a shell.

```bash
git log -p | grep -i password
ssh user@10.10.10.10
cat ~/user.txt
```

## Privilege Escalation

From user to root.

```bash
sudo -l
# (ALL) NOPASSWD: /usr/bin/some-binary
some-binary --exploit
id   # uid=0(root)
```

## Takeaways

- What was the intended path, and did I find it?
- Where did I waste time, and what would I check sooner next time?
- One technique worth remembering for the next box.

## Note to self: hiding answers behind spoiler bars

When I want to show the methodology but not hand over the exact payload off the rip,
I hide the "answer" command behind a click-to-reveal bar. Reader gets the reasoning,
then clicks to see the actual string. Like <span class="spoiler">this</span>.

Usage, in prose only (NOT inside a ``` fenced code block, the HTML renders literally
in there and won't hide anything):

`The body that logged me in was <span class="spoiler"><code>username=x&amp;password[$ne]=null</code></span>.`

Rules I keep tripping over:
- Wrap the value in `<code>` inside the span if I want it monospaced.
- HTML-escape special characters or they break the markup: `<` becomes `&lt;`,
  `>` becomes `&gt;`, `&` becomes `&amp;`. So an EJS payload like `<%= 7*7 %>`
  is written `&lt;%= 7*7 %&gt;` inside the span.
- Keep the recon and standard commands shown normally in code fences. Only cover the
  lines that actually pop the box (final payloads, decoded flags, reused creds).
- Add a one-line heads-up near the top of the post telling readers the grey bars are
  click-to-reveal, so they know it's deliberate.

Styling is in `assets/style.css` (`.spoiler`) and the click/keyboard wiring is in
`assets/reveal.js`, both already loaded site-wide, so nothing extra to import per post.
