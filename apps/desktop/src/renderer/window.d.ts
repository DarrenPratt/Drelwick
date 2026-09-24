import type { DrelwickApi } from "@drelwick/shared";

declare global {
  interface Window {
    drelwick: DrelwickApi;
  }
}

export {};
