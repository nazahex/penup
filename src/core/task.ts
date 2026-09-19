/**
 * Task - Represents a single unit of work in the pipeline
 */

import path from "node:path"
import { Glob } from "bun"
import type { TaskConfig, TransformerStep, VariableMap } from "../config/types"
import type { TransformerRegistry } from "../transformers/registry"
import { Context, type ContextOptions } from "./context"
import type { MatchResult, PathResolver } from "./pathResolver"

export interface FileProcessResult {
  sourcePath: string
  outputPath?: string
  variables: VariableMap
  modified: boolean
  errors: Error[]
  size?: number
}

export interface TaskRunResult {
  taskName: string
  filesProcessed: number
  filesModified: number
  fileResults: FileProcessResult[]
  errors: Error[]
  duration: number
  totalSize: number
}

export interface TaskRunOptions {
  scope?: VariableMap
  cwd?: string
  globals?: VariableMap
  dryRun?: boolean
  verbose?: boolean
}

export class Task {
  readonly name: string
  readonly config: TaskConfig
  private readonly resolver: PathResolver
  private readonly transformerRegistry: TransformerRegistry

  constructor(
    name: string,
    config: TaskConfig,
    resolver: PathResolver,
    transformerRegistry: TransformerRegistry,
  ) {
    this.name = name
    this.config = config
    this.resolver = resolver
    this.transformerRegistry = transformerRegistry
  }

  async scanFiles(options: TaskRunOptions = {}): Promise<MatchResult[]> {
    const cwd = options.cwd ?? process.cwd()
    const globPattern = this.resolver.toGlobPattern(this.config.source)
    const glob = new Glob(globPattern)

    const results: MatchResult[] = []

    for await (const filePath of glob.scan(cwd)) {
      const matchResult = this.resolver.match(filePath, this.config.source)
      if (!matchResult.matched) continue

      // Apply scope filtering if provided
      if (options.scope) {
        const matchesScope = Object.entries(options.scope).every(([key, value]) => {
          const fileValue = matchResult.variables[key]
          if (Array.isArray(fileValue)) {
            return Array.isArray(value) && JSON.stringify(fileValue) === JSON.stringify(value)
          }
          return fileValue === value
        })
        if (!matchesScope) continue
      }

      results.push(matchResult)
    }

    return results
  }

  async processFile(
    matchResult: MatchResult,
    options: TaskRunOptions = {},
  ): Promise<FileProcessResult> {
    const result: FileProcessResult = {
      sourcePath: matchResult.filePath,
      variables: matchResult.variables,
      modified: false,
      errors: [],
    }

    try {
      const file = Bun.file(matchResult.filePath)
      let content = await file.text()
      const originalContent = content

      const contextOptions: ContextOptions = {
        filePath: matchResult.filePath,
        variables: matchResult.variables,
      }

      if (options.globals !== undefined) {
        contextOptions.globals = options.globals
      }

      if (options.cwd !== undefined) {
        contextOptions.cwd = options.cwd
      }

      const context = new Context(contextOptions)

      if (this.config.transforms) {
        for (const transformerStep of this.config.transforms) {
          const transformer = this.resolveTransformer(transformerStep)
          if (!transformer) {
            result.errors.push(
              new Error(
                `Transformer not found: ${typeof transformerStep === "string" ? transformerStep : transformerStep.name}`,
              ),
            )
            continue
          }

          const transformResult = await transformer.execute(content, context)
          if (transformResult.content !== undefined) content = transformResult.content
          if (transformResult.metadata) {
            for (const [key, value] of Object.entries(transformResult.metadata)) {
              context.setMetadata(key, value)
            }
          }
          if (transformResult.changed) result.modified = true
        }
      }

      if (this.config.output && content !== originalContent) {
        // Merge globals and file variables for output path generation
        const allVariables = { ...(options.globals ?? {}), ...matchResult.variables }
        const outputPath = this.resolver.generate(this.config.output.path, allVariables)
        result.outputPath = outputPath

        if (!options.dryRun) {
          const outputDir = path.dirname(outputPath)
          await Bun.spawn(["mkdir", "-p", outputDir]).exited
          await Bun.write(outputPath, content)
        }
      }

      if (this.config.output && content !== originalContent) {
        const allVariables = { ...(options.globals ?? {}), ...matchResult.variables }
        const outputPath = this.resolver.generate(this.config.output.path, allVariables)
        result.outputPath = outputPath

        if (!options.dryRun) {
          const outputDir = path.dirname(outputPath)
          await Bun.spawn(["mkdir", "-p", outputDir]).exited
          await Bun.write(outputPath, content)
        }

        // Track size
        result.size = new TextEncoder().encode(content).length
      } else {
        // Track source file size if no output
        try {
          const sourceFile = Bun.file(matchResult.filePath)
          result.size = sourceFile.size
        } catch {
          result.size = 0
        }
      }

      return result
    } catch (error) {
      result.errors.push(error instanceof Error ? error : new Error(String(error)))
      return result
    }
  }

  async run(options: TaskRunOptions = {}): Promise<TaskRunResult> {
    const startTime = Date.now()

    const result: TaskRunResult = {
      taskName: this.name,
      filesProcessed: 0,
      filesModified: 0,
      fileResults: [],
      errors: [],
      duration: 0,
      totalSize: 0,
    }

    const totalSize = result.fileResults.reduce((sum, r) => sum + (r.size || 0), 0)
    result.totalSize = totalSize

    try {
      const files = await this.scanFiles(options)
      result.filesProcessed = files.length

      for (const file of files) {
        const fileResult = await this.processFile(file, options)
        result.fileResults.push(fileResult)
        if (fileResult.modified) result.filesModified++
        result.errors.push(...fileResult.errors)
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error : new Error(String(error)))
    }

    result.duration = Date.now() - startTime
    return result
  }

  private resolveTransformer(step: TransformerStep) {
    if (typeof step === "string") return this.transformerRegistry.get(step)
    return this.transformerRegistry.get(step.name)
  }
}
