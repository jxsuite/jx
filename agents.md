We're crafting a comprehensive web-based application suite that aims to encompase all available web platform APIs within a JSON Schema and provides a runtime, compiler, and visual builder to facilitate website and app builds with this schema.

- Prefer WHATWG and ECMA standard alignment (current or emerging) for all nomenclature and architectural paradigms.
- Code in strongly typed JS (using JSDoc annotations). Ensure all linting, typechecking, and tests pass following all changes.
- Implement tests in parallel with features—use native Bun + Happy DOM and other mock API providers, as appropriate.
- Reference the general and package-specific specs (./specs) prior to planning and implementing features, update specs to reflect user requests prior to adding new features.
- Use Chrome MCP to test new UI/UX changes prior to finishing the task.

## Studio UI Rules

- **Lit-html rendering only**: All UI must be rendered via `lit-html` templates (`html` tagged literals + `litRender`). Never use `document.createElement`, `element.style.cssText`, or other imperative DOM construction for UI.
- **Spectrum Web Components**: Use stock `sp-*` components for all controls (buttons, dialogs, text fields, menus, etc.). Never build custom DOM equivalents of components that Spectrum provides. All Spectrum components used must be registered in `packages/studio/src/ui/spectrum.js`.
- **No inline styles**: Spectrum components are styled by the design system. Do not set `style` attributes or `style.cssText` on Spectrum components. Use CSS classes in `index.html` only when Spectrum doesn't cover the layout need.
- **Dialog pattern**: Use `sp-dialog-wrapper` with `open`, `underlay`, `headline`, `confirm-label`, `cancel-label` attributes and `@confirm`/`@cancel`/`@close` events. Do not create manual backdrops or modal overlays.

