import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { loadConfig } from "../../src/config/loader.ts"

const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/config-loader")

describe("Config Loader", () => {
  beforeEach(async () => {
    await mkdir(FIXTURE_DIR, { recursive: true })
  })

  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  describe("YAML config loading", () => {
    test("should load valid YAML config", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
tasks:
  task-a:
    source: "./src/[var].md"
`,
      )

      const config = await loadConfig(configPath)

      expect(config.name).toBe("test-project")
      expect(config.tasks["task-a"]).toBeDefined()
      expect(config.tasks["task-a"]?.source).toBe("./src/[var].md")
    })

    test("should load YAML config with global vars", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
vars:
  outputBase: ./dist
  siteUrl: https://example.com
tasks:
  task-a:
    source: "./src/[var].md"
`,
      )

      const config = await loadConfig(configPath)

      expect(config.vars?.["outputBase"]).toBe("./dist")
      expect(config.vars?.["siteUrl"]).toBe("https://example.com")
    })

    test("should load YAML config with presets", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
presets:
  fiction-only:
    description: Process only fiction
    tasks:
      task-a:
        scope:
          category: fiction
tasks:
  task-a:
    source: "./src/[category]/[var].md"
`,
      )

      const config = await loadConfig(configPath)

      expect(config.presets?.["fiction-only"]).toBeDefined()
      expect(config.presets?.["fiction-only"]?.description).toBe("Process only fiction")
    })
  })

  describe("validation", () => {
    test("should throw when name is missing", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
tasks:
  task-a:
    source: "./src/[var].md"
`,
      )

      expect(loadConfig(configPath)).rejects.toThrow(/name/)
    })

    test("should throw when tasks is missing", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
`,
      )

      expect(loadConfig(configPath)).rejects.toThrow(/tasks/)
    })

    test("should throw when task has no source", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
tasks:
  task-a:
    description: "Missing source"
`,
      )

      expect(loadConfig(configPath)).rejects.toThrow(/source/)
    })
  })

  describe("error handling", () => {
    test("should throw when config file not found", async () => {
      expect(loadConfig("/nonexistent/path/penup.config.yaml")).rejects.toThrow(/not found/)
    })

    test("should throw for unsupported extension", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.txt")
      await writeFile(configPath, "name: test")

      expect(loadConfig(configPath)).rejects.toThrow(/Unsupported/)
    })

    test("should throw for invalid YAML syntax", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(configPath, `invalid: [unclosed`)

      expect(loadConfig(configPath)).rejects.toThrow()
    })
  })

  describe("multiple tasks", () => {
    test("should load config with multiple tasks", async () => {
      const configPath = path.join(FIXTURE_DIR, "penup.config.yaml")
      await writeFile(
        configPath,
        `
name: test-project
tasks:
  task-a:
    source: "./src/a/[var].md"
  task-b:
    source: "./src/b/[var].md"
    dependsOn:
      - task-a
  task-c:
    source: "./src/c/[var].md"
`,
      )

      const config = await loadConfig(configPath)

      expect(Object.keys(config.tasks)).toHaveLength(3)
      expect(config.tasks["task-b"]?.dependsOn).toEqual(["task-a"])
    })
  })
})
