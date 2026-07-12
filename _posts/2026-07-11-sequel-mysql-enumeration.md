---
layout: post
title: "HTB Sequel"
date: 2026-07-11
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [mysql, mariadb, databases, starting-point]
excerpt: "A passwordless MariaDB on 3306, an SSL handshake that fights a modern client, and reading creds straight out of the tables."
---

> Starting Point box. I'm writing this for the technique rather than the flag. The
> point of it is how much a single exposed database service gives away when it's
> left wide open, plus a client-side gotcha that cost me a few minutes.

## Recon

One service, and it's the whole box.

```
sudo nmap -sC -sV 10.129.x.x
```

| Port | Service | Version                       |
| ---- | ------- | ----------------------------- |
| 3306 | MySQL   | MariaDB 5.5.5-10.3.27+deb10u1 |

The `nmap` `mysql-info` script already does a lot of the work before I even connect. It hands over the protocol version, thread ID, capability flags, and the auth plugin. Seeing MariaDB on 3306 with nothing else open is the tell that the whole path lives inside the database.

## Enumeration

The plan is simple. Connect as `root`, list the databases, read whatever's interesting. On Arch I use the MariaDB client (`mariadb`, since the old `mysql` command is a deprecated alias now).

```
mariadb -h 10.129.x.x -u root
```

> **Where I got stuck.** My client is a lot newer (12.x) than the server (10.3),
> and the new client tries to negotiate TLS by default. The server doesn't support
> it, so the handshake dies before auth with:
> `ERROR 2026 (HY000): TLS/SSL error: SSL is required, but the server does not support it`.
> The fix is to tell the client not to require SSL. Nothing wrong with the creds or
> the command, just a version mismatch.

```
mariadb -h 10.129.x.x -u root --skip-ssl
```

`root` has no password, so it's straight in at the Enter key. After that it's standard SQL enumeration:

```
SHOW DATABASES;
USE <interesting_db>;
SHOW TABLES;
DESCRIBE <table>;
SELECT * FROM <table>;
```

## Foothold

There's no shell here. The foothold is the data itself. Walking the non-default databases and dumping the tables surfaces the credentials the box wants you to find. `SHOW DATABASES` filters out the noise (`information_schema`, `mysql`, `performance_schema`) and points you at the one that matters.

## Takeaways

- A passwordless `root` on an exposed 3306 is game over. No exploit, no cracking, just connect and read. Worth remembering how much `nmap`'s `mysql-info` gives up before you even authenticate.
- New client plus old server equals a TLS mismatch. `--skip-ssl` (or `--ssl=0`) is the first thing to try when a modern MariaDB client refuses to talk to an old server. I'll reach for it straight away next time instead of second-guessing my command.
- SQL enumeration is a fixed muscle-memory loop: `SHOW DATABASES`, then `USE`, then `SHOW TABLES`, then `DESCRIBE`, then `SELECT`. The same handful of commands works on every MySQL/MariaDB target.
