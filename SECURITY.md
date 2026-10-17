# Security

Please report security problems privately through GitHub: on this repository's **Security** tab,
choose **Report a vulnerability**. Do not open a public issue for them.

What the plugin does with your data, and its safety design, are described in [README.md](README.md)
and [PRIVACY.md](PRIVACY.md). Release text it fetches is treated as untrusted data throughout: only
Claude calls with no tools, in safe mode, ever judge it. Release text that reaches your session
(command output and briefs) is shortened and labelled as data; the reminder shows numbers only.

Prompt-injection reports are in scope and welcome: release text, a commit message or a plugin
description that makes a rating call, the session reminder, a command's output or a brief act on
instructions, change the ratings of other items, or reveal your files or settings.
