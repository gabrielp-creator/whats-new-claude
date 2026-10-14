# Changelog

## 0.3.1 (unreleased)
- Fix: provenance. A plugin in the official marketplace counts as Anthropic-published only from its
  `./plugins` folder or an `anthropics` repo on github.com; before, any `./` path counted, including
  `./external_plugins` (14 of 315 entries on 2026-10-13), and a URL merely containing
  `github.com/anthropics/` did too. A commit counts as first-party only when every pull request GitHub
  links to it comes from the anthropics repo itself (or none does: a direct push); before, the commit
  message's "(#N)" decided, which the commit's author writes, and a commit without one counted as
  first-party. Items fetched before this version keep their stored label.
- Hardening against one fetched item steering others: fork and third-party items are reviewed in
  their own batches, never alongside official ones (a plan may count one more call per lens). When a
  batch comes back with more than 3 items flagged as containing instructions, each flagged item is
  reviewed again on its own, within the same call cap; the injected item stays flagged. An official
  item that names a security, breaking, deprecation or retirement change is never in the lowest band,
  whatever the reviews answered (18 of 3646 stored items on 2026-10-13). Commits are dated when they
  landed, not by their author's date, and no item date can be in the future.

## 0.3.0 (2026-10-13)
- Ratings follow the Claude models each project uses. The file check now lists the model ids in each
  project's files. A new model the project already uses drops to 5 ("already adopted: confirm settings
  and pricing"); a project on an older model of the same family is an upgrade candidate; a change about
  models the project does not use stays below 8 and says "applies when you move to ...". Before, a
  launch rated highest for the projects that had already moved to it.
- Fix: in large projects the file check spent its file limit on output and data folders before reaching
  the source, so it found nothing and could not cap false alarms. It now reads source first and labels a
  project that is still too large "file check incomplete".
- Fix: with a Project filter, All items showed the best score across projects; it now shows that
  project's own score (and sorts by it). Without a filter, the score names the project it belongs to.
- Ratings are redone when they go stale: each answer records the range and file-check result it was
  given under, and an item is rated again when those change (for answers from 0.2.x, when the new
  model check changes them). `plan` counts these in its cost estimate.
- Before setup, the session-start line says to run `/whats-new setup`. Until the review page is
  published, the reminder says `/whats-new page` publishes it (free).

## 0.2.1 (2026-10-09)
- Fix: every `/whats-new` command stopped at its first step. The skill passes `--data` to each
  script, and the argument reader rejected it as an unknown option. It now ignores `--data`, like the
  other scripts do.

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
