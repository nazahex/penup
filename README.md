<div align="center">

# Penup

[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)

**Dynamic content pipeline orchestrator with variable-driven paths.**

</div>

Penup is a Bun-native CLI tool and programmatic library that transforms file-system-based content workflows. Instead of writing brittle scripts with hardcoded paths, you define patterns like `[category]/[collection_id]/[...slug].md` and let Penup automatically extract, propagate, and substitute those variables across your entire build pipeline.

---

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Why Penup?](#why-penup)
  - [Key Differentiators](#key-differentiators)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [1. Create a configuration file](#1-create-a-configuration-file)
  - [2. Run the pipeline](#2-run-the-pipeline)
- [Core Concepts](#core-concepts)
  - [Dynamic Path Variables](#dynamic-path-variables)
    - [Pattern Example](#pattern-example)
  - [Tasks \& Transformers](#tasks--transformers)
  - [Pipeline DAG Execution](#pipeline-dag-execution)
  - [CLI Scoping](#cli-scoping)
  - [Presets](#presets)
- [Configuration Reference](#configuration-reference)
  - [Full Schema](#full-schema)
- [CLI Reference](#cli-reference)
  - [`penup build`](#penup-build)
  - [`penup run <task>`](#penup-run-task)
  - [`penup list`](#penup-list)
- [Built-in Transformers](#built-in-transformers)
  - [`frontmatter.extract`](#frontmatterextract)
  - [`frontmatter.inject`](#frontmatterinject)
- [Custom Transformers](#custom-transformers)
- [Programmatic API](#programmatic-api)
  - [PathResolver Standalone Usage](#pathresolver-standalone-usage)
- [Project Structure](#project-structure)
- [Development](#development)
  - [Architecture Notes](#architecture-notes)
- [License](#license)

---

## Why Penup?

Most static site generators and build tools treat file paths as opaque strings. When your content lives in a structured directory hierarchy, you end up writing custom scripts to:

1. Scan directories and parse filenames
2. Extract metadata from path segments
3. Generate output files in mirrored directory structures
4. Keep all of this in sync as content changes

Penup makes **path variables first-class citizens**. A single pattern definition drives scanning, extraction, transformation, and output generation — eliminating an entire category of glue code.

### Key Differentiators

| Feature        | Traditional Build Tools           | Penup                                                    |
| -------------- | --------------------------------- | -------------------------------------------------------- |
| Path variables | Manual regex parsing              | Declarative `[var]` / `[...rest]` syntax                 |
| Output paths   | Hardcoded or templated separately | Same variables reused via substitution                   |
| Task ordering  | Imperative script chaining        | Declarative DAG with auto topological sort               |
| Filtering      | Custom glob + filter logic        | Built-in scope filtering via CLI args                    |
| Runtime        | Node.js / shell scripts           | Bun-native (fast I/O, native YAML, TypeScript execution) |

---

## Installation

```bash
bun add -d penup
```

Or use directly without installing:

```bash
bunx penup build
```

> **Requires:** Bun ≥ 1.1.0

---

## Quick Start

### 1. Create a configuration file

Create `penup.config.ts` in your project root:

```typescript
import type { PenupConfig } from 'penup';

const config: PenupConfig = {
  name: 'my-content-pipeline',

  vars: {
    outputBase: './dist',
  },

  tasks: {
    'extract-metadata': {
      description: 'Extract frontmatter from Markdown files',
      source: './src/books/[category]/[collection_id]/**/*.md',
      transforms: ['frontmatter.extract'],
      output: {
        path: '{{outputBase}}/[category]/[collection_id]/metadata.json',
        format: 'json',
      },
    },
  },
};

export default config;
```

### 2. Run the pipeline

```bash
# Run all tasks
penup build

# Run a specific task
penup run extract-metadata

# Filter by dynamic path variables
penup run extract-metadata --category=fiction --collection_id=book-123

# Preview changes without writing
penup build --dry-run

# List available tasks
penup list
```

---

## Core Concepts

### Dynamic Path Variables

Penup uses a bracket-based syntax inspired by Next.js file-system routing:

| Syntax          | Description                                             | Example Match                           |
| --------------- | ------------------------------------------------------- | --------------------------------------- |
| `[variable]`    | Matches exactly one path segment                        | `[category]` → `"fiction"`              |
| `[...variable]` | Matches one or more remaining segments (rest/catch-all) | `[...slug]` → `["chapter-1", "page-1"]` |
| `{{variable}}`  | References a global variable from config                | `{{outputBase}}` → `"./dist"`           |

#### Pattern Example

```
Source:  ./src/books/[category]/[collection_id]/[section_id]/[...slug].md
File:    ./src/books/fiction/book-123/chapter-1/page-1.md

Extracted variables:
{
  "category": "fiction",
  "collection_id": "book-123",
  "section_id": "chapter-1",
  "slug": ["page-1"]
}
```

Variables extracted from source paths are automatically available for:

- **Output path generation** — substitute into output patterns
- **Scope filtering** — filter task execution via CLI arguments
- **Transformer context** — access inside any transformer function
- **Global merging** — combined with config-level `vars`

### Tasks & Transformers

A **task** is the fundamental unit of work. Each task:

1. Scans files matching a `source` pattern
2. Extracts variables from each matched path
3. Applies a chain of **transformers** to file content
4. Optionally writes output to a generated path

A **transformer** is a pure function that receives file content and a context, returning transformed content and/or metadata:

```typescript
type TransformerFunction = (
  content: string,
  context: Context
) => TransformResult | Promise<TransformResult>;
```

Transformers can be chained, and metadata produced by one transformer is available to subsequent transformers in the same chain.

### Pipeline DAG Execution

Tasks declare dependencies via `dependsOn`. Penup builds a directed acyclic graph (DAG), performs topological sorting, and executes tasks in correct dependency order. Circular dependencies are detected and reported at startup.

```typescript
tasks: {
  'extract-metadata': { source: './src/**/*.md' },
  'generate-schema': {
    source: './src/**/*.md',
    dependsOn: ['extract-metadata'], // Waits for extract to complete
  },
  'build-sitemap': {
    source: './src/**/*.md',
    dependsOn: ['extract-metadata', 'generate-schema'],
  },
}
```

### CLI Scoping

Filter task execution to specific variable values using named flags, positional arguments, or both:

```bash
# Named arguments (recommended for clarity)
penup run extract-metadata --category=fiction --collection_id=book-123

# Positional arguments (matched to unresolved variables in order)
penup run extract-metadata fiction book-123

# Mixed
penup run extract-metadata --category=fiction book-123
```

Scoping works by matching provided values against variables extracted from each file's source path. Files whose variables don't match the scope are skipped.

### Presets

Presets define reusable scope configurations for common operations:

```typescript
presets: {
  'fiction-only': {
    description: 'Process only fiction category books',
    tasks: {
      'extract-metadata': {
        scope: { category: 'fiction' },
      },
    },
  },
},
```

---

## Configuration Reference

Penup auto-detects configuration files in priority order: `penup.config.ts` > `penup.config.yaml` > `penup.config.yml` > `penup.config.js`. You can also specify an explicit path via `--config <path>`.

### Full Schema

```typescript
interface PenupConfig {
  /** Project name (required) */
  name: string;

  /** Working directory (defaults to process.cwd()) */
  cwd?: string;

  /** Global variables available to all tasks via {{var}} syntax */
  vars?: VariableMap;

  /** Named presets for reusable scope configurations */
  presets?: Record<string, PresetConfig>;

  /** Task definitions (required) */
  tasks: Record<string, TaskConfig>;

  /** Custom transformer definitions */
  transformers?: Record<string, TransformerDefinition>;
}

interface TaskConfig {
  /** Source file pattern with [var] and [...rest] syntax */
  source: string;

  /** Output configuration */
  output?: {
    path: string;           // Output path pattern (supports variables)
    format?: 'json' | 'yaml' | 'text' | 'raw';
    overwrite?: boolean;
  };

  /** Ordered list of transformer steps */
  transforms?: Array<string | { name: string; options?: Record<string, unknown>; when?: string }>;

  /** Task names this task depends on */
  dependsOn?: string[];

  /** Enable parallel execution with sibling tasks */
  parallel?: boolean;

  /** Conditional execution expression */
  when?: string;

  /** Validation configuration */
  validate?: { name: string; strict?: boolean };

  /** Human-readable description */
  description?: string;
}
```

---

## CLI Reference

### `penup build`

Run all tasks in dependency order.

```
penup build [options]

Options:
  -c, --config <path>   Path to config file
  --dry-run             Preview changes without writing files
  -v, --verbose         Verbose output
```

### `penup run <task>`

Run a specific task (and its dependencies).

```
penup run <task> [scope-args...] [options]

Options:
  -c, --config <path>   Path to config file
  --dry-run             Preview changes without writing files
  -v, --verbose         Verbose output

Scope Arguments:
  --key=value           Named variable filter
  value                 Positional variable filter
```

### `penup list`

Display all registered tasks with their descriptions and source patterns.

```
penup list [options]

Options:
  -c, --config <path>   Path to config file
```

---

## Built-in Transformers

### `frontmatter.extract`

Parses YAML frontmatter delimited by `---` from Markdown content. Stores parsed data in context metadata under key `"frontmatter"`.

```typescript
transforms: ['frontmatter.extract']
```

### `frontmatter.inject`

Serializes data as YAML frontmatter and prepends it to Markdown content. Reads data from context metadata or transformer options.

```typescript
transforms: [{
  name: 'frontmatter.inject',
  options: {
    data: { title: 'My Title', slug: 'my-title' },
    overwrite: true,
  },
}]
```

> More built-in transformers (`yaml.parse`, `json.write`, `file.copy`, `template.replace`, `git.getDate`) are planned for Phase 2.

---

## Custom Transformers

Register custom transformers directly in your config:

```typescript
transformers: {
  'uppercase': {
    name: 'uppercase',
    description: 'Convert content to uppercase',
    execute: async (content, context) => {
      const upper = content.toUpperCase();
      return {
        content: upper,
        changed: upper !== content,
        metadata: { transformed: true },
      };
    },
  },
},
```

Then reference by name in any task:

```typescript
transforms: ['frontmatter.extract', 'uppercase']
```

The `context` parameter provides access to:

- `context.filePath` — current file being processed
- `context.variables` — extracted path variables
- `context.globals` — global config variables
- `context.getVariable(name)` — merged lookup (file vars → globals)
- `context.setMetadata(key, value)` / `context.getMetadata<T>(key)` — inter-transformer communication

---

## Programmatic API

Penup exports all core classes for integration into custom tooling:

```typescript
import {
  Pipeline,
  PathResolver,
  TransformerRegistry,
  loadConfig,
  frontmatterTransformers,
} from 'penup';

// Load configuration
const config = await loadConfig('./penup.config.ts');

// Initialize components
const resolver = new PathResolver();
const registry = new TransformerRegistry();
registry.register(frontmatterTransformers.extract);
registry.register(frontmatterTransformers.inject);

// Create and run pipeline
const pipeline = new Pipeline(config, resolver, registry);

const result = await pipeline.run({
  scope: { category: 'fiction' },
  dryRun: false,
});

console.log(`Executed ${result.tasksExecuted} tasks in ${result.duration}ms`);
```

### PathResolver Standalone Usage

```typescript
const resolver = new PathResolver();

// Parse a pattern
const parsed = resolver.parse('./src/[category]/[...slug].md');
// → { variableNames: ['category', 'slug'], hasRestVariable: true, ... }

// Match a file path
const match = resolver.match(
  './src/fiction/book-123/page-1.md',
  './src/[category]/[...slug].md'
);
// → { matched: true, variables: { category: 'fiction', slug: ['book-123', 'page-1'] } }

// Generate output path
const output = resolver.generate(
  './dist/[category]/metadata.json',
  match.variables
);
// → './dist/fiction/metadata.json'

// Convert to glob pattern for file scanning
const glob = resolver.toGlobPattern('./src/[category]/[...slug].md');
// → './src/*/**.md'
```

---

## Project Structure

```
penup/
├── src/
│   ├── index.ts                  # Public API exports
│   ├── core/
│   │   ├── PathResolver.ts       # Dynamic path engine
│   │   ├── Context.ts            # Per-file runtime context
│   │   ├── Task.ts               # Task execution unit
│   │   └── Pipeline.ts           # DAG-based orchestrator
│   ├── transformers/
│   │   ├── registry.ts           # Transformer registry
│   │   └── frontmatter.ts        # Built-in frontmatter transformers
│   ├── config/
│   │   ├── types.ts              # TypeScript type definitions
│   │   └── loader.ts             # Multi-format config loader
│   └── cli/
│       └── index.ts              # CLI entry point (Commander.js)
├── tests/
│   └── core/
│       └── PathResolver.test.ts  # Unit tests
├── demo/
│   ├── penup.config.ts           # Demo configuration
│   ├── run.ts                    # Comprehensive demo runner
│   └── content/                  # Sample fixture files
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type checking
bun run typecheck

# Run the comprehensive demo
bun demo/run.ts

# Link locally for testing in other projects
bun link
```

### Architecture Notes

- **Strict TypeScript** — configured with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and full strict mode
- **Bun-native** — uses `Bun.file()`, `Bun.write()`, `Bun.spawn()`, and `Glob` for maximum performance
- **Zero runtime dependencies** beyond Commander.js (CLI), yaml (parsing), and Zod (validation schema)
- **Plugin-ready** — TransformerRegistry supports registration of custom transformers; hook system planned for Phase 2

---

## License

MIT
