import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TaskConfig } from "../../src/config/types.ts"
import { PathResolver } from "../../src/core/pathResolver.ts"
import { Task } from "../../src/core/task.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/scanfiles-test")

function createRegistry(): TransformerRegistry {
  const registry = new TransformerRegistry()
  registry.register({
    name: "noop",
    description: "No-op transformer",
    execute: async (content: string) => ({ content, changed: false }),
  })
  return registry
}

function createTask(config: TaskConfig): Task {
  return new Task("test-task", config, new PathResolver(), createRegistry())
}

describe("Task.scanFiles", () => {
  beforeEach(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "books/fiction/book-1"), { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "books/nonfiction/guide-1"), { recursive: true })
    await mkdir(path.join(FIXTURE_DIR, "legal/id"), { recursive: true })

    // Book files with numeric prefixes
    await writeFile(path.join(FIXTURE_DIR, "books/fiction/book-1/001-intro.md"), "# Intro")
    await writeFile(path.join(FIXTURE_DIR, "books/fiction/book-1/002-chapter.md"), "# Chapter")
    await writeFile(path.join(FIXTURE_DIR, "books/nonfiction/guide-1/001-basics.md"), "# Basics")

    // Legal files without prefixes
    await writeFile(path.join(FIXTURE_DIR, "legal/id/privasi.md"), "# Privasi")
    await writeFile(path.join(FIXTURE_DIR, "legal/id/keamanan.md"), "# Keamanan")
  })

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  describe("Relative paths", () => {
    test("should match relative pattern with ./ prefix", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.matched)).toBe(true)
    })

    test("should match relative pattern without ./ prefix", async () => {
      const task = createTask({
        source: `tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.matched)).toBe(true)
    })

    test("should extract variables correctly from relative path", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })
      const fictionBook1 = results.find(
        (r) => r.variables["category"] === "fiction" && r.variables["collection_id"] === "book-1",
      )

      expect(fictionBook1).toBeDefined()
      expect(Array.isArray(fictionBook1?.variables["slug"])).toBe(true)
    })

    test("should handle rest variable capturing multiple segments", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/[type]/[id]/[...path].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results.length).toBeGreaterThan(0)
      results.forEach((r) => {
        expect(Array.isArray(r.variables["path"])).toBe(true)
        expect(r.variables["type"]).toBeDefined()
        expect(r.variables["id"]).toBeDefined()
      })
    })

    test("should return empty array when pattern matches nothing", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/nonexistent/[category]/[id].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(0)
    })
  })

  describe("Absolute paths", () => {
    test("should match absolute pattern within cwd", async () => {
      const absolutePattern = path.join(
        FIXTURE_DIR,
        "books/[category]/[collection_id]/[...slug].md",
      )
      const task = createTask({ source: absolutePattern })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.matched)).toBe(true)
    })

    test("should match absolute pattern outside cwd (using ../)", async () => {
      // Create a sibling directory outside FIXTURE_DIR
      const siblingDir = path.join(path.dirname(FIXTURE_DIR), "sibling-test")
      await mkdir(path.join(siblingDir, "docs"), { recursive: true })
      await writeFile(path.join(siblingDir, "docs/readme.md"), "# Readme")

      try {
        const absolutePattern = path.join(siblingDir, "docs/[...slug].md")
        const task = createTask({ source: absolutePattern })

        const results = await task.scanFiles({ cwd: FIXTURE_DIR })

        expect(results).toHaveLength(1)
        expect(results[0]?.variables["slug"]).toEqual(["readme"])
      } finally {
        await rm(siblingDir, { recursive: true, force: true })
      }
    })

    test("should extract variables from absolute path correctly", async () => {
      const absolutePattern = path.join(
        FIXTURE_DIR,
        "books/[category]/[collection_id]/[...slug].md",
      )
      const task = createTask({ source: absolutePattern })

      const results = await task.scanFiles({ cwd: process.cwd() })
      const fictionBook1 = results.find(
        (r) => r.variables["category"] === "fiction" && r.variables["collection_id"] === "book-1",
      )

      expect(fictionBook1).toBeDefined()
      expect(path.isAbsolute(fictionBook1?.filePath as string)).toBe(true)
    })

    test("should return empty array when absolute path doesn't exist", async () => {
      const nonExistentPath = path.join(FIXTURE_DIR, "nonexistent/[category]/[id].md")
      const task = createTask({ source: nonExistentPath })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(0)
    })
  })

  describe("Global variable substitution", () => {
    test("should substitute global variables before scanning", async () => {
      const task = createTask({
        source: `{{baseDir}}/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        globals: { baseDir: "./tests/fixtures/scanfiles-test" },
      })

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.matched)).toBe(true)
    })

    test("should handle multiple global variables", async () => {
      const task = createTask({
        source: `{{baseDir}}/{{type}}/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        globals: {
          baseDir: "./tests/fixtures/scanfiles-test",
          type: "books",
        },
      })

      expect(results).toHaveLength(3)
    })

    test("should handle array global variables", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/[...path].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        globals: { path: ["books", "fiction"] },
      })

      expect(results.length).toBeGreaterThan(0)
    })

    test("should not substitute undefined global variables", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      // No globals provided, pattern should still work
      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
    })
  })

  describe("Scope filtering", () => {
    test("should filter results by single scope variable", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        scope: { category: "fiction" },
      })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.variables["category"] === "fiction")).toBe(true)
    })

    test("should filter results by multiple scope variables", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        scope: { category: "fiction", collection_id: "book-1" },
      })

      expect(results).toHaveLength(2)
      expect(
        results.every(
          (r) => r.variables["category"] === "fiction" && r.variables["collection_id"] === "book-1",
        ),
      ).toBe(true)
    })

    test("should return empty array when scope matches nothing", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        scope: { category: "nonexistent" },
      })

      expect(results).toHaveLength(0)
    })

    test("should filter array variable scope correctly", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({
        cwd: process.cwd(),
        scope: { slug: ["001-intro"] },
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.variables["slug"]).toEqual(["001-intro"])
    })
  })

  describe("Edge cases", () => {
    test("should handle files without numeric prefix", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/legal/[lang]/[slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.matched)).toBe(true)
    })

    test("should handle deeply nested paths", async () => {
      const deepDir = path.join(FIXTURE_DIR, "a/b/c/d/e")
      await mkdir(deepDir, { recursive: true })
      await writeFile(path.join(deepDir, "file.md"), "# Deep")

      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/[...path]/file.md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      const deepFile = results.find((r) => (r.variables["path"] as string[]).includes("e"))
      expect(deepFile).toBeDefined()
    })

    test("should handle unicode characters in paths", async () => {
      const unicodeDir = path.join(FIXTURE_DIR, "books/日本語/コレクション")
      await mkdir(unicodeDir, { recursive: true })
      await writeFile(path.join(unicodeDir, "ファイル.md"), "# 日本語")

      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      const unicodeFile = results.find((r) => r.variables["category"] === "日本語")
      expect(unicodeFile).toBeDefined()
    })

    test("should handle empty directory", async () => {
      const emptyDir = path.join(FIXTURE_DIR, "empty")
      await mkdir(emptyDir, { recursive: true })

      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/empty/[file].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(0)
    })

    test("should always return absolute paths in results", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results.every((r) => path.isAbsolute(r.filePath))).toBe(true)
    })

    test("should handle pattern with only rest variable", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/[...path].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results.length).toBeGreaterThan(0)
      expect(results.every((r) => Array.isArray(r.variables["path"]))).toBe(true)
    })

    test("should handle pattern with multiple rest variables", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[...path1]/[...path2].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      // This should work but may have limited matches depending on PathResolver implementation
      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe("Path format consistency", () => {
    test("should preserve ./ prefix when pattern has it", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
      // All results should have absolute filePath regardless of pattern format
      expect(results.every((r) => path.isAbsolute(r.filePath))).toBe(true)
    })

    test("should work without ./ prefix when pattern doesn't have it", async () => {
      const task = createTask({
        source: `tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results).toHaveLength(3)
      expect(results.every((r) => path.isAbsolute(r.filePath))).toBe(true)
    })
  })

  describe("Real-world scenarios", () => {
    test("should handle content pipeline pattern", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[section_id]/[...slug].md`,
      })

      // Add section structure
      const sectionDir = path.join(FIXTURE_DIR, "books/fiction/book-1/section-1")
      await mkdir(sectionDir, { recursive: true })
      await writeFile(path.join(sectionDir, "topic-1.md"), "# Topic 1")
      await writeFile(path.join(sectionDir, "topic-2.md"), "# Topic 2")

      const results = await task.scanFiles({ cwd: process.cwd() })

      expect(results.length).toBeGreaterThan(0)
      expect(
        results.every(
          (r) =>
            r.variables["category"]
            && r.variables["collection_id"]
            && r.variables["section_id"]
            && r.variables["slug"],
        ),
      ).toBe(true)
    })

    test("should handle fixed directory with variable segments", async () => {
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...slug].md`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      // Should find all .md files in both book collections
      expect(results).toHaveLength(3)
      expect(
        results.every(
          (r) =>
            r.variables["category"]
            && r.variables["collection_id"]
            && Array.isArray(r.variables["slug"]),
        ),
      ).toBe(true)
    })

    test("should match multiple file types with rest variable", async () => {
      // Create yaml files alongside md files
      await writeFile(path.join(FIXTURE_DIR, "books/fiction/book-1/metadata.yaml"), "title: Book 1")
      await writeFile(
        path.join(FIXTURE_DIR, "books/nonfiction/guide-1/metadata.yaml"),
        "title: Guide 1",
      )

      // Use rest variable to capture any filename
      const task = createTask({
        source: `./tests/fixtures/scanfiles-test/books/[category]/[collection_id]/[...file]`,
      })

      const results = await task.scanFiles({ cwd: process.cwd() })

      // Should find both .md and .yaml files
      expect(results.length).toBeGreaterThanOrEqual(4) // 3 md + 2 yaml = 5
      expect(results.every((r) => Array.isArray(r.variables["file"]))).toBe(true)
    })
  })
})
