/**
 * PathResolver - Core engine for dynamic path handling
 *
 * Responsibilities:
 * 1. Parse path patterns with [var] and [...rest] syntax
 * 2. Match real file paths against patterns
 * 3. Extract variables from matched paths
 * 4. Generate output paths by substituting variables
 */

import type { ParsedPattern, PathSegment, VariableMap } from "../config/types.ts"

/**
 * Result of matching a file path against a pattern
 */
export interface MatchResult {
  /** Whether the path matched the pattern */
  matched: boolean
  /** Extracted variables (empty if not matched) */
  variables: VariableMap
  /** The original file path */
  filePath: string
  /** The pattern used for matching */
  pattern: string
}

/**
 * Options for PathResolver operations
 */
export interface PathResolverOptions {
  /** Whether to normalize paths (remove . and ..) */
  normalize?: boolean
  /** Whether to make paths absolute */
  absolute?: boolean
}

export class PathResolver {
  // private readonly options: Required<PathResolverOptions>;

  // constructor(options: PathResolverOptions = {}) {
  //   this.options = {
  //     normalize: options.normalize ?? true,
  //     absolute: options.absolute ?? false,
  //   };
  // }

  /**
   * Parse a path pattern into structured segments.
   */
  parse(pattern: string): ParsedPattern {
    const segments = pattern.split("/")
    const parsedSegments: PathSegment[] = []
    const variableNames: string[] = []
    let hasRestVariable = false
    let restVariableName: string | undefined

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (!segment) continue

      // Check for rest variable [...name] with optional suffix
      const restMatch = segment.match(/^\[\.{3}(\w+)\](.*)$/)
      if (restMatch?.[1]) {
        const name = restMatch[1]
        const suffix = restMatch[2] || ""

        parsedSegments.push({ type: "rest", name })
        variableNames.push(name)
        hasRestVariable = true
        restVariableName = name

        // If there's a suffix (e.g., .md), add it as a literal
        if (suffix) {
          parsedSegments.push({ type: "literal", value: suffix })
        }
        continue
      }

      // Check for single variable [name] with optional suffix
      const varMatch = segment.match(/^\[(\w+)\](.*)$/)
      if (varMatch?.[1]) {
        const name = varMatch[1]
        const suffix = varMatch[2] || ""

        parsedSegments.push({ type: "variable", name })
        variableNames.push(name)

        if (suffix) {
          parsedSegments.push({ type: "literal", value: suffix })
        }
        continue
      }

      // Literal segment
      parsedSegments.push({ type: "literal", value: segment })
    }

    return {
      original: pattern,
      segments: parsedSegments,
      variableNames,
      hasRestVariable,
      restVariableName,
    }
  }

  /**
   * Match a file path against a pattern and extract variables.
   */
  match(filePath: string, pattern: string): MatchResult {
    const parsed = this.parse(pattern)
    const pathSegments = filePath.split("/").filter((s) => s !== "")
    const patternSegments = parsed.segments

    const variables: VariableMap = {}
    let pathIndex = 0
    let patternIndex = 0

    while (patternIndex < patternSegments.length) {
      const segment = patternSegments[patternIndex]
      if (!segment) {
        patternIndex++
        continue
      }

      switch (segment.type) {
        case "literal": {
          const pathSegment = pathSegments[pathIndex]
          if (pathSegment !== segment.value) {
            return { matched: false, variables: {}, filePath, pattern }
          }
          pathIndex++
          patternIndex++
          break
        }

        case "variable": {
          const pathSegment = pathSegments[pathIndex]
          if (pathSegment === undefined) {
            return { matched: false, variables: {}, filePath, pattern }
          }

          const nextSegment = patternSegments[patternIndex + 1]
          let varValue = pathSegment

          // If next pattern segment is a literal suffix (e.g., ".md"), strip it from value
          if (nextSegment && nextSegment.type === "literal") {
            const suffix = nextSegment.value
            if (!pathSegment.endsWith(suffix)) {
              return { matched: false, variables: {}, filePath, pattern }
            }
            varValue = pathSegment.slice(0, -suffix.length)
            patternIndex++ // Skip the literal suffix segment in pattern
          }

          variables[segment.name] = varValue
          pathIndex++
          patternIndex++
          break
        }

        case "rest": {
          const nextSegment = patternSegments[patternIndex + 1]

          if (nextSegment && nextSegment.type === "literal") {
            // Next pattern segment is a literal suffix (e.g., ".md")
            // The last path segment must end with this suffix
            const suffix = nextSegment.value
            const remainingSegments = pathSegments.slice(pathIndex)

            if (remainingSegments.length === 0) {
              return { matched: false, variables: {}, filePath, pattern }
            }

            const lastSegment = remainingSegments[remainingSegments.length - 1]
            if (!lastSegment || !lastSegment.endsWith(suffix)) {
              return { matched: false, variables: {}, filePath, pattern }
            }

            // Strip suffix from the last segment to get clean rest values
            const cleanedLast = lastSegment.slice(0, -suffix.length)
            const restValues = [...remainingSegments.slice(0, -1)]
            if (cleanedLast.length > 0) {
              restValues.push(cleanedLast)
            }

            variables[segment.name] = restValues.length > 0 ? restValues : []

            // Consume all remaining path segments + the suffix literal pattern segment
            pathIndex = pathSegments.length
            patternIndex += 2 // skip rest + literal suffix
          } else {
            // No suffix after rest, consume everything remaining
            const restSegments = pathSegments.slice(pathIndex)
            variables[segment.name] = restSegments.length > 0 ? restSegments : []
            pathIndex = pathSegments.length
            patternIndex++
          }
          break
        }
      }
    }

    // Check if we've consumed all path segments
    if (pathIndex !== pathSegments.length) {
      return { matched: false, variables: {}, filePath, pattern }
    }

    return { matched: true, variables, filePath, pattern }
  }

  /**
   * Generate an output path by substituting variables into a pattern.
   */
  generate(pattern: string, variables: VariableMap): string {
    let result = pattern

    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === "string") {
        result = result.replaceAll(`{{${key}}}`, value)
        result = result.replaceAll(`[${key}]`, value)
      } else if (Array.isArray(value)) {
        const joined = value.join("/")
        result = result.replaceAll(`{{...${key}}}`, joined)
        result = result.replaceAll(`[...${key}]`, joined)
      }
    }

    return result
  }

  /**
   * Check if a file path matches a pattern (boolean version of match).
   */
  matches(filePath: string, pattern: string): boolean {
    return this.match(filePath, pattern).matched
  }

  /**
   * Get all variable names from a pattern.
   */
  getVariableNames(pattern: string): string[] {
    return this.parse(pattern).variableNames
  }

  /**
   * Check if a pattern contains any dynamic variables.
   */
  hasVariables(pattern: string): boolean {
    return this.parse(pattern).variableNames.length > 0
  }

  /**
   * Create a glob pattern from a path pattern for file scanning.
   * Replaces [var] with * and [...var] with **
   */
  toGlobPattern(pattern: string): string {
    let result = pattern
    result = result.replace(/\[\.{3}\w+\]/g, "**")
    result = result.replace(/\[\w+\]/g, "*")
    return result
  }
}
