/**
 * Context - Runtime context for pipeline execution
 * Holds all variables and metadata available during task execution.
 */

import type { Context as ContextInterface, VariableMap } from "../config/types"

export interface ContextOptions {
  filePath: string
  variables?: VariableMap
  globals?: VariableMap
  cwd?: string
}

export class Context implements ContextInterface {
  readonly filePath: string
  readonly variables: VariableMap
  readonly globals: VariableMap
  readonly cwd: string
  private metadataStore: Record<string, unknown> = {}

  constructor(options: ContextOptions) {
    this.filePath = options.filePath
    this.variables = { ...options.variables }
    this.globals = { ...options.globals }
    this.cwd = options.cwd ?? process.cwd()
  }

  getVariable(name: string): string | string[] | undefined {
    const value = this.variables[name]
    if (value !== undefined) return value
    return this.globals[name]
  }

  setVariable(name: string, value: string | string[]): void {
    this.variables[name] = value
  }

  getAllVariables(): VariableMap {
    return { ...this.globals, ...this.variables }
  }

  setMetadata(key: string, value: unknown): void {
    this.metadataStore[key] = value
  }

  getMetadata<T = unknown>(key: string): T | undefined {
    return this.metadataStore[key] as T | undefined
  }

  getAllMetadata(): Record<string, unknown> {
    return { ...this.metadataStore }
  }

  extend(additionalVariables: VariableMap): Context {
    return new Context({
      filePath: this.filePath,
      variables: { ...this.variables, ...additionalVariables },
      globals: this.globals,
      cwd: this.cwd,
    })
  }

  clone(): Context {
    const cloned = new Context({
      filePath: this.filePath,
      variables: this.variables,
      globals: this.globals,
      cwd: this.cwd,
    })
    cloned.metadataStore = { ...this.metadataStore }
    return cloned
  }
}
