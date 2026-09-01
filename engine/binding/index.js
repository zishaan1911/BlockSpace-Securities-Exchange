// Loads the compiled addon. Kept as a tiny shim so callers import a
// stable path rather than reaching into build/Release themselves.
module.exports = require('./build/Release/gasx_engine.node');
