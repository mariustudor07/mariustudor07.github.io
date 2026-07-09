---
layout: post
title: "Completing PortSwigger's Server-Side Vulnerabilities Path (Apprentice)"
date: 2026-07-09
category: "Web Exploitation"
tags: [portswigger, burp, web-security-academy]
excerpt: "I finished all 52 steps of PortSwigger's Apprentice 'Server-side vulnerabilities' path with Burp. Here's what it covers and what actually stuck."
---

I just finished the Apprentice "Server-side vulnerabilities" learning path in
PortSwigger's Web Security Academy. That's all 52 steps, front to back. My tool
the whole way through was Burp Suite: intercept, tamper, repeat. Here's a rundown
of what the path covers and the lessons that actually stuck.

## The workflow

Almost every lab came down to the same loop, with Burp sitting in the middle:

1. Proxy the traffic and read what the browser is really sending.
2. Repeater to replay and mutate a single request until it breaks.
3. Intruder when I needed to fuzz a parameter or brute a small set.

Getting fast in Repeater made the biggest difference by far. Most labs are one
well-crafted request away from being solved.

## What the path covers

It's all server-side, so these are bugs in what the application does with your
input after it reaches the server:

| Area | What clicked |
|------|--------------|
| Path traversal | `../../../etc/passwd`, and the lazy filters that pretend to stop it. |
| SQL injection | Auth bypass with `' OR 1=1--`, then reading data once I understood the query I was breaking into. |
| Authentication | Username enumeration from response and timing differences, then brute-forcing the weak spot. |
| OS command injection | Chaining shell metacharacters where user input reaches a system call. |
| Access control | IDORs and unprotected admin functions, where the server just trusts the client to stay in its lane. |
| Information disclosure | Error messages, comments, and backup files leaking exactly what you need next. |
| Business logic | The bugs that aren't a payload at all. You just use the app in a way the developer never tested. |
| File upload, SSRF, XXE | Getting the server to fetch, parse, or run something it never should have. |

## The lessons that stuck

- Never trust the client. Nearly every category comes back to the same root
  cause: the server assumed the browser played fair. It didn't.
- Read the response, not just the request. Half my wins came from noticing a
  status code, a timing difference, or a leaked field I wasn't meant to see.
- Understand the bug before the payload. Pasting `' OR 1=1--` solves one lab.
  Understanding why it works solves the next fifty.
- The server is the trust boundary. Everything in this path lives on the far side
  of it, which is exactly why client-side checks never count for anything.

## Where I'm going next

Server-side apprentice is the foundation. Next up is the client-side path (XSS,
CSRF and friends), then the Practitioner labs, where these same classes get real
filters and defences layered on top. At some point I also want to run a track
through Caido to compare the workflow against Burp, but that's a writeup for
another day.

> Only ever test targets you're allowed to: the Web Security Academy's own labs,
> your own apps, or a scoped engagement. Never a live site you don't own.
