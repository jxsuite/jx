---
title: "Getting Started — JX Platform"
description: "Install JX Platform and build your first component in under 5 minutes."
---

# Getting Started

Get up and running with JX Platform in under 5 minutes.

## Installation

Install the JX packages with your preferred package manager:

```bash
# Using bun (recommended)
bun add @jxplatform/runtime @jxplatform/compiler

# Using npm
npm install @jxplatform/runtime @jxplatform/compiler
```

## Your First Component

Create a file called `counter.json`:

```json
{
  "tagName": "div",
  "state": {
    "count": 0,
    "increment": {
      "$prototype": "Function",
      "body": "state.count++"
    }
  },
  "children": [
    {
      "tagName": "p",
      "textContent": "Count: ${state.count}"
    },
    {
      "tagName": "button",
      "textContent": "Increment",
      "events": { "click": { "$ref": "#/state/increment" } }
    }
  ]
}
```

This defines a reactive counter component entirely in JSON — state, behavior, and UI in one declarative document.

## Run the Dev Server

Create a minimal HTML shell and start the dev server:

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

- **Explore the examples** — Counter, todo list, forms, markdown, and more in the `examples/` directory
- **Read the site architecture spec** — Learn about file-based routing, layouts, content collections, and multi-page builds
- **Try JX Studio** — The visual IDE for designing and editing JX components on a canvas
- **Browse the source** — [github.com/jxplatform/jx](https://github.com/jxplatform/jx)
