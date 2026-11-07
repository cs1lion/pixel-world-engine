/**
 * `palette-data.ts` 的 token 解析：解析不出的条目**不许静默丢弃**。
 *
 * 旧实现只把能匹配 `name: 0xRRGGBB` / `name: WORLD.x` 的行收进 tokens，
 * 其余行 `continue` 掉；别名指向不存在的槽也会因为 `hex === null` 被
 * `filter` 掉。结果是「调色板里有 24 色」这句话永远成立——哪怕某一行
 * 被写成 `'#4e6241'`（形状漂移）或指向了不存在的 `WORLD.ghost`。
 *
 * 现在返回 `{ tokens, dropped }`：`dropped` 逐条给出符号名、原始值、原因。
 * 位置用符号名（`WORLD.moss`），不用行号——行号会随编辑漂。
 */

/** 参与解析的顶层对象。 */
export const PALETTE_OBJECTS = ['WORLD', 'TERRAIN_COLORS', 'TERRAIN_SPECK'];

export function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

export function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      if (line.includes('://')) return line;
      const index = line.indexOf('//');
      return index >= 0 ? line.slice(0, index) : line;
    })
    .join('\n');
}

export function normalizeHex(raw, digits) {
  const value = raw.toLowerCase();
  if (digits === 3) return `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
  return `#${value}`;
}

/** 合法 token 行：`name: 0xRRGGBB,` 或 `name: WORLD.x,`（允许行尾逗号）。 */
const TOKEN_LINE_RE = /^\s*([a-zA-Z0-9_]+)\s*:\s*(0x[0-9a-fA-F]{6}|(?:WORLD|UI)\.[a-zA-Z0-9_]+)\s*,?\s*$/;

/** 长得像 token 定义的行（`name:` 或 `name =`），用来把「形状漂移」认出来。
 *  行尾 `\r` 也算行终止符：`.$` 在 CRLF 文件上匹配不到，必须显式排掉。 */
const CANDIDATE_LINE_RE = /^\s*([a-zA-Z0-9_]+)\s*[:=]\s*(\S[^\r\n]*?)\s*$/;

/**
 * @param {string} source `palette-data.ts` 原文
 * @param {{ file?: string }} [options]
 * @returns {{
 *   tokens: Array<{ object: string, name: string, fullName: string, raw: string, hex: string, aliasOf: string | null, file: string, line: number }>,
 *   dropped: Array<{ object: string, name: string | null, fullName: string, raw: string, reason: string, file: string }>,
 * }}
 */
export function parsePaletteTokens(source, { file = 'palette-data.ts' } = {}) {
  const text = stripLineComments(stripBlockComments(source));
  const tokens = [];
  const dropped = [];

  for (const objectName of PALETTE_OBJECTS) {
    const startMatch = new RegExp(`export const ${objectName}\\s*=\\s*\\{`).exec(text);
    if (startMatch === null) {
      dropped.push({
        object: objectName,
        name: null,
        fullName: objectName,
        raw: '',
        reason: `找不到 \`export const ${objectName} = {\` 块定义`,
        file,
      });
      continue;
    }
    const start = startMatch.index + startMatch[0].length;
    let depth = 1;
    let end = start;
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth += 1;
      if (text[end] === '}') depth -= 1;
      end += 1;
    }
    const block = text.slice(start, end - 1);
    const lineOffset = text.slice(0, start).split('\n').length;
    for (const [index, line] of block.split('\n').entries()) {
      const strict = TOKEN_LINE_RE.exec(line);
      if (strict !== null) {
        tokens.push({
          object: objectName,
          name: strict[1],
          fullName: `${objectName}.${strict[1]}`,
          raw: strict[2],
          hex: strict[2].startsWith('0x') ? normalizeHex(strict[2].slice(2), 6) : null,
          aliasOf: strict[2].includes('.') ? strict[2] : null,
          file,
          line: lineOffset + index,
        });
        continue;
      }
      const candidate = CANDIDATE_LINE_RE.exec(line);
      if (candidate !== null) {
        dropped.push({
          object: objectName,
          name: candidate[1],
          fullName: `${objectName}.${candidate[1]}`,
          raw: candidate[2].trim(),
          reason: '形状不符：期望 `name: 0xRRGGBB` 或 `name: WORLD.x`',
          file,
        });
      }
    }
  }

  const byFullName = new Map(tokens.map((token) => [token.fullName, token]));
  const kept = [];
  for (const token of tokens) {
    if (token.aliasOf === null) {
      kept.push(token);
      continue;
    }
    const target = byFullName.get(token.aliasOf);
    if (target === undefined) {
      dropped.push({
        object: token.object,
        name: token.name,
        fullName: token.fullName,
        raw: token.raw,
        reason: `别名指向不存在的 token：${token.aliasOf}`,
        file: token.file,
      });
      continue;
    }
    token.hex = target.hex;
    kept.push(token);
  }

  return { tokens: kept, dropped };
}
