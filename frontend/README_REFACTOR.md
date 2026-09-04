# GASX wireframe refactor notes

This folder is a drop-in frontend refactor based on the generated GASX wireframe.

## What changed

- Added the marketing / landing screen from the wireframe.
- Added top-level Market / Trade / Hedge / Analytics navigation.
- Rebuilt the EGSI dashboard into a card hierarchy matching the mockup.
- Rebuilt the order ticket + candlestick + indicative depth into the 3-column trade layout.
- Added a session-trade table so Sui transaction digests are immediately visible after signing.
- Rebuilt the hedge workflow as an AI assistant + fixed risk-limits side panel.
- Added a custom wallet chooser using the current `@mysten/dapp-kit-react` hooks.
- Kept 15-second polling and gateway-only data access.
- Preserved the existing “indicative depth” warning and dev-market safety behavior.

## Important compatibility note

The actual original `src/lib/api.ts` and component source files were not among the supplied attachments. The replacement `src/lib/api.ts` therefore normalizes common camelCase/snake_case response shapes and tries a small number of safe request-body variants for **non-state-changing** gateway preparation/evaluation endpoints. If your API uses a different request schema, only `src/lib/api.ts` should need a small mapping change; the UI files do not need to change.

## Run

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```
