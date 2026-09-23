/**
 * Task - Represents a single unit of work in the pipeline
 */

import { mkdir } from "node:fs/promises"
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

/**
 * Build ContextOptions safely for exactOptionalPropertyTypes.
 * Only includes properties that are not undefined.
 */
function buildContextOptions(
  base: { filePath: string; variables: VariableMap },
  options: TaskRunOptions,
  extra?: Partial<ContextOptions>,
): ContextOptions {
  const ctx: ContextOptions = {
    filePath: base.filePath,
    variables: base.variables,
    ...extra,
  }

  if (options.globals !== undefined) ctx.globals = options.globals
  if (options.cwd !== undefined) ctx.cwd = options.cwd

  return ctx
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
    const globals = options.globals ?? {}

    // 1. Resolve global variables (e.g., {{outputBase}}) in the source pattern
    // BEFORE generating glob patterns or checking for absolute paths.
    let resolvedSourcePattern = this.config.source
    for (const [key, value] of Object.entries(globals)) {
      if (typeof value === "string") {
        resolvedSourcePattern = resolvedSourcePattern.replaceAll(`{{${key}}}`, value)
      } else if (Array.isArray(value)) {
        resolvedSourcePattern = resolvedSourcePattern.replaceAll(`{{...${key}}}`, value.join("/"))
      }
    }

    const isAbsolute = path.isAbsolute(resolvedSourcePattern)

    let globPattern: string
    let scanBase: string

    if (isAbsolute) {
      const relPattern = path.relative(cwd, resolvedSourcePattern)

      if (relPattern.startsWith("..")) {
        // Source is outside cwd — extract static prefix as scan base
        const segments = resolvedSourcePattern.split("/")
        const firstVarIndex = segments.findIndex((s) => s.includes("["))

        if (firstVarIndex > 0) {
          scanBase = segments.slice(0, firstVarIndex).join("/")
          const dynamicPart = segments.slice(firstVarIndex).join("/")
          globPattern = this.resolver.toGlobPattern(dynamicPart)
        } else {
          scanBase = path.dirname(resolvedSourcePattern)
          globPattern = this.resolver.toGlobPattern(path.basename(resolvedSourcePattern))
        }
      } else {
        // Source is under cwd — use relative pattern
        scanBase = cwd
        globPattern = this.resolver.toGlobPattern(relPattern)
      }
    } else {
      scanBase = cwd
      globPattern = this.resolver.toGlobPattern(resolvedSourcePattern)
    }

    const glob = new Glob(globPattern)
    const results: MatchResult[] = []

    for await (const matchedPath of glob.scan(scanBase)) {
      let pathToMatch: string

      // 2. Align path format (absolute vs relative) with the resolved pattern
      // so PathResolver.match() can compare them segment-by-segment correctly.
      if (isAbsolute) {
        pathToMatch = path.isAbsolute(matchedPath)
          ? matchedPath
          : path.resolve(scanBase, matchedPath)
      } else {
        // Both are relative. Ensure "./" prefix consistency.
        if (resolvedSourcePattern.startsWith("./") && !matchedPath.startsWith("./")) {
          pathToMatch = `./${matchedPath}`
        } else if (!resolvedSourcePattern.startsWith("./") && matchedPath.startsWith("./")) {
          pathToMatch = matchedPath.slice(2)
        } else {
          pathToMatch = matchedPath
        }
      }

      const matchResult = this.resolver.match(pathToMatch, resolvedSourcePattern)
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

      // 3. Always store the absolute path in the result for downstream transformers
      // so Bun.file() can read it regardless of the current working directory.
      const absoluteFilePath = path.isAbsolute(matchedPath)
        ? matchedPath
        : path.resolve(scanBase, matchedPath)
      matchResult.filePath = absoluteFilePath

      results.push(matchResult)
    }

    return results
  }

  /**
   * Group matched files by their resolved output path variables.
   * For aggregate mode, files sharing the same output variables belong to the same group.
   */
  /**
   * Group matched files by their resolved output path variables.
   * For aggregate mode, files sharing the same output variables belong to the same group.
   */
  private groupFilesByOutput(files: MatchResult[]): Map<string, MatchResult[]> {
    const groups = new Map<string, MatchResult[]>()
    const outputPattern = this.config.output?.path ?? ""
    const outputVarNames = this.resolver.getVariableNames(outputPattern)

    for (const file of files) {
      // Build group key from output-relevant variables only.
      // Variables in output pattern are a subset of source variables;
      // we extract them directly from the already-matched source variables.
      const keyParts = outputVarNames.map((varName) => {
        const val = file.variables[varName]
        if (val === undefined) return ""
        return Array.isArray(val) ? val.join("/") : val
      })
      const groupKey = keyParts.join("::") || "__default__"

      if (!groups.has(groupKey)) {
        groups.set(groupKey, [])
      }
      groups.get(groupKey)?.push(file)
    }

    return groups
  }

  /**
   * Execute a list of transformer steps against content and context.
   * Returns the final transformed content.
   */
  /**
   * Execute a list of transformer steps against content and context.
   * Returns the final transformed content.
   */
  private async executeTransforms(
    transforms: TransformerStep[] | undefined,
    content: string,
    context: Context,
    errors: Error[],
  ): Promise<{ content: string; modified: boolean }> {
    let currentContent = content
    let modified = false

    if (!transforms) return { content: currentContent, modified }

    for (const step of transforms) {
      const transformer = this.resolveTransformer(step)
      if (!transformer) {
        const stepName = typeof step === "string" ? step : step.name
        errors.push(new Error(`Transformer not found: ${stepName}`))
        continue
      }

      // Inject step options into context metadata under the transformer's name.
      // This allows transformers to read their configuration via context.getMetadata(name).
      // e.g. { name: "file.rename", options: { pattern: "[slug].md" } }
      // becomes available as context.getMetadata("file.rename") → { pattern: "[slug].md" }
      if (typeof step !== "string" && step.options) {
        context.setMetadata(step.name, step.options)
      }

      const result = await transformer.execute(currentContent, context)
      if (result.content !== undefined) currentContent = result.content
      if (result.changed) modified = true

      // Merge metadata produced by this transformer into context
      if (result.metadata) {
        for (const [key, value] of Object.entries(result.metadata)) {
          context.setMetadata(key, value)
        }
      }
    }

    return { content: currentContent, modified }
  }

  async run(options: TaskRunOptions = {}): Promise<TaskRunResult> {
    const startTime = Date.now()
    const mode = this.config.mode ?? "transform"

    const result: TaskRunResult = {
      taskName: this.name,
      filesProcessed: 0,
      filesModified: 0,
      fileResults: [],
      errors: [],
      duration: 0,
      totalSize: 0,
    }

    try {
      const files = await this.scanFiles(options)
      result.filesProcessed = files.length

      if (mode === "aggregate") {
        // --- AGGREGATE MODE ---
        const groups = this.groupFilesByOutput(files)

        for (const [, groupFiles] of groups) {
          const aggregateStore: unknown[] = []
          const validationErrors: Error[] = []
          const groupVariables = groupFiles[0]?.variables ?? {}

          // Phase 1: Run per-file transforms and collect data
          for (const file of groupFiles) {
            const contextOptions = buildContextOptions(
              { filePath: file.filePath, variables: file.variables },
              options,
              {
                aggregateStore,
                validationErrors,
                ...(this.config.vars !== undefined ? { taskVars: this.config.vars } : {}),
              },
            )
            const context = new Context(contextOptions)

            const fileContent = await Bun.file(file.filePath).text()
            const { modified } = await this.executeTransforms(
              this.config.transforms,
              fileContent,
              context,
              result.errors,
            )

            const fileResult: FileProcessResult = {
              sourcePath: file.filePath,
              variables: file.variables,
              modified,
              errors: [...validationErrors],
              size: Bun.file(file.filePath).size,
            }
            result.fileResults.push(fileResult)
            if (modified) result.filesModified++
          }

          // Phase 2: Run aggregate transforms once per group
          if (this.config.aggregateTransforms && this.config.output) {
            const allVariables = { ...(options.globals ?? {}), ...groupVariables }
            const outputPath = this.resolver.generate(this.config.output.path, allVariables)

            const emitContextOptions = buildContextOptions(
              { filePath: outputPath, variables: groupVariables },
              options,
              {
                aggregateStore,
                validationErrors,
                ...(this.config.vars !== undefined ? { taskVars: this.config.vars } : {}),
              },
            )
            const emitContext = new Context(emitContextOptions)

            const serializedAggregate = JSON.stringify(aggregateStore)
            const { content: finalContent } = await this.executeTransforms(
              this.config.aggregateTransforms,
              serializedAggregate,
              emitContext,
              result.errors,
            )

            if (!options.dryRun) {
              const outDir = path.dirname(outputPath)
              await mkdir(outDir, { recursive: true })
              await Bun.write(outputPath, finalContent)
            }

            result.totalSize += new TextEncoder().encode(finalContent).length
          }
        }
      } else if (mode === "validate") {
        // --- VALIDATE MODE ---
        for (const file of files) {
          const validationErrors: Error[] = []
          const contextOptions = buildContextOptions(
            { filePath: file.filePath, variables: file.variables },
            options,
            {
              validationErrors,
              ...(this.config.vars !== undefined ? { taskVars: this.config.vars } : {}),
            },
          )
          const context = new Context(contextOptions)

          const fileContent = await Bun.file(file.filePath).text()
          await this.executeTransforms(this.config.transforms, fileContent, context, result.errors)

          // Collect validation errors
          const fileValidationErrors = context.getValidationErrors()
          result.errors.push(...fileValidationErrors)

          const fileResult: FileProcessResult = {
            sourcePath: file.filePath,
            variables: file.variables,
            modified: false,
            errors: [...fileValidationErrors],
            size: Bun.file(file.filePath).size,
          }
          result.fileResults.push(fileResult)
          result.totalSize += fileResult.size ?? 0
        }
      } else {
        // --- TRANSFORM MODE (original behavior) ---
        for (const file of files) {
          const fileResult = await this.processFile(file, options)
          result.fileResults.push(fileResult)
          if (fileResult.modified) result.filesModified++
          result.errors.push(...fileResult.errors)
          result.totalSize += fileResult.size ?? 0
        }
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error : new Error(String(error)))
    }

    result.duration = Date.now() - startTime
    return result
  }

  /**
   * Process a single file in transform mode.
   * Kept for backward compatibility with the original transform workflow.
   */
  private async processFile(
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

      const contextOptions = buildContextOptions(
        { filePath: matchResult.filePath, variables: matchResult.variables },
        options,
        this.config.vars !== undefined ? { taskVars: this.config.vars } : undefined,
      )
      const context = new Context(contextOptions)

      const { content: transformedContent, modified } = await this.executeTransforms(
        this.config.transforms,
        content,
        context,
        result.errors,
      )
      content = transformedContent
      result.modified = modified

      // Collect validation errors even in transform mode for fail-fast support
      const validationErrors = context.getValidationErrors()
      if (validationErrors.length > 0) {
        result.errors.push(...validationErrors)
      }

      // Write output only if content changed and output is configured
      if (this.config.output && content !== originalContent) {
        const allVariables = { ...(options.globals ?? {}), ...matchResult.variables }
        const outputPath = this.resolver.generate(this.config.output.path, allVariables)
        result.outputPath = outputPath

        if (!options.dryRun) {
          const outDir = path.dirname(outputPath)
          await mkdir(outDir, { recursive: true })
          await Bun.write(outputPath, content)
        }

        result.size = new TextEncoder().encode(content).length
      } else {
        try {
          result.size = file.size
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

  private resolveTransformer(step: TransformerStep) {
    if (typeof step === "string") return this.transformerRegistry.get(step)
    return this.transformerRegistry.get(step.name)
  }
}
