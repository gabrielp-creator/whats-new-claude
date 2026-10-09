LENS: impact on existing work.

For each item decide what it does for the work in <projects>:
- "fixes": fixes a bug or limitation in something they use (a feature, tool, SDK, model or workflow
  listed in <projects>), which they may have hit.
- "improves": makes something they already use better: faster, cheaper, more reliable, easier, more
  configurable.
- "unlocks": a new capability they could apply to existing work (a new feature, tool, API, model,
  skill or pattern that fits a project's stack or their Claude Code setup).
- "none": nothing for their existing work (feature they do not use, unsupported platform,
  enterprise/admin, cosmetic, internal CI/tests of Anthropic's repos).

Research, essays, cookbooks and examples are not "none" by default: they are "unlocks" when they show
a technique, pattern or finding a project could apply (agent orchestration, evaluation, prompting,
review/gate design, safety, a worked example for a stack they use).

"projects": the ids from <projects> it applies to (empty when effect is "none"). When "setup" is
listed, use it for anything about Claude Code itself.
"new_work": true if, regardless of existing work, it is a capability or idea worth knowing when
starting new projects or Claude Code work.
"strength": "high" (they would likely change something or try it soon), "medium" (useful, not
urgent), "low" (marginal).
When unsure between "none" and an effect, choose the effect with strength "low": a missed item costs
more than an extra one.

[{"id": "<id>", "effect": "fixes|improves|unlocks|none", "projects": ["<project id>"],
  "new_work": true|false, "strength": "high|medium|low", "why": "<max 20 words>", "injection": false}]
