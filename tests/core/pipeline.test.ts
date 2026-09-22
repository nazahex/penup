import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Context, PenupConfig, TransformResult } from "../../src/config/types.ts"
import { PathResolver } from "../../src/core/pathResolver.ts"
import { Pipeline } from "../../src/core/pipeline.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/pipeline-test")

function createRegistry(): TransformerRegistry {
  const registry = new TransformerRegistry()

  registry.register({
    name: "noop",
    description: "No-op transformer",
    execute: async (content: string): Promise<TransformResult> => ({
      content,
      changed: false,
    }),
  })

  registry.register({
    name: "always-fail-validate",
    description: "Always fails validation",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      context.addValidationError(new Error(`Validation failed: ${context.filePath}`))
      return { content, changed: false }
    },
  })

  registry.register({
    name: "uppercase",
    description: "Uppercase content",
    execute: async (content: string): Promise<TransformResult> => ({
      content: content.toUpperCase(),
      changed: true,
    }),
  })

  return registry
}

describe("Pipeline", () => {
  beforeEach(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
    await writeFile(path.join(FIXTURE_DIR, "sample.md"), "hello pipeline")
  })

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  describe("initialization", () => {
    test("should initialize tasks from config", () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./src/[var].md" },
          "task-b": { source: "./src/[var].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())

      expect(pipeline.getTaskNames()).toEqual(["task-a", "task-b"])
    })

    test("should retrieve individual tasks", () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./src/[var].md", description: "Test task" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const task = pipeline.getTask("task-a")

      expect(task).toBeDefined()
      expect(task?.name).toBe("task-a")
      expect(task?.config.description).toBe("Test task")
    })

    test("should return undefined for non-existent task", () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {},
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      expect(pipeline.getTask("missing")).toBeUndefined()
    })
  })

  describe("dependency resolution", () => {
    test("should detect circular dependency and aggregate error", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./a.md", dependsOn: ["task-b"] },
          "task-b": { source: "./b.md", dependsOn: ["task-a"] },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toMatch(/[Cc]ircular dependency/)
    })

    test("should detect self-referential dependency", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./a.md", dependsOn: ["task-a"] },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toMatch(/[Cc]ircular dependency/)
    })

    test("should detect missing dependency", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./a.md", dependsOn: ["missing-task"] },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]?.message).toMatch(/Task not found/)
    })
  })

  describe("fail-fast behavior", () => {
    test("should stop pipeline when validate task fails", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          validate: {
            source: `${FIXTURE_DIR}/[...slug].md`,
            mode: "validate",
            transforms: ["always-fail-validate"],
            // failFast defaults to true for validate mode
          },
          build: {
            source: `${FIXTURE_DIR}/[...slug].md`,
            transforms: ["uppercase"],
            dependsOn: ["validate"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      // Only validate should have executed; build should be skipped
      expect(result.tasksExecuted).toBe(1)
      expect(result.taskResults.map((r) => r.taskName)).toEqual(["validate"])
      expect(result.errors.length).toBeGreaterThan(0)
    })

    test("should stop pipeline when explicit failFast task fails", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "strict-check": {
            source: `${FIXTURE_DIR}/[...slug].md`,
            mode: "transform",
            failFast: true,
            transforms: ["always-fail-validate"],
          },
          downstream: {
            source: `${FIXTURE_DIR}/[...slug].md`,
            transforms: ["noop"],
            dependsOn: ["strict-check"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.tasksExecuted).toBe(1)
      expect(result.taskResults.map((r) => r.taskName)).toEqual(["strict-check"])
    })

    test("should continue pipeline when non-failFast task has errors", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "lenient-check": {
            source: `${FIXTURE_DIR}/[...slug].md`,
            mode: "transform",
            failFast: false,
            transforms: ["always-fail-validate"],
          },
          downstream: {
            source: `${FIXTURE_DIR}/[...slug].md`,
            transforms: ["noop"],
            dependsOn: ["lenient-check"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      // Both tasks should execute despite errors in the first
      expect(result.tasksExecuted).toBe(2)
      expect(result.taskResults.map((r) => r.taskName)).toEqual(["lenient-check", "downstream"])
    })
  })

  describe("runTask", () => {
    test("should throw when task not found", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {},
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())

      expect(pipeline.runTask("missing")).rejects.toThrow("Task not found: missing")
    })

    test("should run single task successfully", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": {
            source: `${FIXTURE_DIR}/[...slug].md`,
            transforms: ["noop"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.runTask("task-a")

      expect(result.taskName).toBe("task-a")
      expect(result.filesProcessed).toBe(1)
    })
  })

  describe("run", () => {
    test("should run all tasks in dependency order", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: `${FIXTURE_DIR}/[...slug].md` },
          "task-b": { source: `${FIXTURE_DIR}/[...slug].md`, dependsOn: ["task-a"] },
          "task-c": { source: `${FIXTURE_DIR}/[...slug].md`, dependsOn: ["task-b"] },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.tasksExecuted).toBe(3)
      expect(result.taskResults.map((r) => r.taskName)).toEqual(["task-a", "task-b", "task-c"])
    })

    test("should run subset of tasks when specified", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: `${FIXTURE_DIR}/[...slug].md` },
          "task-b": { source: `${FIXTURE_DIR}/[...slug].md` },
          "task-c": { source: `${FIXTURE_DIR}/[...slug].md` },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run({ tasks: ["task-a", "task-c"] })

      expect(result.tasksExecuted).toBe(2)
      const names = result.taskResults.map((r) => r.taskName)
      expect(names).toContain("task-a")
      expect(names).toContain("task-c")
    })

    test("should propagate scope to all tasks", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: `${FIXTURE_DIR}/[category]/[id].md` },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run({ scope: { category: "fiction" } })

      expect(result.tasksExecuted).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    test("should track total duration", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: `${FIXTURE_DIR}/[...slug].md` },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })
})
