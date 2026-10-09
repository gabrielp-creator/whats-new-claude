# What's New for Claude

A Claude Code plugin that tells you which of Anthropic's new releases matter to **your** projects. It
rates each one from 0 to 10 for each project, shows the top picks for the project you are working in,
and turns them into ready-to-use briefs.

Version 0.2.1. Works in Claude Code only (it runs local scripts). An independent project, not made by or affiliated with Anthropic.

## What you see

- **At session start**, one line: how many top picks there are for the project you opened, and for
  the rest. It also says when a source failed or new items are waiting. Numbers and a link only.
- **`/whats-new here`**: the top picks for this project, best first, each with its rating, the next
  step and why, and whether its names were found in your files. Free: it reads stored results.
- **`/whats-new news`**: recent Anthropic models, new features, deprecations and security changes,
  whatever your projects use.
- **`/whats-new export`**: writes a brief per project for everything rated at or above your threshold
  (it shows where each would go first).
- **`/whats-new`**: updates now, whatever the schedule (for a release you just heard about).
- **The review page** (a private claude.ai artifact): **Top picks** by project with one **Export**
  button, and **All items** for the full list with search, filters and plain-language rewrites.

Options: `here --min 8.5 --days 14 --project <id>`, `news --days 3`,
`export --min 9 --project <id>`. The command shows as `/whats-new-claude:whats-new`.

## Examples

1. **A model you use is being retired.** You open a session in your web app. The reminder says
   "1 top pick for web-app". `/whats-new here` shows it rated 8.8: the model id your code pins is
   retiring on a date in the release notes, with the next step "review models". `/whats-new export`
   writes a brief into the app's docs folder with one prompt that asks Claude to find the pinned model
   ids and propose the change, reporting first.
2. **A Claude Code change touches your hooks.** A release fixes hooks that were being skipped. The file
   check finds the hook name in your project's hook scripts, so the item rates 9.0 for that project with
   "update the harness: retest the gates", while the same item stays below 8 for projects that have no
   hooks.
3. **You heard about a launch this morning.** Run `/whats-new` to update now instead of waiting for the
   daily check, then `/whats-new news --days 1` for the new models and features from any source, or
   open the review page and filter **All items** by date.

## How it decides

1. **Fetches** new items from eight Anthropic sources: Claude Code releases, both Agent SDKs, the API
   release notes, anthropic.com (news, engineering, research), the skills and cookbooks repos, and new
   plugins in the official marketplace.
2. **Reviews** each item with three Claude calls that have **no tools**: impact on each of your
   projects, kind of change, and risk. Tested code merges them into an urgency level.
3. **Checks your files**: looks up the concrete names in each item (settings keys, model ids,
   packages, environment variables, hook names) in your project folders and `~/.claude` config,
   locally.
4. **Rates** the urgent and important items 0 to 10 per project. Code sets the allowed range from the
   urgency and the file check (for example, an item whose model id or package is not in a project's
   files cannot reach 8 for that project); a further Claude call with no tools places the item inside
   that range and says what to do. Items it has not rated yet show a provisional score.

## Setup

```
/plugin marketplace add gabrielp-creator/whats-new-claude
/plugin install whats-new-claude@whats-new-claude
/whats-new setup
```

Claude Code asks for the settings below when you enable the plugin; change them any time in `/config`
(they apply from the next session). Setup scans the folder you name, drafts a list of your projects
(name, one-line description, folder, brief folder) and saves it only after you confirm. The first
`/whats-new` asks how far back to look (7, 30 or 60 days).

| Setting | Default | What it does |
| - | - | - |
| Background update frequency | daily | `daily`, `every 3 days`, `weekly` or `manual`. When due, a session start updates in the background. |
| Top picks threshold | 8 | Rating that counts as a top pick. |
| Background rating budget | 0 | Claude calls a background update may make. 0 = never spend in the background. |
| Ask before more than this many calls | 30 | `/whats-new` asks first above this. |
| Session-start reminder | on | The one-line reminder. |
| GitHub token | none | Optional, read-only; raises GitHub's rate limit for background updates. |

Requires Claude Code 2.1.271 or later and Node 20 or later.

## What it costs

Fetching, the file check, `here`, `news` and `export` are free. Reviewing and rating make `claude -p`
calls on **your own Claude account**: about 4 calls for a typical day of releases (about 60 items).
The first run over 30 days of releases is larger; `/whats-new` shows the number and asks first above
your limit. Background updates spend only up to the budget you set (default: nothing), with a hard cap
in code. Plain-language rewrites on the page run only when you click for them.

## What it reads, sends and writes

- **Fetches** only from `api.github.com`, `platform.claude.com` and `www.anthropic.com`. Your GitHub
  token, if you set one, is sent only to `api.github.com`.
- **Sends to Anthropic** (through your own `claude -p` calls, the same as any Claude Code use): the
  release items, your project ids and one-line descriptions, and, for rating, the names that were or
  were not found in each project and the file paths where they were found. Never file contents.
- **Reads locally**: your project folders and your `~/.claude` config files (not transcripts), for the
  file check. File contents never leave your machine.
- **Writes**: its own data folder (`~/.claude/plugins/data/...`), your private review page, and, when
  you ask, brief files inside your workspace (never into `.git`, `node_modules`, `.claude`, `dotfiles`
  or folders you block, checked on disk so links and short names cannot get around it; never
  overwriting).
- **The review page** contains your project ids, your workspace folder path and the file paths where
  names were found (it is private to your claude.ai account unless you share it). It loads nothing
  from other sites. Full details: [PRIVACY.md](PRIVACY.md).
- **Never** edits your settings, hooks, skills, plugins or code.

## Safety design

Release notes and commit messages are written by other people, so everything fetched is treated as
untrusted data. Only Claude calls with no tools ever judge it, run in safe mode (no plugins, hooks or
MCP servers load), and code bounds what their answers can change. Every call counts against a hard cap
in code: the number you approved, or your background budget. What the commands show in your
session is cut short and labelled as data, and an item a reviewer flagged for containing instructions
aimed at an AI shows only its link. Briefs quote release text as data and ask for findings before any
change.

## Troubleshooting

- **No reminder at session start.** Run `/whats-new setup` first; the reminder also stays quiet when
  there is nothing at your threshold. Check that it is on in `/config`.
- **"This folder is not one of your configured projects."** `here` matches your working folder to the
  project folders from setup. Use `--project <id>`, or rerun `/whats-new setup` to add the folder.
- **A source FAILED.** It is retried on the next run and named in the reminder until it works. GitHub
  rate limits are the usual cause for frequent background updates; add a read-only GitHub token in
  `/config`.
- **"busy: a background update is running".** Wait a few minutes; only one update runs at a time.
- **Items show a "provisional" rating.** They have not been rated by the reviewer yet (over your
  budget, or a call failed); the next `/whats-new` rates them. Details of failed calls are in
  `failures.log` in the plugin's data folder.
- **New items wait instead of being rated in the background.** The background budget is 0 by default;
  raise it in `/config`, or run `/whats-new`, which asks before spending.
- **A hook error at every session start.** The plugin's scripts need Node 20 or later on your `PATH`;
  check with `node --version`.
- **Start over.** Uninstall the plugin (this removes its data folder) and install it again.

## Development

```
npm test                          # node --test tests/*.test.mjs
claude plugin validate .
```
