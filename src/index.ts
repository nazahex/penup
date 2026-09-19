/**
 * Penup - Dynamic content pipeline orchestrator
 * Main entry point for programmatic usage.
 */

// Config loader
export { loadConfig } from "./config/loader"
// Types
export type {
  Context as ContextInterface,
  PenupConfig,
  PresetConfig,
  TaskConfig,
  TransformerDefinition,
  TransformerStep,
  TransformResult,
  VariableMap,
} from "./config/types"
export { Context } from "./core/context"
// Core classes
export { PathResolver } from "./core/pathResolver"
export { Pipeline } from "./core/pipeline"
export { Task } from "./core/task"
// Helper functions
export { defineTransformer } from "./helpers"
// Built-in transformers
export { frontmatterTransformers } from "./transformers/frontmatter"
// Transformer registry
export { TransformerRegistry } from "./transformers/registry"
