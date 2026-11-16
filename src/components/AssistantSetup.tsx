import { useRef, useState } from "react";
import type { AssistantStatus } from "../types";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { Icon } from "./Icon";

interface AssistantSetupProps {
  open: boolean;
  status: AssistantStatus | null;
  onCheck: () => Promise<AssistantStatus>;
  onClose: () => void;
}

const KEY_PAGE = "https://abacus.ai/app/route-llm-apis";

// The key lives in .env on this PC and never passes through the browser, so connecting is
// a few manual steps; this dialog walks through them and checks the result.
export function AssistantSetup({ open, status, onCheck, onClose }: AssistantSetupProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  useFocusTrap(ref, open, onClose);

  if (!open) return null;

  const check = async () => {
    setChecking(true);
    try {
      await onCheck();
    } finally {
      setChecking(false);
      setCheckedAt(Date.now());
    }
  };

  const copyPath = () => {
    if (!status?.settingsFile) return;
    void navigator.clipboard.writeText(status.settingsFile).then(() => setCopied(true));
  };

  return (
    <div className="dialog-layer">
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        aria-describedby="setup-intro"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <h2 id="setup-title" className="dialog-title">
            Connect your AI assistant
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        {status?.configured ? (
          <div className="dialog-body">
            <p id="setup-intro" className="dialog-intro">
              Connected{status.model ? ` to ${status.model}` : ""}. Ask about any note from the Assistant tab.
            </p>
            <footer className="dialog-footer">
              <button type="button" className="pill-btn primary" onClick={onClose} data-autofocus>
                Done
              </button>
            </footer>
          </div>
        ) : (
          <div className="dialog-body">
            <p id="setup-intro" className="dialog-intro">
              Argonaut reaches the assistant through RouteLLM. The key stays in a settings file on this PC and never
              reaches the browser, so it's added by hand, once.
            </p>
            <ol className="setup-steps">
              <li>
                <h3 className="setup-step-title">Get a RouteLLM API key</h3>
                <p>Sign in to Abacus.AI with a ChatLLM subscription, then create a key on the RouteLLM API page.</p>
                <a className="pill-btn" href={KEY_PAGE} target="_blank" rel="noreferrer">
                  Open the RouteLLM API page <Icon name="external" size={16} />
                </a>
              </li>
              <li>
                <h3 className="setup-step-title">Add it to Argonaut's settings file</h3>
                {status?.settingsFile ? (
                  <>
                    <p>Open this file in Notepad:</p>
                    <div className="copy-row">
                      <code className="copy-value">{status.settingsFile}</code>
                      <button type="button" className="ghost-btn" onClick={copyPath}>
                        {copied ? "Copied" : "Copy path"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p>
                    Open <code>.env</code> in the knowledge-vault folder, next to Argonaut.exe.
                  </p>
                )}
                <p>
                  Replace the placeholder after <code>LLM_API_KEY=</code> with your key, with no quotes or spaces, then
                  save.
                  {status?.model && (
                    <>
                      {" "}
                      The model is <code>{status.model}</code>, set on the <code>LLM_MODEL=</code> line.
                    </>
                  )}
                </p>
              </li>
              <li>
                <h3 className="setup-step-title">Relaunch Argonaut</h3>
                <p>Close this window and open Argonaut.exe again. It restarts the assistant with the new key.</p>
              </li>
            </ol>
            <footer className="dialog-footer">
              <span className="dialog-status" role="status">
                {checking ? "Checking…" : checkedAt ? "Not connected yet: Argonaut hasn't picked up a key." : ""}
              </span>
              <button type="button" className="ghost-btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="pill-btn primary" onClick={() => void check()} disabled={checking}>
                Check again
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}
