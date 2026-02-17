import * as vscode from 'vscode';
import { InputPanel } from './panels/inputPanel';
import { PreviewPanel } from './panels/previewPanel';
import { modelService } from './services/modelService';
import { promptService } from './services/promptService';
import {
	ConversationTurn,
	ExtensionToWebviewMessage,
	GenerationRequest,
	PreviewState,
	StoredDesign,
	WebviewToExtensionMessage
} from './types';
import { DEFAULT_AESTHETIC_PRESETS, EXTENSION_ID } from './utils/constants';
import { encodeHtmlForIframe, parseGeneratedCode, parseStreamingPartial } from './utils/responseParser';

class GenUiController {
	private static readonly WORKSPACE_DESIGNS_KEY = 'genUI.workspaceDesigns';
	private static readonly MAX_STORED_DESIGNS = 50;

	private inputPanel: InputPanel | null = null;
	private previewPanel: PreviewPanel | null = null;

	private state: PreviewState = {
		generatedCode: null,
		conversationHistory: [],
		selectedModel: null,
		originalRequest: null,
		isGenerating: false
	};

	constructor(private readonly context: vscode.ExtensionContext) {
		modelService.initialize(context);
	}

	public async openGeneratePanels(): Promise<void> {
		if (!this.inputPanel || this.inputPanel.isDisposed) {
			this.inputPanel = new InputPanel(
				this.context.extensionUri,
				(message) => {
					void this.handleMessage(message);
				},
				() => {
					this.inputPanel = null;
				}
			);
		} else {
			this.inputPanel.reveal();
		}

		if (!this.previewPanel || this.previewPanel.isDisposed) {
			this.previewPanel = new PreviewPanel(
				this.context.extensionUri,
				(message) => {
					void this.handleMessage(message);
				},
				() => {
					this.previewPanel = null;
				}
			);
		} else {
			this.previewPanel.reveal();
		}

		const presets = this.getAestheticPresets();
		await this.broadcast({ type: 'aestheticPresets', payload: presets });

		const model = await modelService.getSelectedModel();
		if (model) {
			this.state.selectedModel = model;
			await this.broadcast({ type: 'modelSelected', payload: { name: model.name, family: model.family } });
		}

		await this.restoreMostRecentDesign();
	}

	public async selectModel(): Promise<void> {
		const model = await modelService.promptModelSelection(true);
		if (!model) {
			return;
		}

		this.state.selectedModel = model;
		await this.broadcast({ type: 'modelSelected', payload: { name: model.name, family: model.family } });
		void vscode.window.showInformationMessage(`Model selected: ${model.name} (${model.family})`);
	}

	public async saveToFile(): Promise<void> {
		if (!this.state.generatedCode?.combinedHtml) {
			void vscode.window.showWarningMessage('No generated HTML available to save.');
			return;
		}

		const target = await vscode.window.showSaveDialog({
			title: 'Save Generated UI',
			defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
			filters: { HTML: ['html'] },
			saveLabel: 'Save HTML'
		});

		if (!target) {
			return;
		}

		await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(this.state.generatedCode.combinedHtml));

		const action = await vscode.window.showInformationMessage(
			`Saved generated UI to ${target.fsPath}`,
			'Open in Editor',
			'Open in Browser'
		);

