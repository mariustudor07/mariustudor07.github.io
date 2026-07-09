---
layout: post
title: "Completing the Web Security Academy — Apprentice Path"
date: 2026-07-09
category: "Web Exploitation"
tags: [portswigger, burp, web-security-academy]
excerpt: "Working through every apprentice-level lab in PortSwigger's Web Security Academy with Burp Suite — the vulnerability classes I covered and what actually stuck."
---

I finished the **Apprentice** path in PortSwigger's Web Security Academy — every
apprentice-level lab across the syllabus. My tool the whole way through was
**Burp Suite**: intercept, tamper, repeat. This is a rundown of what the path
covered and the lessons that actually stuck.

## The workflow

Almost every lab came down to the same loop with Burp in the middle:

1. **Proxy** the traffic and read what the browser is really sending.
2. **Repeater** to replay and mutate a single request until it breaks.
3. **Intruder** when I needed to fuzz a parameter or brute a small set.

Getting fast in Repeater was the single biggest force multiplier — most labs are
one well-crafted request away from solved.

## What the path covered

| Area | What clicked |
|------|--------------|
| **SQL injection** | Auth bypass with `' OR 1=1--`, and reading data by understanding the query I was breaking into. |
| **XSS** | Reflected vs. stored — the payload is easy, *finding the sink and context* is the real skill. |
| **Access control** | IDORs and unprotected admin functions: the server trusting the client to stay in its lane. |
| **Authentication** | Username enumeration via response/timing differences, then brute-forcing the weak spot. |
| **Path traversal** | `../../../etc/passwd` and the filters that pretend to stop it. |
| **OS command injection** | Chaining shell metacharacters where user input hits a system call. |
| **CSRF** | Forging state-changing requests when there's no unpredictable token. |
| **Business logic** | The bugs that aren't a payload at all — just using the app in a way the developer never tested. |
| **Information disclosure** | Error messages, comments, and backup files leaking exactly what you need next. |

## The lessons that stuck

- **Never trust the client.** Nearly every category is really the same root cause:
  the server assuming the browser played fair. It didn't.
- **Read the response, not just the request.** Half the wins came from noticing a
  status code, a timing difference, or a leaked field I wasn't supposed to see.
- **Understand the vuln before the payload.** Copy-pasting `' OR 1=1--` solves one
  lab; understanding *why* it works solves the next fifty.
- **Context is everything in XSS.** The same string is inert in one place and code
  execution in another.

## Where I'm going next

The apprentice path is the foundation — I'm moving into the **Practitioner** labs
next, where the same classes get real filters and defences layered on top. I'm
also planning to run the same track through **Caido** to compare the workflow
against Burp, but that's a writeup for further down the line.

> Only ever test targets you're authorised to — the Web Security Academy's own
> labs, your own apps, or a scoped engagement. Never a live site you don't own.
