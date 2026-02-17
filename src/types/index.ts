import * as vscode from 'vscode';

export interface SelectedModel {
    id: string;
    name: string;
    vendor: string;
    family: string;
    version: string;
    maxInputTokens: number;
    model: vscode.LanguageModelChat;
}

export interface GenerationRequest {
    description: string;
    aesthetic: string;
    constraints?: string;
    accessibilityRequirements?: string;
}

export interface ParsedCode {
    html: string;
    css: string;
    js: string;
    raw: string;
    combinedHtml: string;
}

export interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface PreviewState {
    generatedCode: ParsedCode | null;
    conversationHistory: ConversationTurn[];
    selectedModel: SelectedModel | null;
    originalRequest: GenerationRequest | null;
    isGenerating: boolean;
}

export interface StoredDesign {
    id: string;
    title: string;
    createdAt: string;
    request: GenerationRequest | null;
    generatedCode: ParsedCode;
}

export type WebviewToExtensionMessage =
    | { type: 'generate'; payload: GenerationRequest } 
    | { type: 'applyCorrection'; payload: string }
    | { type: 'reset' }
    | { type: 'saveToFile'}
    | { type: 'loadDesign'}
    | { type: 'selectModel'}
    | { type: 'ready' };

export type ExtensionToWebviewMessage = 
    | {type: 'streamChunk'; payload: string }
    | {type: 'streamComplete'; payload: ParsedCode}
    | {type: 'streamError'; payload: string}
    | {type: 'modelSelected'; payload: {name:string; family: string}}
    | {type: 'generationStarted'}
    | {type: 'aestheticPresets'; payload: string[]}
    | {type: 'restoreState'; payload: Partial<PreviewState>}
    | {type: 'previewUpdate'; payload: { base64Html: string; isStreaming: boolean }}
    | {type: 'stateReset'};