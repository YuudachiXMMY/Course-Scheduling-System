// PDF 教师评语的 CJK 换行器(纯逻辑,可独立单测;不引入 @react-pdf 或 server-only)。
//
// 为什么需要它:@react-pdf/renderer 的 textkit 只在两种位置断行——ASCII 空格(glue,
// 无连字符)或 hyphenation 音节点(penalty,会强制插入可见的 '-' 字形)。它没有任何
// CJK 原生断行。于是一段没有空格的长中文要么整行冲出页面(“单行超出页面”),要么在混排
// 的少数空格处被迫提前折行(“提前换行”)。而用逐字 hyphenation 回调虽能折行,却会在每个
// 中文字之间插入连字符(实测:`两门-` / `阅读-`),对正式报告不可接受。
//
// 因此这里用嵌入字体(Noto Sans SC)的字符宽度自行把叙述预折成每行都不超过内容宽度的
// 硬行,再交给 @react-pdf 渲染——react-pdf 侧无需二次折行,故既不溢出也不插连字符。

/** A4 纸尺寸(pt),与 @react-pdf 内置 A4 = [595.28, 841.89] 一致;作为 <Page size> 的单一来源。 */
export const A4_WIDTH_PT = 595.28
export const A4_HEIGHT_PT = 841.89
/** 报告页四周内边距(pt),与 styles.page.padding 一致。 */
export const REPORT_PAGE_PADDING = 40
/** 正文字号(pt),与 styles.page.fontSize 一致。1em = 该字号 pt。 */
export const REPORT_BODY_FONT_SIZE = 11

// Noto Sans SC 实测:CJK 表意字与全角标点 advance 恰为 1.0em;ASCII 区段(≤ U+007F)最宽
// 的 'm' 也仅 0.889em。但 `·`(U+00B7)`℃``‰``§``±``×`等非 ASCII 符号在本字体里同为 1.0em,
// 若只按“是否全角”二分会把它们误计为窄字而低估宽度、进而溢出。故采用保守二分:唯 ASCII 计
// 0.9em(> 0.889 的安全上界),其余一律计 1.0em —— 对 CJK/全角/上述符号/增补平面生僻字都精确
// 或安全高估,保证任何输入下计宽都 ≥ 真实 advance,绝不溢出。
const FULL_WIDTH_EM = 1.0
const HALF_WIDTH_EM = 0.9

// East Asian Wide/Fullwidth:表意字、假名、谚文、CJK 标点、全角符号等,在等宽 CJK 字体
// 中 advance 均为 1em。覆盖常见区段即可(叙述几乎只含中文与偶发 ASCII)。
const FULL_WIDTH_RE =
  /[‐-‧ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** 该字符是否为全角(East Asian Wide/Fullwidth)。 */
export function isFullWidth(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0
  // 增补平面 CJK 表意字扩展 B–F(生僻姓名/古籍字),在 CJK 字体中同为全角(BMP 正则覆盖不到)。
  if (cp >= 0x20000 && cp <= 0x3ffff) return true
  return FULL_WIDTH_RE.test(ch)
}

// 行首禁则:这些收尾类标点不得出现在行首,需粘连到前一个单元的行尾。
const NO_LINE_START = new Set(
  Array.from('、。，．！？；：）〕〉》」』】〟”’…‥・ー々〆〜～%‰°℃!?,.:;)]}'),
)
// 行尾禁则:这些起始类标点不得落在行尾,需粘连到后一个单元的行首。
const NO_LINE_END = new Set(Array.from('（〔〈《「『【〖〘“‘([{'))

/** 单个字符的宽度(em)。唯 ASCII 计半角,其余(CJK/全角/符号/生僻字)保守计全角,确保不低估。 */
export function charWidthEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  return cp <= 0x7f ? HALF_WIDTH_EM : FULL_WIDTH_EM
}

type Atom = { s: string; space: boolean }

const isSingleChar = (s: string): boolean => Array.from(s).length === 1

