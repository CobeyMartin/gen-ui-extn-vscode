import * as vscode from 'vscode';
import { PREVIEW_PANEL_VIEW_TYPE } from '../utils/constants';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types';

export class PreviewPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    onMessage: (message: WebviewToExtensionMessage) => void,
    onDispose?: () => void
  ) {
    this.panel = vscode.window.createWebviewPanel(
      PREVIEW_PANEL_VIEW_TYPE,
      'Gen UI Preview',
      vscode.ViewColumn.Two,
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
    this.panel.reveal(vscode.ViewColumn.Two);
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
      `frame-src 'self' data: blob:`,
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
<title>Gen UI Preview</title>
<style>
  :root {
    --bg: #0a0a0f;
    --primary: #00ffaa;
    --secondary: #ff00aa;
    --tertiary: #00aaff;
    --text: #d6d7dd;
    --muted: #9097a8;
    --card: rgba(15, 16, 26, .9);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: 'Outfit', sans-serif;
    background:
      radial-gradient(800px 430px at 15% -10%, rgba(0,255,170,.13), transparent 55%),
      radial-gradient(900px 460px at 90% -20%, rgba(255,0,170,.12), transparent 55%),
      radial-gradient(700px 460px at 50% 110%, rgba(0,170,255,.12), transparent 55%),
      var(--bg);
    color: var(--text);
    padding: 14px;
  }
  .layout {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 10px;
    height: calc(100vh - 28px);
  }
  .toolbar, .controls {
    background: var(--card);
    border: 1px solid rgba(0,255,170,.25);
    border-radius: 12px;
    padding: 10px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .stream {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #445;
    box-shadow: 0 0 0 0 rgba(0,255,170,0);
  }
  .stream.active {
    background: var(--primary);
    animation: pulse 1s ease infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(0,255,170,.45); }
    100% { box-shadow: 0 0 0 11px rgba(0,255,170,0); }
  }
  .label {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .8px;
    color: #baffee;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 1px solid rgba(0,170,255,.35);
    border-radius: 12px;
    background: #ffffff;
  }
  input {
    flex: 1;
    border-radius: 10px;
    border: 1px solid rgba(0,170,255,.35);
    background: rgba(8, 10, 20, .9);
    color: var(--text);
    padding: 10px 12px;
    outline: none;
    font-family: 'Outfit', sans-serif;
  }
  input:focus { border-color: var(--primary); }
  button {
    border: 0;
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: 'Space Mono', monospace;
    transition: transform .15s ease, filter .2s ease;
  }
  button:hover { transform: translateY(-1px); filter: saturate(1.1); }
  button.apply {
    color: #03110d;
    background: linear-gradient(135deg, var(--primary), #49ffe0);
  }
  button.reset {
    color: #1a0312;
    background: linear-gradient(135deg, var(--secondary), #ff57c3);
  }
  button.save {
    color: #031024;
    background: linear-gradient(135deg, var(--tertiary), #61d0ff);
  }
  .status {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
  }
</style>
</head>
<body>
  <div class="layout">
    <div class="toolbar">
      <div id="streamDot" class="stream"></div>
      <span class="label">Live Stream</span>
      <span id="status" class="status">Idle</span>
    </div>

    <iframe id="previewFrame" sandbox="allow-scripts allow-modals allow-forms"></iframe>

    <div class="controls">
      <input id="correction" placeholder="Describe corrections to refine the UI..." />
      <button id="apply" class="apply">Apply</button>
      <button id="reset" class="reset">Reset</button>
      <button id="load" class="save">Load</button>
      <button id="save" class="save">Save</button>
    </div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  const frame = document.getElementById('previewFrame');
  const correction = document.getElementById('correction');
  const streamDot = document.getElementById('streamDot');
  const status = document.getElementById('status');

  function decodeBase64(base64) {
    try {
      return decodeURIComponent(escape(window.atob(base64)));
    } catch {
      return window.atob(base64);
    }
  }

  function setStreaming(isStreaming) {
    streamDot.classList.toggle('active', Boolean(isStreaming));
    status.textContent = isStreaming ? 'Generating…' : 'Ready';
  }

  window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'generationStarted') {
      setStreaming(true);
      return;
    }

    if (message.type === 'previewUpdate') {
      const html = decodeBase64(message.payload.base64Html);
      frame.srcdoc = html;
      setStreaming(message.payload.isStreaming);
      return;
    }

    if (message.type === 'streamComplete') {
      setStreaming(false);
      return;
    }

    if (message.type === 'streamError') {
      setStreaming(false);
      status.textContent = message.payload;
      return;
    }

    if (message.type === 'stateReset') {
      frame.srcdoc = '';
      correction.value = '';
      setStreaming(false);
    }
  });

  document.getElementById('apply').addEventListener('click', () => {
    const value = correction.value.trim();
    if (!value) {
      return;
    }
    vscode.postMessage({ type: 'applyCorrection', payload: value });
    correction.value = '';
  });

  document.getElementById('reset').addEventListener('click', () => {
    vscode.postMessage({ type: 'reset' });
  });

  document.getElementById('save').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveToFile' });
  });

  document.getElementById('load').addEventListener('click', () => {
    vscode.postMessage({ type: 'loadDesign' });
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
