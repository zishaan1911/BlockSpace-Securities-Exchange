// Verifies the ESM named-import path specifically.
//
// This exists because test.js uses require(), and a binding that works
// under CommonJS can still fail under ESM: Node detects a CJS module's
// named exports by static analysis, and `module.exports = require(...)`
// defeats it. api/ is ESM, so it hit exactly that and the CJS-only
// smoke test did not catch it.
import assert from 'node:assert';
import { Engine } from './index.js';

const engine = new Engine({ risk: { maxOrderQuantity: 100 } });
const placed = engine.placeOrder({
  traderId: 'esm-check', isBid: true, price: 500, quantity: 5, availableMargin: 999999,
});
assert.strictEqual(placed.accepted, true, 'ESM named import should give a working Engine');
assert.strictEqual(engine.getBookSnapshot().bestBid.price, 500);
console.log('engine binding (ESM): all checks passed');
