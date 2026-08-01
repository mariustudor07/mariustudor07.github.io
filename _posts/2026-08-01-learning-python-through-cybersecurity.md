---
layout: post
title: "Learning Python Through Cybersecurity"
date: 2026-08-01 20:00:00
category: "Learning"
difficulty: "Beginner"
tags: [python, learning, beginners, cybersecurity, ai-assisted]
excerpt: "How I finally learned Python by building five small cybersecurity tools instead of reading documentation. A hash cracker, a cipher breaker, a log parser, a password checker, and a port mapper."
---

> A friend asked me what I used to learn Python. The honest answer isn't a
> course or a book. It's that I stopped trying to *learn Python* and started
> *building small security tools*, hitting real errors, and reasoning my way
> out of them. Five challenges took me from "Python feels childish" to actually
> being comfortable in it. This is what I built, what each one taught me, and
> the questions I asked an AI along the way to get unstuck without being handed
> the answers.

## Why this worked when reading docs didn't

I'd avoided Python for a long time. Coming from Kotlin, where I'd already
shipped an app to the Play Store, Python felt loose and almost *too* simple.
That simplicity turned out to be the entire point: it's lightweight, it's
everywhere, and in security it's the default language for tooling and glue.

The thing that made it stick wasn't documentation. Official docs are a
*reference*, written for people who already know the language. For learning,
they're the wrong tool. What worked was building things I actually cared about,
narrating my logic in plain English first, then translating it line by line,
and treating every error message as the lesson rather than a failure.

Each challenge below follows the same shape: **what I built**, **the method**,
**what I learned**, and **what I asked the AI**. I used the AI as a mentor that
nudged me toward the next idea instead of dumping solutions, which is the only
way any of it actually landed.

## Challenge 1: Hash cracker

**What I built:** a script that takes a SHA-256 hash and a wordlist, hashes
every word, and finds the one that matches.

```python
import hashlib

words = {"password", "letmein", "dragon", "monkey", "football"}
target = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"

for word in words:
    if hashlib.sha256(word.encode()).hexdigest() == target:
        print(word)
```

**What I learned:**

- A hash is **one-way**. You don't reverse it, you guess, hash the guess, and
  compare. That guess-and-compare loop is the entire engine behind offline
  password cracking (John the Ripper, Hashcat do exactly this, just billions of
  times a second on a GPU).
- **Strings vs bytes.** `hashlib` refuses a plain string, it works on raw
  bytes, so you have to `.encode()` the word first. The error
  `Strings must be encoded before hashing` taught me more than a chapter on
  encoding would have.
- A crack only works **if the answer is in the wordlist**. That's why
  `rockyou.txt` and wordlist quality matter.

**What I asked the AI:** *How would you make two identical passwords produce
different hashes?* I reasoned my way to **salting** before it named it. The
insight: append a **random, per-user** value before hashing (not PII like an
account ID, since a database breach dumps that in the next column). Unique salts
mean an attacker has to re-run their whole wordlist separately for every user
instead of once for everyone, and it's why you check whether a hash is *salted*
before deciding it's worth attacking.

## Challenge 2: Caesar cipher brute-forcer

**What I built:** given ciphertext, print all 25 possible shifts so the readable
one is obvious. Brute force is legitimate here because the keyspace is tiny.

```python
e = "Wkh iodj lv khoor zruog"

for j in range(1, 26):
    result = ""
    for i in e:
        if i.islower():
            result += chr((ord(i) - ord('a') + j) % 26 + ord('a'))
        elif i.isupper():
            result += chr((ord(i) - ord('A') + j) % 26 + ord('A'))
        else:
            result += i
    print(result)
```

Output line that mattered: `The flag is hello world`.

**What I learned:**

