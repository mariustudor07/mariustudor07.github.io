# mariustudor07.github.io

My personal site — About + security blog. Live at **https://mariustudor07.github.io**

Built with [Jekyll](https://jekyllrb.com/); GitHub Pages builds it automatically on
every push. No local build step needed.

## Editing the About page

All the About/home content lives in **one file**: `_data/content.yml`
(bio, skills, projects, timeline, certs, languages). Edit it, push, done —
you never touch the HTML.

## Adding a blog post / writeup

1. Create a Markdown file in `_posts/` named `YYYY-MM-DD-title.md`
2. Add this front matter — the **`category`** drives the filter buttons:

   ```yaml
   ---
   layout: post
   title: "HTB — Blackfield"
   date: 2026-07-10
   category: "HTB Writeups"     # or "Web Exploitation"
   difficulty: "Hard"           # optional, HTB only
   tags: [windows, active-directory, kerberos]
   excerpt: "One-line summary shown in the list and search."
   ---

   ## Recon
   Your content here...
   ```

3. Commit and push:

   ```bash
   git add . && git commit -m "writeup: HTB Blackfield" && git push
   ```

The blog page lists posts newest-first, filters by category, and has a live
search box over titles/tags/excerpts. Live in ~1 min.

> Categories are defined in `_config.yml` under `blog_categories`. Use the exact
> string in a post's `category:` field so it lands in the right filter.

## Structure

```
├── _config.yml          # site config + blog categories
├── _data/content.yml    # ← edit your About content here
├── index.html           # About / home page
├── blog.html            # blog list + filter + search  (/blog/)
├── _layouts/            # default, post
├── _posts/              # writeups (Markdown)
└── assets/              # style.css, blog-filter.js, typewriter.js
```

## Contribution graph note

Commits only light up your GitHub graph if the commit author email is a
**verified** email on your account (Settings → Emails). Check with
`git config user.email`.
