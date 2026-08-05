import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { installClientErrorReporting, reportCaughtError } from "./lib/clientErrors";

/**
 * Installed before anything renders, so a crash during the first paint is still reported.
 *
 * First-party and errors only — nothing is sent unless something throws. `lib/clientErrors.ts`
 * quotes the privacy sentence this keeps true and lists exactly what does and does not leave
 * the device.
 */
installClientErrorReporting();

createRoot(document.getElementById("root")!, {
  /**
   * React 19 hands an error CAUGHT by an error boundary to `console.error` and nothing else;
   * only uncaught ones reach `window.onerror`. Every page here renders inside `ErrorBoundary`
   * (App.tsx) and React Router's own boundary, so the worst failure a customer can have — the
   * page in front of them collapsing to "Something broke on this page" — is precisely the one
   * the window handler never sees. This closes that gap; it is not belt-and-braces.
   */
  onCaughtError: reportCaughtError,
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
