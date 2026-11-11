---
title: "Type checking"
description: "Check a .jxn document with tsc and in your editor: its scripts, function bodies, templates, references and the props it gives a component."
spec:
  - spec.md#23.3
code:
  - packages/schema/src/jxn/virtual-document.ts
  - packages/schema/src/jxn/document-scopes.ts
  - packages/schema/src/jxn/state-types.ts
  - packages/schema/src/jxn/schema-types.ts
  - packages/content-mapper/src/mapper.ts
  - packages/content-mapper/src/server.ts
---

# Type checking

A `.jxn` document holds TypeScript in two places: its [script](/docs/framework/concepts/functions#a-module-inside-the-document) and the `body` of each function. It names the same state in two more: each `${}` template, and each `$ref` into `state`. And it names another document's state wherever it gives a component its `$props`. `tsc` checks all five, and prints each error at the line and column where you wrote it. An editor that runs TypeScript's language server shows the same errors, with hover, completion, rename and go to definition.

The work is done by `@jxsuite/content-mapper`, a program TypeScript starts to read a kind of file it cannot read itself. Content mappers arrive in TypeScript 7.1, which is a beta today.

:::doc-note
Studio checks a function body as you type, and a whole `.jxn` file in its Code editor, with nothing to install ([Code editing](/docs/studio/logic/code#type-errors-in-a-jxn-file)). This page is about the terminal, CI and your own editor. Only `.jxn` documents are read here. A `.json` document's bodies are checked in Studio and nowhere else, and its templates and references are checked nowhere.
:::

## Set it up

Install the compiler and the mapper:

```sh
bun add -d typescript@7.1.0-beta @jxsuite/content-mapper
```

TypeScript starts the mapper with `node`, so Node has to be on your path even in a project that otherwise runs on Bun. The mapper needs Node 22.18 or newer on the 22 line, or 24.11 or newer.

Add a `tsconfig.jxn.json` beside your project file:

```json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "contentMappers": [{ "extensions": [".jxn"], "package": "@jxsuite/content-mapper" }],
  "include": ["pages", "layouts", "components", "src"]
}
```

Then give it a script in `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.jxn.json --runExternalCode"
  }
}
```

:::doc-warning
`--runExternalCode` is not permission for one mapper. It lets `tsc` start every content mapper the `tsconfig` names that has a file to read, each as a program with your own access to the machine. That is why the mapper gets a `tsconfig` of its own here: the flag covers one short file you can read in full. Read the `contentMappers` list of a `tsconfig` you did not write before you run it with this flag.
:::

Without the flag `tsc` starts no mapper, reads no document, and says why:

```text
tsconfig.jxn.json(8,3): error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.
```

That is the second reason for the separate file. A `tsconfig.json` with no `contentMappers` in it keeps working for every tool that runs `tsc` without the flag. A `.ts` file that imports a document is reported there as importing a module that cannot be found (`TS2307`), so check such a file under `tsconfig.jxn.json`.

## Reading the errors

Here is a page with three mistakes in it, `pages/counter.jxn`:

```kdl
div {
  script #"""
    const STEP = 1;
    export function increment(state: State) {
      state.count += STEP;
    }
    """#
  state {
    count 0
    (export)increment
    (export)decrement
    (fn)reset "state.count = STEP - 1"
  }
  button {
    (fn)onclick "state.total += 1"
  }
}
```

And a module that imports it, `src/use.ts`:

```ts
import type { State } from "../pages/counter.jxn";
import { increment } from "../pages/counter.jxn";

export function twice(state: State): void {
  increment(state);
  increment(state);
}
export const label: State["count"] = "three";
```

`bun run typecheck` prints four errors:

```text
pages/counter.jxn(11,13): error TS2694: Namespace '"/home/you/site/pages/counter.jxn"' has no exported member 'decrement'.
pages/counter.jxn(12,30): error TS2304: Cannot find name 'STEP'.
pages/counter.jxn(15,24): error TS2339: Property 'total' does not exist on type 'State'.
src/use.ts(8,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

- **`(export)decrement`** names an export the script does not have. The error is on the entry, at the name.
- **`STEP`** belongs to the script. A body is not inside the script, so it reaches a script's function through the state entry that exports it and reaches nothing else.
- **`state.total`** is not an entry of this page's `state`.
- **`State["count"]`** is `number`, because `count 0` is. A `.ts` file that imports a document gets its client script's exports and its `State`.

A column counts UTF-16 code units from one, as it does in a `.ts` file. It is the column in the `.jxn` file whichever way the string is spelled: a quoted string with escapes, a multi-line string or a raw string.

A file that is not valid Jx Notation gets one error of the mapper's own, with the code `jx1`:

```text
pages/broken.jxn(4,1): error jx1: A document has one root element, and this is a second
```

While any file has one, `tsc` prints those and no type errors, as it does for a syntax error in a `.ts` file.

## What `State` says

Inside a script, `State` is the type of the document's `state`, in scope without an import. Inside a body, `state` has that type. It says what the document can prove and no more:

| Entry                                                      | Type                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A string, number or boolean                                | `string`, `number`, `boolean`                                                                          |
| An object or an array                                      | Its shape, or the types of its items                                                                   |
| An entry with a `type`                                     | What its schema says ([Declared types](#declared-types))                                               |
| `(export)name`                                             | The type of the export it names, or of its return value when the document reads it as a computed value |
| `(server)name`                                             | What the server function resolves to, or `null` before it has answered                                 |
| `(fn)name` with a body                                     | A function, or any type when the document reads it as a computed value                                 |
| A `$prototype` instance, an expression, a template, `null` | Any type                                                                                               |

An entry the document cannot give a type to is any type, not an error. So is a parameter a function declares without a type ([A parameter's type](#a-parameters-type)), except the one that receives the event ([Events and rows](#events-and-rows)).

A handler on an element inside a section with its own `state` sees that state and its parents'. A hover there names the inner section by number: `(property) State$1.local: number`. The number is the section's place in the document, so it changes when you add a section above it. A `.ts` file can import `State` and cannot import `State$1`.

**Whether an unknown name is an error depends on what surrounds the document.** A page with a layout, or in a project whose project file has `state` of its own, reads entries the page never declares. There `state.anything` is allowed, and only the names the page does declare are typed. A layout in the project's `layouts` folder is open in the same way, because it reads the state of whichever page it wraps. A page with neither, and every component, is exact: `state.total` above is an error because nothing else could have declared it. A name that begins with `$`, such as `state.$media`, is always allowed.

The mapper learns this from the nearest project file at or above the document, and looks no higher than the folder `tsconfig.jxn.json` is in. That is why the file goes beside your project file.

## Declared types

An entry can say what it holds instead of leaving it to its first value. That matters most for a list that starts empty, which proves nothing about its items. Write the types once in `$defs`, and name them from `state`:

```kdl
$defs {
  TodoItem {
    type object
    properties {
      id type=integer
      text type=string
      done type=boolean
    }
    required id text
  }
  Status {
    type string
    enum idle loading
  }
}
todo-list {
  state {
    items {
      type type=array items=(ref)"#/$defs/TodoItem"
      (array)default
    }
    status type=(ref)"#/$defs/Status" default=idle
    (fn)add "state.items.push({ id: 1, text: 2 })"
    (fn)finish "state.status = \"done\"; state.items[0].done.valueOf()"
  }
  p "${state.items[0].txt}"
}
```

```text
todo-list.jxn(23,40): error TS2322: Type 'number' is not assignable to type 'string'.
todo-list.jxn(24,17): error TS2322: Type '"done"' is not assignable to type 'Status'.
todo-list.jxn(24,42): error TS2532: Object is possibly 'undefined'.
todo-list.jxn(26,23): error TS2551: Property 'txt' does not exist on type 'TodoItem'. Did you mean 'text'?
```

A definition is named in an error as you named it. Each one is a type in a namespace called `$defs`, so `#/$defs/TodoItem` is `$defs.TodoItem`, and a `.ts` file can use it:

```ts
import type { $defs } from "./components/todo-list.jxn";

export const first: $defs.TodoItem = { id: 1, text: "Write the docs" };
```

A schema is read keyword by keyword:

| Schema                                          | Type                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `type` of `string`, `number`, `boolean`, `null` | That type. `integer` is `number`                                       |
| `type` with several names                       | Any one of them                                                        |
| `enum`, `const`                                 | Exactly those values, when each is a string, number, boolean or `null` |
| `type=array`                                    | A list of what `items` says                                            |
| `type=object`                                   | Each of `properties`, optional unless `required` lists it              |
| `anyOf`, `oneOf`                                | Any one of the schemas                                                 |
| `allOf`                                         | All of the schemas at once                                             |
| `$ref` to `#/$defs/Name`                        | That definition                                                        |

Three rules decide the rest:

- **A schema with no `type` is any type.** `properties` alone does not make an object, because in JSON Schema it constrains nothing until `type` says the value is one. Keywords that validate a value, such as `minimum`, `pattern` and `format`, say nothing about its type.
- **An object is exact about its properties.** Reading or writing one the schema does not list is an error, which is how a misspelling is caught. Add `additionalProperties=#true` to allow any other key.
- **A vague type gives way to the default.** `type=array` with no `items`, `type=object` with no `properties`, or no `type` at all says nothing about what is inside, so an entry with a `default` is typed from that value. `nums type=array` with a default of `1` and `2` is a list of numbers. A type that does say what is inside always wins over the default.

A `$ref` to a definition the document does not have is an error at the name, which says that `$defs` has no exported member of that name. A `$ref` to another file, or deeper into a definition (`#/$defs/TodoItem/properties/id`), is any type.

A `required` list needs more than one name to be a list. Write `(array)required id` for a single name, since `required id` alone is a string and makes nothing required.

### A parameter's type

A function written as a block lists its `parameters`, and each one can say its type. `text` is TypeScript, written as you would write it after the colon. Anything else in `type` is a schema, read by the table above. Either one can name a definition:

```kdl
$defs {
  Task {
    type object
    properties {
      id type=integer
      title type=string
    }
    required id title
  }
}
div {
  state {
    total 0
    add {
      $prototype Function
      parameters {
        - { name price; type text=number }
        - name=task type=(ref)"#/$defs/Task"
        - { name done; optional #true; type text="(task: $defs.Task) => void" }
        - { name unit; type text=Currency }
      }
      body "state.total += price.length; task.title.toFixed(); done(task); void unit"
    }
  }
}
```

```text
pages/cart.jxn(20,34): error TS2304: Cannot find name 'Currency'.
pages/cart.jxn(22,34): error TS2339: Property 'length' does not exist on type 'number'.
pages/cart.jxn(22,53): error TS2551: Property 'toFixed' does not exist on type 'string'. Did you mean 'fixed'?
pages/cart.jxn(22,64): error TS2722: Cannot invoke an object which is possibly 'undefined'.
```

- **`price`** is a `number` and **`task`** is a `$defs.Task`, so the body is held to both.
- **`done`** is marked `optional`, so it may be `undefined` and has to be checked before it is called.
- **`Currency`** names nothing, and the error is at the word in the `text`. Text can use any type TypeScript knows without an import (`KeyboardEvent`, `Record<string, number>`), and the document's own definitions as `$defs.Name`.

A parameter written as a bare name, or with no `type`, is any type. A `type` that says nothing about what is inside gives way to the parameter's `default`, as an entry's does. `state` is always the document's `State`, whatever is written beside it. On an event handler, a type on the first parameter after `state` replaces the event's ([Events and rows](#events-and-rows)).

The types hold inside the body only. What a caller passes is not checked against them ([Limits](#limits)).

## Events and rows

A handler knows which event it is given and which element it is on. Here is `pages/todos.jxn`:

```kdl
main {
  state {
    todos {
      - { title "Write"; done #false }
    }
    draft ""
  }
  input {
    (fn)onkeydown "if (event.key === 'Enter') state.draft = event.target.value"
  }
  form {
    input
    (fn)onsubmit "event.preventDefault(); event.target.reset()"
  }
  ul {
    $array items=(ref)"#/state/todos" {
      li {
        (fn)onclick "state.$map.item.done = !state.$map.item.finished"
      }
    }
  }
}
```

```text
pages/todos.jxn(13,43): error TS18047: 'event.target' is possibly 'null'.
pages/todos.jxn(13,56): error TS2339: Property 'reset' does not exist on type 'EventTarget'.
pages/todos.jxn(18,62): error TS2339: Property 'finished' does not exist on type '{ title: string; done: boolean; }'.
```

- **The `onkeydown` handler has no error.** On an `input`, `event` is a `KeyboardEvent`, so `event.key` is known. Both `event.currentTarget` and `event.target` are the `HTMLInputElement`, so `event.target.value` is a string.
- **The `onsubmit` handler has two.** A form holds other elements, and a `submit` could have started on one of them, so `event.target` is `EventTarget | null`, as the browser declares it. Write `event.currentTarget.reset()`. `currentTarget` is always the element the handler is on.
- **`state.$map`** is the row a repeated element is drawn for. `item` is one of `todos`, so `done` is a boolean and `finished` does not exist. `index` is a number.

`event.target` is typed as the handler's own element in three cases, the ones where the event cannot have started anywhere else:

- The element holds no other element: only text, or nothing.
- The event does not bubble, such as `focus`, `blur`, `load` and `mouseenter`.
- The element is a `select`, and the event is `change` or `input`.

Name the event as a parameter (`(fn)onkeydown e "..."`) and `e` has the same type.

A function in `state` that elements bind, such as `onclick=(ref)"#/state/save"`, gets the events of those bindings. Bound to a button's `onclick` and a form's `onsubmit`, its event is one or the other and it has to tell them apart. A function that anything else in the document names (a body that calls `state.save()`, a template) gets an event of any type, since a caller can pass whatever it likes.

`item` is typed when the document says what the list holds: a list written in the document, a `state` entry, or part of an outer row (`items=(ref)"$map/item/tags"`). A list that is fetched or computed gives an `item` of any type.

Three things are any type, by design:

- **An element the browser does not name.** A custom element's events are its own.
- **An event the browser does not name**, such as one your code dispatches.
- **Everything, in a project without the DOM library.** If `compilerOptions.lib` leaves out `dom`, every event is any type and no handler is reported for reading one.

## Templates and references

A template and a `$ref` are not function bodies, and they name `state` all the same. Both are checked. Here is `pages/list.jxn`:

```kdl
main {
  state {
    todos {
      - { title "Write"; done #false }
    }
    filter "all"
    (fn)clear "state.todos = []"
  }
  h1 "${state.todos.length} to do, showing ${state.filtre}"
  button "Clear" onclick=(ref)"#/state/clear"
  input value=(ref)"#/state/fliter" onchange=(ref)"#/state/filter"
  ul {
    $array items=(ref)"#/state/todos" {
      li "${index + 1}. ${item.title} ${item.finished ? 'done' : ''}" hidden=(ref)"$map/item/done"
    }
  }
}
```

```text
pages/list.jxn(9,52): error TS2551: Property 'filtre' does not exist on type 'State'. Did you mean 'filter'?
pages/list.jxn(14,46): error TS2339: Property 'finished' does not exist on type '{ title: string; done: boolean; }'.
pages/list.jxn(11,52): error TS2345: Argument of type 'string' is not assignable to parameter of type '(state: any, event: Event & { readonly currentTarget: HTMLInputElement; readonly target: HTMLInputElement; }) => unknown'.
pages/list.jxn(11,29): error TS2551: Property 'fliter' does not exist on type 'State'. Did you mean 'filter'?
```

- **`${state.filtre}`** is a misspelling inside a template. The error is at the name, inside the string.
- **`${item.finished}`** reads the row. In a template the row goes by four names, and all four are typed: `item`, `index`, `$map` and `state.$map`.
- **`onchange=(ref)"#/state/filter"`** binds a handler to a string. A `$ref` on an `on` member has to name a function the binding can call, with that binding's event. The browser would attach nothing and say nothing.
- **`#/state/fliter`** names an entry that is not there. The error is at the name inside the `$ref`.

### Where a string is a template

A string is checked as a template where the runtime reads it as one:

- An element's text, a property, an attribute, a `style` value, and a value handed to a component as `$props`.
- A `state` entry that is a string.
- What configures a `$prototype` entry, such as the `url` of a `Request`.

A string anywhere else is data. A `${` inside a list in `state` is text, and is left alone.

A template is JavaScript and not TypeScript, because that is how the page runs it. A type written inside one is an error here (`TS8016`), as it is a syntax error on the page. Outside a repeated element, `item`, `index` and `$map` are any type, and so are `$site` and `$page`.

### Which references are checked

A `$ref` is checked when it reads `state` or a row: `#/state/...`, `$map/...` and `#/$map/...`. Each name in the path is checked against the one before it, so `#/state/todos/0/finished` is an error at `finished`. A step through an entry that is `null` until it loads is allowed, since the page reads it as nothing until then.

A `$ref` with another scheme (`window#/`, `document#/`, `parent#/`, a file) is not checked.

## Component props

A component is a document, and its `state` is what an instance can be given. So each prop is checked against the component's `State`. Here is `components/site-card.jxn`:

```kdl
site-card {
  state {
    heading ""
    count 0
    featured #false
  }
  h2 "${state.heading}"
}
```

And a page that uses it twice, `pages/index.jxn`:

```kdl
main {
  state {
    title "Latest"
    total 3
  }
  site-card {
    $props heading=(ref)"#/state/title" count="3" featured=#true
  }
  site-card {
    $props heading=(ref)"#/state/total" headline="New"
  }
}
```

```text
pages/index.jxn(7,41): error TS2322: Type 'string' is not assignable to type 'number'.
pages/index.jxn(10,12): error TS2322: Type 'number' is not assignable to type 'string'.
pages/index.jxn(10,41): error TS2561: Object literal may only specify known properties, but 'headline' does not exist in type 'Props<State>'. Did you mean to write 'heading'?
```

- **`count="3"`** gives a string to an entry the card declares as a number. The error is at the prop's name.
- **`heading=(ref)"#/state/total"`** passes a number where the card holds a string. A `$ref` has the type of the entry it names.
- **`headline`** is not an entry of the card. The page would render without it and say nothing.

Each prop is checked by itself, so one mistake does not hide the next.

### Which document a tag names

The mapper finds a component's document in two places:

- **`$elements`.** Each `.jxn` file the document lists by a relative path, such as `(ref)"../components/site-card.jxn"`. A file that is not there is an error at its entry (`TS2307`), and until it is there no prop in that document is checked.
- **The project's `components` folder.** Each `.jxn` file directly inside it that is named for its tag, such as `components/site-card.jxn`. A project uses these without declaring them, and so does the mapper.

A tag that neither one names takes any prop. That covers a custom element from a package, a `.json` component and a component kept in a subfolder that no `$elements` entry points at.

### What a value is checked as

| Value                                                         | Checked as                                  |
| ------------------------------------------------------------- | ------------------------------------------- |
| A `$ref` into `state` or a row                                | The type of the entry it names              |
| A string, a number or a boolean                               | Itself                                      |
| A template, `null`, a list, an object, a `$ref` anywhere else | Any type. The prop's name is still checked. |

A prop may always be `null` or `undefined`, so a `$ref` to an entry that is `null` until it loads is no error for that.

A component whose own `State` allows unknown names ([What `State` says](#what-state-says)) takes any prop name, and only the names it declares are typed. Every file in a project's `components` folder is exact.

## In an editor

TypeScript 7.1's language server reads the same `tsconfig.jxn.json`, and through the mapper it answers for a `.jxn` file what it answers for a `.ts` file:

- **Errors** at the same positions `tsc` prints.
- **Hover** on `state.count` in a body or a template, or on `count` in `"#/state/count"`, shows `(property) State.count: number`. Hover on an event parameter shows the event and the element, such as `KeyboardEvent & { readonly currentTarget: HTMLButtonElement; ... }`.
- **Completion** after `state.` lists the document's entries.
- **Go to definition** from `state.count` in a body, or from `count` in a `$ref`, goes to the entry. An entry written `(export)increment` is the script's function under the same name, so from `state.increment` it goes to the function. Where an entry names its export apart, as `(export)hello $export=greet`, it offers the entry and the function. From a prop's name it goes to the component's entry, in the component's file. From the name at the end of `"#/$defs/TodoItem"` it goes to the definition.
- **Rename** of an entry rewrites the entry, the script, every body and template that reads it and every `$ref` that names it, in the document's `state` or a nested section's. It can start from any of them. A section that declares an entry under a name the document also uses has an entry of its own, so renaming one leaves the other and everything that reads it. An entry written `(export)increment` and the function it exports are one name, so renaming the function, the entry or `state.increment` rewrites all three. Renaming a script's function rewrites the `$export` that names it. Renaming a component's entry also rewrites the prop in every `.jxn` document that sets it, and renaming the prop renames the entry. Renaming a definition rewrites every `$ref` to it in the document, and renaming a property in a definition rewrites the bodies and templates that read it.

The language server also notices a project file changing. Give a project `state` of its own, or a default layout, and its open pages are checked again without a restart. This reaches every project in the folder `tsconfig.jxn.json` is in or in a folder under it, apart from `node_modules` and folders whose names begin with a dot. It relies on the editor reporting file changes to the language server, which editors do when a server asks.

The language server runs a mapper only when the editor tells it the project may run external code, which is the editor's form of `--runExternalCode`. Until it does, a `.jxn` file gets no errors, no hover and no completion, and nothing says why.

There is no Jx editor extension yet. Your editor has to be told by hand that a `.jxn` file goes to the TypeScript language server.

## Limits

- **`.json` documents** are not read. Studio checks their bodies.
- **Studio does not use the mapper.** Its function editor checks a body on its own, and its Code editor checks one `.jxn` file at a time: the scripts, bodies, templates and references in it, and no prop given to a component kept in another file. `tsc` is what reads the whole project.
- **`jx build` does not run it.** A build still accepts a document with a type error, so run the script in CI.
- **A class's methods** are not checked.
- **A call is not checked against a function's parameters.** A parameter's type holds inside the body. `state.add("a")` is accepted whatever `add` declares, because a function entry is callable with anything, and the entry's own `type`, which says what it returns, is not read.
- **`$defs` are read from the document that uses them.** A `$ref` to a definition in another file is any type, and so is a definition whose name is not an identifier, such as `todo-item`.
- **Renaming a property does not rewrite `required`.** The list holds the old name, so the property becomes optional and the next check usually says so.
- **Props are checked only in `$props`, and only against a `.jxn` component.** A property or an attribute written on the instance itself is not held against the component. A prop named for a private entry, such as `#cache`, is not reported here, though the page refuses to set it.
- **A project file added in a folder that had none is seen when a document is next read.** The one exception is the folder `tsconfig.jxn.json` is in, which is watched whether it holds a project file or not. Elsewhere, restart the language server to have every page checked against the new file.
- **A new component is seen when a document is next read.** Add a file to `components` while your editor is open, and a page that already uses the tag is checked against it after the page's next edit.
- **A handler reached through a longer path is not checked as one.** `onclick=(ref)"#/state/actions/save"` has its path checked, and not whether `save` is a function.
- **Renaming a `(server)name` entry is whole only from the entry.** The one word stands for two names, the state entry and the server function. Started on the entry, a rename rewrites the function, the entry and every place that reads it. Started on the function it leaves `state.name` in bodies, and started in a body it leaves the function. Either way the next check reports what was left behind. A client entry written `(export)name` renames from anywhere.

## Related

- [Functions and modules](/docs/framework/concepts/functions): bodies, scripts and how an export is called
- [Jx Notation](/docs/framework/concepts/jxn-files): the `.jxn` format
- [Code editing in Studio](/docs/studio/logic/code): the checking Studio does as you type
