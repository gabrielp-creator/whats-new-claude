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
- Fix: the file check read Claude Code's agent worktrees (`.claude/worktrees/`) and other nested
  checkouts as the project's own files, so a copy on another branch could confirm an item or add a
  model id. It now skips `.claude/worktrees` and any subfolder holding a `.git` file (a worktree or
  submodule); a project folder that is itself a worktree is still read.
- The file check tells use from mention. A name counts as used only in code files and a closed list of
  config files (`package.json`, `settings*.json`, `*.toml`, GitHub workflow files, and the `model:`
  line of `.claude` agent, command, lens and skill front matter). Docs, HTML, other JSON, SQL, tests,
  fixtures, proofs, smoke checks, logs and full-line comments only mention it: a mention is shown to
  the rater as context but never confirms an item and never counts as "not found". Before, any text
  file confirmed, so stored release notes and review records could confirm every item and add model
  ids a project never runs. `models.json` now records each model id with its file and line, the ids
  only mentioned, and model aliases (`sonnet`, `opus`, `haiku`, `fable`, `inherit`, `*-latest`, from
  front matter, `--model`, `ANTHROPIC_MODEL` or a `model` setting). Aliases are recorded, never
  resolved: a launch or retirement in an alias's family is rated in the soon band with "your `sonnet`
  alias may have moved: confirm which model it runs", and the file and line. A launch for a project
  with no model id and no alias is "model not known", no longer capped as "not found". A breaking
  change in an alias's family gets the same "confirm which model it runs" note in the soon band,
  rather than reopening the urgent band. The setup check also reads `~/.claude/lenses`.
- A code or config file that quotes prose (runs of 8 or more words) from 3 or more release items is
  read as a release archive: its names are mentions, never confirmations. One copied snippet still
  counts, identifiers count as one word, and phrases shared by more than two items are ignored. Each
  such file is printed by the file check and listed under `archives` in `models.json`.
- Fix: CLI flags were never found. A release item names a flag with its dashes (`--strict-mcp-config`)
  and the file index dropped them, so a project passing the flag read "not found". Flags are now
  looked up with their dashes, and only within 10 lines of a call to the `claude` CLI in config or
  code (a shell `claude -...`, a `cmd: "claude"` setting, or `"claude"` on a line that starts a
  process), so another tool's `--continue` does not count; `-p`, `-c` and `-r` count as `--print`,
  `--continue` and `--resume`. In a project whose code calls `claude`, an absent flag counts as "not
  found" like any other name. `models.json` lists each project's `claudeCalls` with file and line.
  "Found in" now names a code file before a config file.
- Setup's project descriptions read `package.json` and `pyproject.toml` up to two folders below each
  project (skipping installed packages and dot folders), so a workspace that keeps its code in a
  subfolder is described with its packages. Only the draft written by `/whats-new setup` changes.
