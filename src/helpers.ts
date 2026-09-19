import type { TransformerDefinition } from "./config/types.ts"

/**
 * Helper untuk mendefinisikan custom transformer dengan type safety.
 * Client pakai ini di project mereka sendiri.
 *
 * @example
 * ```ts
 * import { defineTransformer } from 'penup';
 *
 * const myTransformer = defineTransformer({
 *   name: 'my.custom',
 *   description: 'My custom transformer',
 *   execute: async (content, context) => {
 *     return { content: content.toUpperCase(), changed: true };
 *   },
 * });
 * ```
 */
export function defineTransformer(definition: TransformerDefinition): TransformerDefinition {
  return definition
}
