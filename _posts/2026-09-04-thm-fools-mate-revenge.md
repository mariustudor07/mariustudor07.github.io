---
layout: post
title: "THM: Fool's Mate, Revenge"
date: 2026-09-04 19:45:00
category: "Web Exploitation"
difficulty: "Medium"
tags: [thm, web, prototype-pollution, nodejs, business-logic, burp-suite]
excerpt: "The sequel to Fool's Mate, and this time they patched my cheap trick. Replaying the winning move to the API no longer works, because the server now checks a locked reward gate before it hands over the flag. The fix, and the whole room, is prototype pollution: poison Object.prototype through the settings endpoint so the server's own config object reads back 'unlocked' as true, then make the move for real."
---

Heads up: the winning payload and the flag are hidden behind click-to-reveal bars. The
method is written out normally, only the answer lines are covered.

If you read my Fool's Mate writeup, you know the original was almost insultingly simple:
the UI blocked the mating move, but that check was client-side only, so you replayed the
move straight to the API and won. This is the revenge box, and the author clearly read
that solution and closed the door on it. Same chess app, same Endgame Trainer, but now
the cheap replay does not work anymore. Getting past the new lock taught me my first real
prototype pollution, so this one was a genuine step up.

## Recon

```
sudo nmap -sC -sV -A <TARGET_IP>
```

```
22/tcp   open  ssh   OpenSSH 9.6p1 Ubuntu
3000/tcp open  http  Node.js Express framework
|_http-title: Endgame Trainer
```

Same Node/Express chess app as before, this time on port 3000.

## The trick from last time is dead

I went straight for the old solve out of habit: intercept the game, send the mate-in-one
move to the move API by hand, expect the flag. The move goes through, the board says
checkmate, and then... nothing. No flag.

The server now has a second gate. Winning the game is not enough anymore; before it
releases the reward it checks a flag on its own config, something like an `unlocked`
property, and by default that gate is shut. So the real puzzle is not the chess move at
all. It is: how do I get the server to believe its reward gate is open?

## The only thing that writes server state

If I need to change something the server remembers, I need to find where the app writes
state. Clicking around, the one feature that saves anything server-side is the
preferences / settings save. The app lets you store display preferences (theme, piece
set, that kind of thing), and it does it by POSTing a little JSON object that the backend
merges into its own settings.

That word, merges, is the whole room. A Node backend that deep-merges attacker JSON into
an object without filtering the keys is the textbook setup for **prototype pollution**.

## Prototype pollution, the short version

In JavaScript every plain object shares one ancestor, `Object.prototype`. If I can get
the server to write a key onto `Object.prototype` instead of onto my little settings
object, then every plain object in the whole process inherits that key. Including any
fresh config object the server builds later to decide whether the reward is unlocked.

So instead of sending a normal preference, I smuggle a `__proto__` key into the merge:

```
POST /api/settings   (Content-Type: application/json)
{ "theme": "dark", "__proto__": { "unlocked": true } }
```

If the merge is naive, `unlocked: true` lands on `Object.prototype`, not on my settings.
From that point on, any object the server checks for `.unlocked` reads back `true` through
the prototype chain, because it inherits it.

A couple of things I ran into that the polished walkthroughs gloss over:

- If `__proto__` is filtered, `constructor.prototype` reaches the same place. A lot of
  naive filters only blocklist the literal string `__proto__` and forget the other road
  to the prototype.
- Nesting a whole object under `__proto__` can send a recursive merge into a stack
  overflow and crash it. Flattening the payload, assigning the primitive straight to the
  target property, was more reliable than the pretty nested version.

<span class="spoiler">The payload that worked: a settings POST carrying <code>constructor.prototype.unlocked = true</code> as a flattened primitive, alongside a normal preference field so the request still looks like a save.</span>

## Then just win the game

Once the prototype is polluted and the gate inherits `unlocked = true`, I replayed the
mate-in-one move exactly like the first box. This time the server checks its reward gate,
sees it open, and hands over the flag.

<span class="spoiler">Pollute <code>Object.prototype.unlocked</code> via the settings merge, then submit the mating move to the move API. Flag: <code>THM{[redacted]}</code></span>

## What I took from it

The jump from Fool's Mate to this one is a really clean lesson in defence. The first box
was "the client is not a security boundary." The fix was to add a real server-side check.
But the fix was implemented on top of a language footgun: a merge that trusts attacker
key names. So the sequel is "moving the check to the server does nothing if the attacker
can rewrite the server's own state."

Prototype pollution scared me on paper and then made total sense once I saw it as: I am
not editing my object, I am editing the blueprint every object is copied from. Change the
blueprint and the server starts lying to itself.
