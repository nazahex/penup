/**
 * Config Loader - Loads and validates Penup configuration
 */

import path from "node:path"
import { parse as parseYaml } from "yaml"
import type { PenupConfig } from "./types"

const CONFIG_FILE_NAMES = [
  "penup.config.ts",
  "penup.config.yaml",
  "penup.config.yml",
  "penup.config.js",
]

async function findConfigFile(cwd: string = process.cwd()): Promise<string | null> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const filePath = path.join(cwd, fileName)
    const file = Bun.file(filePath)
    if (await file.exists()) return filePath
  }
  return null
}

async function loadTypeScriptConfig(filePath: string): Promise<PenupConfig> {
  const module = await import(filePath)
  if (module.default) return module.default as PenupConfig
  if (module.config) return module.config as PenupConfig
  throw new Error(`Config file ${filePath} must export a default or 'config' named export`)
}

async function loadYamlConfig(filePath: string): Promise<PenupConfig> {
  const file = Bun.file(filePath)
  const content = await file.text()
  const config = parseYaml(content)
  if (!config || typeof config !== "object") throw new Error(`Invalid YAML config in ${filePath}`)
  return config as PenupConfig
}

async function loadJavaScriptConfig(filePath: string): Promise<PenupConfig> {
  const module = await import(filePath)
  if (module.default) return module.default as PenupConfig
  if (module.config) return module.config as PenupConfig
  throw new Error(`Config file ${filePath} must export a default or 'config' named export`)
}

function validateConfig(config: PenupConfig): void {
  if (!config.name) throw new Error('Config must have a "name" field')
  if (!config.tasks || typeof config.tasks !== "object")
    throw new Error('Config must have a "tasks" object')
  for (const [taskName, task] of Object.entries(config.tasks)) {
    if (!task.source) throw new Error(`Task "${taskName}" must have a "source" field`)
  }
}

export async function loadConfig(configPath?: string): Promise<PenupConfig> {
  let filePath: string | null

  if (configPath) {
    filePath = path.resolve(configPath)
    const file = Bun.file(filePath)
    if (!(await file.exists())) throw new Error(`Config file not found: ${filePath}`)
  } else {
    filePath = await findConfigFile()
    if (!filePath)
      throw new Error(`No config file found. Create one of: ${CONFIG_FILE_NAMES.join(", ")}`)
  }

  console.log(`📄 Loading config from: ${filePath}`)

  let config: PenupConfig

  if (filePath.endsWith(".ts")) {
    config = await loadTypeScriptConfig(filePath)
  } else if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    config = await loadYamlConfig(filePath)
  } else if (filePath.endsWith(".js")) {
    config = await loadJavaScriptConfig(filePath)
  } else {
    throw new Error(`Unsupported config file format: ${filePath}`)
  }

  validateConfig(config)
  return config
}
