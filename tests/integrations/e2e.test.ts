import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml } from "yaml"
import type {
  Context,
  PenupConfig,
  TransformerDefinition,
  TransformResult,
} from "../../src/config/types.ts"
import { PathResolver } from "../../src/core/pathResolver.ts"
import { Pipeline } from "../../src/core/pipeline.ts"
import { defineTransformer } from "../../src/helpers.ts"
import { aggregationTransformers } from "../../src/transformers/aggregation.ts"
import {
  createFileCopyTransformer,
  createFileRenameTransformer,
} from "../../src/transformers/file.ts"
import { frontmatterTransformers } from "../../src/transformers/frontmatter.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/e2e")
const OUTPUT_DIR = path.join(FIXTURE_DIR, "output")

function createRegistry(): TransformerRegistry {
  const resolver = new PathResolver()
  const registry = new TransformerRegistry()

  // Built-in frontmatter transformers
  registry.register(frontmatterTransformers.extract)
  registry.register(frontmatterTransformers.inject)

  // Built-in aggregation transformers
  for (const def of Object.values(aggregationTransformers)) {
    registry.register(def)
  }

  // Built-in filesystem transformers
  registry.register(createFileRenameTransformer(resolver))
  registry.register(createFileCopyTransformer(resolver))

  // Test-specific transformer
  registry.register({
    name: "wrap-content",
    description: "Wraps content in markers",
    execute: async (content: string): Promise<TransformResult> => {
      const wrapped = `<!-- START -->\n${content}\n<!-- END -->`
      return { content: wrapped, changed: true }
    },
  })

  // Validation transformer for testing
  registry.register({
    name: "require-title",
    description: "Validate that frontmatter has a title",
    execute: async (_content: string, context: Context): Promise<TransformResult> => {
      const fm = context.getMetadata<Record<string, unknown>>("frontmatter") ?? {}
      if (!fm["title"]) {
        context.addValidationError(new Error(`Missing title in ${context.filePath}`))
      }
      return { content: _content, changed: false }
    },
  })

  return registry
}

