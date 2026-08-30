/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_USE_MOCK?: string;
  readonly VITE_GASX_PACKAGE_ID?: string;
  readonly VITE_USDC_COIN_TYPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
