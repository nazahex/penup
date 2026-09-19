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
    execute: async (content: string, _context: Context): Promise<TransformResult> => {
      const upper = content.toUpperCase()
      return { content: upper, changed: upper !== content }
    },
  })
  registry.register({
    name: "append-footer",
    description: "Append a footer line",
    execute: async (content: string, _context: Context): Promise<TransformResult> => {
      const updated = `${content}\n\n<!-- FOOTER -->`
      return { content: updated, changed: true }
    },
  })
  registry.register({
    name: "set-metadata",
    description: "Set some metadata",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      context.setMetadata("processedAt", new Date().toISOString())
      return { content, changed: false }
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

    test("should filter by multiple scope variables", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({
        cwd: process.cwd(),
        scope: { category: "fiction", collection_id: "book-1" },
      })

      expect(files).toHaveLength(2)
      expect(files.every((f) => f.variables["collection_id"] === "book-1")).toBe(true)
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

  describe("processFile", () => {
    test("should apply transformer chain", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const firstFile = files[0]
      if (!firstFile) throw new Error("No files scanned")

      const result = await task.processFile(firstFile, { cwd: process.cwd() })

      expect(result.modified).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    test("should chain multiple transformers in order", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase", "append-footer"],
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const firstFile = files[0]
      if (!firstFile) throw new Error("No files scanned")

      const result = await task.processFile(firstFile, { cwd: process.cwd() })

      expect(result.modified).toBe(true)
    })

    test("should collect errors for unknown transformers", async () => {
      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["nonexistent-transformer"],
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const firstFile = files[0]
      if (!firstFile) throw new Error("No files scanned")

      const result = await task.processFile(firstFile, { cwd: process.cwd() })

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toContain("Transformer not found")
    })

    test("should write output file when configured (not dry-run)", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output")
      await mkdir(outputDir, { recursive: true })

      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
        output: {
          path: `${outputDir}/[category]/[collection_id].txt`,
          format: "text",
        },
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const firstFile = files[0]
      if (!firstFile) throw new Error("No files scanned")

      const result = await task.processFile(firstFile, { cwd: process.cwd() })

      expect(result.outputPath).toBeDefined()
      expect(result.modified).toBe(true)

      const outputPath = result.outputPath
      if (!outputPath) throw new Error("Expected outputPath to be defined")
      expect(outputPath).toBeDefined()
      expect(result.modified).toBe(true)

      const outputFile = Bun.file(outputPath)
      expect(await outputFile.exists()).toBe(true)
    })

    test("should not write output file in dry-run mode", async () => {
      const outputDir = path.join(FIXTURE_DIR, "output-dry")

      const config: TaskConfig = {
        source: `${FIXTURE_DIR}/[category]/[collection_id]/[...slug].md`,
        transforms: ["uppercase"],
        output: {
          path: `${outputDir}/[category]/[collection_id].txt`,
          format: "text",
        },
      }
      const task = new Task("test", config, new PathResolver(), createRegistry())

      const files = await task.scanFiles({ cwd: process.cwd() })
      const firstFile = files[0]
      if (!firstFile) throw new Error("No files scanned")

      const result = await task.processFile(firstFile, {
        cwd: process.cwd(),
        dryRun: true,
      })

      expect(result.outputPath).toBeDefined()
      const outputPath = result.outputPath
      if (!outputPath) throw new Error("Expected outputPath to be defined")
      expect(outputPath).toBeDefined()
      expect(result.modified).toBe(true)

      const outputFile = Bun.file(outputPath)
      expect(await outputFile.exists()).toBe(false)
    })
  })

  describe("run", () => {
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
  })
})
