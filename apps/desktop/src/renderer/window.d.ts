import type { SarelApi } from "@sarel/shared";

declare global {
  interface Window {
    sarel: SarelApi;
  }
}

export {};
