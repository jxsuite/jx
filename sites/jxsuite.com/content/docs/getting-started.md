---
title: "Getting Started — JX Suite"
description: "Install JX Suite and build your first component in under 5 minutes."
---

# Getting Started

Get up and running with JX Suite in under 5 minutes.

## Installation

Install the JX packages with your preferred package manager:

```bash
# Using bun (recommended)
bun add @jxsuite/runtime @jxsuite/compiler

# Using npm
npm install @jxsuite/runtime @jxsuite/compiler
```

## Your First Component

Create a file called `counter.json`:

```json
{
  "tagName": "my-counter",
  "state": {
    "count": 0,
    "increment": {
      "$prototype": "Function",
      "body": "state.count++"
    }
  },
  "children": [
    {
      "tagName": "span",
      "textContent": "${state.count}"
    },
    {
      "tagName": "button",
      "textContent": "+",
      "onclick": { "$ref": "#/state/increment" }
    }
  ]
}
```

This defines a reactive counter component entirely in JSON — state, behavior, and UI in one declarative document.

## Run the Dev Server

Start the development server:

```bash
bun run dev
```

Open `http://localhost:3000` in your browser. Changes to your JSON files trigger live reload automatically.

## Build for Production

Compile your site to static HTML:

```bash
bun run build
```

The output goes to `dist/` — plain HTML, CSS, and optional JavaScript. Deploy anywhere.

## What's Next

- **[Spec Overview](/docs/spec)** — The full Jx specification
- **[Component Model](/docs/components)** — How components work
- **[Reactivity](/docs/reactivity)** — Template strings, signals, and computed values
- **[Styling](/docs/styling)** — Inline styles, nested selectors, media breakpoints
- **[Site Architecture](/docs/site-architecture)** — Routing, layouts, content collections
