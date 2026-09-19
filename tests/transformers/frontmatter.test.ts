import { describe, expect, test } from "bun:test"
import { Context } from "../../src/core/context.ts"
import { frontmatterTransformers } from "../../src/transformers/frontmatter.ts"

function createContext(filePath = "/test/file.md") {
  return new Context({ filePath })
}

describe("Frontmatter Transformers", () => {
  describe("frontmatter.extract", () => {
    const extractor = frontmatterTransformers.extract

    test("should extract valid frontmatter", async () => {
      const content = `---
title: Hello World
slug: hello-world
---

# Content Body`

      const ctx = createContext()
      const result = await extractor.execute(content, ctx)

      expect(result.changed).toBe(false)
      expect(result.metadata?.["frontmatter"]).toEqual({
        title: "Hello World",
        slug: "hello-world",
      })
      expect(ctx.getMetadata<{ title: string; slug: string }>("frontmatter")).toEqual({
        title: "Hello World",
        slug: "hello-world",
      })
    })

    test("should return empty metadata when no frontmatter", async () => {
      const content = "# Just markdown\n\nNo frontmatter here."
      const ctx = createContext()
      const result = await extractor.execute(content, ctx)

      expect(result.changed).toBe(false)
      expect(result.metadata?.["frontmatter"]).toEqual({})
    })

    test("should handle frontmatter with arrays and nested objects", async () => {
      const content = `---
title: Complex
teaches:
  - Item 1
  - Item 2
meta:
  author: Jane
  year: 2024
---

Body`

      const ctx = createContext()
      const result = await extractor.execute(content, ctx)
      const frontmatter = result.metadata?.["frontmatter"] as Record<string, unknown>

      expect(frontmatter["title"]).toBe("Complex")
      expect(frontmatter["teaches"]).toEqual(["Item 1", "Item 2"])
      expect(frontmatter["meta"]).toEqual({ author: "Jane", year: 2024 })
    })

    test("should handle malformed YAML gracefully", async () => {
      const content = `---
title: [unclosed
---

Body`

      const ctx = createContext()
      const result = await extractor.execute(content, ctx)

      expect(result.changed).toBe(false)
      expect(result.content).toBe(content)
    })

    test("should handle empty frontmatter", async () => {
      const content = `---
---

Body`

      const ctx = createContext()
      const result = await extractor.execute(content, ctx)

      expect(result.metadata?.["frontmatter"]).toEqual({})
    })

    test("should have correct transformer metadata", () => {
      expect(extractor.name).toBe("frontmatter.extract")
      expect(extractor.description).toBeTruthy()
      expect(typeof extractor.execute).toBe("function")
    })
  })

  describe("frontmatter.inject", () => {
    const injector = frontmatterTransformers.inject

    test("should inject frontmatter into plain markdown", async () => {
      const content = "# Hello World\n\nThis is content."
      const ctx = createContext()
      ctx.setMetadata("injectOptions", {
        data: { title: "Hello", slug: "hello" },
      })

      const result = await injector.execute(content, ctx)

      expect(result.changed).toBe(true)
      expect(result.content).toContain("---")
      expect(result.content).toContain("title: Hello")
      expect(result.content).toContain("# Hello World")
    })

    test("should not overwrite existing frontmatter by default", async () => {
      const content = `---
title: Original
---

Body`

      const ctx = createContext()
      ctx.setMetadata("injectOptions", {
        data: { title: "New Title" },
      })

      const result = await injector.execute(content, ctx)

      expect(result.changed).toBe(false)
      expect(result.content).toBe(content)
    })

    test("should overwrite existing frontmatter when option is set", async () => {
      const content = `---
title: Original
---

Body`

      const ctx = createContext()
      ctx.setMetadata("injectOptions", {
        data: { title: "New Title" },
        overwrite: true,
      })

      const result = await injector.execute(content, ctx)

      expect(result.changed).toBe(true)
      expect(result.content).toContain("title: New Title")
      expect(result.content).not.toContain("title: Original")
    })

    test("should use data from metadataKey option", async () => {
      const content = "# Content"
      const ctx = createContext()
      ctx.setMetadata("customData", { title: "From Custom Key" })
      ctx.setMetadata("injectOptions", {
        metadataKey: "customData",
      })

      const result = await injector.execute(content, ctx)

      expect(result.content).toContain("title: From Custom Key")
    })

    test("should fall back to empty data when no options provided", async () => {
      const content = "# Content"
      const ctx = createContext()

      const result = await injector.execute(content, ctx)

      expect(result.changed).toBe(true)
      expect(result.content).toContain("---")
    })

    test("should have correct transformer metadata", () => {
      expect(injector.name).toBe("frontmatter.inject")
      expect(injector.description).toBeTruthy()
      expect(typeof injector.execute).toBe("function")
    })
  })
})
