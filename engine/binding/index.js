'use strict';
/**
 * Loads the compiled addon and re-exports its members individually.
 *
 * The individual `exports.X = ...` assignments matter and are not
 * stylistic. This package is CommonJS while api/ is ESM, and Node
 * detects a CJS module's named exports by statically analysing the
 * source (cjs-module-lexer). A bare `module.exports = require(...)`
 * cannot be analysed, so `import { Engine } from '@gasx/engine'` fails
 * with "does not provide an export named 'Engine'" even though the
 * property exists at runtime. Assigning each name explicitly makes the
 * export visible to that analysis.
 */
const addon = require('./build/Release/gasx_engine.node');

exports.Engine = addon.Engine;
// Default export too, so `import engine from '@gasx/engine'` also works.
module.exports.default = addon;
