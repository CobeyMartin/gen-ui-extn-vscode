import { ConversationTurn, GenerationRequest } from '../types';
import { CORRECTION_PROMPT_PREFIX, DESIGN_THINKING_SYSTEM_PROMPT } from '../utils/constants';

export class PromptService {
  public buildGenerationPrompt(request: GenerationRequest): string {
    return [
      'Generate a complete standalone HTML document.',
      `Main description: ${request.description}`,
      `Aesthetic direction: ${request.aesthetic}`,
      request.constraints ? `Technical constraints: ${request.constraints}` : '',
      request.accessibilityRequirements ? `Accessibility requirements: ${request.accessibilityRequirements}` : '',
      'Return only raw HTML.'
    ].filter(Boolean).join('\n');
  }

  public buildCorrectionPrompt(correction: string, currentHtml: string): string {
    return [
      CORRECTION_PROMPT_PREFIX,
      `Requested changes: ${correction}`,
      'Current HTML to modify:',
      currentHtml
    ].join('\n\n');
  }

  public getSystemPrompt(): string {
    return DESIGN_THINKING_SYSTEM_PROMPT;
  }

  public appendTurn(history: ConversationTurn[], role: ConversationTurn['role'], content: string): ConversationTurn[] {
    return [...history, { role, content }];
  }
}

export const promptService = new PromptService();
