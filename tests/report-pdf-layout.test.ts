import { describe, it, expect } from 'vitest'
import {
  wrapCjkText,
  charWidthEm,
  isFullWidth,
  narrativeMaxWidthEm,
  A4_WIDTH_PT,
  REPORT_PAGE_PADDING,
  REPORT_BODY_FONT_SIZE,
} from '@/lib/report-pdf-layout'

// 每个字符统一计 1em —— 让折行结果完全可预测(maxWidthEm=N ⇒ 纯中文每行 N 字)。
const w1 = () => 1

const LONG =
  '小明本月整体表现稳定出勤情况良好课堂参与度高作业能够按时完成书写工整' +
  '思维活跃在数学与语文两门学科上均有明显进步尤其是在应用题的解题思路方面' +
  '展现出较强的逻辑推理能力建议在课后继续保持阅读习惯并加强对错题的复盘总结'

describe('字符分类与计宽', () => {
  it('isFullWidth 识别中文、全角标点、假名、谚文', () => {
    for (const ch of '小明，。！？（）《》…年ぁカ가') expect(isFullWidth(ch)).toBe(true)
  })
  it('isFullWidth 对 ASCII 字母/数字/半角标点返回 false', () => {
    for (const ch of 'aZ0 9,.()%') expect(isFullWidth(ch)).toBe(false)
  })
  it('charWidthEm:全角 1.0em,半角 0.9em(> Noto Sans SC ASCII 最大 0.889em,保证不溢出)', () => {
    expect(charWidthEm('小')).toBe(1.0)
    expect(charWidthEm('，')).toBe(1.0)
    expect(charWidthEm('A')).toBe(0.9)
    expect(charWidthEm('8')).toBe(0.9)
  })
})

describe('wrapCjkText 基本折行', () => {
  it('纯中文按宽度逐字折行,每行不超宽', () => {
    expect(wrapCjkText('小明本月表现稳定', 3, w1)).toEqual(['小明本', '月表现', '稳定'])
  })
  it('短文本只占一行', () => {
    expect(wrapCjkText('小明表现稳定。', 46, w1)).toEqual(['小明表现稳定。'])
  })
  it('空串返回空数组', () => {
    expect(wrapCjkText('', 46)).toEqual([])
  })
  it('绝不插入连字符:无空格输入按行拼接后与原文逐字节一致', () => {
    const lines = wrapCjkText(LONG, 20, w1)
    expect(lines.join('')).toBe(LONG)
    expect(lines.join('')).not.toContain('-')
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20)
  })
})

describe('wrapCjkText 禁则(避头尾)', () => {
  it('行首禁则:收尾标点绝不落在行首(粘连到前一字)', () => {
    // 朴素逐字在宽度 3 处会得到 ['你好世','，界'] —— “，”落到行首;禁则应避免。
    const lines = wrapCjkText('你好世，界', 3, w1)
    expect(lines).toEqual(['你好', '世，界'])
    for (const l of lines) expect('，。、！？；：）'.includes(l[0]!)).toBe(false)
  })
  it('行尾禁则:起始标点绝不落在行尾(粘连到后一字)', () => {
    // 朴素逐字在宽度 3 处会得到 ['你好（','世界'] —— “（”落到行尾;禁则应避免。
    const lines = wrapCjkText('你好（世界', 3, w1)
    expect(lines).toEqual(['你好', '（世界'])
    for (const l of lines) expect('（《「【'.includes(l[l.length - 1]!)).toBe(false)
  })
})