		if (action === 'Open in Editor') {
			const doc = await vscode.workspace.openTextDocument(target);
			await vscode.window.showTextDocument(doc, { preview: false });
		} else if (action === 'Open in Browser') {
			await vscode.env.openExternal(target);
		}
	}

	public async loadFromWorkspaceStorage(): Promise<void> {
		await this.loadDesignFromWorkspaceStorage();
	}

	private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		switch (message.type) {
			case 'ready': {
					if (this.inputPanel && !this.inputPanel.isDisposed) {
					await this.inputPanel.postMessage({ type: 'aestheticPresets', payload: this.getAestheticPresets() });
				}

				if (this.state.selectedModel) {
					await this.broadcast({
						type: 'modelSelected',
						payload: { name: this.state.selectedModel.name, family: this.state.selectedModel.family }
					});
				}
				return;
			}

			case 'selectModel': {
				await this.selectModel();
				return;
			}

			case 'generate': {
				await this.generate(message.payload);
				return;
			}

			case 'applyCorrection': {
				await this.applyCorrection(message.payload);
				return;
			}

			case 'saveToFile': {
				await this.saveToFile();
				return;
			}

			case 'loadDesign': {
				await this.loadDesignFromWorkspaceStorage();
				return;
			}

			case 'reset': {
				this.state.generatedCode = null;
				this.state.conversationHistory = [];
				this.state.originalRequest = null;
				this.state.isGenerating = false;
				await this.broadcast({ type: 'stateReset' });
				return;
			}

			default:
				return;
		}
	}

	private async generate(request: GenerationRequest): Promise<void> {
		const model = await this.ensureModel();
		if (!model) {
			return;
		}

		this.state.isGenerating = true;
		this.state.originalRequest = request;
		await this.broadcast({ type: 'generationStarted' });

		const userPrompt = promptService.buildGenerationPrompt(request);
		const history = promptService.appendTurn(this.state.conversationHistory, 'user', userPrompt);

		try {
			const { fullText, updatedHistory } = await this.streamModelResponse(model.model, history, promptService.getSystemPrompt());
			this.state.conversationHistory = updatedHistory;
			this.state.generatedCode = parseGeneratedCode(fullText);
			await this.persistGeneratedDesign(this.state.generatedCode, this.state.originalRequest);
			this.state.isGenerating = false;

			await this.broadcast({ type: 'streamComplete', payload: this.state.generatedCode });
			await this.pushPreview(this.state.generatedCode.combinedHtml, false);
		} catch (error) {
			this.state.isGenerating = false;
			const message = error instanceof Error ? error.message : 'Generation failed.';
			await this.broadcast({ type: 'streamError', payload: message });
		}
	}

	private async applyCorrection(correction: string): Promise<void> {
		if (!this.state.generatedCode) {
			void vscode.window.showWarningMessage('Generate a UI first before applying corrections.');
			return;
		}

		const model = await this.ensureModel();
		if (!model) {
			return;
		}

		this.state.isGenerating = true;
		await this.broadcast({ type: 'generationStarted' });

		const correctionPrompt = promptService.buildCorrectionPrompt(correction, this.state.generatedCode.combinedHtml);
		const history = promptService.appendTurn(this.state.conversationHistory, 'user', correctionPrompt);

		try {
			const { fullText, updatedHistory } = await this.streamModelResponse(model.model, history, promptService.getSystemPrompt());
			this.state.conversationHistory = updatedHistory;
			this.state.generatedCode = parseGeneratedCode(fullText);
			await this.persistGeneratedDesign(this.state.generatedCode, this.state.originalRequest);
			this.state.isGenerating = false;

			await this.broadcast({ type: 'streamComplete', payload: this.state.generatedCode });
			await this.pushPreview(this.state.generatedCode.combinedHtml, false);
		} catch (error) {
			this.state.isGenerating = false;
			const message = error instanceof Error ? error.message : 'Correction failed.';
			await this.broadcast({ type: 'streamError', payload: message });
		}
	}

	private async streamModelResponse(
		model: vscode.LanguageModelChat,
		history: ConversationTurn[],
		systemPrompt: string
	): Promise<{ fullText: string; updatedHistory: ConversationTurn[] }> {
		let fullText = '';

		const messages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.User(`${systemPrompt}\n\nFollow these rules for this turn.`),
			...history.map((turn) => turn.role === 'user'
				? vscode.LanguageModelChatMessage.User(turn.content)
				: vscode.LanguageModelChatMessage.Assistant(turn.content))
		];

		const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

		for await (const chunk of response.text) {
			const text = this.chunkToText(chunk);
			if (!text) {
				continue;
			}

			fullText += text;
			await this.broadcast({ type: 'streamChunk', payload: text });

			const parsed = parseStreamingPartial(fullText);
			await this.pushPreview(parsed.combinedHtml, true);
		}

		const updatedHistory = promptService.appendTurn(history, 'assistant', fullText);
		return { fullText, updatedHistory };
	}

	private chunkToText(chunk: unknown): string {
		if (typeof chunk === 'string') {
			return chunk;
		}

		if (chunk && typeof chunk === 'object') {
			const part = chunk as { value?: unknown };
			if (typeof part.value === 'string') {
				return part.value;
			}
		}

		return '';
	}

	private async ensureModel(): Promise<ReturnType<typeof modelService.getCurrentModel>> {
		if (this.state.selectedModel) {
			return this.state.selectedModel;
		}

		const model = await modelService.getSelectedModel();
		if (!model) {
			void vscode.window.showWarningMessage('Select a model to continue.');
			return null;
		}

		this.state.selectedModel = model;
		await this.broadcast({ type: 'modelSelected', payload: { name: model.name, family: model.family } });
		return model;
	}

	private async pushPreview(html: string, isStreaming: boolean): Promise<void> {
		const base64Html = encodeHtmlForIframe(html);
		await this.broadcast({ type: 'previewUpdate', payload: { base64Html, isStreaming } });
	}

	private async broadcast(message: ExtensionToWebviewMessage): Promise<void> {
		const posts: Array<Promise<boolean>> = [];

		if (this.inputPanel && !this.inputPanel.isDisposed) {
			posts.push(Promise.resolve(this.inputPanel.postMessage(message)).catch(() => false));
		}

		if (this.previewPanel && !this.previewPanel.isDisposed) {
			posts.push(Promise.resolve(this.previewPanel.postMessage(message)).catch(() => false));
		}

		if (!posts.length) {
			return;
		}

		await Promise.all(posts);
	}

	private getAestheticPresets(): string[] {
		const configured = vscode.workspace.getConfiguration(EXTENSION_ID).get<string[]>('aestheticPresets');
		return configured?.length ? configured : DEFAULT_AESTHETIC_PRESETS;
	}

	private getStoredDesigns(): StoredDesign[] {
		return this.context.workspaceState.get<StoredDesign[]>(GenUiController.WORKSPACE_DESIGNS_KEY, []);
	}

	private async persistGeneratedDesign(generatedCode: StoredDesign['generatedCode'], request: GenerationRequest | null): Promise<void> {
		const existing = this.getStoredDesigns();
		const title = request?.description?.trim().slice(0, 80) || 'Generated UI';

		const next: StoredDesign[] = [
			{
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				title,
				createdAt: new Date().toISOString(),
				request,
				generatedCode
			},
			...existing
		].slice(0, GenUiController.MAX_STORED_DESIGNS);

		await this.context.workspaceState.update(GenUiController.WORKSPACE_DESIGNS_KEY, next);
	}

	private async restoreMostRecentDesign(): Promise<void> {
		if (this.state.generatedCode) {
			return;
		}

		const [latest] = this.getStoredDesigns();
		if (!latest) {
			return;
		}

		this.state.generatedCode = latest.generatedCode;
		this.state.originalRequest = latest.request;
		await this.pushPreview(latest.generatedCode.combinedHtml, false);
	}

	private async loadDesignFromWorkspaceStorage(): Promise<void> {
		const designs = this.getStoredDesigns();
		if (!designs.length) {
			void vscode.window.showInformationMessage('No saved designs found in workspace storage yet.');
			return;
		}

		const picked = await vscode.window.showQuickPick(
			designs.map((design) => {
				const created = new Date(design.createdAt).toLocaleString();
				return {
					label: design.title,
					description: created,
					detail: design.request?.aesthetic ? `Aesthetic: ${design.request.aesthetic}` : 'Generated design',
					design
				};
			}),
			{
				title: 'Load saved design',
				placeHolder: 'Choose a design from workspace storage'
			}
		);

		if (!picked) {
			return;
		}

		this.state.generatedCode = picked.design.generatedCode;
		this.state.originalRequest = picked.design.request;
		await this.broadcast({ type: 'streamComplete', payload: picked.design.generatedCode });
		await this.pushPreview(picked.design.generatedCode.combinedHtml, false);
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const controller = new GenUiController(context);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = '$(wand) Gen UI';
	statusBarItem.tooltip = 'Generate stunning UI with AI Design Thinking';
	statusBarItem.command = 'genUI.generateUI';
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(
		vscode.commands.registerCommand('genUI.generateUI', async () => {
			await controller.openGeneratePanels();
		}),
		vscode.commands.registerCommand('genUI.selectModel', async () => {
			await controller.selectModel();
		}),
		vscode.commands.registerCommand('genUI.loadDesign', async () => {
			await controller.openGeneratePanels();
			await controller.loadFromWorkspaceStorage();
		}),
		vscode.commands.registerCommand('genUI.saveToFile', async () => {
			await controller.saveToFile();
		})
	);
}

export function deactivate(): void {}
