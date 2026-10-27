/**
 * 扫源码的公共手法。
 *
 * 这些测试查的是「代码里有没有出现某个词」，不是「文件里有没有」——
 * 注释里提一句「旧接口曾经叫 commissions」是解释历史，不算把词汇接回来。
 * 所以都要先把注释剔掉再看。
 *
 * 剔注释的这一行从前在 `purity.test.ts` 里照抄了三遍。三遍都一样的东西，
 * 改一处漏两处是必然的——而漏掉的表现是某条扫描悄悄失效，测试照绿。
 */

import { readFileSync } from 'node:fs';

/** 注释行：双斜杠、块注释的续行（以星号开头）、以及块注释自己那一行。 */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** 字符串字面量：单引号、双引号、模板串。不处理转义与嵌套，只为挖掉里面的内容。 */
const STRING_SPAN = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gs;

/** 一行之内写完的块注释。 */
const INLINE_BLOCK = /\/\*[\s\S]*?\*\//g;

/**
 * 把一个字符串字面量换成等长空白。
 *
 * 换空白而不是删掉：行里剩下的相对位置不变，而且「字符串里有个网址」不会
 * 被误当成行尾注释的起点。`http://…` 里的那两个斜杠曾经让按行切 `//` 的
 * 做法把半行代码一起切掉。
 */
function blankStrings(line: string): string {
  return line.replace(STRING_SPAN, (span) => ' '.repeat(span.length));
}

/**
 * 读一个文件，只留代码。
 *
 * 按**行**剔，不做真正的词法分析：
 *   - 整行都是注释的，整行剔掉（块注释续行以星号开头，一并剔掉）；
 *   - 一行之内写完的块注释，从 `/*` 挖到 `*\/`；
 *   - **行尾的 `//` 注释也挖掉**。这一条是补上的：从前只剔整行注释，于是
 *     `void whenApi; // 从前这里用 requestAnimationFrame` 会让「界面里不许
 *     出现 rAF」那条闸红——而那一行恰恰是在解释为什么不用它。误报一样毁掉
 *     一道闸，只是毁得慢一点。
 *
 * 已知边界（有意不假装补上）：`'request'+'AnimationFrame'` 这种拼出来的词
 * 扫不到。那是词级扫描的天花板，不是漏了一个正则——真要靠一道闸拦住它，
 * 得在构建期做标识符解析，那不属于一条测试的体量。所以只在这儿的注释里
 * 说清楚，别让读的人以为它拦得住。
 */
export function codeOf(path: URL | string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .map((line) => blankStrings(line).replace(INLINE_BLOCK, (span) => ' '.repeat(span.length)))
    // 字符串已经挖空，剩下的 `//` 只可能是行尾注释。
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}
