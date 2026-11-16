import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppStateProvider } from "./hooks/useAppState";
import { MissionsProvider } from "./hooks/useMissions";
import { DialogsProvider } from "./hooks/useDialogs";
// The fonts ship with the app, so nothing is fetched from outside and they work offline.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <DialogsProvider>
      <AppStateProvider>
        <MissionsProvider>
          <App />
        </MissionsProvider>
      </AppStateProvider>
    </DialogsProvider>
  </StrictMode>,
);
