/**
 * Pipeline - DAG-based task executor
 */

import type { PenupConfig, VariableMap } from "../config/types"
import type { TransformerRegistry } from "../transformers/registry"
import type { PathResolver } from "./pathResolver"
import { Task, type TaskRunResult } from "./task"

export interface PipelineRunOptions {
  tasks?: string[]
  scope?: VariableMap
  cwd?: string
  dryRun?: boolean
  verbose?: boolean
}

export interface PipelineRunResult {
  tasksExecuted: number
  taskResults: TaskRunResult[]
  errors: Error[]
  duration: number
}

export class Pipeline {
  private readonly config: PenupConfig
  private readonly resolver: PathResolver
  private readonly transformerRegistry: TransformerRegistry
  private readonly tasks: Map<string, Task> = new Map()

  constructor(
    config: PenupConfig,
    resolver: PathResolver,
    transformerRegistry: TransformerRegistry,
  ) {
    this.config = config
    this.resolver = resolver
    this.transformerRegistry = transformerRegistry

    // Auto-register custom transformers from config.
    // This ensures programmatic API usage matches CLI behavior.
    if (config.transformers) {
      for (const [name, definition] of Object.entries(config.transformers)) {
        if (!this.transformerRegistry.has(name)) {
          this.transformerRegistry.register(definition)
        }
      }
    }

    this.initializeTasks()
  }

  private initializeTasks(): void {
    for (const [taskName, taskConfig] of Object.entries(this.config.tasks)) {
      const task = new Task(taskName, taskConfig, this.resolver, this.transformerRegistry)
      this.tasks.set(taskName, task)
    }
  }

  getTask(name: string): Task | undefined {
    return this.tasks.get(name)
  }

  getTaskNames(): string[] {
    return Array.from(this.tasks.keys())
  }

  private getExecutionOrder(taskNames?: string[]): string[] {
    const allTasks = taskNames ?? Array.from(this.tasks.keys())
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const order: string[] = []

    const visit = (taskName: string): void => {
      if (visited.has(taskName)) return
      if (visiting.has(taskName))
        throw new Error(`Circular dependency detected involving task: ${taskName}`)

      visiting.add(taskName)
      const task = this.tasks.get(taskName)
      if (!task) throw new Error(`Task not found: ${taskName}`)

      if (task.config.dependsOn) {
        for (const dep of task.config.dependsOn) visit(dep)
      }

      visiting.delete(taskName)
      visited.add(taskName)
      order.push(taskName)
    }

    for (const taskName of allTasks) visit(taskName)
    return order
  }

  async run(options: PipelineRunOptions = {}): Promise<PipelineRunResult> {
    const startTime = Date.now()
    const result: PipelineRunResult = {
      tasksExecuted: 0,
      taskResults: [],
      errors: [],
      duration: 0,
    }

    try {
      const taskNamesToRun = options.tasks ?? Array.from(this.tasks.keys())
      const executionOrder = this.getExecutionOrder(taskNamesToRun)

      for (const taskName of executionOrder) {
        const task = this.tasks.get(taskName)
        if (!task) continue

        const taskResult = await task.run(
          stripUndefined({
            scope: options.scope,
            cwd: options.cwd ?? this.config.cwd,
            globals: this.config.vars,
            dryRun: options.dryRun,
            verbose: options.verbose,
          }),
        )

        result.taskResults.push(taskResult)
        result.tasksExecuted++
        result.errors.push(...taskResult.errors)

        // Fail-fast: stop pipeline if task has errors and failFast is enabled
        const isFailFast = task.config.failFast ?? task.config.mode === "validate"
        if (taskResult.errors.length > 0 && isFailFast) {
          break
        }
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error : new Error(String(error)))
    }

    result.duration = Date.now() - startTime
    return result
  }

  async runTask(taskName: string, options: PipelineRunOptions = {}): Promise<TaskRunResult> {
    const task = this.tasks.get(taskName)
    if (!task) throw new Error(`Task not found: ${taskName}`)

    return task.run(
      stripUndefined({
        scope: options.scope,
        cwd: options.cwd ?? this.config.cwd,
        globals: this.config.vars,
        dryRun: options.dryRun,
        verbose: options.verbose,
      }),
    )
  }
}

/**
 * Strip undefined values from an object to satisfy exactOptionalPropertyTypes.
 * Properties with undefined values are omitted entirely from the result.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      ;(result as Record<string, unknown>)[key] = value
    }
  }
  return result
}
