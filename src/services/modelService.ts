import * as vscode from 'vscode';
import { SelectedModel } from '../types';

export class ModelService {
  private static instance: ModelService;
  private selectedModel: SelectedModel | null = null;
  private context: vscode.ExtensionContext | null = null;

  private constructor() {}

  public static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService();
    }
    return ModelService.instance;
  }

  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  public getCurrentModel(): SelectedModel | null {
    return this.selectedModel;
  }

  public async getSelectedModel(): Promise<SelectedModel | null> {
    if (this.selectedModel && await this.validateModel(this.selectedModel.id)) {
      return this.selectedModel;
    }

    const cachedModelId = this.context?.globalState.get<string>('genUI.selectedModelId');
    if (cachedModelId) {
      const cachedModel = await this.findModelById(cachedModelId);
      if (cachedModel) {
        this.selectedModel = cachedModel;
        return cachedModel;
      }
    }

    return this.promptModelSelection();
  }

  public async promptModelSelection(showAll = false): Promise<SelectedModel | null> {
    const allModels = await vscode.lm.selectChatModels({});
    if (!allModels.length) {
      void vscode.window.showWarningMessage('No chat models are currently available in VS Code.');
      return null;
    }

    const config = vscode.workspace.getConfiguration('genUI');
    const preferredFamily = config.get<string>('defaultModelFamily', 'gpt-4o').toLowerCase();

    const preferred = allModels.filter((m) => this.isPreferredModel(m));
    const models = showAll || !preferred.length ? allModels : preferred;

    const items = models
      .map((model) => ({
        label: model.name,
        description: `${model.vendor} • ${model.family}`,
        detail: `Version ${model.version} • Max input ${model.maxInputTokens.toLocaleString()} tokens`,
        model
      }))
      .sort((a, b) => Number(this.modelText(b.model).includes(preferredFamily)) - Number(this.modelText(a.model).includes(preferredFamily)));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Gen UI: Select Model',
      placeHolder: 'Choose an AI model for UI generation',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!picked) {
      return null;
    }

    const selectedModel: SelectedModel = {
      id: picked.model.id,
      name: picked.model.name,
      vendor: picked.model.vendor,
      family: picked.model.family,
      version: picked.model.version,
      maxInputTokens: picked.model.maxInputTokens,
      model: picked.model
    };

    this.selectedModel = selectedModel;
    await this.context?.globalState.update('genUI.selectedModelId', selectedModel.id);
    return selectedModel;
  }

  private isPreferredModel(model: vscode.LanguageModelChat): boolean {
    const haystack = this.modelText(model);
    return ['gemini', 'codex', 'sonnet', 'opus'].some((name) => haystack.includes(name));
  }

  private modelText(model: vscode.LanguageModelChat): string {
    return `${model.id} ${model.family} ${model.name} ${model.vendor}`.toLowerCase();
  }

  private async findModelById(id: string): Promise<SelectedModel | null> {
    const models = await vscode.lm.selectChatModels({ id });
    const model = models[0];

    if (!model) {
      return null;
    }

    return {
      id: model.id,
      name: model.name,
      vendor: model.vendor,
      family: model.family,
      version: model.version,
      maxInputTokens: model.maxInputTokens,
      model
    };
  }

  private async validateModel(id: string): Promise<boolean> {
    const models = await vscode.lm.selectChatModels({ id });
    return models.length > 0;
  }
}

export const modelService = ModelService.getInstance();
