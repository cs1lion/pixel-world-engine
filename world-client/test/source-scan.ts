/**
 * 扫源码的公共手法。
 *
 * 这些测试查的是「代码里有没有出现某个词」，不是「文件里有没有」——
 * 注释里提一句「旧接口曾经叫 commissions」是解释历史，不算把词汇接回来。
 * 所以都要先把注释行剔掉再看。
 *
 * 剔注释的这一行从前在 `purity.test.ts` 里照抄了三遍。三遍都一样的东西，
 * 改一处漏两处是必然的——而漏掉的表现是某条扫描悄悄失效，测试照绿。
 */

import { readFileSync } from 'node:fs';

/** 注释行：双斜杠、块注释的续行（以星号开头）、以及块注释自己那一行。 */
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/**
 * 读一个文件，只留代码行。
 *
 * 按**行**剔，不做真正的词法分析：块注释中间的内容照剔（以星号开头），
 * 而一行之内写完的块注释，它的后半段会留下来。扫的都是整词，
 * 注释尾巴里恰好写出一个禁词的可能，比这种做法漏掉的风险更低。
 */
export function codeOf(path: URL | string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !COMMENT_LINE.test(line))
    .join('\n');
}
