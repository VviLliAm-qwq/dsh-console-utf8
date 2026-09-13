/**
 * dsh-console-utf8 — bounded lifecycle log.
 *
 * The host keeps no diagnostics for a bundle-patch plugin, so the plugin
 * speaks for itself: one file under the dsh state directory, trimmed to its
 * newest half once it outgrows the cap. Nothing is written under
 * `node --test`, so a test run never touches a user's log.
 *
 * @module dsh-console-utf8/log
 */

import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'

/** Above this size the log is trimmed to its newest half. */
export const MAX_LOG_BYTES = 128 * 1024

/**
 * Append one line, trimming first when the file has outgrown `maxBytes`.
 *
 * @param {string} path - Log file path.
 * @param {string} line - Complete line, newline included.
 * @param {number} [maxBytes] - Size cap before trimming.
 */
export function appendLogLine(path, line, maxBytes = MAX_LOG_BYTES) {
  try {
    if (statSync(path).size > maxBytes) {
      writeFileSync(path, readFileSync(path, 'utf8').slice(-Math.floor(maxBytes / 2)))
    }
  } catch {
    // Missing or unreadable file: the append below recreates it.
  }
  appendFileSync(path, line)
}

/**
 * Build the plugin's quiet logger: the host logger always, plus the bounded
 * file when file logging is allowed.
 *
 * @param {object} ctx - Cordis context (its `logger` is optional).
 * @param {object} options - Logger wiring.
 * @param {string} options.path - Diagnostic log path.
 * @param {boolean} options.enabled - False under `node --test`.
 * @param {string} [options.prefix] - Message prefix.
 * @returns {{ info: (message: string) => void, warn: (message: string) => void }}
 */
export function createLogger(ctx, { path, enabled, prefix = 'dsh-console-utf8' }) {
  const write = (level, message) => {
    try {
      ctx?.logger?.[level]?.(`${prefix}: ${message}`)
    } catch {
      // Observability only; never let logging break the plugin.
    }
    if (!enabled) return
    try {
      appendLogLine(path, `${new Date().toISOString()} ${level} ${message}\n`)
    } catch {
      // An unwritable log path is not worth surfacing.
    }
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
  }
}
