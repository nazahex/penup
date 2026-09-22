/**
 * Built-in transformers for aggregate and validate modes.
 * These transformers interact with shared Context state (aggregateStore, validationErrors).
 */

import { stringify as stringifyYaml } from "yaml"
import type { Context, TransformerDefinition, TransformResult } from "../config/types"

/**
 * Pushes the current frontmatter metadata into the shared aggregate store.
 * Designed to be used in per-file transforms of an aggregate task.
 */
const aggregatePushTransformer: TransformerDefinition = {
  name: "aggregate.push",
  description: "Push frontmatter metadata into the shared aggregate store",
  execute: async (_content: string, context: Context): Promise<TransformResult> => {
    const frontmatter = context.getMetadata<Record<string, unknown>>("frontmatter")

    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      return { changed: false }
    }

    context.pushToAggregate(frontmatter)
    return { changed: false }
  },
}

/**
 * Serializes the shared aggregate store into YAML format.
 * Designed to be used as an aggregateTransform step.
 * Expects input content to be a JSON-serialized array from the pipeline engine.
 */
const yamlEmitTransformer: TransformerDefinition = {
  name: "yaml.emit",
  description: "Serialize aggregate data into YAML output",
  execute: async (content: string, _context: Context): Promise<TransformResult> => {
    let data: unknown[]

    try {
      data = JSON.parse(content)
    } catch {
      return { content: "", changed: true }
    }

    if (!Array.isArray(data)) {
      return { content: "", changed: true }
    }

    const yamlOutput = stringifyYaml(data, { lineWidth: 0 })
    return { content: yamlOutput, changed: true }
  },
}

/**
 * Serializes the shared aggregate store into JSON format.
 * Designed to be used as an aggregateTransform step.
 * Expects input content to be a JSON-serialized array from the pipeline engine.
 */
const jsonEmitTransformer: TransformerDefinition = {
  name: "json.emit",
  description: "Serialize aggregate data into formatted JSON output",
  execute: async (content: string, _context: Context): Promise<TransformResult> => {
    let data: unknown[]

    try {
      data = JSON.parse(content)
    } catch {
      return { content: "[]", changed: true }
    }

    if (!Array.isArray(data)) {
      return { content: "[]", changed: true }
    }

    const jsonOutput = JSON.stringify(data, null, 2)
    return { content: jsonOutput, changed: true }
  },
}

export const aggregationTransformers = {
  "aggregate.push": aggregatePushTransformer,
  "yaml.emit": yamlEmitTransformer,
  "json.emit": jsonEmitTransformer,
}
