// P9: PURE 出口侧清洗器 — 无 db / 无 server-only，直接可单测（镜像 report-stats.ts）。
// LLM 起草的叙述可能夹带「杂鱼信息」：会话式前后缀寒暄、Markdown 残留、代码围栏、多余空行。
// 这些既非事实也非叙述，进 PDF 只会显示成难看的 ** / # 字面量或多余客套。此模块在 draftNarrative
// 单一出口（以及教师保存时）把它们剥掉。
//
// 核心不变式：对「已经干净」的中文叙述必须是 no-op —— 否则会打破 report.test.ts 对 narrative 的
// 精确等值断言，也会惊扰教师的有意排版。因此采取【保守】策略：只剥高置信杂鱼，其余（重复数字、
// 编造事实等）交给 report-prompt 的 RUBRIC 规则约束。清洗必须幂等（清洗结果再清洗不变）。
//
// 反例守卫（经审查加固）：宁可漏剥，也不误删面向家长、谈论学生的正常正文——
//   · 会话式后缀必须明确提及「报告/叙述/草稿/评语」这一产物本身才判定，避免误删
//     「如需为孩子调整学习计划，请联系老师」这类合法结尾；
//   · 引用块要求 > 后带空白，避免把「>90 分」的比较符当成 Markdown；
//   · 单个 * 仅在成对包裹「非数字开头」内容时才去除，避免把「5*3」粘成「53」。

// 判定用的长度上限 / 探测窗口（集中命名，便于日后调参与审查）。
const MAX_PREAMBLE_LEN = 50 // 前缀行最长字数（超过即视为正文，不剥）
const MAX_SIGNOFF_LEN = 40 // 后缀行最长字数（正文结尾往往更长，故更紧）
const MAX_META_STRIP_ITERS = 5 // 前/后缀循环剥离的轮数上限（防止病态输入无限循环）
const REFUSAL_MAX_LEN = 40 // 仅在短文本上判拒答，避免误伤正文里含「无法」的长叙述

