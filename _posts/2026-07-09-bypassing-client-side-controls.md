---
layout: post
title: "Bypassing Client-Side Controls with Burp / Caido"
date: 2026-07-09
tags: [webtesting, proxies]
---

Quick notes from working through client-side control bypasses. The core lesson:
**anything enforced only in the browser is not enforced at all.**

## The setup

Intercepting proxy (Burp or Caido) sitting between the browser and the server so
every request can be inspected and modified before it leaves.

## What I tested

- Disabled/greyed-out form fields — re-enabled by editing the request in the proxy.
- Hidden `price` fields in a cart — tampered the value on the way to the server.
- Client-side length/format validation — bypassed by sending the raw request directly.

```http
POST /cart/checkout HTTP/1.1
Host: shop.example
Content-Type: application/x-www-form-urlencoded

product_id=42&price=1337
```

## Takeaway

> Never trust the client. Validate and authorize everything server-side.

Next up: exploring how these controls should be re-implemented defensively.
