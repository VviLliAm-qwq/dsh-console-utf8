/**
 * dsh-console-utf8 — Cordis entry.
 *
 * This module re-exports exactly the three symbols a Cordis plugin entry is
 * read for (`name`, `Config`, `apply`) and nothing else: an entry module that
 * carries extra symbols changes how the loader wraps the activation, which is
 * the failure mode documented in `docs/DSH-PLUGIN-SOP.md` §2.1. The
 * implementation lives in `./plugin.js`.
 *
 * @module dsh-console-utf8
 */

export { Config, apply, name } from './plugin.js'
