import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Context, TaskConfig, TransformResult } from "../../src/config/types.ts"
import { PathResolver } from "../../src/core/pathResolver.ts"
import { Task } from "../../src/core/task.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/task-test")

function createRegistry(): TransformerRegistry {
  const registry = new TransformerRegistry()

  registry.register({
    name: "uppercase",
    description: "Uppercase content",
    execute: async (content: string): Promise<TransformResult> => {
      const upper = content.toUpperCase()
      return { content: upper, changed: upper !== content }
    },
  })

  registry.register({
    name: "append-footer",
    description: "Append a footer line",
    execute: async (content: string): Promise<TransformResult> => ({
      content: `${content}\n\n<!-- FOOTER -->`,
      changed: true,
    }),
  })

  // Simulates frontmatter.extract + aggregate.push behavior
  registry.register({
    name: "extract-and-push",
    description: "Extract fake frontmatter and push to aggregate store",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      const title = content.trim()
      context.setMetadata("frontmatter", { title, slug: context.variables["slug"] })
      context.pushToAggregate({ title, slug: context.variables["slug"] })
      return { content, changed: false }
    },
  })

  // Simulates yaml.emit / json.emit behavior for aggregate transforms
  registry.register({
    name: "json-emit",
    description: "Parse JSON input and re-serialize as formatted JSON",
    execute: async (content: string): Promise<TransformResult> => {
      try {
        const data = JSON.parse(content)
        return { content: JSON.stringify(data, null, 2), changed: true }
      } catch {
        return { content: "[]", changed: true }
      }
    },
  })

  // Simulates zod.validate behavior
  registry.register({
    name: "validate-title",
    description: "Validate that content is not empty",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      if (!content.trim()) {
        context.addValidationError(new Error(`Empty content in ${context.filePath}`))
      }
      return { content, changed: false }
    },
  })

  registry.register({
    name: "always-fail",
    description: "Always adds a validation error",
    execute: async (_content: string, context: Context): Promise<TransformResult> => {
      context.addValidationError(new Error(`Intentional failure in ${context.filePath}`))
      return { content: _content, changed: false }
    },
  })

  return registry
}

