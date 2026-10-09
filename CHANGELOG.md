# Changelog

## 0.2.0 (2026-10-08)
- Ratings from 0 to 10 per project: code sets each item's range from its urgency and the file check,
  a tool-less Claude call places it inside and says what to do.
- New commands: `/whats-new here`, `news` and `export`, with `--min`, `--days` and `--project`.
  `/whats-new` alone now means "update now".
- The review page opens on **Top picks** (by project, with one Export button); the full list moves
  to **All items**.
- Background updates at session start on a frequency you choose (daily, every 3 days, weekly,
  manual), spending Claude calls only within a budget you set (default none).
- Settings in `/config`. An optional GitHub token is kept in Claude Code's secure storage; the
  plugin no longer reads `GITHUB_TOKEN` from your environment.
- Fixed: the session-start reminder was sent to Claude instead of being shown to you.
- Fixed: the page showed garbled characters when opened as a local file.
- MIT licence.

## 0.1.0
- First private version: fetch, three tool-less lenses, check before flagging, review page, briefs.
