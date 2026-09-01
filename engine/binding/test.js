// Smoke test for the N-API binding, run by `npm test` in this package.
// The engine's own behaviour is covered by 91 C++ tests; this checks the
// JS<->C++ marshalling specifically, which those cannot reach.
const assert = require('assert');
const { Engine } = require('./index.js');

const engine = new Engine({
  risk: { contractMultiplier: 10, marginRatioBps: 1000, maxOrderQuantity: 100, maxNetPosition: 500 },
  pricing: { priceScale: 1, baseHalfSpread: 5, minConfidence: 0.4, maxQuoteSize: 100, minQuoteSize: 5 },
});

// Resting order, then a crossing order that should fill against it.
const sell = engine.placeOrder({ traderId: 'alice', isBid: false, price: 480, quantity: 5, availableMargin: 100000 });
assert.strictEqual(sell.accepted, true, 'sell should be accepted');

const buy = engine.placeOrder({ traderId: 'bob', isBid: true, price: 500, quantity: 5, availableMargin: 100000 });
assert.strictEqual(buy.accepted, true, 'buy should be accepted');
assert.strictEqual(buy.fills.length, 1, 'should fill against the resting order');
assert.strictEqual(buy.fills[0].price, 480, 'executes at the resting (maker) price');

// Positions update on both sides of a fill.
assert.strictEqual(engine.netPosition('bob'), 5);
assert.strictEqual(engine.netPosition('alice'), -5);

// Risk policy is enforced across the boundary, not just in C++.
const tooBig = engine.placeOrder({ traderId: 'carol', isBid: true, price: 500, quantity: 9999, availableMargin: 100000 });
assert.strictEqual(tooBig.accepted, false, 'should reject over max order quantity');
assert.ok(tooBig.rejectReason.length > 0, 'rejection should say why');

const poor = engine.placeOrder({ traderId: 'dave', isBid: true, price: 500, quantity: 10, availableMargin: 1 });
assert.strictEqual(poor.accepted, false, 'should reject on insufficient margin');

// Quoting.
const quote = engine.getQuote({ market: 'EGSI-1H', expectedValue: 441, volatility: 20, confidence: 0.9, netPosition: 0 });
assert.strictEqual(quote.hasQuote, true);
assert.ok(quote.bid < quote.fairPrice && quote.fairPrice < quote.ask, 'bid < fair < ask');

const noQuote = engine.getQuote({ market: 'EGSI-1H', expectedValue: 441, volatility: 20, confidence: 0.1 });
assert.strictEqual(noQuote.hasQuote, false, 'refuses to quote below min confidence');

// Book snapshot and cancel.
const resting = engine.placeOrder({ traderId: 'erin', isBid: true, price: 400, quantity: 3, availableMargin: 100000 });
let book = engine.getBookSnapshot();
assert.strictEqual(book.bestBid.price, 400);
assert.strictEqual(engine.cancelOrder(resting.orderId).cancelled, true);
book = engine.getBookSnapshot();
assert.strictEqual(book.bestBid, null, 'book empty after cancel');

console.log('engine binding: all checks passed');
