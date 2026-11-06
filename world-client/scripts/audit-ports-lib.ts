/**
 * 禁用端口判据的纯逻辑：先按语言去注释，再在「可执行文本」里找端口字面量。
 *
 * 注释里的人话（例如「5188 是别的 worktree」）不是运行时会用的端口，不能误报；
 * 字符串/模板串里的端口是真正会连过去的，必须报。
 */

export const BANNED_PORTS = [5188, 5191, 5202, 5203] as const;

export type CommentKind = 'js' | 'hash' | 'none';

export interface PortHit {
  line: number;
  port: number;
  text: string;
}

/**
 * JS/TS：去掉 `//` 与 `/* ... *\/`，但保留字符串与模板串内容。
 * 注释字符替换成空格，换行保留，保证行号不变。
 */
function stripJsComments(source: string): string {
  let out = '';
  let state: 'code' | 'single' | 'double' | 'template' | 'line' | 'block' = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      } else {
        out += ' ';
      }
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 1;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'single' || state === 'double') {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
        state = 'code';
      }
      continue;
    }
    if (state === 'template') {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '`') {
        state = 'code';
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line';
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block';
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
    else if (ch === '`') state = 'template';
    out += ch;
  }
  return out;
}

/** YAML / .env / shell：去掉引号外的 `#` 到行尾。 */
function stripHashComments(source: string): string {
  let out = '';
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += source[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      if (i < source.length) out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

export function stripComments(source: string, kind: CommentKind): string {
  if (kind === 'js') return stripJsComments(source);
  if (kind === 'hash') return stripHashComments(source);
  return source;
}

export function commentKindFor(file: string): CommentKind {
  const lower = file.toLowerCase();
  if (/\.(mjs|cjs|js|ts|mts|cts)$/.test(lower)) return 'js';
  if (/\.(yml|yaml|py|sh|ps1|toml|ini)$/.test(lower)) return 'hash';
  if (lower.split(/[\\/]/).pop()?.startsWith('.env')) return 'hash';
  return 'none';
}

const PORT_PATTERN = /\b(5188|5191|5202|5203)\b/g;

export function findBannedPorts(source: string, kind: CommentKind): PortHit[] {
  const text = stripComments(source, kind);
  const hits: PortHit[] = [];
  for (const match of text.matchAll(PORT_PATTERN)) {
    const index = match.index ?? 0;
    const line = text.slice(0, index).split(/\n/).length;
    hits.push({
      line,
      port: Number(match[1]),
      text: source.split(/\r?\n/)[line - 1]?.trim() ?? '',
    });
  }
  return hits;
}