describe("End-to-End Integration", () => {
  beforeEach(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "books/fiction/book-alpha"), { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "books/nonfiction/guide-1"), { recursive: true })
    await mkdir(OUTPUT_DIR, { recursive: true })

    // Fiction files
    await writeFile(
      path.join(FIXTURE_DIR, "books/fiction/book-alpha/001-intro.md"),
      `---
title: Introduction
slug: intro
description: Book intro
---

# Introduction

Welcome to the story.`,
    )

    await writeFile(
      path.join(FIXTURE_DIR, "books/fiction/book-alpha/002-chapter.md"),
      `---
title: Chapter One
slug: chapter-one
---

# Chapter One

The adventure begins.`,
    )

    // Nonfiction file
    await writeFile(
      path.join(FIXTURE_DIR, "books/nonfiction/guide-1/001-basics.md"),
      `---
title: Basics
slug: basics
---

# Basics

Learn the fundamentals.`,
    )
  })

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  // ============================================================
  // EXISTING TESTS
  // ============================================================

  test("should run complete pipeline: extract → transform → output", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "process-books": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["frontmatter.extract", "wrap-content"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
            format: "text",
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.tasksExecuted).toBe(1)
    expect(result.errors).toHaveLength(0)

    const taskResult = result.taskResults[0]
    if (!taskResult) throw new Error("No task result")

    expect(taskResult.filesProcessed).toBe(3)
    expect(taskResult.filesModified).toBe(3)

    const fictionOutput = Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/001-intro.html"))
    expect(await fictionOutput.exists()).toBe(true)

    const content = await fictionOutput.text()
    expect(content).toContain("<!-- START -->")
    expect(content).toContain("<!-- END -->")
    expect(content).toContain("Welcome to the story")
  })

  test("should respect scope filtering in full pipeline", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "process-books": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
            format: "text",
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({
      cwd: process.cwd(),
      scope: { category: "fiction" },
    })

    const taskResult = result.taskResults[0]
    if (!taskResult) throw new Error("No task result")

    expect(taskResult.filesProcessed).toBe(2)
    expect(taskResult.filesModified).toBe(2)
  })

  test("should execute tasks in dependency order", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      tasks: {
        "step-1": { source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md` },
        "step-2": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          dependsOn: ["step-1"],
        },
        "step-3": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          dependsOn: ["step-2"],
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.tasksExecuted).toBe(3)
    expect(result.taskResults.map((r) => r.taskName)).toEqual(["step-1", "step-2", "step-3"])
  })

  test("should propagate variables through pipeline", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { siteName: "Test Site", version: "1.0.0" },
      tasks: {
        process: { source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md` },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)
  })

  test("should handle dry-run mode without writing files", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        process: {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["wrap-content"],
          output: { path: `{{outputBase}}/[category]/[collection_id]/[...slug].html` },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd(), dryRun: true })

    const taskResult = result.taskResults[0]
    if (!taskResult) throw new Error("No task result")

    expect(taskResult.filesProcessed).toBe(3)
    const output = Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/001-intro.html"))
    expect(await output.exists()).toBe(false)
  })

  test("should handle frontmatter extract in real pipeline", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      tasks: {
        extract: {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["frontmatter.extract"],
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)
    expect(result.taskResults[0]?.filesProcessed).toBe(3)
  })

  test("should aggregate errors without stopping pipeline", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      tasks: {
        "task-with-error": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["nonexistent-transformer"],
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.tasksExecuted).toBe(1)
    const taskResult = result.taskResults[0]
    if (!taskResult) throw new Error("No task result")
    expect(taskResult.fileResults.every((r) => r.errors.length > 0)).toBe(true)
  })

  // ============================================================
  // AGGREGATE MODE E2E TESTS
  // ============================================================

  test("should aggregate frontmatter into single YAML file per group", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "extract-metadata": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "aggregate",
          transforms: ["frontmatter.extract", "aggregate.push"],
          aggregateTransforms: ["yaml.emit"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/metadata.yaml`,
            format: "yaml",
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    // Fiction book should have its own metadata.yaml with 2 topics
    const fictionMetaPath = path.join(OUTPUT_DIR, "fiction/book-alpha/metadata.yaml")
    const fictionMeta = Bun.file(fictionMetaPath)
    expect(await fictionMeta.exists()).toBe(true)

    const fictionData = parseYaml(await fictionMeta.text()) as Array<Record<string, unknown>>
    expect(Array.isArray(fictionData)).toBe(true)
    expect(fictionData).toHaveLength(2)
    expect(fictionData.map((d) => d["slug"]).sort()).toEqual(["chapter-one", "intro"])

    // Nonfiction guide should have its own metadata.yaml with 1 topic
    const nonfictionMetaPath = path.join(OUTPUT_DIR, "nonfiction/guide-1/metadata.yaml")
    const nonfictionMeta = Bun.file(nonfictionMetaPath)
    expect(await nonfictionMeta.exists()).toBe(true)

    const nonfictionData = parseYaml(await nonfictionMeta.text()) as Array<Record<string, unknown>>
    expect(nonfictionData).toHaveLength(1)
    expect(nonfictionData[0]?.["slug"]).toBe("basics")
  })

  test("should aggregate frontmatter into single JSON file per group", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "extract-metadata": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "aggregate",
          transforms: ["frontmatter.extract", "aggregate.push"],
          aggregateTransforms: ["json.emit"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/metadata.json`,
            format: "json",
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    const metaPath = path.join(OUTPUT_DIR, "fiction/book-alpha/metadata.json")
    const metaFile = Bun.file(metaPath)
    expect(await metaFile.exists()).toBe(true)

    const data = JSON.parse(await metaFile.text()) as Array<Record<string, unknown>>
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
  })

  test("should aggregate with scope filtering applied", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "extract-metadata": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "aggregate",
          transforms: ["frontmatter.extract", "aggregate.push"],
          aggregateTransforms: ["yaml.emit"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/metadata.yaml`,
            format: "yaml",
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd(), scope: { category: "fiction" } })

    expect(result.errors).toHaveLength(0)

    // Fiction metadata should exist
    const fictionMetaPath = path.join(OUTPUT_DIR, "fiction/book-alpha/metadata.yaml")
    expect(await Bun.file(fictionMetaPath).exists()).toBe(true)

    // Nonfiction metadata should NOT exist (filtered out)
    const nonfictionMetaPath = path.join(OUTPUT_DIR, "nonfiction/guide-1/metadata.yaml")
    expect(await Bun.file(nonfictionMetaPath).exists()).toBe(false)
  })

  // ============================================================
  // VALIDATE MODE E2E TESTS
  // ============================================================

  test("should validate frontmatter successfully", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      tasks: {
        "validate-topics": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "validate",
          transforms: ["frontmatter.extract", "require-title"],
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)
    expect(result.taskResults[0]?.filesProcessed).toBe(3)
    expect(result.taskResults[0]?.filesModified).toBe(0) // validate never modifies
  })

  test("should stop pipeline when validate task fails with fail-fast", async () => {
    // Create a file with invalid frontmatter (no title)
    await writeFile(
      path.join(FIXTURE_DIR, "books/fiction/book-alpha/003-broken.md"),
      `---
slug: broken
---

# Broken

No title here.`,
    )

    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "validate-topics": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "validate",
          transforms: ["frontmatter.extract", "require-title"],
          // failFast defaults to true for validate mode
        },
        "process-books": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          dependsOn: ["validate-topics"],
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    // Pipeline should stop at validate
    expect(result.tasksExecuted).toBe(1)
    expect(result.taskResults.map((r) => r.taskName)).toEqual(["validate-topics"])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test("should continue pipeline when non-failFast task has errors", async () => {
    await writeFile(
      path.join(FIXTURE_DIR, "books/fiction/book-alpha/003-broken.md"),
      `---
slug: broken
---

# Broken`,
    )

    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "lenient-validate": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "validate",
          failFast: false, // Explicit non-fail-fast
          transforms: ["frontmatter.extract", "require-title"],
        },
        "process-books": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          dependsOn: ["lenient-validate"],
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    // Both tasks should execute
    expect(result.tasksExecuted).toBe(2)
    expect(result.taskResults.map((r) => r.taskName)).toEqual(["lenient-validate", "process-books"])
    expect(result.errors.length).toBeGreaterThan(0) // Validation errors still reported
  })

  // ============================================================
  // FILESYSTEM UTILITY E2E TESTS
  // ============================================================

  test("should rename files using file.rename transformer", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      tasks: {
        "rename-files": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: [
            "frontmatter.extract",
            { name: "file.rename", options: { pattern: "[slug].md" } },
          ],
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    // Original prefixed files should be gone
    expect(
      await Bun.file(path.join(FIXTURE_DIR, "books/fiction/book-alpha/001-intro.md")).exists(),
    ).toBe(false)
    expect(
      await Bun.file(path.join(FIXTURE_DIR, "books/fiction/book-alpha/002-chapter.md")).exists(),
    ).toBe(false)

    // Renamed files should exist
    expect(
      await Bun.file(path.join(FIXTURE_DIR, "books/fiction/book-alpha/intro.md")).exists(),
    ).toBe(true)
    expect(
      await Bun.file(path.join(FIXTURE_DIR, "books/fiction/book-alpha/chapter-one.md")).exists(),
    ).toBe(true)
  })

  test("should copy content to additional destination using file.copy", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR, backupBase: `${OUTPUT_DIR}-backup` },
      tasks: {
        "process-and-backup": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: [
            "wrap-content",
            {
              name: "file.copy",
              options: { dest: `{{backupBase}}/[category]/[collection_id]/[...slug].html` },
            },
          ],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    // Primary output should exist
    const primaryOutput = Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/001-intro.html"))
    expect(await primaryOutput.exists()).toBe(true)

    // Backup copy should also exist
    const backupOutput = Bun.file(
      path.join(`${OUTPUT_DIR}-backup`, "fiction/book-alpha/001-intro.html"),
    )
    expect(await backupOutput.exists()).toBe(true)

    // Both should have identical content
    expect(await primaryOutput.text()).toBe(await backupOutput.text())

    // Cleanup
    await rm(`${OUTPUT_DIR}-backup`, { recursive: true, force: true })
  })

  // ============================================================
  // MULTI-MODE PIPELINE E2E TESTS
  // ============================================================

  test("should run multi-mode pipeline: validate → aggregate → transform", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        "validate-topics": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "validate",
          transforms: ["frontmatter.extract", "require-title"],
        },
        "extract-metadata": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          mode: "aggregate",
          dependsOn: ["validate-topics"],
          transforms: ["frontmatter.extract", "aggregate.push"],
          aggregateTransforms: ["yaml.emit"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/metadata.yaml`,
            format: "yaml",
          },
        },
        "render-html": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          dependsOn: ["extract-metadata"],
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)
    expect(result.tasksExecuted).toBe(3)
    expect(result.taskResults.map((r) => r.taskName)).toEqual([
      "validate-topics",
      "extract-metadata",
      "render-html",
    ])

    // All outputs should exist
    expect(await Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/metadata.yaml")).exists()).toBe(
      true,
    )
    expect(
      await Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/001-intro.html")).exists(),
    ).toBe(true)
  })

  // ============================================================
  // CUSTOM TRANSFORMER E2E TESTS
  // ============================================================

  test("should support custom transformers defined in config", async () => {
    const uppercaseTransformer: TransformerDefinition = defineTransformer({
      name: "custom.uppercase",
      description: "Convert content to uppercase",
      execute: async (content: string): Promise<TransformResult> => {
        const upper = content.toUpperCase()
        return { content: upper, changed: upper !== content }
      },
    })

    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      transformers: {
        "custom.uppercase": uppercaseTransformer,
      },
      tasks: {
        "process-with-custom": {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["custom.uppercase"],
          output: {
            path: `{{outputBase}}/[category]/[collection_id]/[...slug].txt`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    const outputFile = Bun.file(path.join(OUTPUT_DIR, "fiction/book-alpha/001-intro.txt"))
    expect(await outputFile.exists()).toBe(true)

    const content = await outputFile.text()
    expect(content).toBe(content.toUpperCase())
    expect(content).toContain("WELCOME TO THE STORY")
  })

  // ============================================================
  // VARIABLE SUBSTITUTION E2E TESTS
  // ============================================================

  test("should substitute global variables in output paths", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: {
        outputBase: OUTPUT_DIR,
        buildId: "build-123",
      },
      tasks: {
        process: {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/{{buildId}}/[category]/[collection_id]/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    const outputPath = path.join(OUTPUT_DIR, "build-123/fiction/book-alpha/001-intro.html")
    expect(await Bun.file(outputPath).exists()).toBe(true)
  })

  test("should use rest variable correctly in output paths", async () => {
    const config: PenupConfig = {
      name: "e2e-test",
      vars: { outputBase: OUTPUT_DIR },
      tasks: {
        process: {
          source: `${FIXTURE_DIR}/books/[category]/[collection_id]/[...slug].md`,
          transforms: ["wrap-content"],
          output: {
            path: `{{outputBase}}/all/[...slug].html`,
          },
        },
      },
    }

    const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
    const result = await pipeline.run({ cwd: process.cwd() })

    expect(result.errors).toHaveLength(0)

    // Rest variable [...slug] should preserve the nested path structure
    const outputPath = path.join(OUTPUT_DIR, "all/001-intro.html")
    expect(await Bun.file(outputPath).exists()).toBe(true)
  })
})