describe("Task", () => {
  beforeEach(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "fiction/book-1"), { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "fiction/book-2"), { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "nonfiction/guide"), { recursive: true })

    await writeFile(path.join(FIXTURE_DIR, "fiction/book-1/chapter-1.md"), "hello world")
    await writeFile(path.join(FIXTURE_DIR, "fiction/book-1/chapter-2.md"), "second chapter")
    await writeFile(path.join(FIXTURE_DIR, "fiction/book-2/intro.md"), "book two intro")
    await writeFile(path.join(FIXTURE_DIR, "nonfiction/guide/basics.md"), "basics content")
  })

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  describe("scanFiles", () => {
    test("should scan all matching files", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })

      expect(files).toHaveLength(4)
      expect(files.every((f) => f.matched)).toBe(true)
    })

    test("should extract variables from matched files", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const fictionBook1 = files.find(
        (f) => f.variables["category"] === "fiction" && f.variables["collection_id"] === "book-1",
      )

      expect(fictionBook1).toBeDefined()
      expect(Array.isArray(fictionBook1?.variables["slug"])).toBe(true)
    })

    test("should filter by scope variables", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({
        cwd: process.cwd(),
        scope: { category: "fiction" },
      })

      expect(files).toHaveLength(3)
      expect(files.every((f) => f.variables["category"] === "fiction")).toBe(true)
    })

    test("should return empty array when no matches", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/nonexistent/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      expect(files).toHaveLength(0)
    })
  })

  describe("run - transform mode", () => {
    test("should process all matching files and report statistics", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
      }
      const task = new Task("test-task", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.taskName).toBe("test-task")
      expect(result.filesProcessed).toBe(4)
      expect(result.filesModified).toBe(4)
      expect(result.errors).toHaveLength(0)
      expect(result.duration).toBeGreaterThan(0)
    })

    test("should chain multiple transformers in order", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-transform")
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase", "append-footer"],
        output: { path: `${outputDir}/[category]/[collection_id]/[...slug].md` },
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesModified).toBe(4)

      // Verify output content reflects both transformers
      const outputFile = Bun.file(path.join(outputDir, "fiction/book-1/chapter-1.md"))
      expect(await outputFile.exists()).toBe(true)
      const content = await outputFile.text()
      expect(content).toContain("HELLO WORLD")
      expect(content).toContain("<!-- FOOTER -->")
    })

    test("should collect errors for unknown transformers", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["nonexistent-transformer"],
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toContain("Transformer not found")
    })

    test("should not write output in dry-run mode", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-dry")
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
        output: { path: `${outputDir}/[category]/[collection_id]/[...slug].md` },
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd(), dryRun: true })

      expect(result.filesModified).toBe(4)
      const outputFile = Bun.file(path.join(outputDir, "fiction/book-1/chapter-1.md"))
      expect(await outputFile.exists()).toBe(false)
    })

    test("should handle scope filtering in run", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const result = await task.run({
        cwd: process.cwd(),
        scope: { category: "nonfiction" },
      })

      expect(result.filesProcessed).toBe(1)
      expect(result.filesModified).toBe(1)
    })
  })

  describe("run - aggregate mode", () => {
    test("should aggregate data from multiple files into single output", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-aggregate")
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "aggregate",
        transforms: ["extract-and-push"],
        aggregateTransforms: ["json-emit"],
        output: {
          path: `${outputDir}/[category]/[collection_id]/metadata.json`,
          format: "json",
        },
      }
      const task = new Task("agg-test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesProcessed).toBe(4)
      expect(result.errors).toHaveLength(0)

      // Should produce one output file per group (category/collection_id combo)
      const book1Output = Bun.file(path.join(outputDir, "fiction/book-1/metadata.json"))
      expect(await book1Output.exists()).toBe(true)

      const book1Data = JSON.parse(await book1Output.text())
      expect(Array.isArray(book1Data)).toBe(true)
      expect(book1Data).toHaveLength(2) // chapter-1 and chapter-2
    })

    test("should group files by output variables correctly", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-grouping")
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "aggregate",
        transforms: ["extract-and-push"],
        aggregateTransforms: ["json-emit"],
        output: {
          path: `${outputDir}/[category]/all.json`,
          format: "json",
        },
      }
      const task = new Task("group-test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      if (result.errors.length > 0) {
        console.error("Task Errors:", result.errors)
      }

      // Two groups: fiction and nonfiction
      const fictionOutput = Bun.file(path.join(outputDir, "fiction/all.json"))
      const nonfictionOutput = Bun.file(path.join(outputDir, "nonfiction/all.json"))

      expect(await fictionOutput.exists()).toBe(true)
      expect(await nonfictionOutput.exists()).toBe(true)

      const fictionData = JSON.parse(await fictionOutput.text())
      expect(fictionData).toHaveLength(3) // book-1 (2 files) + book-2 (1 file)

      const nonfictionData = JSON.parse(await nonfictionOutput.text())
      expect(nonfictionData).toHaveLength(1)
    })

    test("should not write aggregate output in dry-run mode", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-agg-dry")
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "aggregate",
        transforms: ["extract-and-push"],
        aggregateTransforms: ["json-emit"],
        output: {
          path: `${outputDir}/[category]/[collection_id]/metadata.json`,
          format: "json",
        },
      }
      const task = new Task("agg-dry", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd(), dryRun: true })

      expect(result.filesProcessed).toBe(4)
      const outputFile = Bun.file(path.join(outputDir, "fiction/book-1/metadata.json"))
      expect(await outputFile.exists()).toBe(false)
    })
  })

  describe("run - validate mode", () => {
    test("should pass validation when all files are valid", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "validate",
        transforms: ["validate-title"],
      }
      const task = new Task("val-pass", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesProcessed).toBe(4)
      expect(result.errors).toHaveLength(0)
      expect(result.filesModified).toBe(0) // validate never modifies
    })

    test("should collect validation errors from failing files", async () => {
      // Create an empty file to trigger validation failure
      await writeFile(path.join(FIXTURE_DIR, "fiction/book-1/empty.md"), "")

      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "validate",
        transforms: ["validate-title"],
      }
      const task = new Task("val-fail", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesProcessed).toBe(5)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.message.includes("Empty content"))).toBe(true)
    })

    test("should report zero modifications in validate mode", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        mode: "validate",
        transforms: ["always-fail"],
      }
      const task = new Task("val-no-mod", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesModified).toBe(0)
      expect(result.errors.length).toBe(4)
    })
  })

  describe("run - edge cases", () => {
    test("should return zero stats when no files match", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/missing/[category]/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesProcessed).toBe(0)
      expect(result.filesModified).toBe(0)
      expect(result.fileResults).toHaveLength(0)
    })

    test("should default to transform mode when mode is not specified", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
        // mode intentionally omitted
      }
      const task = new Task("default-mode", config, new PathResolver(), createRegistry())

      const result = await task.run({ cwd: process.cwd() })

      expect(result.filesProcessed).toBe(4)
      expect(result.filesModified).toBe(4)
    })
  })
})
