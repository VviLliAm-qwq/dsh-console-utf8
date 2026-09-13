import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as entry from '../lib/index.js'
import * as implementation from '../lib/plugin.js'
import { Config } from '../lib/index.js'

test('the entry module exports exactly name, Config and apply', () => {
  // `docs/DSH-PLUGIN-SOP.md` §2.1 rule 1: an entry module carrying extra
  // symbols changes how the loader wraps the activation, and every mediated
  // registration afterwards is refused — silently.
  assert.deepEqual(Object.keys(entry).sort(), ['Config', 'apply', 'name'])
  assert.equal(entry.name, 'dsh-console-utf8')
  assert.equal(typeof entry.apply, 'function')
  assert.equal(typeof entry.Config, 'function')
})

test('the entry re-exports the implementation rather than shadowing it', () => {
  assert.equal(entry.name, implementation.name)
  assert.equal(entry.apply, implementation.apply)
  assert.equal(entry.Config, implementation.Config)
})

test('Config is a Schemastery schema that resolves its own defaults', () => {
  assert.equal(typeof Config, 'function')
  assert.equal(Config({}).enabled, true)
})
