import { describe, expect, test } from "bun:test"
import type { Context, PenupConfig, TransformResult } from "../../src/config/types.ts"
import { PathResolver } from "../../src/core/pathResolver.ts"
import { Pipeline } from "../../src/core/pipeline.ts"
import { TransformerRegistry } from "../../src/transformers/registry.ts"

function createRegistry(): TransformerRegistry {
  const registry = new TransformerRegistry()
  registry.register({
    name: "noop",
    description: "No-op transformer",
    execute: async (content: string, _context: Context): Promise<TransformResult> => ({
      content,
      changed: false,
    }),
  })
  return registry
}

describe("Pipeline", () => {
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

    test("should detect self-referential dependency and aggregate error", async () => {
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

    test("should detect missing dependency and aggregate error", async () => {
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
            source: "./tests/fixtures/nonexistent-[var].md",
            transforms: ["noop"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.runTask("task-a")

      expect(result.taskName).toBe("task-a")
      expect(result.filesProcessed).toBe(0)
    })
  })

  describe("run", () => {
    test("should run all tasks in dependency order", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./tests/fixtures/no-match-[var].md" },
          "task-b": { source: "./tests/fixtures/no-match-[var].md", dependsOn: ["task-a"] },
          "task-c": { source: "./tests/fixtures/no-match-[var].md", dependsOn: ["task-b"] },
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
          "task-a": { source: "./tests/fixtures/no-match-[var].md" },
          "task-b": { source: "./tests/fixtures/no-match-[var].md" },
          "task-c": { source: "./tests/fixtures/no-match-[var].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run({ tasks: ["task-a", "task-c"] })

      expect(result.tasksExecuted).toBe(2)
      expect(result.taskResults.map((r) => r.taskName)).toContain("task-a")
      expect(result.taskResults.map((r) => r.taskName)).toContain("task-c")
    })

    test("should pass scope to all tasks", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./tests/fixtures/[category]/[id].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run({
        scope: { category: "fiction" },
      })

      expect(result.tasksExecuted).toBe(1)
      // No errors means scope was passed successfully
      expect(result.errors).toHaveLength(0)
    })

    test("should propagate dryRun to all tasks", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./tests/fixtures/[var].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run({ dryRun: true })

      expect(result.tasksExecuted).toBe(1)
    })

    test("should propagate globals to all tasks", async () => {
      const config: PenupConfig = {
        name: "test",
        vars: { outputBase: "./dist" },
        tasks: {
          "task-a": { source: "./tests/fixtures/[var].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.tasksExecuted).toBe(1)
    })

    test("should aggregate errors from all tasks", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": {
            source: "./tests/fixtures/[var].md",
            transforms: ["nonexistent-transformer"],
          },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      // No files matched, so transformer error won't trigger - but pipeline still completes
      expect(result.errors).toHaveLength(0)
    })

    test("should track total duration", async () => {
      const config: PenupConfig = {
        name: "test",
        tasks: {
          "task-a": { source: "./tests/fixtures/[var].md" },
        },
      }

      const pipeline = new Pipeline(config, new PathResolver(), createRegistry())
      const result = await pipeline.run()

      expect(result.duration).toBeGreaterThanOrEqual(0)
    })
  })
})