// 把段落切成“不可断单元”:每个全角字符自成一个单元;连续的非全角非空白字符(拉丁词、
// 数字、ASCII 标点)合为一个单元(整词不拆);仅 ASCII 空格/制表符是可丢弃的断点(全角空格
// U+3000 作段首缩进,按全角字符保留而非丢弃)。随后按禁则把行首/行尾禁则标点粘连到相邻单元,
// 避免标点落在行首或行尾。
function atomize(text: string): Atom[] {
  const raw: Atom[] = []
  let word = ''
  const flush = () => {
    if (word) {
      raw.push({ s: word, space: false })
      word = ''
    }
  }
  for (const ch of text) {
    if (ch === ' ' || ch === '\t') {
      flush()
      raw.push({ s: ' ', space: true })
    } else if (isFullWidth(ch)) {
      flush()
      raw.push({ s: ch, space: false })
    } else {
      word += ch
    }
  }
  flush()

  // pendingOpen:挂起的“起始类”标点(如 （「“),等待粘到其后的第一个内容单元的行首——
  // 这样即便多个开括号相邻(“（)或其后跟空格,也绝不会被单独断到行尾。
  const merged: Atom[] = []
  let pendingOpen = ''
  for (const atom of raw) {
    if (atom.space) {
      if (pendingOpen) continue // 开括号与后文之间的空格丢弃,让开括号紧贴后文
      merged.push(atom)
      continue
    }
    const single = isSingleChar(atom.s)
    // 行首禁则:收尾标点粘到前一个真实单元的行尾。
    if (single && NO_LINE_START.has(atom.s) && !pendingOpen) {
      const prev = merged[merged.length - 1]
      if (prev && !prev.space) {
        prev.s += atom.s
        continue
      }
    }
    // 行尾禁则:起始标点挂起,等待粘到后文行首(可累积多个相邻开括号)。
    if (single && NO_LINE_END.has(atom.s)) {
      pendingOpen += atom.s
      continue
    }
    merged.push({ s: pendingOpen + atom.s, space: false })
    pendingOpen = ''
  }
  if (pendingOpen) merged.push({ s: pendingOpen, space: false }) // 结尾孤立的开括号
  return merged
}

function unitWidth(s: string, widthOf: (ch: string) => number): number {
  let w = 0
  for (const ch of s) w += widthOf(ch)
  return w
}

// 把宽度本身就超过一行的单元(如超长英文串)按字符硬切成多段,每段都 ≤ maxWidthEm。
function splitOversized(s: string, maxWidthEm: number, widthOf: (ch: string) => number): string[] {
  const chunks: string[] = []
  let cur = ''
  let curW = 0
  for (const ch of s) {
    const w = widthOf(ch)
    if (cur !== '' && curW + w > maxWidthEm) {
      chunks.push(cur)
      cur = ''
      curW = 0
    }
    cur += ch
    curW += w
  }
  if (cur) chunks.push(cur)
  return chunks
}

/**
 * 把一段文本按内容宽度(em)预折成若干硬行:CJK 逐字断行、拉丁词整体不拆、空格为可丢弃
 * 断点、行首/行尾禁则标点粘连相邻字符。每行的计宽都不超过 maxWidthEm。
 *
 * @param text       段落文本(不含换行)。
 * @param maxWidthEm 每行可用宽度(em)。
 * @param widthOf    单字符计宽(em),默认 {@link charWidthEm}。可注入以便测试。
 */
export function wrapCjkText(
  text: string,
  maxWidthEm: number,
  widthOf: (ch: string) => number = charWidthEm,
): string[] {
  if (!text) return []
  if (!(maxWidthEm > 0)) return [text]

  const atoms = atomize(text)
  const lines: string[] = []
  let cur = ''
  let curW = 0
  const pushLine = () => {
    const line = cur.replace(/\s+$/, '') // 丢弃行尾空格
    if (line !== '') lines.push(line)
    cur = ''
    curW = 0
  }

  for (const atom of atoms) {
    const w = unitWidth(atom.s, widthOf)
    if (atom.space) {
      if (cur === '') continue // 不以空格起行
      if (curW + w > maxWidthEm) {
        pushLine() // 空格处断行,空格被丢弃
        continue
      }
      cur += atom.s
      curW += w
      continue
    }
    // 需要在该单元前断行?
    if (cur !== '' && curW + w > maxWidthEm) pushLine()
    // 单元自身超过一行:硬切。
    if (w > maxWidthEm) {
      const chunks = splitOversized(atom.s, maxWidthEm, widthOf)
      for (let i = 0; i < chunks.length - 1; i++) {
        cur = chunks[i]!
        pushLine()
      }
      const tail = chunks[chunks.length - 1]!
      cur = tail
      curW = unitWidth(tail, widthOf)
      continue
    }
    cur += atom.s
    curW += w
  }
  pushLine()
  return lines.length ? lines : ['']
}

/** 教师评语的每行可用宽度(em)= 内容宽度(pt) / 正文字号(pt)。 */
export function narrativeMaxWidthEm(): number {
  const contentWidthPt = A4_WIDTH_PT - REPORT_PAGE_PADDING * 2
  // 预留极小安全余量(约 0.3em),吸收浮点与 react-pdf 内部定位的亚像素差异。
  return contentWidthPt / REPORT_BODY_FONT_SIZE - 0.3
}
