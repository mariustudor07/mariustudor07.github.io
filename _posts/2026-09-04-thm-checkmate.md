---
layout: post
title: "THM: Checkmate"
date: 2026-09-04 19:25:00
category: "Web Exploitation"
difficulty: "Easy"
tags: [thm, web, password-cracking, brute-force, cewl, cupp, hydra, john, hashcat]
excerpt: "Not a single exploit in the classic sense, just one man's terrible password habits followed across four login pages and finally into SSH. Default creds get you in the front door, a wordlist scraped off the company site gets you the next, his own social profile builds the one after that, and a password pattern you learn along the way opens the shell. A whole box about why password reuse is the vulnerability."
---

Heads up: this writeup hides the answer lines (cracked passwords, the final flag)
behind click-to-reveal bars. The method is all in the open, only the spoilers are covered.

This one has no memory corruption, no injection, no clever payload. It is four login
pages and an SSH port, and the entire box is the story of one employee, Marco, reusing
and lightly reskinning the same weak password everywhere. What I liked about it is that
each stage teaches the next: the way you crack login number two literally hands you the
raw material for cracking number three. By the end you are not guessing, you are just
applying the pattern the box taught you.

## Recon

```
sudo nmap -sC -sV -A <TARGET_IP>
```

SSH plus a stack of small web apps, all Python `Werkzeug` (Flask):

```
22/tcp   open  ssh   OpenSSH 9.6p1 Ubuntu
5000/tcp open  http  Werkzeug/Flask   Operation Checkmate   (landing page)
5001/tcp open  http  Werkzeug/Flask   FirewallOS  -  Sign in
5002/tcp open  http  Werkzeug/Flask   Engineering Careers
5003/tcp open  http  Werkzeug/Flask   social.thm  -  Log in
```

Port 5000 is just the story/landing page. The three real targets are the login forms
on 5001, 5002 and 5003, and they are meant to be done in order, because each one leaks
something you need for the next.

## 5001, FirewallOS: the one everybody forgets to change

The firewall admin panel. This is the "did you ever change the default?" lesson, and
the answer is no. The admin login goes through with a default credential pair, no
cracking required beyond trying the obvious.

If you want to be thorough about it rather than guessing, this is a plain POST login,
so you can throw a small list at it. I used a quick HTTP brute against the `admin` user
and it falls over immediately.

<span class="spoiler"><code>admin</code> logs in with a throwaway default password (think the kind of numeric default nobody should ship). Lesson one: change your defaults.</span>

## 5002, Employee Portal: the password is a word off their own website

The engineering careers / employee portal. Username is `marco`. His password here is not
random, it is a word lifted straight from the company's own site copy. So you scrape the
site into a wordlist and brute the login with it.

Scrape the site with CeWL:

```
cewl -d 2 -m 3 --lowercase -w cewl_words.txt http://<TARGET_IP>:5002/
```

Then brute the `marco` login with that wordlist (Hydra, or whatever HTTP brute tool you
like). The hit comes fast because the password is sitting in the marketing text.

<span class="spoiler">marco's portal password is an on-brand company word (a single dictionary word pulled by CeWL). Lesson two: your own website is a wordlist.</span>

## 5003, social.thm: his own profile builds the wordlist

Now a little internal social platform, same user, `marco`. This time the password is
built from personal details, and helpfully, his profile on this very platform lists
them: full name, nickname, birthday, the things he cares about. That is exactly what a
personal-wordlist generator eats.

Feed those details into CUPP:

```
cupp -i
```

It spits out a few thousand candidate passwords from the name, nickname and dates, and
one of them lands.

<span class="spoiler">His social password is a surname-plus-number style value straight out of the CUPP list. Lesson three: your bio is your attacker's wordlist.</span>

There is also a small side puzzle here: a profile picture whose filename is a SHA-256
hash. You can crack the original filename with John treating it as raw-sha256 against
rockyou, which is a neat little reminder that a hash of something guessable is not a
secret:

```
john image_hash.txt --wordlist=/usr/share/wordlists/rockyou.txt --format=raw-sha256
```

## Port 22, SSH: apply the pattern

By now the box has shown you three of Marco's passwords, and a shape has emerged. They
all follow the same idea: a keyword, capitalised, a year, a bit of punctuation. That is
the whole trick for the last step. You do not need to find his SSH password, you need to
generate the pattern and let it find itself.

Take the CeWL words from earlier as the base keywords, then expand each into
`Keyword` + `20xx` + `!` across every year, and brute SSH with that list:

```
# build Capitalised + 2000..2099 + ! from the keyword list, then:
hydra -l marco -P marco_pattern.txt ssh://<TARGET_IP>
```

It connects, and the shell (and the flag) are yours.

<span class="spoiler">SSH falls to a <code>Keyword2024!</code> style password, exactly the format the earlier stages taught. Flag: <code>THM{[redacted]}</code></span>

## What it actually teaches

There is no bug on this box. The vulnerability is a person. Every stage is the same
human weakness wearing a slightly different hat: defaults left in place, passwords made
of dictionary words, passwords made of personal facts, and one predictable formula reused
across every system he touches. Crack one and you have basically cracked all of them,
because they are the same password with the serial numbers filed off.

The part that stuck with me is how the box weaponises information you would never think
of as sensitive. Marketing copy. A birthday on a profile. A nickname. None of it feels
like a secret, and all of it went straight into a wordlist that owned the account.
