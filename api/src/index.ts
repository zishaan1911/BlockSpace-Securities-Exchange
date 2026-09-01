/**
 * Real entrypoint: wires the real SuiChainAdapter/ThetanutsHedgeProvider/
 * HttpAiClient into buildServer and starts listening. Run with:
 *
 *   cd api && npm run dev
 */
import { loadEnvFile } from 'node:process';
import { SuiChainAdapter } from '@gasx/sui-adapter';
import { ThetanutsHedgeProvider } from '@gasx/thetanuts-adapter';
import { HttpAiClient } from './aiClient.js';
import { loadGatewayConfig } from './config.js';
import { createDatabase } from './db.js';
import { CppEngineLayer } from './engineLayer.js';
import { buildServer } from './server.js';

// Load the gateway's own .env plus both chain adapters' .env files
// (api/.env.example documents the split). Each is optional — config
// defaults and the adapters' own validation still apply afterwards.
for (const path of ['.env', '../blockchain/sui/.env', '../blockchain/thetanuts/.env']) {
  try {
    loadEnvFile(path);
  } catch {
    // No .env file at this path — variables may come from the shell.
  }
}

const config = loadGatewayConfig();
const db = createDatabase(config.databaseUrl, { error: (m) => console.error(m) });
const aiClient = new HttpAiClient(config.aiServiceUrl);

const app = buildServer({
  db,
  engine: new CppEngineLayer({
    contractMultiplier: 10,
    marginRatioBps: 1000,
    maxOrderQuantity: config.riskPolicy.maxOrderContracts,
    maxNetPosition: config.riskPolicy.maxPositionContracts,
    minConfidence: config.riskPolicy.minModelConfidence,
  }),
  chainAdapter: new SuiChainAdapter(config.sui),
  hedgeProvider: new ThetanutsHedgeProvider(config.thetanuts),
  aiClient,
  riskPolicy: config.riskPolicy,
  exposureConfig: config.exposureConfig,
});

/**
 * Warm-start the AI service's history from durable storage.
 *
 * The AI service keeps EGSI history in memory and never touches the
 * database itself (ARCHITECTURE.md §2: this gateway is the only
 * client), so a restart would otherwise reset the forecaster's
 * EMA/RSI/momentum context to nothing — even though every reading was
 * durably stored all along. Best-effort throughout: a missing database
 * or an AI service that is not up yet degrades the start, it does not
 * fail it.
 */
async function warmStartAiHistory(): Promise<void> {
  if (!db) return;
  try {
    const history = await db.getEgsiHistory('EGSI-1H', 200);
    if (history.length === 0) return;
    const restored = await aiClient.restoreHistory(history.map((h) => h.score));
    if (restored === null) {
      app.log.warn('AI service did not accept restored history; it will rebuild from new cycles');
    } else {
      app.log.info(`restored ${restored} EGSI readings into the AI service`);
    }
  } catch (err) {
    app.log.warn(`could not warm-start AI history: ${(err as Error).message}`);
  }
}

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => warmStartAiHistory())
  .then(() => app.log.info(`GASX API gateway listening on :${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
