import { describe, expect, test } from "bun:test"
import { PathResolver } from "../../src/core/pathResolver.ts"

describe("PathResolver - Advanced Edge Cases", () => {
  const resolver = new PathResolver()

  describe("parse() edge cases", () => {
    test("should handle empty pattern", () => {
      const parsed = resolver.parse("")
      expect(parsed.segments).toEqual([])
      expect(parsed.variableNames).toEqual([])
    })

    test("should handle pattern with only slashes", () => {
      const parsed = resolver.parse("///")
      expect(parsed.segments).toEqual([])
    })

    test("should handle variable at root level", () => {
      const parsed = resolver.parse("[category]/file.md")
      expect(parsed.variableNames).toEqual(["category"])
      expect(parsed.segments[0]).toEqual({ type: "variable", name: "category" })
    })

    test("should handle rest variable at beginning", () => {
      const parsed = resolver.parse("[...slug]/file.md")
      expect(parsed.variableNames).toEqual(["slug"])
      expect(parsed.hasRestVariable).toBe(true)
    })

    test("should handle variable with underscores and numbers", () => {
      const parsed = resolver.parse("[collection_id_2024]/[file_name]")
      expect(parsed.variableNames).toEqual(["collection_id_2024", "file_name"])
    })

    test("should preserve literal case sensitivity", () => {
      const parsed = resolver.parse("./Books/FICTION/[category].md")
      expect(parsed.segments.find((s) => s.type === "literal" && s.value === "Books")).toBeDefined()
      expect(
        parsed.segments.find((s) => s.type === "literal" && s.value === "FICTION"),
      ).toBeDefined()
    })
  })

  describe("match() edge cases", () => {
    test("should match path with single segment", () => {
      const result = resolver.match("file.md", "[name].md")
      expect(result.matched).toBe(true)
      expect(result.variables).toEqual({ name: "file" })
    })

    test("should match rest variable capturing single segment", () => {
      const result = resolver.match("./src/file.md", "./src/[...slug].md")
      expect(result.matched).toBe(true)
      expect(result.variables["slug"]).toEqual(["file"])
    })

    test("should match rest variable capturing zero segments (empty array)", () => {
      const result = resolver.match("./src/index.md", "./src/[...slug]/index.md")
      expect(result.matched).toBe(true)
      expect(result.variables["slug"]).toEqual([])
    })

    test("should match rest variable capturing many segments", () => {
      const result = resolver.match("./src/a/b/c/d/e/file.md", "./src/[...slug].md")
      expect(result.matched).toBe(true)
      expect(result.variables["slug"]).toEqual(["a", "b", "c", "d", "e", "file"])
    })

    test("should not match when literal suffix does not match", () => {
      const result = resolver.match("./src/file.txt", "./src/[...slug].md")
      expect(result.matched).toBe(false)
    })

    test("should match with unicode characters in variables", () => {
      const result = resolver.match("./src/日本語/ファイル.md", "./src/[category]/[name].md")
      expect(result.matched).toBe(true)
      expect(result.variables["category"]).toBe("日本語")
      expect(result.variables["name"]).toBe("ファイル")
    })

    test("should match with dots in variable values", () => {
      const result = resolver.match("./src/v1.2.3/file.md", "./src/[version]/[name].md")
      expect(result.matched).toBe(true)
      expect(result.variables["version"]).toBe("v1.2.3")
    })

    test("should not match when too few path segments", () => {
      const result = resolver.match("./src/file.md", "./src/[a]/[b]/[c].md")
      expect(result.matched).toBe(false)
    })

    test("should not match when too many path segments (no rest)", () => {
      const result = resolver.match("./src/a/b/c.md", "./src/[a]/[b].md")
      expect(result.matched).toBe(false)
    })

    test("should match with leading slash", () => {
      const result = resolver.match("/src/file.md", "/src/[name].md")
      expect(result.matched).toBe(true)
      expect(result.variables["name"]).toBe("file")
    })

    test("should handle pattern without any variables", () => {
      const result = resolver.match("./src/file.md", "./src/file.md")
      expect(result.matched).toBe(true)
      expect(result.variables).toEqual({})
    })

    test("should not match literal path with different case", () => {
      const result = resolver.match("./src/FILE.md", "./src/file.md")
      expect(result.matched).toBe(false)
    })
  })

  describe("generate() edge cases", () => {
    test("should handle pattern with no variables", () => {
      const output = resolver.generate("./static/output.json", {})
      expect(output).toBe("./static/output.json")
    })

    test("should handle empty rest variable (produces empty string)", () => {
      const output = resolver.generate("./dist/[...slug].json", { slug: [] })
      expect(output).toBe("./dist/.json")
    })

    test("should leave unresolved variables as-is", () => {
      const output = resolver.generate("./dist/[category]/[id].json", { category: "fiction" })
      expect(output).toBe("./dist/fiction/[id].json")
    })

    test("should handle multiple rest variables in same pattern", () => {
      const output = resolver.generate("./dist/[...a]/[...b].json", { a: ["x", "y"], b: ["z"] })
      expect(output).toBe("./dist/x/y/z.json")
    })

    test("should handle unicode characters in substitution", () => {
      const output = resolver.generate("./dist/[category]/index.html", { category: "日本語" })
      expect(output).toBe("./dist/日本語/index.html")
    })
  })

  describe("toGlobPattern() edge cases", () => {
    test("should handle pattern with no variables", () => {
      const glob = resolver.toGlobPattern("./src/file.md")
      expect(glob).toBe("./src/file.md")
    })

    test("should handle multiple consecutive variables", () => {
      const glob = resolver.toGlobPattern("./[a]/[b]/[c].md")
      expect(glob).toBe("./*/*/*.md")
    })

    test("should handle rest variable in middle of pattern", () => {
      const glob = resolver.toGlobPattern("./src/[...slug]/file.md")
      expect(glob).toBe("./src/**/file.md")
    })

    test("should handle mixed single and rest variables", () => {
      const glob = resolver.toGlobPattern("./[category]/[...slug]/[id].md")
      expect(glob).toBe("./*/**/*.md")
    })
  })

  describe("round-trip consistency", () => {
    test("should extract and regenerate to same output path", () => {
      const pattern = "./src/[category]/[id]/[...slug].md"
      const outputPathPattern = "./dist/[category]/[id]/[...slug].html"
      const filePath = "./src/fiction/book-123/chapter-1/page-1.md"

      const match = resolver.match(filePath, pattern)
      expect(match.matched).toBe(true)

      const output = resolver.generate(outputPathPattern, match.variables)
      expect(output).toBe("./dist/fiction/book-123/chapter-1/page-1.html")
    })

    test("should maintain variable names across parse operations", () => {
      const pattern = "./src/[a]/[b]/[...c].md"

      const parsed1 = resolver.parse(pattern)
      const parsed2 = resolver.parse(pattern)

      expect(parsed1.variableNames).toEqual(parsed2.variableNames)
      expect(parsed1.segments.length).toBe(parsed2.segments.length)
    })
  })
})
