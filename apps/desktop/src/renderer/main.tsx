import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RecoveryStartup } from "./RecoveryStartup.js";
import { App } from "./App.js";
import { RendererErrorBoundary } from "./RendererErrorBoundary.js";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Renderer root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <RendererErrorBoundary>
      <RecoveryStartup>
        <App />
      </RecoveryStartup>
    </RendererErrorBoundary>
  </StrictMode>,
);
