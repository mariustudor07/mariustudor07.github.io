---
layout: post
title: "THM: Management Wants A Word"
date: 2026-08-09 20:00:00
category: "Digital Forensics"
difficulty: "Hard"
tags: [thm, hacker-holidays, digital-forensics, windows, kape, dpapi, chrome, veracrypt, privacy, cryptography]
excerpt: "Housekeeping found a guest's laptop and IT pulled a KAPE triage before wiping it. The task is to walk one chain end to end: the machine's autologon secret unlocks Vera's Windows password, that password unlocks her DPAPI master key, the master key decrypts a password Chrome saved for her, and that saved password opens a VeraCrypt container she thought no one would ever mount. No cracking, just following what Windows quietly remembers about you."
---

<figure class="figure-narrow">
  <img src="{{ '/assets/img/management-wants-a-word-briefing.png' | relative_url }}" alt="Comic panel titled 04 Sunrise, subtitle 'It was never a bug. It was the business model.' A hooded figure images the last machine and carves deleted complaint tickets back out of unallocated space. Ticket #041, #088, #201, #129 all RESOLVED by VERA, plus 214 deleted complaint tickets all closed by VERA. The timeline assembles into a single name. VERA was the concierge, the manager, and the escalation team, all of it, the whole time. A cheerful good-morning message was already waiting in the inbox before you woke, and it reads less like hospitality than like a confession.">
  <figcaption>The story panel for day 14. It's flavour, but it matters: everything traces back to one identity, Vera. In the actual room she's a real Windows user account, and the whole box is following what her laptop remembered about her.</figcaption>
</figure>

This one is a Hard forensics room and honestly the difficulty is fair, not because any single
step is hard but because there are five of them and if you get the order wrong nothing works.
The briefing: housekeeping found a guest's laptop left after an early checkout, Room 214,
registered to a "Vera." IT pulled a full KAPE triage before wiping the machine for the next
guest. Somewhere in that triage is a password Vera never meant to leave behind, and it opens a
door to something she was keeping quiet.

The trick the room is teaching, and the room card basically says it out loud, is that **a
browser will remember things for you that you never told anyone else**, and **not every hidden
file needs a password cracker, some of them just need a really good memory**. I did not crack a
single hash in this room. Everything I needed was already stored on the disk, I just had to
decrypt it in the right order.

Standard disclaimer, this is a deliberately built forensics lab, "Vera" is a fictional account
and the artifacts are seeded for the exercise. Nothing here is a real person's data.

