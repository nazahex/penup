/**
 * Core type definitions for Penup
 * All types are designed for strict TypeScript mode with no implicit any
 */

import type { ZodSchema } from "zod"

// ============================================================
// VARIABLE & PATH TYPES
// ============================================================

/**
 * Represents a dynamic path variable extracted from a file path.
 * Can be either a single string (from [var]) or an array (from [...var])
 */
export type VariableValue = string | string[]

/**
 * Map of variable names to their extracted values.
 * Keys are the variable names without brackets.
 */
export type VariableMap = Record<string, VariableValue>

/**
 * A segment of a path pattern.
 * Can be a literal string, a single variable [name], or a rest variable [...name]
 */
export type PathSegment =
  | { type: "literal"; value: string }
  | { type: "variable"; name: string }
  | { type: "rest"; name: string }

/**
 * Parsed path pattern, broken down into typed segments
 */
export interface ParsedPattern {
  /** Original pattern string */
  original: string
  /** Ordered list of path segments */
  segments: PathSegment[]
  /** List of variable names that can be extracted */
  variableNames: string[]
  /** Whether pattern contains a rest variable */
  hasRestVariable: boolean
  /** Name of the rest variable (if exists) */
  restVariableName?: string | undefined
}

// ============================================================
// CONTEXT
// ============================================================

/**
 * Runtime context passed through the pipeline.
 * Contains variables extracted from current file path.
 */
export interface Context {
  /** Current file path being processed */
  filePath: string
  /** Variables extracted from the source path */
  variables: VariableMap
  /** Global variables from config */
  globals: VariableMap
  /** Working directory */
  cwd: string

  // Methods - must match class implementation in core/Context.ts
  getVariable(name: string): string | string[] | undefined
  setVariable(name: string, value: string | string[]): void
  getAllVariables(): VariableMap
  setMetadata(key: string, value: unknown): void
  getMetadata<T = unknown>(key: string): T | undefined
  getAllMetadata(): Record<string, unknown>
  extend(additionalVariables: VariableMap): Context
  clone(): Context
}

// ============================================================
// TRANSFORMER
// ============================================================

/**
 * Result of a transformer operation.
 * Can contain new content to write, metadata, or side effects.
 */
export interface TransformResult {
  /** New content to write (if applicable) */
  content?: string
  /** Additional metadata produced by this transformer */
  metadata?: Record<string, unknown>
  /** Whether the transformation changed anything */
  changed: boolean
}

/**
 * A transformer function that processes file content within a context.
 * Receives the current content and context, returns the result.
 */
export type TransformerFunction = (
  content: string,
  context: Context,
) => TransformResult | Promise<TransformResult>

/**
 * Definition of a transformer that can be referenced in config.
 */
export interface TransformerDefinition {
  /** Unique identifier for the transformer */
  name: string
  /** Human-readable description */
  description: string
  /** Zod schema for validating transformer options */
  optionsSchema?: ZodSchema<unknown>
  /** The transformer function itself */
  execute: TransformerFunction
}

// ============================================================
// TASK CONFIGURATION
// ============================================================

/**
 * Configuration for a transformer step within a task.
 * Can be a simple string (no options) or an object with options.
 */
export type TransformerStep =
  | string
  | {
      /** Transformer name to invoke */
      name: string
      /** Options to pass to the transformer */
      options?: Record<string, unknown>
      /** Condition that must be true for this transformer to run */
      when?: string
    }

/**
 * Output configuration for a task.
 */
export interface TaskOutputConfig {
  /** Output path pattern (can contain variables) */
  path: string
  /** Output format (for serialization) */
  format?: "json" | "yaml" | "text" | "raw"
  /** Whether to overwrite existing files */
  overwrite?: boolean
}

/**
 * Configuration for a single task in the pipeline.
 */
export interface TaskConfig {
  /** Source file pattern with dynamic variables */
  source: string
  /** Output configuration (optional, for transformers that produce files) */
  output?: TaskOutputConfig
  /** List of transformer steps to apply */
  transforms?: TransformerStep[]
  /** Names of tasks this task depends on */
  dependsOn?: string[]
  /** Whether this task can run in parallel with others */
  parallel?: boolean
  /** Condition for running this task */
  when?: string
  /** Whether to validate output (if validator registered) */
  validate?: {
    /** Validator name */
    name: string
    /** Whether to fail on validation error */
    strict?: boolean
  }
  /** Human-readable description */
  description?: string
}

// ============================================================
// PRESET
// ============================================================

/**
 * Scope configuration for a task within a preset.
 * Defines specific values for dynamic variables.
 */
export interface TaskScope {
  /** Map of variable names to their fixed values */
  [variableName: string]: string | string[]
}

/**
 * A preset is a named collection of task scopes.
 * Useful for common operation patterns (e.g., "build for production", "process specific category")
 */
export interface PresetConfig {
  /** Human-readable description */
  description?: string
  /** Task-specific scopes */
  tasks?: {
    [taskName: string]: {
      scope?: TaskScope
    }
  }
  /** Global variable overrides */
  globals?: VariableMap
}

// ============================================================
// ROOT CONFIG
// ============================================================

/**
 * Root configuration for Penup.
 * Can be loaded from penup.config.ts, .yaml, or .js
 */
export interface PenupConfig {
  /** Project name */
  name: string
  /** Working directory (defaults to process.cwd()) */
  cwd?: string
  /** Global variables available to all tasks */
  vars?: VariableMap
  /** Named presets */
  presets?: {
    [presetName: string]: PresetConfig
  }
  /** Task definitions */
  tasks: {
    [taskName: string]: TaskConfig
  }
  /** Custom transformers to register */
  transformers?: {
    [transformerName: string]: TransformerDefinition
  }
}
