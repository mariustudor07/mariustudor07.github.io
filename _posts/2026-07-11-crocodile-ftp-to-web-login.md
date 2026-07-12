---
layout: post
title: "HTB Crocodile"
date: 2026-07-11
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [ftp, gobuster, web, starting-point]
excerpt: "Anonymous FTP leaks two credential lists, gobuster finds the login page. The short solve, and the hour of VPN and browser pain around it."
---

> Starting Point box. The actual solve is short. The real reason this post exists
> is the hour I lost to infrastructure before I ever touched the box. I'm writing
> the pain down so future me doesn't repeat it.

## Recon

```
sudo nmap -sC -sV 10.129.x.x
```

| Port | Service | Version              |
| ---- | ------- | -------------------- |
| 21   | FTP     | vsftpd 3.0.3         |
| 80   | HTTP    | Apache httpd 2.4.41  |

`nmap`'s `ftp-anon` script does half the work. It reports anonymous login allowed and lists two files sitting in the FTP root: `allowed.userlist` and `allowed.userlist.passwd`. Two open ports, and the names already tell the story. Grab creds off FTP, spend them on the web app.

## Enumeration

Anonymous FTP, pull both files:

```
ftp 10.129.x.x
# Name: anonymous
# Password: (blank, just Enter)
ls
get allowed.userlist
get allowed.userlist.passwd
bye
```

```
cat allowed.userlist        # aron, pwnmeow, egotisticalsw, admin
cat allowed.userlist.passwd # root, Supersecretpassword1, ...
```

> **The mental trap.** These are two parallel lists, not paired rows. Line 4 of
> each isn't necessarily one credential, so you've got up to 4x4 combinations. On a
> real target this is where `hydra` earns its keep. Here, the intended `admin`
> pair works.

Now find where to spend them. The web app on 80 redirects to a login, and `gobuster` confirms the path:

```
gobuster dir -u http://10.129.x.x -w /usr/share/seclists/Discovery/Web-Content/common.txt -x php,html
# /login.php (200)
```

## Foothold

Log into `/login.php` with the `admin` credential from the two lists. That's the box. The login reveals the flag.

## Where I actually lost the time

The five-line solve above took maybe ten minutes. Everything else was environment. I'm recording it because these are reusable lessons, not one-offs.

**1. VPN MTU, the bug that fakes being "the box is down".**
Pages wouldn't load. `ping` worked, `curl -I` worked (headers only), but the full 58 KB page hung forever. The OpenVPN log had the giveaway:
`read UDPv4 [EMSGSIZE Path-MTU=1480]: Message too long`. Large response packets were exceeding the tunnel MTU and getting silently dropped. Small stuff (ping, HEAD) fit, big stuff (the actual page) didn't.

```
# quick fix on the live interface:
sudo ip link set dev tun0 mtu 1300

# permanent fix, add to the .ovpn (the server was pushing tun-mtu 1500):
tun-mtu 1400
mssfix 1300
pull-filter ignore "tun-mtu"
```

That `pull-filter ignore "tun-mtu"` line matters. Without it the server's pushed MTU overrides your config and you're back to square one. And every VPN pack (Starting Point, Machines, Seasonal) is a separate file that needs the fix.

**2. Wrong VPN entirely.** Before the MTU thing, I was on the Machines VPN while the box needed a different network. `ping` returned *Destination Host Unreachable from the gateway*, which is a routing failure (wrong network), not a firewall drop. Match the pack to the section.

**3. `.htb` hostnames need /etc/hosts.** The web app redirects to a hostname. The browser can't resolve `crocodile.htb` on its own, so add it manually:

```
echo "10.129.x.x  crocodile.htb" | sudo tee -a /etc/hosts
```

**4. Firefox proxy chaos.** A stale FoxyProxy/system-proxy setting had `network.proxy.type` stuck on `5` (system), routing box traffic into a dead proxy. `curl` works and Firefox hangs equals a browser-side proxy problem every time. Set it to `0` (No proxy) in `about:config`, and disable the extension so it stops overriding.

## Takeaways

- `nmap` scripts hand you the plot. `ftp-anon` gave me anonymous access and the filenames without a single manual step.
- Two wordlists aren't paired creds. Think in combinations, and reach for `hydra` when the list is long and the target won't lock you out.
- "Server not found" or a hanging page is usually me, not the box. The debug ladder that never fails: `ping`, then `curl -I`, then check `tun0` MTU, then check `/etc/hosts`, then check the Firefox proxy. If `curl` works and the browser doesn't, it's the browser.
- The recon to foothold pipeline finally clicked here: nmap tells you what's open, service enum (gobuster, FTP) gets you creds, creds get you a login. Everything after is a variation on that.