Heads up: the answer bits (Vera's password, the recovered browser password, the flag) are
hidden behind grey <span class="spoiler">bars like this</span>. Click one, or tab to it and
press Enter, to reveal it. The methodology is all in the open, only the answers are covered.

## The whole chain at a glance

The reason this room feels hard is that it's a key ladder. Each artifact hands you the key to
the next one:

```
SAM + SECURITY hives   ->  Vera's Windows login password (from an LSA autologon secret)
  ->  decrypt Vera's DPAPI master key  (needs: that password + her SID)
  ->  decrypt Chrome's "Local State" AES key  (DPAPI-protected)
  ->  decrypt a password Chrome saved for her  (AES-256-GCM, the "v10" blob)
  ->  use that saved password to open a VeraCrypt container in Documents
  ->  inside: an invoice PDF with the flag on it
```

Miss the SID, or feed the wrong password into DPAPI, or forget that Chrome's key is itself
DPAPI-wrapped, and the chain just dead-ends with a decrypt error. So I'll walk it in order.

## What's in the triage

KAPE (the Kroll Artifact Parser and Extractor) grabs a targeted set of forensic files off a
live Windows box. Unzipping the task file gives a `C\` folder that mirrors the real disk. The
parts that matter:

```
C\Windows\System32\config\        SAM, SYSTEM, SECURITY, SOFTWARE  (registry hives)
C\Users\vera\NTUSER.DAT
C\Users\vera\AppData\Roaming\Microsoft\Protect\S-1-5-21-...-1000\   (DPAPI master keys)
C\Users\vera\AppData\Local\Google\Chrome For Testing\User Data\     (the browser profile)
C\Users\vera\Documents\backup                                        (100 MB of ??? )
```

That `backup` file is the "door." It's exactly 104,857,600 bytes (100 MiB on the nose), it has
no file header, and its bytes are basically pure noise (I measured about 7.997 bits per byte of
entropy, and 8.0 is the theoretical max for random data). A round size, no magic bytes, wall to
wall entropy: that's the fingerprint of a VeraCrypt container. Nothing else to do with it yet,
so I go find the password.

## Step 1: Vera's Windows password, no cracking required

The classic move here is to pull the NT hash out of the SAM and throw it at hashcat. I set that
up and then noticed I didn't need it. Impacket's `secretsdump` reads the offline hives directly,
and it dumps not just the password hashes but the **LSA secrets**, and one of those secrets is
the autologon password stored in plaintext.

```bash
secretsdump.py -sam SAM -system SYSTEM -security SECURITY LOCAL
```

```
[*] Dumping local SAM hashes (uid:rid:lmhash:nthash)
Administrator:500:aad3b435...:1241186a4aac4f34f4bf7ace71b396a8:::
vera:1000:aad3b435...:1241186a4aac4f34f4bf7ace71b396a8:::
[*] Dumping LSA Secrets
[*] DefaultPassword
(Unknown User):<REDACTED>
[*] DPAPI_SYSTEM
dpapi_machinekey:0x8754...
```

`DefaultPassword` is the Windows autologon secret. Windows stores it in cleartext in the
SECURITY hive so it can log the user in without prompting, which is a genuinely useful thing to
know as a privacy fact: **if autologon is on, the password is sitting in the registry in the
clear.** No cracking, it just hands it to you.

Vera's login password:

<span class="spoiler"><code>minivera</code></span>

I sanity-checked it against the SAM by computing the NT hash of that string (NT hash is just
MD4 of the UTF-16-LE password) and confirming it equals `1241186a4aac4f34f4bf7ace71b396a8`,
the hash on Vera's account. It matches, and it's also the same hash as Administrator, so both
accounts share that password. Good, one key in hand.

## Step 2: decrypt Vera's DPAPI master key

DPAPI (the Data Protection API) is the Windows service that apps use to encrypt secrets like
saved passwords and Wi-Fi keys, so they don't have to invent their own crypto. Every user has a
set of **master keys** in `AppData\Roaming\Microsoft\Protect\<SID>\`, each named as a GUID, and
those master keys are themselves encrypted with a key derived from the user's login password
plus their SID. That's why I needed Step 1 first.

There's exactly one master key file here, GUID `c90719ef-5b98-474e-b934-136d606a702a`. Impacket's
`dpapi.py` decrypts it if you give it the password and the SID (the SID is the folder name):

```bash
dpapi.py masterkey \
  -file 'C/Users/vera/AppData/Roaming/Microsoft/Protect/S-1-5-21-2529683458-431225740-1723070931-1000/c90719ef-5b98-474e-b934-136d606a702a' \
  -sid  'S-1-5-21-2529683458-431225740-1723070931-1000' \
  -password '<VERA_LOGIN_PASSWORD>'
```

```
Decrypted key with User Key (SHA1)
Decrypted key: 0x5e5715ec9b6df5a8...b3e9d40
```

That hex blob is the decrypted master key. It's not the final answer, it's the key that unlocks
the next box.

## Step 3: get Chrome's encryption key out of "Local State"

Chrome (this profile is "Chrome For Testing," the automation build, but the storage is the same)
doesn't DPAPI-encrypt every saved password one by one. Instead it generates one AES key, wraps
**that** with DPAPI, and stores the wrapped key in a JSON file called `Local State` under
`os_crypt.encrypted_key`. Every saved password is then AES-encrypted with that one key.

So the key is base64, and once decoded it starts with the ASCII bytes `DPAPI`. Strip that 5-byte
prefix and what's left is a DPAPI blob I can hand to the master key from Step 2:

```bash
# pull encrypted_key out of Local State, base64-decode, drop the 'DPAPI' prefix, save raw
python3 -c "import json,base64; \
raw=base64.b64decode(json.load(open('Local State'))['os_crypt']['encrypted_key'])[5:]; \
open('/tmp/enckey.bin','wb').write(raw)"

dpapi.py unprotect -file /tmp/enckey.bin -key 0x5e5715ec9b6df5a8...b3e9d40
```

```
Successfully decrypted data
 0000   20 6A 39 A0 97 13 27 EA  94 87 E4 AE A9 84 4F 5D
 0010   36 70 16 24 56 98 22 76  93 9A 71 26 46 DA 0B 02
```

Those 32 bytes are Chrome's AES-256 key. This is the part people miss the first time: the key in
`Local State` is not usable on its own, it's DPAPI-wrapped, so it depends on the exact same
master key chain. One key protects the whole password store.

## Step 4: decrypt the saved password

Now the actual saved logins, in the profile's SQLite database called `Login Data`:

```bash
sqlite3 "Default/Login Data" \
  "SELECT origin_url, username_value, hex(password_value) FROM logins;"
```

```
http://bytelotus.thm:8080/ | VeraSecretVault | 763130C88A72A64F...FEB3D7
```

The stored password starts with `763130`, which is ASCII for `v10`. Modern Chrome tags each
encrypted value with a version prefix, and `v10` means: 3-byte prefix, then a 12-byte nonce,
then AES-256-GCM ciphertext with a 16-byte auth tag at the end, using the key from Step 3.
(There's a newer `v20` "app-bound" scheme that's more painful, but this profile is on `v10`, so
the key we already have is enough.)

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
key   = bytes.fromhex('206a39a0971327ea9487e4aea9844f5d3670162456982276939a712646da0b02')
blob  = bytes.fromhex('763130C88A72A64F...FEB3D7')   # the password_value from sqlite
nonce, ct = blob[3:15], blob[15:]
print(AESGCM(key).decrypt(nonce, ct, None).decode())
```

The username is `VeraSecretVault`, the site is `http://bytelotus.thm:8080/`, and the recovered
password is:

<span class="spoiler"><code>Wh4t1sV3raD0inG0nTh1sH0st</code></span>

That's the "password she never meant to leave behind." She saved it in her browser once and
forgot the browser keeps it forever. The name of the login (`VeraSecretVault`) is a pretty
loud hint about what it unlocks.

## Step 5: open the door

Back to that 100 MiB `backup` file. My guess was VeraCrypt, so I tested the recovered password
against it with `cryptsetup`, which can read TrueCrypt/VeraCrypt volumes. The
`--test-passphrase` mode checks the header without mounting anything:

```bash
printf '%s' '<RECOVERED_CHROME_PASSWORD>' | \
  cryptsetup open --type tcrypt --veracrypt --test-passphrase backup --verbose
# -> Command successful.
```

It's VeraCrypt and the password is right. To actually see inside, open it as a device and mount
it read-only (this needs root for the device mapper):

```bash
printf '%s' '<RECOVERED_CHROME_PASSWORD>' | \
  sudo cryptsetup open --type tcrypt --veracrypt backup vera_backup -
sudo mount -o ro /dev/mapper/vera_backup /mnt/vera_backup
ls -R /mnt/vera_backup
```

```
/mnt/vera_backup:
  $RECYCLE.BIN/
  secret_financial_documents/
  System Volume Information/

/mnt/vera_backup/secret_financial_documents:
  important_invoice_byte_lotus.pdf
  transactions_q3.csv
```

A FAT volume with a folder literally called `secret_financial_documents`. The CSV is a list of
Byte Lotus transactions (catering, transport, guest accommodation), and one line stood out,
`Internal Adjustment, Image asset correction, 0.00, Archived`, which felt like a nudge toward
the image in the PDF.

> Quick note on the "really good memory" hint, and a version number the room drops (`1.26.29`).
> That points at the other, easier path some people take on this room: you don't strictly need
> the DPAPI ladder if you carve the plaintext password straight out of a **memory image** of the
> browser process, and `1.26.29` is a Chrome-For-Testing build you'd match your offsets against.
> I went the disk-artifact route because it's the one that teaches you how the storage actually
> works, but "good memory" = RAM is the intended wink.

## Reading the flag out of the PDF

`exiftool` on the invoice showed one page with an embedded image (636x724, FlateDecode) and no
selectable text, so the flag is baked into the picture, not the PDF text. I didn't have a PDF
renderer handy, but I did have Python's imaging library, so I pulled the image stream out of the
PDF, zlib-inflated it, and rebuilt it as a PNG:

```python
import zlib
from PIL import Image
data = open('important_invoice_byte_lotus.pdf','rb').read()
i = data.find(b'/Width 636/Height 724/BitsPerComponent 8/SMask')
s = data.find(b'stream', i) + len(b'stream')
if data[s:s+2] == b'\r\n': s += 2
raw = data[s:data.find(b'endstream', s)]
img = zlib.decompress(raw)               # 636*724*3 RGB bytes
Image.frombytes('RGB', (636, 724), img).save('invoice.png')
```

And there's the invoice, billed to "Hotel Cleaning LLC" from "Byte Lotus Resorts," one line
item, and the flag sitting right in the description column.

<figure>
  <img src="{{ '/assets/img/management-wants-a-word-invoice.png' | relative_url }}" alt="A rendered invoice from Byte Lotus Resorts, billed to Hotel Cleaning LLC at 25 SMTP Rd, payable to Byte Lotus Resorts at 8080 Http Street. Invoice number 2122/9090/5050, dated 7/19/2026. A single line item in the table has quantity 1 at 100 dollars, and its description contains the flag, which is covered here with a black redaction bar reading THM redacted.">
  <figcaption>The invoice reconstructed from the PDF's embedded image stream. The one line item holds the flag (redacted here). Little touches I like: the addresses are "25 SMTP Rd" and "8080 Http Street," which is very on-brand for a room about protocols and ports.</figcaption>
</figure>

One gotcha worth mentioning: I misread the flag the first time and submitted it, wrong. When you
recover a flag from an image, especially in a monospace font, the leetspeak characters bite you.
`3` vs a letter, `0` vs `O`, digit `1` vs lowercase `l`, and here `V3r4` where I first typed
`V3ra` because the `4` reads like an `a` at small sizes. Zoom the crop way in before you trust
what you read.

The flag:

<span class="spoiler"><code>THM{1t_w4s_V3r4_A11_Al0ng?!}</code></span>

Which, decoded from leet, is "it was Vera all along," matching the comic. Fitting.

## What I took from this one

- **Autologon passwords live in the clear.** `secretsdump` pulling `DefaultPassword` out of the
  SECURITY hive saved me from ever touching hashcat. Always dump LSA secrets before you assume
  you need to crack anything.
- **DPAPI is a chain, and the links are ordered.** User password + SID unlock the master key,
  the master key unlocks Chrome's `Local State` AES key, and only then can you touch the saved
  passwords. Skip a link and it just fails.
- **Browsers remember more than the user does.** A password saved once to Chrome is recoverable
  offline forever, as long as you also have the user's login. That's not a bug, it's the design,
  and it's a real privacy point, not just a CTF trick. If a machine is compromised, so is every
  password the browser ever saved on it.
- **Headerless + round size + max entropy = an encrypted container.** 100 MiB of noise with no
  magic bytes was VeraCrypt, and `cryptsetup --veracrypt` reads it without needing the VeraCrypt
  GUI at all.
- **Redacting flags cuts both ways.** I hide them in these writeups anyway, but reconstructing a
  flag from an image taught me to zoom in and read every glyph twice before submitting.

Genuinely one of my favourite rooms so far, because nothing in it was "guess the payload." It
was just: here is what a Windows machine quietly stores about a person, now walk it.
