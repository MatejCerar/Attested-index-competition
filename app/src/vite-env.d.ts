/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GENERATE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
