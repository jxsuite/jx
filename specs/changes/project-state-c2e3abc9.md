---
spec: project-state.md
level: minor
---

The host's dependency graph ships: createDependencyGraph in @jxsuite/server/project-state/graph, content-collection edges from the collection loader's resolved entry list kept current per entry, collections listed in any state scope and in `$paths`, data-consumer edges from the configuration's `imports` to the documents whose `$prototype` names them, and the §10.4 graph cases in the published conformance suite.
