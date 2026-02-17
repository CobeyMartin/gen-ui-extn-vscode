import * as vscode from 'vscode';
import { INPUT_PANEL_VIEW_TYPE } from '../utils/constants';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types';

export class InputPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    onMessage: (message: WebviewToExtensionMessage) => void,
    onDispose?: () => void
  ) {
    this.panel = vscode.window.createWebviewPanel(
      INPUT_PANEL_VIEW_TYPE,
      'Gen UI Input',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => onMessage(msg as WebviewToExtensionMessage));
    this.panel.onDidDispose(() => {
      this.disposed = true;
      onDispose?.();
    });
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public reveal(): void {
    if (this.disposed) {
      return;
    }
    this.panel.reveal(vscode.ViewColumn.One);
  }

  public postMessage(message: ExtensionToWebviewMessage): Thenable<boolean> | Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    return this.panel.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = nonceValue();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} https://fonts.googleapis.com 'unsafe-inline'`,
      `font-src https://fonts.gstatic.com`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<title>Gen UI Input</title>
<style>
  :root {
    --bg: #0a0a0f;
    --primary: #00ffaa;
    --secondary: #ff00aa;
    --tertiary: #00aaff;
    --text: #d6d7dd;
    --muted: #8f93a4;
    --card: rgba(18, 19, 30, 0.88);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: 'Outfit', sans-serif;
    background:
      radial-gradient(900px 400px at 20% -10%, rgba(0,255,170,.15), transparent 55%),
      radial-gradient(900px 450px at 90% -20%, rgba(255,0,170,.12), transparent 55%),
      radial-gradient(700px 420px at 50% 110%, rgba(0,170,255,.14), transparent 55%),
      var(--bg);
    color: var(--text);
    padding: 18px;
  }
  .card {
    background: var(--card);
    border: 1px solid rgba(0,255,170,.25);
    border-radius: 16px;
    box-shadow: 0 0 0 1px rgba(255,0,170,.15) inset;
    padding: 18px;
  }
  h1 {
    margin: 0 0 12px;
    font-family: 'Space Mono', monospace;
    color: var(--primary);
    letter-spacing: .5px;
    font-size: 18px;
  }
  .sub {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 12px;
  }
  label {
    display: block;
    margin: 12px 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .8px;
    font-family: 'Space Mono', monospace;
    color: #c7ffe7;
  }
  textarea, select {
    width: 100%;
    border-radius: 10px;
    border: 1px solid rgba(0,170,255,.35);
    background: rgba(8, 10, 20, .9);
    color: var(--text);
    padding: 10px 12px;
    font-size: 13px;
    outline: none;
    transition: border-color .18s ease, box-shadow .18s ease;
    font-family: 'Outfit', sans-serif;
  }
  textarea { min-height: 96px; resize: vertical; }
  textarea:focus, select:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px rgba(0,255,170,.15);
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }
  button {
    flex: 1;
    border: 0;
    border-radius: 12px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    letter-spacing: .6px;
    padding: 10px 12px;
    cursor: pointer;
    color: #03110d;
    background: linear-gradient(135deg, var(--primary), #49ffe0);
    transition: transform .15s ease, filter .2s ease, box-shadow .2s ease;
    box-shadow: 0 10px 20px rgba(0,255,170,.2);
  }
  button.alt {
    background: linear-gradient(135deg, var(--secondary), #ff57c3);
    color: #180312;
    box-shadow: 0 10px 20px rgba(255,0,170,.2);
  }
  button:hover { transform: translateY(-1px); filter: saturate(1.1); }
  .model {
    margin-top: 10px;
    color: #98fff5;
    font-size: 12px;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Gen UI Extension</h1>
    <p class="sub">AI-powered design thinking UI generator</p>

    <label for="description">Main Description</label>
    <textarea id="description" placeholder="Describe what UI to build..."></textarea>

    <label for="aesthetic">Aesthetic Direction</label>
    <select id="aesthetic"></select>

    <label for="constraints">Technical Constraints (optional)</label>
    <textarea id="constraints" placeholder="Framework, performance limits, target devices..."></textarea>

    <label for="accessibility">Accessibility Requirements (optional)</label>
    <textarea id="accessibility" placeholder="WCAG level, keyboard-only, screen-reader notes..."></textarea>

    <div class="row">
      <button id="generate">Generate UI</button>
      <button id="selectModel" class="alt">Select Model</button>
    </div>

    <div id="model" class="model">Model: not selected</div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const descriptionEl = document.getElementById('description');
  const aestheticEl = document.getElementById('aesthetic');
  const constraintsEl = document.getElementById('constraints');
  const accessibilityEl = document.getElementById('accessibility');
  const modelEl = document.getElementById('model');

  document.getElementById('generate').addEventListener('click', () => {
    const description = descriptionEl.value.trim();
    if (!description) {
      modelEl.textContent = 'Please enter a description before generating.';
      return;
    }

    vscode.postMessage({
      type: 'generate',
      payload: {
        description,
        aesthetic: aestheticEl.value,
        constraints: constraintsEl.value.trim(),
        accessibilityRequirements: accessibilityEl.value.trim()
      }
    });
  });

  document.getElementById('selectModel').addEventListener('click', () => {
    vscode.postMessage({ type: 'selectModel' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'aestheticPresets') {
      aestheticEl.innerHTML = '';
      for (const preset of message.payload) {
        const option = document.createElement('option');
        option.value = preset;
        option.textContent = preset;
        aestheticEl.appendChild(option);
      }
    }

    if (message.type === 'modelSelected') {
      modelEl.textContent = 'Model: ' + message.payload.name + ' (' + message.payload.family + ')';
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function nonceValue(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
