import { useCallback, useEffect, useState } from "react";

// The desktop icon for Argonaut.exe. Only the Argonaut window (WebView2) can see or make one:
// the page asks the launcher hosting it through window.chrome.webview, and the launcher
// answers with whether a shortcut to it is on the desktop. In a plain browser there's no
// launcher, and nothing is offered.

interface WebViewBridge {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

interface ShortcutAnswer {
  type: "desktop-shortcut";
  exists: boolean;
  error: string | null;
}

function bridge(): WebViewBridge | null {
  return (window as unknown as { chrome?: { webview?: WebViewBridge } }).chrome?.webview ?? null;
}

function isAnswer(data: unknown): data is ShortcutAnswer {
  return typeof data === "object" && data !== null && (data as ShortcutAnswer).type === "desktop-shortcut";
}

export function useDesktopShortcut(onResult: (created: boolean, error: string | null) => void) {
  // null until the launcher answers, and always in a plain browser.
  const [exists, setExists] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const webview = bridge();
    if (!webview) return;
    const listen = (event: MessageEvent) => {
      if (!isAnswer(event.data)) return;
      setExists(event.data.exists);
      setCreating((was) => {
        if (was) onResult(event.data.exists, event.data.error);
        return false;
      });
    };
    webview.addEventListener("message", listen);
    // Asked again whenever the window comes back, in case the icon was deleted meanwhile.
    const ask = () => webview.postMessage("desktop-shortcut:status");
    ask();
    window.addEventListener("focus", ask);
    return () => {
      webview.removeEventListener("message", listen);
      window.removeEventListener("focus", ask);
    };
  }, [onResult]);

  const create = useCallback(() => {
    const webview = bridge();
    if (!webview) return;
    setCreating(true);
    webview.postMessage("desktop-shortcut:create");
  }, []);

  return { canCreate: exists === false, creating, create };
}
