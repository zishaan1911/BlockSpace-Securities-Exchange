/**
 * Real entrypoint: wires the real SuiChainAdapter/ThetanutsHedgeProvider/
 * HttpAiClient into buildServer and starts listening. Run with:
 *
 *   cd api && npm run dev
 *
 * NOT exercised end-to-end from Claude's sandbox — no network egress to
 * Sui, Base, or a locally-running AI service there. See README.md.
 */
import { SuiChainAdapter } from '@gasx/sui-adapter';
import { ThetanutsHedgeProvider } from '@gasx/thetanuts-adapter';
import { HttpAiClient } from './aiClient.js';
import { loadGatewayConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadGatewayConfig();

const app = buildServer({
  chainAdapter: new SuiChainAdapter(config.sui),
  hedgeProvider: new ThetanutsHedgeProvider(config.thetanuts),
  aiClient: new HttpAiClient(config.aiServiceUrl),
  riskPolicy: config.riskPolicy,
});

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`GASX API gateway listening on :${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