- `ord()` / `chr()` convert between a character and its ASCII number (Python's
  equivalent of casting in C#).
- **Modulo (`%`)** is the whole trick. `x % 26` can never be 26 or higher, it
  wraps, like a clock. That replaces messy manual `if n > 122: n -= 26` logic and
  handles *any* shift size in one step. The formula
  `(ord(c) - ord('a') + shift) % 26 + ord('a')` knocks the letter down to a
  0 to 25 position, shifts, wraps, and lifts it back to real ASCII.
- **Edge cases expose hidden assumptions.** My first version silently assumed
  every character was lowercase, so spaces and capitals came out as garbage. The
  fix was three branches: lowercase (base `'a'`), uppercase (base `'A'`), and
  leave non-letters alone with `isalpha()`.
- I fixed four separate bugs by **reading the output and reasoning backwards**,
  the same debugging loop you use on a box when a tool spits out something weird.

**What I asked the AI:** *Explain `%`, I skipped it because I didn't understand
it.* Genuinely understanding modulo unlocked not just this challenge but a
recurring pattern in crypto and reverse-engineering challenges (XOR/shift
obfuscation loves it). The security takeaway: Caesar is trivially broken
*because* it only has 25 keys. Real ciphers (AES, RSA) have keyspaces so vast
that "just try every key" would outlast the universe.

## Challenge 3: Log IP extractor

**What I built:** read a log, pull every IP with regex, and count occurrences to
surface the noisiest host, baby's-first threat detection.

```python
import re
from collections import Counter

log = """2026-07-28 10:14:22 Failed login from 192.168.1.55
2026-07-28 10:14:23 Failed login from 192.168.1.55
2026-07-28 10:14:25 Accepted login from 10.0.0.8
2026-07-28 10:14:26 Failed login from 192.168.1.55
2026-07-28 10:14:30 Connection from 172.16.0.99
2026-07-28 10:14:31 Failed login from 192.168.1.55
2026-07-28 10:14:33 Accepted login from 10.0.0.8"""

ips = re.findall(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}", log)
counts = Counter(ips)
print(counts)
```

Result: `192.168.1.55` fired four failed logins, the brute-forcer, surfaced
automatically from a pile of noise.

**What I learned:**

- **Regex** describes the *shape* of what you want. `\d+` is "one or more
  digits", `\.` is a literal dot (escaped, because `.` alone means "any
  character"). An IP is four digit-groups separated by three dots.
- The **raw string** prefix `r"..."` stops Python mangling the backslashes, so get
  in the habit of putting `r` in front of every pattern.
- `re.findall(pattern, text)` returns a **list** of every match; `Counter(list)`
  tallies them in one line.
- **Precision vs "good enough".** My pattern would happily match
  `999.999.999.999`, which isn't a valid IP. Tightening to `\d{1,3}` helps, but
  truly validating 0 to 255 in regex is ugly, and for pulling IPs out of a log you
  control, you usually don't bother. Knowing *when* precision matters is real
  engineering judgment.

**What I asked the AI:** how the same job gets done in the **terminal** with
pipes: `cat log | grep -oE "pattern" | sort | uniq -c | sort -nr`. The mental
model that unlocked it: each command is a filter, `|` is the conveyor belt
between them, and `grep` uses the *same regex* I'd just learned in Python. On a
box, that pipeline is how you go from 10,000 lines to the 3 that hold the flag.

## Challenge 4: Password strength checker

**What I built:** the defensive mirror of Challenge 1. Instead of *breaking*
weak passwords, this *stops* them. It loops until the user enters something with
an uppercase letter, a digit, and a special character.

```python
while True:
    p = input("please enter your password: ")
    has_upper = 0
    has_number = 0
    has_special = 0
    for c in p:
        if c.isupper():
            has_upper += 1
        if c.isdigit():
            has_number += 1
        if not c.isalpha() and not c.isdigit():
            has_special += 1
    if has_upper == 0 or has_number == 0 or has_special == 0:
        print("Too weak, try again")
    else:
        print("Strong enough!")
        break
```

**What I learned:**

- **The reset bug.** Counters have to be reset *inside* the loop, at the top,
  otherwise a retry keeps the previous attempt's counts. This was the single most
  instructive bug: it's about *where* state lives, not syntax.
- There's **no `.isspecial()`**, you define "special" yourself as
  `not c.isalpha() and not c.isdigit()`. Combining checks you already know to
  invent one that doesn't exist is a core skill.
- Python uses **words** (`and`, `or`, `not`) where C#/Kotlin use symbols
  (`&&`, `||`, `!`). Muscle memory from other languages fights you here.
- `break` exits a `while True` loop; writing `False` on its own does nothing.

**What I asked the AI:** I wanted to *gamify* strength with a points system based
on ASCII values. The AI pushed back with the actual security reasoning: ASCII
value measures *which* character it is, not how *unpredictable* it is. What
really makes a password hard to crack is **character-type variety** (each type,
lower, upper, digit, symbol, multiplies the attacker's search space) and
**length** (every extra character multiplies it again). Repetition (`!!!`) is a
*weakness*, because crackers guess predictable patterns first. So a score should
reward variety and length, not high ASCII codes. A validator that checks types
but **not length** would accept `Ab1!`, four characters, crackable in seconds.

## Challenge 5: Port-to-service mapper

**What I built:** turn a list of open ports from a scan into readable service
names, the primitive version of what a scanner's fingerprinting does, and
(not coincidentally) the exact dispatch pattern an agent's tool registry uses.

```python
open_ports = [22, 80, 3306, 8080, 443]

common_ports = {
    21: "FTP",
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    143: "IMAP",
    443: "HTTPS",
    445: "SMB",
    3306: "MySQL",
    3389: "RDP",
}

for port in open_ports:
    print(f"Port {port} -> {common_ports.get(port, 'Unknown')}")
```

**What I learned:**

- A **dictionary** is a direct key-to-value lookup. `common_ports[22]` instantly
  returns `"SSH"`, no loop, no scanning. My first attempt used a nested loop to
  *search* the dict, which threw away the entire reason to use one.
- **Missing keys crash.** `common_ports[8080]` raises `KeyError` because 8080
  isn't in the dict. Real scans always contain surprises, so a tool that dies on
  the first unexpected port is useless.
- `.get(key, default)` does the lookup *and* the fallback in one expression:
  `common_ports.get(8080, "Unknown")` returns `"Unknown"` instead of crashing.
  I first solved this with `try/except`, which works, but `.get()` collapses five
  lines to one. Knowing *both* matters: `.get()` for lookups, `try/except` for
  things like network failures where there's no shortcut.
- **f-strings**: `f"Port {port} -> {...}"` drops variables straight into a string
  (Python's version of Kotlin's `"$port"`). One consistent code path means one
  consistent output format.

**What I asked the AI:** how this scales into my larger project, an AI-assisted
pentest agent. The architecture I landed on: **Python owns the tools and the
control loop; the AI is a constrained advisor the loop consults for judgment,
returning structured (JSON) decisions the code validates before acting.**
Deterministic work with a *correct* answer (parsing output, hashing, port
lookups) is code; fuzzy *best-judgment* calls ("chase the SSRF or the git leak
first?") are where you spend model calls. This little `.get()` dispatch,
`tools.get(action_name, default_handler)`, is that tool registry in miniature.

## What actually made the difference

Five small tools taught me strings vs bytes, loops, nested loops, variable
scope, modulo, conditionals, regex, dictionaries, `.get()`, f-strings, and
validation loops, and I picked all of it up *because I needed it*, which is why
it stuck.

A few things I'd tell anyone starting:

- **Narrate your logic in plain English first**, then translate line by line.
  Your gaps become tiny, targeted searches instead of a documentation deep-dive.
- **Read error messages as your primary teacher.** Python's are unusually
  readable, and every one you fix is a permanent lesson.
- **Prefer a plain-language explanation over the official docs** when learning.
  Docs are for people who already know the language.
- **Being stuck and looking something up is the mechanism, not a failure.** The
  whole skill is carrying a *map* of what's possible and fetching specifics on
  demand, not memorising syntax.

The bigger realisation: building and breaking are the *same understanding*
pointed in two directions. A programmer asks *"how do I make this work?"*; a
hacker asks *"how does this break?"* You can't break what you don't understand,
and you understand by building. Every one of these tools was me building the
mechanism well enough to see how it fails, which is the actual job.

Next up: the same approach applied to networking tools (a TCP port scanner and
banner grabber) once I'm off my phone and back at a proper terminal.
