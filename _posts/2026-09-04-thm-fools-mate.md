---
layout: post
title: "THM: Fool's Mate"
date: 2026-09-04 18:45:00
category: "Web Exploitation"
difficulty: "Easy"
tags: [thm, web, client-side-validation, business-logic, burp-suite, node]
excerpt: "A chess trainer that asks you to deliver Fool's Mate, then greys out the exact move you need to make. The catch is that the rule stopping you lives entirely in the browser. Move a legal piece once to learn the request format, replay it with the move the UI forbids, and the server plays along."
---

This was, in the words of the note I left myself right after, "the easiest hack in
history of hacking." I want to write it up anyway, because the reason it was easy is
a real lesson and not just luck: the thing standing between me and the flag was a rule
that only existed in my own browser.

The room is a little chess app called the **Endgame Trainer**. It sets up a board and
wants you to deliver a specific checkmate. The problem it hands you is that the winning
move is one the interface simply will not let you make. You click the piece, and nothing
happens. That is the whole puzzle.

## Recon

Standard start, nmap against the box:

```
sudo nmap -sC -sV -A <TARGET_IP>
```

Two ports:

```
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu
80/tcp open  http    Node.js Express framework
|_http-title: Endgame Trainer
```

SSH I ignored. Everything lives on the web app on port 80, an Express server serving
the chess trainer.

## The move it won't let you make

The board loads, and the objective is to force checkmate. If you know the pattern, the
mate is there in one move. But when you try to make it, the piece the mate depends on is
dead on the board. The UI has decided that move is not allowed and refuses to send it.

For a while I sat there assuming I was reading the position wrong. I was not. The move
is legal in chess. The app was just refusing to let me make it, and that refusal is the
actual target of the room.

## It's only frontend

Here is the thing that makes this a web room and not a chess room. The check that blocks
the move is happening in JavaScript, in the browser, before anything is sent to the
server. The server, when it finally receives a move, does not appear to re-check whether
that move was one the client was "allowed" to make. It just applies it.

That is a classic client-side validation gap: the rule that matters is enforced in the
place the attacker fully controls, and not on the server where it would actually mean
something.

## Capturing the request format

To exploit it I needed to know what a move actually looks like on the wire. So I did the
one thing the app was happy to let me do: I made a legal, allowed move (a pawn) with Burp
Suite intercepting.

That gave me the shape of the request the frontend sends when you move a piece: the
endpoint, the method, and the small bit of JSON describing where the piece came from and
where it went. Once I had that template, the "forbidden" move was no longer special. It
is the same request with different coordinates.

## Replaying the winning move

I took the captured request, swapped the pawn's coordinates for the move the interface
would not let me make, and sent it.

<span class="spoiler"><code>the move the board greyed out, submitted by hand as the same POST the pawn used, just with the from/to squares changed to the mating piece</code></span>

The server accepted it, applied the mate, and handed over the flag: `THM{[redacted]}`.

## What I actually took from it

The chess theme is a costume. Strip it off and this is one of the most common real bugs
on the web: **trusting the client to enforce a rule.** Greyed-out buttons, disabled
fields, "you can't do that" messages in the UI, none of it is security if the server
does not check the same thing again when the request arrives. The browser is the
attacker's turf. Anything decided there can be undone with an intercepting proxy and a
minute of patience.

The move I "could not make" was legal the entire time. The only thing stopping me was
code running on my side of the wire, and I own that side.
