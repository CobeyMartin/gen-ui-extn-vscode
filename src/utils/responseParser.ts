import { ParsedCode } from '../types';

const BLOCK_RE = /```(html|css|js|javascript)?\s*([\s\S]*?)```/gi;
const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const SCRIPT_RE = /<script[^>]*>([\s\S]*?)<\/script>/gi;

export function parseGeneratedCode(response: string): ParsedCode {
  const raw = response.trim();

  if (looksLikeHtml(raw)) {
    const combinedHtml = ensureCompleteHtml(raw);
    return {
      html: combinedHtml,
      css: extractAll(STYLE_RE, combinedHtml).join('\n'),
      js: extractAll(SCRIPT_RE, combinedHtml).join('\n'),
      raw,
      combinedHtml
    };
  }

  const blockMap = extractCodeBlocks(raw);
  const html = blockMap.html ?? '';
  const css = blockMap.css ?? '';
  const js = blockMap.js ?? blockMap.javascript ?? '';

  if (html) {
    const combinedHtml = ensureCompleteHtml(composeHtml(html, css, js));
    return { html, css, js, raw, combinedHtml };
  }

  const fallbackHtml = ensureCompleteHtml(raw);
  return {
    html: fallbackHtml,
    css: extractAll(STYLE_RE, fallbackHtml).join('\n'),
    js: extractAll(SCRIPT_RE, fallbackHtml).join('\n'),
    raw,
    combinedHtml: fallbackHtml
  };
}

export function parseStreamingPartial(partial: string): ParsedCode {
  return parseGeneratedCode(autoCloseUnclosedTags(partial));
}

export function encodeHtmlForIframe(html: string): string {
  return Buffer.from(html, 'utf8').toString('base64');
}

function composeHtml(html: string, css: string, js: string): string {
  if (/<!DOCTYPE html>/i.test(html)) {
    return html;
  }

  const hasHtmlTag = /<html[\s>]/i.test(html);
  const bodyContent = hasHtmlTag ? html : `<body>${html}</body>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${css ? `<style>${css}</style>` : ''}
</head>
${bodyContent}
${js ? `<script>${js}</script>` : ''}
</html>`;
}

function extractCodeBlocks(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  let match: RegExpExecArray | null;

  while ((match = BLOCK_RE.exec(raw)) !== null) {
    const lang = (match[1] ?? 'html').toLowerCase();
    const code = match[2]?.trim() ?? '';
    if (!result[lang]) {
      result[lang] = code;
    }
  }

  return result;
}

function looksLikeHtml(content: string): boolean {
  return /^<!doctype html>/i.test(content)
    || /^<html[\s>]/i.test(content)
    || /<head[\s>]|<body[\s>]|<main[\s>]|<section[\s>]/i.test(content);
}

function ensureCompleteHtml(content: string): string {
  let normalized = content.trim();

  if (!/^<!doctype html>/i.test(normalized)) {
    if (!/^<html[\s>]/i.test(normalized)) {
      normalized = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n</head>\n<body>\n${normalized}\n</body>\n</html>`;
    } else {
      normalized = `<!DOCTYPE html>\n${normalized}`;
    }
  }

  return autoCloseUnclosedTags(normalized);
}

export function autoCloseUnclosedTags(input: string): string {
  const selfClosing = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][\w-]*)[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(input)) !== null) {
    const token = match[0];
    const tag = match[1].toLowerCase();
    const isClosing = token.startsWith('</');
    const isSelfClosing = token.endsWith('/>') || selfClosing.has(tag);

    if (isSelfClosing) {
      continue;
    }

    if (isClosing) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) {
        stack.splice(idx, 1);
      }
      continue;
    }

    stack.push(tag);
  }

  let output = input;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    output += `</${stack[i]}>`;
  }

  return output;
}

function extractAll(regex: RegExp, input: string): string[] {
  const clone = new RegExp(regex.source, regex.flags);
  const result: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = clone.exec(input)) !== null) {
    if (match[1]?.trim()) {
      result.push(match[1].trim());
    }
  }

  return result;
}
