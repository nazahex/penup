import { describe, expect, test } from "bun:test"
import type { Context, TransformerDefinition, TransformResult } from "../../src/config/types.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

function createMockTransformer(name: string): TransformerDefinition {
  return {
    name,
    description: `Mock transformer: ${name}`,
    execute: async (_content: string, _context: Context): Promise<TransformResult> => ({
      content: _content,
      changed: false,
    }),
  }
}

describe("TransformerRegistry", () => {
  describe("register", () => {
    test("should register a new transformer", () => {
      const registry = new TransformerRegistry()
      const transformer = createMockTransformer("test")

      registry.register(transformer)

      expect(registry.has("test")).toBe(true)
    })

    test("should throw error when registering duplicate name", () => {
      const registry = new TransformerRegistry()
      const transformer1 = createMockTransformer("test")
      const transformer2 = createMockTransformer("test")

      registry.register(transformer1)

      expect(() => registry.register(transformer2)).toThrow(
        'Transformer "test" is already registered',
      )
    })

    test("should allow multiple different transformers", () => {
      const registry = new TransformerRegistry()

      registry.register(createMockTransformer("transformer-a"))
      registry.register(createMockTransformer("transformer-b"))
      registry.register(createMockTransformer("transformer-c"))

      expect(registry.list()).toEqual(["transformer-a", "transformer-b", "transformer-c"])
    })
  })

  describe("get", () => {
    test("should return registered transformer", () => {
      const registry = new TransformerRegistry()
      const transformer = createMockTransformer("test")
      registry.register(transformer)

      const retrieved = registry.get("test")
      expect(retrieved).toBe(transformer)
    })

    test("should return undefined for non-existent transformer", () => {
      const registry = new TransformerRegistry()
      expect(registry.get("missing")).toBeUndefined()
    })
  })

  describe("has", () => {
    test("should return true for registered transformer", () => {
      const registry = new TransformerRegistry()
      registry.register(createMockTransformer("test"))

      expect(registry.has("test")).toBe(true)
    })

    test("should return false for non-existent transformer", () => {
      const registry = new TransformerRegistry()
      expect(registry.has("missing")).toBe(false)
    })
  })

  describe("list", () => {
    test("should return empty array for empty registry", () => {
      const registry = new TransformerRegistry()
      expect(registry.list()).toEqual([])
    })

    test("should return all registered names in insertion order", () => {
      const registry = new TransformerRegistry()

      registry.register(createMockTransformer("alpha"))
      registry.register(createMockTransformer("beta"))
      registry.register(createMockTransformer("gamma"))

      expect(registry.list()).toEqual(["alpha", "beta", "gamma"])
    })
  })

  describe("unregister", () => {
    test("should remove registered transformer", () => {
      const registry = new TransformerRegistry()
      registry.register(createMockTransformer("test"))

      registry.unregister("test")

      expect(registry.has("test")).toBe(false)
      expect(registry.get("test")).toBeUndefined()
    })

    test("should not throw when unregistering non-existent transformer", () => {
      const registry = new TransformerRegistry()

      expect(() => registry.unregister("missing")).not.toThrow()
    })

    test("should allow re-registration after unregister", () => {
      const registry = new TransformerRegistry()
      const transformer1 = createMockTransformer("test")
      const transformer2 = createMockTransformer("test")

      registry.register(transformer1)
      registry.unregister("test")
      registry.register(transformer2)

      expect(registry.get("test")).toBe(transformer2)
    })
  })

  describe("clear", () => {
    test("should remove all transformers", () => {
      const registry = new TransformerRegistry()
      registry.register(createMockTransformer("a"))
      registry.register(createMockTransformer("b"))
      registry.register(createMockTransformer("c"))

      registry.clear()

      expect(registry.list()).toEqual([])
      expect(registry.has("a")).toBe(false)
    })

    test("should handle clearing empty registry", () => {
      const registry = new TransformerRegistry()

      expect(() => registry.clear()).not.toThrow()
      expect(registry.list()).toEqual([])
    })
  })
})
