/**
 * Logger utility with pendon-style formatting
 * Uses ANSI escape codes for colored, structured output
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[38;5;12m", // Light cyan for info
  green: "\x1b[38;5;10m", // Light green for success
  yellow: "\x1b[38;5;11m", // Light yellow for warnings
  red: "\x1b[38;5;9m", // Light red for errors
  gray: "\x1b[38;5;8m", // Gray for details
  clearLine: "\x1b[2K", // Clear current line
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "kB", "MB", "GB"]
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = bytes / k ** i
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Format duration in milliseconds to human-readable
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m ${seconds}s`
}

export const logger = {
  /**
   * Log task scanning phase
   */
  scanning(message: string = "Scanning source files...") {
    console.log(`${colors.clearLine}${colors.cyan}${message}${colors.reset}`)
  },

  /**
   * Log info message with bullet
   */
  info(message: string) {
    console.log(
      `${colors.clearLine}${colors.cyan}◆ ${colors.reset}${colors.cyan}${colors.bold}⟦info⟧${colors.reset} ${colors.cyan}${message}${colors.reset}`,
    )
  },

  /**
   * Log success message with checkmark
   */
  success(message: string) {
    console.log(
      `${colors.clearLine}${colors.green}✔ ${colors.reset}${colors.green}${colors.bold}⟦done⟧${colors.reset} ${colors.green}${message}${colors.reset}`,
    )
  },

  /**
   * Log warning message
   */
  warn(message: string) {
    console.log(
      `${colors.clearLine}${colors.yellow}⚠ ${colors.reset}${colors.yellow}${colors.bold}⟦warn⟧${colors.reset} ${colors.yellow}${message}${colors.reset}`,
    )
  },

  /**
   * Log error message
   */
  error(message: string) {
    console.log(
      `${colors.clearLine}${colors.red}✗ ${colors.reset}${colors.red}${colors.bold}⟦error⟧${colors.reset} ${colors.red}${message}${colors.reset}`,
    )
  },

  /**
   * Log task result details
   */
  taskResult(
    taskName: string,
    stats: {
      filesProcessed?: number | undefined
      filesModified: number
      totalSize: number
      inputPattern: string
      outputPattern?: string | undefined
      outputFormat?: string | undefined
      duration: number
    },
  ) {
    console.log(
      `${colors.clearLine}${colors.cyan}◆ ${colors.reset}${colors.cyan}${colors.bold}⟦info⟧${colors.reset} ${colors.cyan}Task: ${taskName} (${formatDuration(stats.duration)})${colors.reset}`,
    )

    console.log(`${colors.gray}› Result:${colors.reset}`)
    console.log(`  - input: ${stats.inputPattern}`)

    if (stats.outputPattern) {
      console.log(`  - output: ${stats.outputPattern}`)
    }

    if (stats.outputFormat) {
      console.log(`  - format: ${stats.outputFormat}`)
    }

    console.log(`  - processed: ${stats.filesProcessed} files`)
    console.log(`  - modified: ${stats.filesModified} files`)
    console.log(`  - size: ${formatBytes(stats.totalSize)}`)
  },

  /**
   * Log pipeline summary
   */
  summary(stats: {
    tasksExecuted: number
    totalFiles: number
    totalModified: number
    totalSize: number
    duration: number
    errors: number
  }) {
    console.log("")
    console.log(`${colors.gray}━${"━".repeat(60)}${colors.reset}`)
    console.log(`${colors.gray}› Summary:${colors.reset}`)
    console.log(`  - tasks: ${stats.tasksExecuted}`)
    console.log(`  - files: ${stats.totalFiles}`)
    console.log(`  - modified: ${stats.totalModified}`)
    console.log(`  - size: ${formatBytes(stats.totalSize)}`)
    console.log(`  - duration: ${formatDuration(stats.duration)}`)

    if (stats.errors > 0) {
      console.log(`  - errors: ${colors.red}${stats.errors}${colors.reset}`)
    }
  },

  /**
   * Log individual file processing
   */
  file(filePath: string, status: "processed" | "modified" | "skipped" | "error", message?: string) {
    const symbol = status === "modified" ? "✓" : status === "error" ? "✗" : "•"
    const color =
      status === "modified"
        ? colors.green
        : status === "error"
          ? colors.red
          : status === "skipped"
            ? colors.gray
            : colors.cyan

    const msg = message ? ` ${colors.gray}(${message})${colors.reset}` : ""
    console.log(`  ${color}${symbol}${colors.reset} ${filePath}${msg}`)
  },

  /**
   * Log error details
   */
  errorDetail(error: Error, context?: string) {
    console.log(`${colors.red}  ✗ ${context || "Error"}: ${error.message}${colors.reset}`)
    if (process.env["DEBUG"] && error.stack) {
      console.log(
        `${colors.gray}    ${error.stack.split("\n").slice(1, 3).join("\n    ")}${colors.reset}`,
      )
    }
  },
}
