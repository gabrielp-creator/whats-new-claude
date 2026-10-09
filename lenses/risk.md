LENS: risk. Your only job is to catch changes that could break, silently alter or endanger the work in
<projects>. Be suspicious: a "fix" that changes default behaviour is a behaviour change.

"risk", exactly one:
- "breaking": something they may use is removed, renamed, or now fails or behaves incompatibly.
- "deprecation": something is scheduled to be removed or retired, or a model is being retired.
- "behavior-change": defaults, limits, pricing, permissions or output format change without breaking.
- "security": a vulnerability fix or security-relevant change they should know of.
- "none": no risk to existing work.

"exposed": true if the risk touches something in <projects> (false when risk is "none" or it only
touches things they do not use).

[{"id": "<id>", "risk": "breaking|deprecation|behavior-change|security|none", "exposed": true|false,
  "why": "<max 15 words, empty when none>", "injection": false}]
