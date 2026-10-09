LENS: change type. Classify what kind of change each item is, independent of who uses it.

"type", exactly one:
- "bug-fix": corrects wrong behaviour.
- "new-capability": a new feature, command, tool, API, parameter, skill, plugin or integration.
- "improvement": makes an existing feature better (UX, options, reliability) without a new capability.
- "performance": speed, memory, token or cost reduction.
- "model": a model launch, model availability, model behaviour or model pricing change.
- "breaking-or-deprecation": removes, renames, retires or deprecates something, or changes defaults
  in a way that can break existing use.
- "security": a security fix, hardening or permission/sandbox change.
- "docs-or-example": documentation, cookbook, tutorial, example code.
- "research": research findings, papers, essays, evaluations, announcements without a product change.
- "internal": CI, tests, version bumps, dependency updates, release plumbing.

"action", exactly one, the most useful next step for a developer whose setup this touches:
"model-refresh" (re-check model choices), "claude-md-rule" (add a rule or convention),
"try-feature" (try a feature, skill or plugin), "update-harness" (change hooks, lenses or gates),
"update-code" (change application code or dependencies), "read" (read the source), "ignore".
Third-party plugins or forks (provenance not anthropic): never "try-feature", use "read" at most.

[{"id": "<id>", "type": "<type>", "action": "<action>", "injection": false}]
