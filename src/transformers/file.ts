import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import type {
  Context,
  TransformerDefinition,
  TransformResult,
  VariableMap,
} from "../config/types.ts"
import type { PathResolver } from "../core/pathResolver.ts"

/**
 * Factory that creates a file.rename transformer bound to a specific PathResolver.
 */
export function createFileRenameTransformer(resolver: PathResolver): TransformerDefinition {
  return {
    name: "file.rename",
    description: "Rename source file using a dynamic path pattern",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      const options =
        context.getMetadata<{ pattern?: string; stripPrefix?: string }>("file.rename") ?? {}
      const pattern = options.pattern

      if (!pattern) return { content, changed: false }

      const oldPath = context.filePath
      const dir = path.dirname(oldPath)

      // Merge path variables with frontmatter metadata
      const fm = context.getMetadata<Record<string, unknown>>("frontmatter") ?? {}
      const allVars: VariableMap = { ...context.getAllVariables(), ...(fm as VariableMap) }

      const generatedName = resolver.generate(pattern, allVars)

      // CRITICAL: file.rename always operates within the same directory.
      // If the pattern generates a path with directories, use only the basename.
      let newFileName = generatedName.includes("/") ? path.basename(generatedName) : generatedName

      // Apply prefix stripping if configured (e.g., "001_foo.jsx" → "foo.jsx")
      if (options.stripPrefix) {
        try {
          const regex = new RegExp(options.stripPrefix)
          newFileName = newFileName.replace(regex, "")
        } catch {
          console.error(`[file.rename] Invalid stripPrefix regex: ${options.stripPrefix}`)
        }
      }

      const newPath = path.join(dir, newFileName)

      if (oldPath === newPath) return { content, changed: false }

      try {
        await rename(oldPath, newPath)
        return { content, changed: true, metadata: { renamedFrom: oldPath, renamedTo: newPath } }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[file.rename] Failed: ${msg}`)
        return { content, changed: false }
      }
    },
  }
}

/**
 * Copy the current content to an additional output path.
 * Supports [var] and [...rest] variable substitution.
 * Does NOT modify the source file or the main pipeline output.
 */
export function createFileCopyTransformer(resolver: PathResolver): TransformerDefinition {
  return {
    name: "file.copy",
    description: "Copy content to an additional destination path",
    execute: async (content: string, context: Context): Promise<TransformResult> => {
      const options = context.getMetadata<{ dest?: string }>("file.copy") ?? {}
      const destPattern = options.dest

      if (!destPattern) return { content, changed: false }

      // Merge path variables with frontmatter metadata for consistency
      const fm = context.getMetadata<Record<string, unknown>>("frontmatter") ?? {}
      const allVars: VariableMap = { ...context.getAllVariables(), ...(fm as VariableMap) }

      const destPath = resolver.generate(destPattern, allVars)

      try {
        const destDir = path.dirname(destPath)
        // Use native fs.mkdir for reliability in test environments
        await mkdir(destDir, { recursive: true })
        await Bun.write(destPath, content)
        return { content, changed: false, metadata: { copiedTo: destPath } }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[file.copy] Failed to copy to ${destPath}: ${msg}`)
        return { content, changed: false }
      }
    },
  }
}
