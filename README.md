# Stash

A Mac app for keeping notes, documents, images, videos and links in one place —
with a menu-bar quick panel, drag-and-drop Smart Sort, and an AI that learns from your library.

## Install
Open **Terminal** and paste:

```
curl -fsSL https://raw.githubusercontent.com/charliecurrin/stash/main/install.sh | bash
```

## Updates
Stash checks this repo for a newer `version.json` when it starts (and every few hours).
When there's a new version, a **Restart & Update** button appears in the app.
Your notes and files are stored separately in `~/Library/Application Support/Stash/` and are never touched by updates.

## Publishing an update
1. Replace the changed files (usually `index.html`).
2. Bump `"version"` in `version.json` (e.g. 1.1.0 → 1.2.0) and write a short `"notes"` line.
3. Commit. Everyone's Stash picks it up on next launch.
