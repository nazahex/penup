/**
 * Frontmatter Transformer - Extract or inject YAML frontmatter
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { Context, TransformerDefinition, TransformResult } from "../config/types"

interface ExtractOptions {
  remove?: boolean
  metadataKey?: string
}

interface InjectOptions {
  data: Record<string, unknown>
  metadataKey?: string
  overwrite?: boolean
}

const extractTransformer: TransformerDefinition = {
  name: "frontmatter.extract",
  description: "Extract YAML frontmatter from Markdown files",
  execute: async (content: string, context: Context): Promise<TransformResult> => {
    const options: ExtractOptions = {}
    const metadataKey = options.metadataKey ?? "frontmatter"
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/

    const match = content.match(frontmatterRegex)

    if (!match || !match[1]) {
      return {
        content: options.remove ? "" : content,
        changed: false,
        metadata: { [metadataKey]: {} },
      }
    }

    try {
      const parsed = parseYaml(match[1]) ?? {}
      context.setMetadata(metadataKey, parsed)

      const newContent = options.remove ? content.replace(frontmatterRegex, "").trim() : content

      return {
        content: newContent,
        changed: options.remove ?? false,
        metadata: { [metadataKey]: parsed },
      }
    } catch (error) {
      console.error(`Failed to parse frontmatter in ${context.filePath}:`, error)
      return { content, changed: false, metadata: {} }
    }
  },
}

const injectTransformer: TransformerDefinition = {
  name: "frontmatter.inject",
  description: "Inject YAML frontmatter into Markdown files",
  execute: async (content: string, context: Context): Promise<TransformResult> => {
    const options: InjectOptions = context.getMetadata<InjectOptions>("injectOptions") ?? {
      data: {},
    }
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---/
    const match = content.match(frontmatterRegex)

    let data = options.data
    if (options.metadataKey) {
      const metadataData = context.getMetadata<Record<string, unknown>>(options.metadataKey)
      if (metadataData) data = metadataData
    }

    const yamlString = stringifyYaml(data).trim()
    const newFrontmatter = `---\n${yamlString}\n---`

    let newContent: string
    let changed: boolean

    if (match && options.overwrite) {
      newContent = content.replace(frontmatterRegex, newFrontmatter)
      changed = newContent !== content
    } else if (!match) {
      newContent = `${newFrontmatter}\n\n${content}`
      changed = true
    } else {
      newContent = content
      changed = false
    }

    return { content: newContent, changed, metadata: { frontmatter: data } }
  },
}

export const frontmatterTransformers = {
  extract: extractTransformer,
  inject: injectTransformer,
}
