/**
 * TransformerRegistry - Registry for managing transformers
 */

import type { TransformerDefinition } from "../config/types"

export class TransformerRegistry {
  private readonly transformers: Map<string, TransformerDefinition> = new Map()

  register(definition: TransformerDefinition): void {
    if (this.transformers.has(definition.name)) {
      throw new Error(`Transformer "${definition.name}" is already registered.`)
    }
    this.transformers.set(definition.name, definition)
  }

  get(name: string): TransformerDefinition | undefined {
    return this.transformers.get(name)
  }

  has(name: string): boolean {
    return this.transformers.has(name)
  }

  list(): string[] {
    return Array.from(this.transformers.keys())
  }

  unregister(name: string): void {
    this.transformers.delete(name)
  }

  clear(): void {
    this.transformers.clear()
  }
}
