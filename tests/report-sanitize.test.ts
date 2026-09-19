import { describe, it, expect } from 'vitest'
import { sanitizeNarrative, validateNarrative } from '@/lib/report-sanitize'

// ---------------------------------------------------------------------------
// PURE 清洗器：把 LLM 起草叙述里的「杂鱼信息」（会话式前后缀、Markdown 残留、
// 代码围栏、多余空行）在出口侧剥掉。核心不变式：对已经干净的中文叙述必须是 no-op，
// 否则会打破 report.test.ts 对 narrative 的精确等值断言。保守策略：只剥高置信杂鱼。
// ---------------------------------------------------------------------------

describe('sanitizeNarrative — 干净叙述零改动 (no-op invariant)', () => {
  it('单段纯文本原样返回', () => {
    expect(sanitizeNarrative('小明表现稳定。')).toBe('小明表现稳定。')
  })
  it('单换行分句的叙述原样保留（PDF 靠 \\n 分段，不可破坏）', () => {
    const clean = '小明本月表现稳定，出勤良好。\n课堂参与积极，值得表扬。'
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
  it('空行分段的多段叙述原样保留', () => {
    const clean = '第一段：小明出勤稳定。\n\n第二段：课堂参与积极。\n\n第三段：继续加油。'
    // 注意：首段以中文冒号结尾但含实质内容，且是"第一段：..."，不应被当作前缀剥掉
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
  it('合法括号/破折号内容不误删', () => {
    const clean = '小明（本月新入班）适应良好——尤其在数学方面进步显著。'
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
  it('行首合法数字（年份）不被当作有序列表', () => {
    const clean = '2024 年以来，小明的学习态度持续改善。'
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
  it('含"无法"等词但为长叙述时不受影响', () => {
    const clean =
      '小明本月在部分难题上暂时无法独立完成，但通过反复练习已有明显进步，学习信心也在逐步建立，值得肯定。'
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
})

describe('sanitizeNarrative — 剥离代码围栏', () => {
  it('整体被 ``` 包裹时解包', () => {
    expect(sanitizeNarrative('```\n小明表现稳定。\n```')).toBe('小明表现稳定。')
  })
  it('带语言标注的围栏也解包', () => {
    expect(sanitizeNarrative('```markdown\n小明表现稳定。\n课堂积极。\n```')).toBe(
      '小明表现稳定。\n课堂积极。',
    )
  })
})

describe('sanitizeNarrative — 剥离 Markdown 标记（保留文字）', () => {
  it('剥离 ATX 标题标记', () => {
    expect(sanitizeNarrative('## 总体表现\n小明表现稳定。')).toBe('总体表现\n小明表现稳定。')
  })
  it('剥离加粗 **', () => {
    expect(sanitizeNarrative('小明**表现稳定**，值得表扬。')).toBe('小明表现稳定，值得表扬。')
  })
  it('剥离下划线加粗 __', () => {
    expect(sanitizeNarrative('小明__表现稳定__，值得表扬。')).toBe('小明表现稳定，值得表扬。')
  })
  it('剥离斜体 *', () => {
    expect(sanitizeNarrative('小明*表现稳定*，值得表扬。')).toBe('小明表现稳定，值得表扬。')
  })
  it('剥离无序列表标记', () => {
    expect(sanitizeNarrative('- 出勤良好\n- 成绩稳定')).toBe('出勤良好\n成绩稳定')
  })
  it('剥离有序列表标记', () => {
    expect(sanitizeNarrative('1. 出勤良好\n2. 成绩稳定')).toBe('出勤良好\n成绩稳定')
  })
  it('剥离引用块标记', () => {
    expect(sanitizeNarrative('> 小明表现稳定。')).toBe('小明表现稳定。')
  })
  it('剥离行内代码反引号', () => {
    expect(sanitizeNarrative('本月成绩为 `85` 分。')).toBe('本月成绩为 85 分。')
  })
  it('剥离链接语法保留文字', () => {
    expect(sanitizeNarrative('详见 [课堂记录](https://x.com/n)。')).toBe('详见 课堂记录。')
  })
  it('丢弃水平分割线（转为段落分隔）', () => {
    expect(sanitizeNarrative('小明表现稳定。\n---\n课堂积极。')).toBe(
      '小明表现稳定。\n\n课堂积极。',
    )
  })
})

describe('sanitizeNarrative — 剥离会话式前缀', () => {
  it('剥离"好的，以下是……报告："冒号结尾前缀行', () => {
    expect(sanitizeNarrative('好的，以下是为小明起草的进度报告：\n小明表现稳定。')).toBe(
      '小明表现稳定。',
    )
  })
  it('剥离独立成段的"以下是报告："前缀', () => {
    expect(sanitizeNarrative('以下是报告：\n\n小明表现稳定。')).toBe('小明表现稳定。')
  })
  it('剥离纯应答"好的。"开头', () => {
    expect(sanitizeNarrative('好的。\n小明表现稳定。')).toBe('小明表现稳定。')
  })
})

describe('sanitizeNarrative — 剥离会话式后缀（面向审阅者的元信息）', () => {
  it('剥离"希望这份报告对您有帮助"结尾', () => {
    expect(
      sanitizeNarrative('小明表现稳定。\n\n希望这份报告对您有所帮助，如需修改请告诉我。'),
    ).toBe('小明表现稳定。')
  })
  it('剥离"以上是报告草稿，请审阅"结尾', () => {
    expect(sanitizeNarrative('小明表现稳定。\n\n以上是本月报告草稿，请审阅。')).toBe(
      '小明表现稳定。',
    )
  })
  it('保留面向家长的合法结尾（如有疑问请联系）', () => {
    const clean = '小明表现稳定。\n如有疑问，请随时与我联系。'
    expect(sanitizeNarrative(clean)).toBe(clean)
  })
})

describe('sanitizeNarrative — 空白规整', () => {
  it('折叠多余空行为至多一个空段', () => {
    expect(sanitizeNarrative('小明表现稳定。\n\n\n\n课堂积极。')).toBe(
      '小明表现稳定。\n\n课堂积极。',
    )
  })
  it('去除首尾空白与行尾空格', () => {
    expect(sanitizeNarrative('\n\n  小明表现稳定。   \n课堂积极。  \n\n')).toBe(
      '小明表现稳定。\n课堂积极。',
    )
  })
})

describe('sanitizeNarrative — 组合杂鱼', () => {
  it('前缀+标题+加粗+列表+后缀 一次剥净', () => {
    const junk = [
      '好的，以下是报告：',
      '',
      '## 总体表现',
      '',
      '小明**表现稳定**，出勤良好。',
      '',
      '- 课堂积极',
      '',
      '希望这份报告对您有帮助。',
    ].join('\n')
    expect(sanitizeNarrative(junk)).toBe('总体表现\n\n小明表现稳定，出勤良好。\n\n课堂积极')
  })
  it('幂等：清洗结果再清洗不变', () => {
    const junk = '```\n好的，以下是报告：\n\n小明**表现稳定**。\n\n如需修改请告诉我。\n```'
    const once = sanitizeNarrative(junk)
    expect(sanitizeNarrative(once)).toBe(once)
  })
})

describe('sanitizeNarrative — 审查加固回归（零误伤优先）', () => {
  it('HIGH-1: 不误删面向家长、谈论学生后续计划的合法结尾', () => {
    const a = '小明本月表现稳定。\n如需为孩子调整学习计划，请随时联系老师。'
    expect(sanitizeNarrative(a)).toBe(a)
    const b = '小明阅读进步明显。\n如需补充课外阅读材料，欢迎联系老师。'
    expect(sanitizeNarrative(b)).toBe(b)
    const c = '小明本月表现稳定。\n以上内容如有不清楚的地方，请查阅课堂笔记。'
    expect(sanitizeNarrative(c)).toBe(c)
  })
  it('HIGH-2: 嵌套加粗+斜体剥净且幂等', () => {
    const out = sanitizeNarrative('小明**本月*格外*努力**，进步显著。')
    expect(out).toBe('小明本月格外努力，进步显著。')
    expect(sanitizeNarrative(out)).toBe(out) // 幂等
  })
  it('HIGH-3: 连续多行会话式前缀一次剥净', () => {
    expect(sanitizeNarrative('好的。\n以下是报告：\n\n小明表现稳定。')).toBe('小明表现稳定。')
  })
  it('MEDIUM-4: 不把乘号 5*3 粘成 53', () => {
    const s = '练习中 5*3=15，以及 2*4=8 都算对了。'
    expect(sanitizeNarrative(s)).toBe(s)
  })
  it('MEDIUM-5: 行首 > 比较符不被当作引用块删除', () => {
    const s = '>90分的学生占多数，小明也在其中。'
    expect(sanitizeNarrative(s)).toBe(s)
  })
})

describe('sanitizeNarrative — 边界', () => {
  it('空字符串返回空', () => {
    expect(sanitizeNarrative('')).toBe('')
  })
  it('纯空白返回空', () => {
    expect(sanitizeNarrative('   \n  \n')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// validateNarrative：出口侧兜底，空/拒答直接抛错，避免把垃圾草稿静默落库。
// ---------------------------------------------------------------------------
describe('validateNarrative', () => {
  it('正常叙述不抛错', () => {
    expect(() => validateNarrative('小明表现稳定。')).not.toThrow()
  })
  it('空叙述抛"空叙述"', () => {
    expect(() => validateNarrative('')).toThrow(/空叙述/)
    expect(() => validateNarrative('   ')).toThrow(/空叙述/)
  })
  it('短拒答抛"拒绝"', () => {
    expect(() => validateNarrative('抱歉，我无法完成这个请求。')).toThrow(/拒绝/)
  })
  it('英文拒答抛"拒绝"', () => {
    expect(() => validateNarrative('Sorry, I cannot help with that.')).toThrow(/拒绝/)
  })
  it('含"无法"的长叙述不误判为拒答', () => {
    const long =
      '小明本月在部分难题上暂时无法独立完成，但通过反复练习已有明显进步，学习信心也在逐步建立，值得肯定。'
    expect(() => validateNarrative(long)).not.toThrow()
  })
})
