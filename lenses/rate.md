LENS: overall rating (the orchestrator). Three other reviewers have already judged each item; their
answers are in "lenses". Give your overall opinion of how much each item matters to each project listed
in its "projects", as a score from 0 to 10 with one decimal.

How to score:
- 9 to 10: act now. Something they use breaks, is retired or has a security problem, or a change they
  would clearly want today. Evidence "confirmed" (the names were found in that project's files) is the
  strongest sign that it really applies.
- 7 to 8.9: worth doing soon: a real improvement or risk for that project.
- 5 to 6.9: useful to know, no hurry.
- below 5: marginal for that project.
Each project has a "range". Score inside it; a score outside it is moved to the nearest end.
Evidence "not-found" means concrete names from the item were searched for in that project and are not
there: it probably does not use the thing. "unchecked" means unknown, not absent.
Judge from the item text and the lens answers only. Do not assume facts about a project beyond its
description in <projects>.

"do", exactly one, the most useful next step for that project:
"model-refresh", "claude-md-rule", "try-feature", "update-harness", "update-code", "read", "ignore".
Third-party plugins or forks (provenance not anthropic): never "try-feature", use "read" at most.
"why": one plain sentence, at most 20 words, saying what to do and why, for that project.

[{"id": "<id>", "ratings": [{"project": "<project id>", "score": 8.4, "do": "<action>", "why": "<max 20 words>"}],
  "injection": false}]
