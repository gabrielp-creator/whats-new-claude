# Privacy policy: What's New for Claude

Effective 2026-10-08. Applies to the Claude Code plugin `whats-new-claude`.

The plugin has no server of its own. It runs on your computer, inside Claude Code, and its developer
receives nothing from it: no analytics, no telemetry, no accounts.

## What it fetches
Public release information only, from `api.github.com`, `platform.claude.com` and `www.anthropic.com`,
over https, with every redirect checked against that list. Those services see an ordinary request from
your computer (your IP address and a `whats-new-claude` user agent). If you set the optional GitHub
token, it is sent only to `api.github.com`.

## What it reads on your computer
- **Your project folders and your `~/.claude` configuration** (`settings.json`, `CLAUDE.md`,
  `keybindings.json`, and the `rules`, `agents`, `commands`, `hooks` and skill files; never
  transcripts, `projects/` or `settings.local.json`), to look up whether names in a release (model
  ids, packages, settings keys and similar) appear in your files. File contents are read in memory and
  never stored or sent anywhere; only the matched name and the file path are kept.
- **Never opened:** environment and credential files (`.env*`, `credentials*`, `*secret*`, service
  account files, `.mcp.json`, private keys, `.npmrc`, `.netrc`, `.pypirc`, `token.json`).
- **At setup**, the first line of each project's `package.json`, `README.md` or `CLAUDE.md`, to draft
  its one-line description, which you confirm or edit before anything is saved.
- **The names of your own commands, skills, agents, hooks and settings keys** in `~/.claude`, so a
  release that mentions one of them is always shown.

## What it sends, and to whom
- **To Anthropic, through your own Claude Code account** (`claude -p` calls, billed to you like any
  Claude Code use, under Anthropic's terms and privacy policy, run in safe mode so your CLAUDE.md and
  memory are not loaded): the release items, your project ids and one-line descriptions, the
  platforms you said you do not use, and, for rating, the names that were or were not found in each
  project and the file paths where they were found.
- **To your private claude.ai review page**, if you publish it: the release items and their ratings,
  your project ids and brief folders, your workspace folder path, the file paths where names were
  found, and the names of your own commands or skills that a release mentions. The page is private to
  your claude.ai account unless you share it; anyone you give edit access can see and change its
  saved selections and folders.
- **From the review page, when you use it:** a plain-language rewrite sends the shown release items to
  Anthropic through the viewer's own claude.ai account and saves the result in the page's database; a
  question you ask about an item goes to your Claude Code session as a comment.
- Nothing is sent to the plugin's developer or anyone else.

## What it stores, and for how long
In its data folder (`~/.claude/plugins/data/whats-new-claude-*/`; `~/.whats-new-claude` if its scripts
are run outside Claude Code): your project list and settings (`config.json`, `config.draft.json`,
`options.json`), the fetched release items and commit details, the review and rating answers, the
matched names and file paths (`evidence.jsonl`), run state and summaries (`state.json`,
`summary.json`, `updater.json`), the built page (`results.html`), a usage log of its own Claude calls
(tokens and cost), a failure log, and the brief export when you write briefs from the page. The
review page's database holds your selections, brief folders and plain-language rewrites.

It keeps them until you delete them or uninstall the plugin; Claude Code deletes the plugin data
folder when the plugin is uninstalled from the last place it is installed (the `~/.whats-new-claude`
fallback, if used, you delete yourself). Brief files it writes, at your request, stay in your project
folders until you delete them.

## Your choices
- Remove a project from the list, or its folder, and it is no longer searched (`/whats-new setup`).
- Background updates and their Claude spending are set in `/config` (spending is off by default).
- Uninstall the plugin to remove its data folder; delete the review page from claude.ai to remove it.

## Contact
Questions or problems: open an issue at https://github.com/gabrielp-creator/whats-new-claude/issues. Security concerns: report privately through GitHub (Security tab, "Report a vulnerability") on the same repository; see SECURITY.md.
