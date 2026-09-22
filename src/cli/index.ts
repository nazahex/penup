#!/usr/bin/env bun
/**
 * Penup CLI - Command line interface with pendon-style logging
 */

import { Command } from "commander"
import { loadConfig } from "../config/loader.ts"
import { PathResolver } from "../core/pathResolver.ts"
import { Pipeline } from "../core/pipeline.ts"
import { logger } from "../logger.ts"
import { aggregationTransformers } from "../transformers/aggregation.ts"
import { createFileCopyTransformer, createFileRenameTransformer } from "../transformers/file.ts"
import { frontmatterTransformers } from "../transformers/frontmatter.ts"
import { TransformerRegistry } from "../transformers/registry.ts"

const program = new Command()

async function initPipeline(configPath?: string): Promise<Pipeline> {
  const config = await loadConfig(configPath)
  const resolver = new PathResolver()
  const registry = new TransformerRegistry()

  // Register built-in transformers
  registry.register(frontmatterTransformers.extract)
  registry.register(frontmatterTransformers.inject)

  // Register aggregate & emit built-in transformers
  for (const definition of Object.values(aggregationTransformers)) {
    registry.register(definition)
  }

  registry.register(createFileRenameTransformer(resolver))
  registry.register(createFileCopyTransformer(resolver))

  // Register custom transformers from config
  if (config.transformers) {
    const customNames: string[] = []
    for (const [_name, definition] of Object.entries(config.transformers)) {
      // FIX: Use definition.name instead of object key 'name' to prevent duplicate registration
      if (!registry.has(definition.name)) {
        registry.register(definition)
        customNames.push(definition.name)
      } else {
        logger.warn(
          `Custom transformer "${definition.name}" conflicts with built-in. Using built-in.`,
        )
      }
    }
    if (customNames.length > 0) {
      console.log(
        `\x1b[38;5;8m› Registered ${customNames.length} custom transformer(s): ${customNames.join(", ")}\x1b[0m`,
      )
    }
  }

  return new Pipeline(config, resolver, registry)
}
program
  .name("penup")
  .description("Dynamic content pipeline orchestrator with variable-driven paths")
  .version("0.1.0")

// Build command
program
  .command("build")
  .description("Run all tasks in the pipeline")
  .option("-c, --config <path>", "Path to config file")
  .option("--dry-run", "Preview changes without writing files")
  .option("-v, --verbose", "Verbose output")
  .action(async (options) => {
    try {
      logger.scanning()

      const pipeline = await initPipeline(options.config)
      const result = await pipeline.run({
        dryRun: options.dryRun,
        verbose: options.verbose,
      })

      // Log each task result
      for (const taskResult of result.taskResults) {
        const task = pipeline.getTask(taskResult.taskName)
        if (!task) continue

        logger.taskResult(taskResult.taskName, {
          filesProcessed: taskResult.filesProcessed,
          filesModified: taskResult.filesModified,
          totalSize: taskResult.totalSize || 0,
          inputPattern: task.config.source,
          outputPattern: task.config.output?.path,
          outputFormat: task.config.output?.format,
          duration: taskResult.duration,
        })

        // Log errors for this task
        if (taskResult.errors.length > 0 && options.verbose) {
          for (const error of taskResult.errors) {
            logger.errorDetail(error, taskResult.taskName)
          }
        }
      }

      // Summary dengan type annotations
      const totalFiles = result.taskResults.reduce<number>((sum, r) => sum + r.filesProcessed, 0)
      const totalModified = result.taskResults.reduce<number>((sum, r) => sum + r.filesModified, 0)
      const totalSize = result.taskResults.reduce<number>((sum, r) => sum + (r.totalSize || 0), 0)

      if (result.errors.length === 0) {
        logger.success("All tasks completed")
      } else {
        logger.warn(`Completed with ${result.errors.length} error(s)`)
      }

      logger.summary({
        tasksExecuted: result.tasksExecuted,
        totalFiles,
        totalModified,
        totalSize,
        duration: result.duration,
        errors: result.errors.length,
      })

      if (result.errors.length > 0) {
        process.exit(1)
      }
    } catch (error) {
      logger.error("Build failed")
      logger.errorDetail(error instanceof Error ? error : new Error(String(error)))
      process.exit(1)
    }
  })

// Run command
program
  .command("run <task>")
  .description("Run a specific task")
  .option("-c, --config <path>", "Path to config file")
  .option("--dry-run", "Preview changes without writing files")
  .option("-v, --verbose", "Verbose output")
  .action(async (taskName, options) => {
    try {
      logger.scanning(`Running task: ${taskName}`)

      const pipeline = await initPipeline(options.config)
      const task = pipeline.getTask(taskName)

      if (!task) {
        logger.error(`Task not found: ${taskName}`)
        console.log(`\x1b[38;5;8m› Available tasks: ${pipeline.getTaskNames().join(", ")}\x1b[0m`)
        process.exit(1)
      }

      const result = await pipeline.runTask(taskName, {
        dryRun: options.dryRun,
        verbose: options.verbose,
      })

      logger.taskResult(taskName, {
        filesProcessed: result.filesProcessed,
        filesModified: result.filesModified,
        totalSize: result.totalSize || 0,
        inputPattern: task.config.source,
        outputPattern: task.config.output?.path,
        outputFormat: task.config.output?.format,
        duration: result.duration,
      })

      if (result.errors.length > 0) {
        logger.warn(`Completed with ${result.errors.length} error(s)`)

        // Always print errors for validate mode or when failFast is enabled.
        // For other modes, require --verbose flag.
        const task = pipeline.getTask(taskName)
        const shouldShowErrors =
          options.verbose || task?.config.mode === "validate" || task?.config.failFast === true

        if (shouldShowErrors) {
          for (const error of result.errors) {
            logger.errorDetail(error, taskName)
          }
        } else {
          console.log(`\x1b[38;5;8m› Run with -v to see error details\x1b[0m`)
        }

        process.exit(1)
      } else {
        logger.success(`Task "${taskName}" completed`)
      }
    } catch (error) {
      logger.error("Task execution failed")
      logger.errorDetail(error instanceof Error ? error : new Error(String(error)))
      process.exit(1)
    }
  })

// List command
program
  .command("list")
  .description("List all available tasks")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options) => {
    try {
      const pipeline = await initPipeline(options.config)
      const taskNames = pipeline.getTaskNames()

      logger.scanning("Available tasks")
      console.log("")

      for (const name of taskNames) {
        const task = pipeline.getTask(name)
        if (!task) continue

        console.log(`\x1b[38;5;12m◆ ${name}\x1b[0m`)
        if (task.config.description) {
          console.log(`  \x1b[38;5;8m${task.config.description}\x1b[0m`)
        }
        console.log(`  \x1b[38;5;8m› source: ${task.config.source}\x1b[0m`)
        if (task.config.output?.path) {
          console.log(`  \x1b[38;5;8m› output: ${task.config.output.path}\x1b[0m`)
        }
        if (task.config.dependsOn && task.config.dependsOn.length > 0) {
          console.log(`  \x1b[38;5;8m› depends: ${task.config.dependsOn.join(", ")}\x1b[0m`)
        }
        console.log("")
      }

      logger.success(`Listed ${taskNames.length} task(s)`)
    } catch (error) {
      logger.error("Failed to list tasks")
      logger.errorDetail(error instanceof Error ? error : new Error(String(error)))
      process.exit(1)
    }
  })

program.parse()
