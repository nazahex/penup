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
  /** Shared aggregate store reference for aggregate mode */
  aggregateStore?: unknown[]
  /** Shared validation errors reference for validate mode */
  validationErrors?: Error[]
}

export class Context implements ContextInterface {
  readonly filePath: string
  readonly variables: VariableMap
  readonly globals: VariableMap
  readonly cwd: string
  private metadataStore: Record<string, unknown> = {}
  private aggregateStore: unknown[]
  private validationErrors: Error[]

  constructor(options: ContextOptions) {
    this.filePath = options.filePath
    this.variables = { ...options.variables }
    this.globals = { ...options.globals }
    this.cwd = options.cwd ?? process.cwd()
    // Use provided shared references or create new isolated ones
    this.aggregateStore = options.aggregateStore ?? []
    this.validationErrors = options.validationErrors ?? []
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

  pushToAggregate(data: unknown): void {
    this.aggregateStore.push(data)
  }

  getAggregateData(): unknown[] {
    return this.aggregateStore
  }

  addValidationError(error: Error): void {
    this.validationErrors.push(error)
  }

  getValidationErrors(): Error[] {
    return this.validationErrors
  }

  extend(additionalVariables: VariableMap): Context {
    return new Context({
      filePath: this.filePath,
      variables: { ...this.variables, ...additionalVariables },
      globals: this.globals,
      cwd: this.cwd,
      aggregateStore: this.aggregateStore,
      validationErrors: this.validationErrors,
    })
  }

  clone(): Context {
    const cloned = new Context({
      filePath: this.filePath,
      variables: this.variables,
      globals: this.globals,
      cwd: this.cwd,
      aggregateStore: this.aggregateStore,
      validationErrors: this.validationErrors,
    })
    cloned.metadataStore = { ...this.metadataStore }
    return cloned
  }
}
