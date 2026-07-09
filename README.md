# mariustudor07.github.io

My learning log & security notes. Live at **https://mariustudor07.github.io**

## How it works

This is a [Jekyll](https://jekyllrb.com/) site. GitHub Pages builds it automatically
on every push — no local build step needed.

## Adding a new note

1. Create a Markdown file in `_posts/` named `YYYY-MM-DD-title.md`
2. Add front matter at the top:

   ```yaml
   ---
   layout: post
   title: "Your title here"
   date: 2026-07-09
   tags: [webtesting, proxies]
   ---
   ```

3. Write the note in Markdown below the front matter.
4. Commit and push:

   ```bash
   git add .
   git commit -m "notes: portswigger practitioner lab writeup"
   git push
   ```

The homepage lists posts automatically, newest first. Live in ~1 min.

## Structure

```
├── _config.yml        # site config
├── index.html         # homepage (lists posts)
├── _layouts/          # default + post templates
├── _posts/            # your notes (Markdown, one file per note)
└── assets/style.css   # dark terminal styling
```

## Note on the contribution graph

Commits count toward your green squares only if the commit author email is a
**verified** email on your GitHub account (Settings → Emails). Check with:

```bash
git config user.email
```
