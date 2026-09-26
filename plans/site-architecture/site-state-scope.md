---
status: stub
disposition: reconcile
claims:
  - site-architecture.md#10.4
size: S
---

# Site state is documented as `$site.<key>` and as inherited page state, the two ways it arrives

## Context

`specs/site-architecture.md` §10.4, line 1412:

> **Status: Partial.** Data files through `$ref`, `ContentCollection` and `ContentEntry` declarations, and `$props`-only component inputs ship. Item 1 does not hold: `injectContext` (`packages/site/src/context.ts`) spreads project `state` flat onto `$site` (`$site.siteName`, not `$site.state.siteName`) and also merges it into the page's own `state` as bare keys, the page winning, which is what §3.2 describes; item 1 and §5.5's `$site.state` row describe a nesting that does not exist.

The section was unmarked before the census. The spec contradicts itself: §3.2 says project `state` entries are "available to every page" and that "a page may shadow a site-level `state` entry with its own", which is the bare-key merge the code performs, while §10.4 item 1 says site state is reachable only as `$site.state.foo` "to prevent naming collisions". §3.2 does not wholly agree with the code either: it also calls those entries "read-only from the page's perspective", and `injectContext` copies each one into the page's own `state` as an ordinary, writable entry. The user docs (`docs/framework/site/project-json.md`, around line 104) document both shipped forms.

Disposition `reconcile`, on the evidence that the code, the docs and §3.2's merge and shadowing rules agree. The detail phase must still confirm the collision argument is acceptably answered by "the page wins", because reversing the bare merge would break every project that relies on it.

**What exists**

- `injectContext` in `packages/site/src/context.ts`: `doc.state.$site = { name, url, …locales, ...projectConfig.state }`, then each project `state` key copied into `doc.state` when the page does not declare it; `packages/site/tests/context.test.ts` ("spreads project state into $site").
- The same function feeds the build, the Studio canvas and the cloud preview.

**What is missing**

- §10.4 item 1 rewritten to the two shipped access paths, `$site.<key>` read-only and bare `state.<key>` shadowable by the page.
- §5.5's `$site.state` row rewritten to `$site.<key>`. §5.5 is owned by `plan:site-architecture/page-context-props`, which requires this plan for that row and closes the section after it lands.
- Ride-alongs in two verified sections, both describing the bare merge as read-only when it is writable page state: §3.2's "(read-only from the page's perspective)" and §10.1's "Site `state` (read-only)" cell.
- A test pinning that a page's own key wins over a project key of the same name.

**Related**

- site-architecture.md §3.2 (inheritance), site-architecture.md §5.5 (layout props), site-architecture.md §10.1 (cascade hierarchy).
- site-architecture.md §13.7, which relies on the component boundary being the state boundary.
