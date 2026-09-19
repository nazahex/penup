import { describe, expect, test } from "bun:test"
import { Context } from "../../src/core/context.ts"

describe("Context", () => {
  describe("constructor", () => {
    test("should initialize with minimal options", () => {
      const ctx = new Context({ filePath: "/test/file.md" })

      expect(ctx.filePath).toBe("/test/file.md")
      expect(ctx.variables).toEqual({})
      expect(ctx.globals).toEqual({})
      expect(ctx.cwd).toBe(process.cwd())
    })

    test("should initialize with all options", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { siteUrl: "https://example.com" },
        cwd: "/custom/cwd",
      })

      expect(ctx.filePath).toBe("/test/file.md")
      expect(ctx.variables).toEqual({ category: "fiction" })
      expect(ctx.globals).toEqual({ siteUrl: "https://example.com" })
      expect(ctx.cwd).toBe("/custom/cwd")
    })

    test("should not mutate input objects", () => {
      const vars = { category: "fiction" }
      const globals = { siteUrl: "https://example.com" }
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: vars,
        globals: globals,
      })

      ctx.variables["category"] = "modified"
      expect(vars.category).toBe("fiction")
    })
  })

  describe("getVariable", () => {
    test("should return file-specific variable when present", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { category: "nonfiction" },
      })

      expect(ctx.getVariable("category")).toBe("fiction")
    })

    test("should fall back to globals when variable not in file", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { siteUrl: "https://example.com" },
      })

      expect(ctx.getVariable("siteUrl")).toBe("https://example.com")
    })

    test("should return undefined when variable does not exist", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      expect(ctx.getVariable("missing")).toBeUndefined()
    })

    test("should handle array variable values", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { slug: ["a", "b", "c"] },
      })

      expect(ctx.getVariable("slug")).toEqual(["a", "b", "c"])
    })
  })

  describe("setVariable", () => {
    test("should add new variable", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      ctx.setVariable("category", "fiction")

      expect(ctx.getVariable("category")).toBe("fiction")
    })

    test("should override existing variable", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
      })

      ctx.setVariable("category", "nonfiction")
      expect(ctx.getVariable("category")).toBe("nonfiction")
    })

    test("should override globals with file variable", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        globals: { siteUrl: "https://old.com" },
      })

      ctx.setVariable("siteUrl", "https://new.com")
      expect(ctx.getVariable("siteUrl")).toBe("https://new.com")
    })
  })

  describe("getAllVariables", () => {
    test("should merge globals and file variables", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { siteUrl: "https://example.com" },
      })

      expect(ctx.getAllVariables()).toEqual({
        category: "fiction",
        siteUrl: "https://example.com",
      })
    })

    test("should prioritize file variables over globals", () => {
      const ctx = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { category: "nonfiction", siteUrl: "https://example.com" },
      })

      const all = ctx.getAllVariables()
      expect(all["category"]).toBe("fiction")
      expect(all["siteUrl"]).toBe("https://example.com")
    })
  })

  describe("metadata operations", () => {
    test("should store and retrieve metadata", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      ctx.setMetadata("frontmatter", { title: "Hello" })

      expect(ctx.getMetadata<{ title: string }>("frontmatter")).toEqual({ title: "Hello" })
    })

    test("should return undefined for missing metadata", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      expect(ctx.getMetadata("missing")).toBeUndefined()
    })

    test("should support typed metadata retrieval", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      ctx.setMetadata("count", 42)

      const count = ctx.getMetadata<number>("count")
      expect(count).toBe(42)
    })

    test("should return all metadata", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      ctx.setMetadata("key1", "value1")
      ctx.setMetadata("key2", { nested: true })

      const all = ctx.getAllMetadata()
      expect(all).toEqual({
        key1: "value1",
        key2: { nested: true },
      })
    })

    test("should not mutate metadata store via getAllMetadata", () => {
      const ctx = new Context({ filePath: "/test/file.md" })
      ctx.setMetadata("key", "value")

      const all = ctx.getAllMetadata()
      all["key"] = "modified"

      expect(ctx.getMetadata<string>("key")).toBe("value")
    })
  })

  describe("extend", () => {
    test("should create new context with merged variables", () => {
      const original = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { siteUrl: "https://example.com" },
      })

      const extended = original.extend({ newVar: "new-value" })

      expect(extended.getVariable("category")).toBe("fiction")
      expect(extended.getVariable("newVar")).toBe("new-value")
      expect(extended.filePath).toBe("/test/file.md")
    })

    test("should not modify original context", () => {
      const original = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
      })

      const extended = original.extend({ category: "nonfiction" })

      expect(original.getVariable("category")).toBe("fiction")
      expect(extended.getVariable("category")).toBe("nonfiction")
    })

    test("should preserve globals in extended context", () => {
      const original = new Context({
        filePath: "/test/file.md",
        globals: { siteUrl: "https://example.com" },
      })

      const extended = original.extend({ category: "fiction" })
      expect(extended.getVariable("siteUrl")).toBe("https://example.com")
    })
  })

  describe("clone", () => {
    test("should create independent copy", () => {
      const original = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
        globals: { siteUrl: "https://example.com" },
      })
      original.setMetadata("key", "value")

      const cloned = original.clone()

      expect(cloned.filePath).toBe(original.filePath)
      expect(cloned.variables).toEqual(original.variables)
      expect(cloned.globals).toEqual(original.globals)
      expect(cloned.getMetadata<string>("key")).toBe("value")
    })

    test("should not share state with original", () => {
      const original = new Context({
        filePath: "/test/file.md",
        variables: { category: "fiction" },
      })

      const cloned = original.clone()
      cloned.setVariable("category", "nonfiction")

      expect(original.getVariable("category")).toBe("fiction")
      expect(cloned.getVariable("category")).toBe("nonfiction")
    })

    test("should preserve metadata in clone", () => {
      const original = new Context({ filePath: "/test/file.md" })
      original.setMetadata("data", { nested: true })

      const cloned = original.clone()
      expect(cloned.getMetadata<{ nested: boolean }>("data")).toEqual({ nested: true })
    })
  })
})
