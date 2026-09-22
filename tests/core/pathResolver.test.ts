import { describe, expect, test } from "bun:test"
import { PathResolver } from "../../src/core/pathResolver"

describe("PathResolver", () => {
  const resolver = new PathResolver()

  describe("parse()", () => {
    test("should parse literal segments", () => {
      const parsed = resolver.parse("./src/books")
      expect(parsed.variableNames).toEqual([])
      expect(parsed.hasRestVariable).toBe(false)
    })

    test("should parse single variable segments", () => {
      const parsed = resolver.parse("./src/[category]/[id]")
      expect(parsed.variableNames).toEqual(["category", "id"])
      expect(parsed.hasRestVariable).toBe(false)
    })

    test("should parse rest variable segments", () => {
      const parsed = resolver.parse("./src/[...slug].md")
      expect(parsed.variableNames).toEqual(["slug"])
      expect(parsed.hasRestVariable).toBe(true)
      expect(parsed.restVariableName).toBe("slug")
    })
  })

  describe("match()", () => {
    test("should extract single variables", () => {
      const result = resolver.match("./src/fiction/book-123", "./src/[category]/[id]")
      expect(result.matched).toBe(true)
      expect(result.variables).toEqual({ category: "fiction", id: "book-123" })
    })

    test("should extract rest variables", () => {
      const result = resolver.match(
        "./src/fiction/book-123/chapter-1/page-1.md",
        "./src/[category]/[collection_id]/[...slug].md",
      )
      expect(result.matched).toBe(true)
      expect(result.variables).toEqual({
        category: "fiction",
        collection_id: "book-123",
        slug: ["chapter-1", "page-1"],
      })
    })

    test("should not match when pattern does not match", () => {
      const result = resolver.match("./src/fiction/book-123", "./src/nonfiction/[id]")
      expect(result.matched).toBe(false)
    })
  })

  describe("generate()", () => {
    test("should substitute variables", () => {
      const output = resolver.generate("./dist/[category]/metadata.json", {
        category: "fiction",
      })
      expect(output).toBe("./dist/fiction/metadata.json")
    })

    test("should substitute rest variables", () => {
      const output = resolver.generate("./dist/[...slug].json", {
        slug: ["a", "b"],
      })
      expect(output).toBe("./dist/a/b.json")
    })
  })

  describe("toGlobPattern()", () => {
    test("should convert variables to glob wildcards", () => {
      const glob = resolver.toGlobPattern("./src/books/[category]/[collection_id]/[...slug].md")
      expect(glob).toBe("./src/books/*/*/**/*.md") // ← Updated: **.md → **/*.md
    })
  })
})