- **Privacy change:** the plugin now reads `settings.local.json` (in `~/.claude` and in each
  project's `.claude` folder), which it never opened before, and the `hooks/hooks.json` of enabled
  plugins. They are parsed in memory to a fixed set of facts, stored per project in `profile.json`:
  each hook's event, type and script path (never its command or prompt), the tool names in allow,
  deny and ask rules (never the rule text; MCP tools only as "mcp"), `defaultMode`, whether the
  sandbox is on, whether a skill or command runs inline shell, and Anthropic package names in
  manifests. PRIVACY.md and the README say so. The general file check still never opens
  `settings.local.json`, `.mcp.json` or `.env` files.
- Settings items can now be checked. A release item about hook types or events, permission rules,
  the sandbox, inline shell or a permission mode names no word a file search can find, so it stayed
  unchecked in its full band. Such items are now answered from the profile: a matching hook or rule
  confirms the item ("`command` hook on Stop", "Bash in deny rules"), and when every setting the item
  names is visible but absent, the item counts as "not found". A mode that can be switched during a
  session, or a project with no settings file, stays unknown.
- The file check records what a project's own scripted calls to the `claude` CLI switch off, in
  `profile.json` under `cli`, and prints it: tools (`--tools ""`), MCP (`--strict-mcp-config` with no
  `--mcp-config`), and hooks, skills, plugins and MCP (`--safe-mode`). A feature counts as off only
  when every call found turns it off with literal arguments and the project's `.claude` folder does
  not switch it on; arguments from a variable, a spread, a condition or `"$@"` make it unknown. Each
  entry lists the file and line of every call.
- The file check reads the installed Claude Code version with `claude --version`, run locally from the
  plugin's own folder (it sends nothing and is not a model call), and records it per project in
  `profile.json`. Output that is not a version records none. A project that depends on the Agent SDK
  runs the CLI the SDK bundles, so its version is recorded as unknown.
- Items now reach the projects they are about, not only the ones the reviews named. A release about a
  model your code pins reaches that project; an Agent SDK release reaches the projects that depend on
  that SDK, and no longer the ones that don't; a Claude Code change that a project's own scripted
  `claude` calls switch off moves to your setup instead (security, breaking and deprecation items stay,
  with a note); and an official security, breaking or deprecation item that reached no project is
  checked against every project's own settings.
- Which models a change is about is now read from its wording: ranges ("Opus 4.7+", "4.7 and newer",
  "4.0 to 4.7"), "Claude 3.x", the model a breaking change is on ("code written for X can break on Y"),
  and "earlier models aren't affected". A name found in your settings no longer confirms a change that
  is about models you don't use, and a confirmation resting only on a setting's key no longer raises
  an item. Open wording ("including", "other models") rules nothing out.
- A launch is now an item that says a model was launched, added or introduced, or made the default; an
  item saying a model is "available" somewhere is not. Only the newest model named per family is the
  launch, so a predecessor named for comparison no longer reads as "already adopted". Price and limit
  changes are their own kind: "check your price table" for a model you use, one line otherwise; a
  caching price also needs `cache_control` in your code.
- A breaking change on a model your code pins is confirmed with the file and line where it is used.
  When it came with a launch you already run, you are asked to confirm it is handled, at soon.
- **New fetch target:** the model deprecations page on `platform.claude.com` (an allowlisted host),
  read in its markdown form for a free retirement check with no Claude calls. A model id your code pins
  that is deprecated gets its own row, urgent, with the retirement date and the recommended
  replacement; one that is already retired gets a row asking you to confirm nothing still sends it.
  Upgrades from a retiring model are urgent with the date. A page that does not parse whole is an
  error, shown, and the last good copy is kept.
- Bands follow what your files show. An upgrade is soon, not urgent, unless your current model is
  retiring. An item not used here (not found, or about other models) drops to later; security,
  breaking and deprecation items stay in soon, below the 7+ list. The urgent floor for breaking and
  security items holds only when your files confirm the exposure and the reviews agree on what the
  item is. A new feature's own name not being in your files no longer counts against it.
- Claude Code fixes already in the version you run, with nothing in your settings that interacts with
  them, are listed once as "Already in your version" with no prompt and no rating call. New features,
  model launches and breaking changes stay rated.
- The rater now sees where each model is called, and its own score and any disagreement with the band
  are kept and shown ("rater disagrees"); they never move an item.
- Silent-failure counters in `summary.json` (open model scopes, ties added and dropped, unreadable
  scripted calls, items held at soon, and more); the session-start reminder names any that jumps.
- Briefs are grouped: Confirm handled, Act now, Later, then a one-line appendix (Not used here,
  Already in your version) with no prompts. One launch reported by several sources is one entry with
  every link. Prompts name only what the plugin's own check found (models and where they are called,
  an alias and its line, hooks and rule kinds), and a model change first looks for a decision you have
  already made. Entry headings are the plugin's own words; release text stays inside the quote. No
  brief is written for a project with nothing to confirm, act on or keep for later, and an export with
  nothing at your threshold falls back to 7+ and says so. New configs put briefs in `docs/` when that
  is where a project already keeps them.
- Each rating is stamped with the plugin version. Ratings made before 0.3.1 are marked "rated before
  0.3.1" and redone on your next run, counted in the same cost question, never as new items.
- Fixes from the release review: fork and third-party items never get a file check, so their text
  cannot learn which names your files hold. A `claude -p` command built by joining strings (`+`, an
  f-string, `.format`, `%`) or with an unquoted shell variable counts as not fully known, so nothing is
  taken as switched off. Model ranges such as "Opus 4.8 and 5 and newer", "onwards", "and up" and
  "starting with" no longer read as closed. In a brief, a source of the same launch that is not tied
  to the project adds its link but never decides the entry. A security item held for a project keeps
  its note even when the impact review saw no effect. A name found but set aside by the model scope
  shows as mentioned, not "not seen". A pinned dated snapshot matches its own row on the deprecations
  page. A command or skill whose name contains a word like "security" no longer makes items naming it
  a tripwire. A plugin whose name is not a plain short name gets a neutral title, its name kept in the
  quoted text. `claude --version` refuses a path the Windows shell would change.

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