// 拒答/空输出探测：仅在【短】文本上触发。
const REFUSAL_RE =
  /(无法|抱歉|对不起|不能|难以)[^。.!！\n]{0,20}(完成|提供|生成|起草|协助|帮助|满足|处理|回答)|作为(一个|一名)?(AI|ai|人工智能|语言模型|大模型)[^。.!！\n]{0,10}(无法|不能|不便)|as an ai\b|i\s+(cannot|can'?t|am unable|apologize)\b/i

/** 首行若是会话式前缀（应答语 或 以冒号收尾并指向"报告/以下……"的引导语），视为杂鱼。 */
function isPreambleLine(line: string): boolean {
  const l = line.trim()
  if (l.length === 0 || l.length > MAX_PREAMBLE_LEN) return false
  // 引导语：以中/英冒号结尾，且提及报告/叙述/以下/为某某起草等
  if (
    /[:：]\s*$/.test(l) &&
    /(以下|如下|这是|下面|这份|报告|叙述|草稿|起草|撰写|为您|为.{1,8}(同学|学生|孩子))/.test(l)
  ) {
    return true
  }
  // 纯应答开场白
  if (/^(好的|好|没问题|当然(可以)?|明白了?|收到)[。.！!，,、]?$/.test(l)) return true
  return false
}

/**
 * 末行若是面向「审阅者/请求方」的元信息（关于这份报告草稿本身，而非面向家长的正文），视为杂鱼。
 * 关键约束：必须显式提及「报告/叙述/草稿/评语」——否则「如需为孩子调整计划，请联系老师」这类合法
 * 家长向结尾会被误删（HIGH bug）。
 */
function isSignoffLine(line: string): boolean {
  const l = line.trim()
  if (l.length === 0 || l.length > MAX_SIGNOFF_LEN) return false
  if (!/(报告|叙述|草稿|评语)/.test(l)) return false
  return /希望[^。.!！\n]{0,12}(帮助|有用|参考|满意)|请[^。.!！\n]{0,4}(审阅|审核|过目|指正|查阅|审查)|供[^。.!！\n]{0,4}参考|如需[^。.!！\n]{0,8}(修改|调整|完善|补充|变动|更改)/.test(
    l,
  )
}

// P10: 推理模型（MiniMax-M3 等）把整段思维链以 <think>…</think> 内联在 content 字段返回
// （reasoning_content 常为 null，无法靠字段分离），若不剥离，英文 chain-of-thought 会被当作叙述
// 落库、渲染进家长看到的 PDF——这正是「杂鱼信息(ai prompts/thinking)」的主要来源。此处在出口侧
// 统一剥净，覆盖所有 provider。正常中文正文绝不会出现字面量 <think>，故对干净叙述为 no-op。
const REASONING_TAGS = 'think|thinking|reasoning'
function stripReasoning(text: string): string {
  return (
    text
      // 1. 成对块 <think …>…</think>（惰性匹配、跨行、大小写不敏感、允许属性；backref 保证同名闭合）。
      .replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'), '')
      // 2. 剩余的未闭合开始标签（截断输出）：思维链是前缀，从该标签起到结尾全部丢弃。
      .replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i'), '')
      // 3. 孤立的结束标签。
      .replace(new RegExp(`<\\/(${REASONING_TAGS})>`, 'gi'), '')
  )
}

/** 去掉包裹整段输出的代码围栏，以及任何独立成行的 ``` 围栏行。 */
function stripCodeFences(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
}

export function sanitizeNarrative(raw: string): string {
  if (!raw) return ''
  let text = raw.replace(/\r\n?/g, '\n')

  // 0. 推理模型思维链 <think>…</think>：必须最先剥离，否则其内部的 Markdown/代码围栏会污染后续步骤。
  text = stripReasoning(text)

  // 1. 代码围栏。
  text = stripCodeFences(text)

  // 2. 逐行剥离块级 Markdown 标记（保留文字）。
  text = text
    .split('\n')
    .map((line) => {
      let l = line.replace(/[ \t]+$/, '') // 行尾空白
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) return '' // 水平分割线 → 空行
      l = l.replace(/^\s*>{1,3}[ \t]+/, '') // 引用块（> 后需空白，避免误删 >90 这类比较符）
      l = l.replace(/^\s{0,3}#{1,6}\s+/, '') // ATX 标题
      l = l.replace(/^\s{0,3}[-*+]\s+/, '') // 无序列表
      l = l.replace(/^\s{0,3}\d{1,2}[.)]\s+/, '') // 有序列表（1-2 位）
      return l
    })
    .join('\n')

  // 3. 行内 Markdown。** / __ 恒为 Markdown（中文正文不会出现连续两个），直接全局删除，天然处理
  //    嵌套外层（***word*** / **外*内*外**）；单个 * 与乘号易混，仅在成对包裹「非数字开头」内容时才
  //    去除，避免把「5*3」粘成「53」。
  text = text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/\*([^*\n\d][^*\n]*?)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, '$1')

  // 4. 会话式前缀 / 后缀：循环剥离（LLM 可能连写多行寒暄），每轮各剥至多一行，且必须留有其它正文。
  const lines = text.split('\n')
  const firstNonEmpty = () => lines.findIndex((l) => l.trim().length > 0)
  const lastNonEmpty = () => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim().length > 0) return i
    return -1
  }
  for (let iter = 0; iter < MAX_META_STRIP_ITERS; iter++) {
    const fi = firstNonEmpty()
    if (fi === -1 || !isPreambleLine(lines[fi])) break
    if (!lines.slice(fi + 1).some((l) => l.trim().length > 0)) break
    lines.splice(fi, 1)
  }
  for (let iter = 0; iter < MAX_META_STRIP_ITERS; iter++) {
    const li = lastNonEmpty()
    if (li === -1 || !isSignoffLine(lines[li])) break
    if (!lines.slice(0, li).some((l) => l.trim().length > 0)) break
    lines.splice(li, 1)
  }
  text = lines.join('\n')

  // 5. 空白规整：折叠 3+ 连续换行为一个空段；去首尾空白。段内单换行保留（PDF 靠它分段）。
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/**
 * 出口侧兜底校验：清洗后若为空或明显是拒答，直接抛错，避免把垃圾/空草稿静默落库。
 * 只对短文本判拒答，长叙述即便含「无法」也放行。
 */
export function validateNarrative(text: string): void {
  const t = (text ?? '').trim()
  if (t.length === 0) throw new Error('模型返回空叙述，报告起草失败，请稍后重试')
  if (t.length < REFUSAL_MAX_LEN && REFUSAL_RE.test(t)) {
    throw new Error('模型拒绝起草报告，请检查数据或稍后重试')
  }
}
