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

const app = buildServer({
  chainAdapter: new SuiChainAdapter(config.sui),
  hedgeProvider: new ThetanutsHedgeProvider(config.thetanuts),
  aiClient: new HttpAiClient(config.aiServiceUrl),
  riskPolicy: config.riskPolicy,
  exposureConfig: config.exposureConfig,
});

app
  .listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`GASX API gateway listening on :${config.port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