describe('wrapCjkText 拉丁词与空格', () => {
  // 全角 1em、半角(ASCII)0.5em 的度量,便于观察整词不拆。
  const wMix = (ch: string) => (isFullWidth(ch) ? 1 : 0.5)

  it('拉丁词整体不拆,必要时整块移到下一行', () => {
    const lines = wrapCjkText('报告GPA成绩', 2, wMix)
    // 'GPA'(1.5em)放不下当前行时整块换行,且始终完整出现在某一行。
    expect(lines.some((l) => l.includes('GPA'))).toBe(true)
    expect(lines.every((l) => !/G$|^PA|GP$|^A(?!$)/.test(l) || l.includes('GPA'))).toBe(true)
    expect(lines.join('').replace(/\s/g, '')).toBe('报告GPA成绩')
  })
  it('空格是可丢弃断点:折行处不残留行尾空格', () => {
    const lines = wrapCjkText('abc def ghi', 4, wMix)
    for (const l of lines) expect(l).toBe(l.replace(/\s+$/, ''))
  })
  it('超长且无空格的串会被硬切成不超宽的多段', () => {
    const lines = wrapCjkText('abcdefghij', 2, wMix) // 每字 0.5em ⇒ 每行至多 4 字
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(4)
    expect(lines.join('')).toBe('abcdefghij')
  })
})

describe('narrativeMaxWidthEm 与真实字体度量集成', () => {
  it('由 A4 宽与页边距、字号推导每行 em 宽', () => {
    const expected = (A4_WIDTH_PT - REPORT_PAGE_PADDING * 2) / REPORT_BODY_FONT_SIZE - 0.3
    expect(narrativeMaxWidthEm()).toBeCloseTo(expected, 5)
    expect(narrativeMaxWidthEm()).toBeGreaterThan(46) // ≈ 46.55
    expect(narrativeMaxWidthEm()).toBeLessThan(47)
  })
  it('用默认(全/半角)度量折长中文:多行,每行计宽不超上限,内容零增删', () => {
    const max = narrativeMaxWidthEm()
    const lines = wrapCjkText(LONG, max) // 默认 charWidthEm
    expect(lines.length).toBeGreaterThan(1)
    // 纯中文:每行恰 46 字(46em ≤ 46.55 < 47em)。
    expect(lines[0]!.length).toBe(46)
    for (const l of lines) {
      const width = Array.from(l).reduce((s, ch) => s + charWidthEm(ch), 0)
      expect(width).toBeLessThanOrEqual(max)
    }
    expect(lines.join('')).toBe(LONG) // 无连字符、无丢字
  })
})

describe('审查回归:计宽上界、禁则边界、内容保真', () => {
  it('#1 非 ASCII 符号(·℃‰§±×÷)按全角 1.0em 计,不再低估致溢出', () => {
    for (const ch of '·℃‰§±×÷') expect(charWidthEm(ch)).toBe(1.0)
  })
  it('#1 “·”密集的近满行不再溢出内容宽(复现审查用例)', () => {
    const narrative =
      '小明本次评估涉及的知识点包括：分数·小数·百分数·比例·方程·函数·统计·概率的综合运用，' +
      '课堂表现中规中矩，作业按时完成，建议继续保持每日阅读并加强复习巩固。'
    const max = narrativeMaxWidthEm()
    for (const l of wrapCjkText(narrative, max)) {
      const width = Array.from(l).reduce((s, ch) => s + charWidthEm(ch), 0)
      expect(width).toBeLessThanOrEqual(max)
    }
  })
  it('#4 增补平面 CJK(扩展B生僻字)识别为全角且计 1.0em', () => {
    const ch = String.fromCodePoint(0x20000)
    expect(isFullWidth(ch)).toBe(true)
    expect(charWidthEm(ch)).toBe(1.0)
  })
  it('#3 全角空格 U+3000(段首缩进)被保留,内容零丢失', () => {
    const text = '　　小明本月表现稳定,建议继续保持。'
    expect(wrapCjkText(text, 46).join('')).toBe(text)
  })
  it('#2 相邻起始类标点(“（)绝不落在行尾', () => {
    const lines = wrapCjkText('你好“（重点）”说明', 4, w1)
    for (const l of lines) expect('（《「【〈『〔“‘([{'.includes(l[l.length - 1]!)).toBe(false)
  })
  it('#2 开括号后紧跟空格时仍不落在行尾', () => {
    const lines = wrapCjkText('你好（ 世界', 3, w1)
    for (const l of lines) expect(l[l.length - 1]).not.toBe('（')
  })
})
