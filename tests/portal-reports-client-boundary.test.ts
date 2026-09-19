import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ── B2 回归（orch-review #45–#49，commit f29a988，CRITICAL） ──────────────────────────────────────────
//
// 被发现的击穿：portal/reports/reports-list.tsx 是 'use client'，却从 server-only 的 data.ts「值导入」
// WHOLE_SCHEDULE_KEY，把 postgres 驱动 / @auth 依赖链拖进客户端 bundle → next build 失败（server-only
// poison-pill + tls/net/fs 无法解析）。修复：抽出无 server 依赖的 constants.ts，客户端改从 constants 值
// 导入，data.ts 仅保留 `import type`。
//
// 为什么用「源码静态断言」而不是运行时导入：vitest 把 server-only 别名成空 stub、且在 Node 下导入客户端
// 组件根本不会复现「打包时把 server 链拉进 client」的错误 —— 只有真正的 next build 会。所以这里守的是
// bundle 边界的**结构不变量**：portal/reports 下任何 'use client' 模块都不得对其 server-only 兄弟 data.ts
// 建立「运行时依赖」（静态值导入，或 import()/require() 动态导入）；constants.ts 必须保持无 server 依赖。
// 它在毫秒级触发，是整跑 next build 之前的快速前哨。

const reportsDir = fileURLToPath(new URL('../src/app/portal/reports', import.meta.url))
const read = (rel: string) => readFileSync(path.join(reportsDir, rel), 'utf8')

const notesDir = fileURLToPath(new URL('../src/app/portal/notes', import.meta.url))
const readNote = (rel: string) => readFileSync(path.join(notesDir, rel), 'utf8')

// 字符级扫描去掉注释、但保留字符串（模块说明符要留着）。逐字符处理，避免把字符串里的 `//`、`/*` 当注释，
// 也避免把注释里描述性的 `import 'server-only'` / `from './data'` 文本当成真实代码（验证者实证的误伤）。
function stripComments(src: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const c2 = src[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += c2 ?? ''
        i++
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      continue
    }
    if (c === '/' && c2 === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && c2 === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i++ // 跳过 '*'，循环 i++ 再跳 '/'
      continue
    }
    out += c
  }
  return out
}

interface ParsedImport {
  spec: string // 模块说明符，如 './data'
  runtime: boolean // 是否带来运行时（值）绑定 —— true 会把该模块的依赖链打进当前 bundle
  raw: string // 语句原文（供断言 WHOLE_SCHEDULE_KEY 来源用）
}

// 枚举所有静态 `import ... from '...'`（含跨行花括号）。行首锚定；`(?!import)` 负向前瞻确保惰性匹配
// 不会跨越相邻 import（例如前面紧挨一条副作用 `import './x'` 时不会把两条并成一条）。副作用导入无 from，
// 不在此列（本测试对 ./data 的判断只关心「是否有运行时绑定」）。
function parseStaticImports(src: string): ParsedImport[] {
  const re = /^import\b((?:(?!\bimport\b)[\s\S])*?)\bfrom\s*['"]([^'"]+)['"]/gm
  return [...src.matchAll(re)].map((m) => {
    const clause = m[1].trim()
    return { spec: m[2], runtime: clauseHasRuntimeBinding(clause), raw: m[0] }
  })
}

// clause 是 `import` 与 `from` 之间的部分。`import type ...` 整条被 TS 擦除 → 无运行时绑定；
// 否则任何 default / namespace / 非 type 前缀的具名绑定都是运行时绑定。
function clauseHasRuntimeBinding(clause: string): boolean {
  if (/^type\b/.test(clause)) return false
  const beforeBrace = clause.split('{')[0].trim().replace(/,$/, '').trim()
  if (beforeBrace) return true // 默认导入 / `* as ns`
  const braced = clause.match(/\{([\s\S]*)\}/)
  if (!braced) return false
  return braced[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((name) => !/^type\b/.test(name)) // 存在非 type 具名绑定 → 运行时
}

// 动态运行时引用：import('<spec>') / require('<spec>')。这些同样把 <spec> 的依赖链打进 chunk，
// 因此对 server-only 的 ./data 而言，动态导入和静态值导入一样会造成 B2 击穿。
function dynamicRefs(src: string, spec: string): string[] {
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b(?:import|require)\\s*\\(\\s*['"]${esc}['"]`, 'g')
  return [...src.matchAll(re)].map((m) => m[0])
}

// 客户端模块：'use client' 或 "use client" 指令（去注释后位于文件开头）。
function isClientModule(src: string): boolean {
  return /^\s*['"]use client['"]/.test(stripComments(src).trimStart())
}

// 客户端对 server-only ./data 的所有运行时引用（静态值导入 + 动态导入），已去注释。
function runtimeDataRefs(rawSrc: string): string[] {
  const src = stripComments(rawSrc)
  const staticLeaks = parseStaticImports(src)
    .filter((i) => i.spec === './data' && i.runtime)
    .map((i) => i.raw)
  return [...staticLeaks, ...dynamicRefs(src, './data')]
}

const clientTsxFiles = readdirSync(reportsDir).filter(
  (f) => f.endsWith('.tsx') && isClientModule(read(f)),
)

describe('B2 回归 — portal/reports 客户端 / 服务端 bundle 边界', () => {
  it("reports-list.tsx 存在且是 'use client' 组件（守卫的锚点）", () => {
    expect(clientTsxFiles).toContain('reports-list.tsx')
  })

  it("任何 'use client' 模块都不得对 server-only 的 ./data 建立运行时依赖（静态值导入或动态 import/require）", () => {
    for (const file of clientTsxFiles) {
      expect(
        runtimeDataRefs(read(file)),
        `${file} 对 server-only ./data 建立了运行时依赖 → 会把 postgres/@auth 链打进 client bundle（B2 击穿）`,
      ).toEqual([])
    }
  })

  it('WHOLE_SCHEDULE_KEY 从无 server 依赖的 ./constants 值导入，而非 ./data', () => {
    const imports = parseStaticImports(stripComments(read('reports-list.tsx')))
    const fromConstants = imports.find(
      (i) => i.spec === './constants' && /\bWHOLE_SCHEDULE_KEY\b/.test(i.raw),
    )
    expect(
      fromConstants,
      'reports-list.tsx 应从 ./constants 值导入 WHOLE_SCHEDULE_KEY',
    ).toBeTruthy()
    const fromData = imports.find(
      (i) => i.spec === './data' && /\bWHOLE_SCHEDULE_KEY\b/.test(i.raw),
    )
    expect(fromData, 'WHOLE_SCHEDULE_KEY 不得来自 server-only 的 ./data').toBeUndefined()
  })

  it('filter.ts（被客户端组件导入的纯逻辑）不得对 server-only 的 ./data 建立运行时依赖', () => {
    expect(
      runtimeDataRefs(read('filter.ts')),
      'reports/filter.ts 只能从 ./data 做 import type，绝不值导入',
    ).toEqual([])
  })

  it('constants.ts 保持无 server 依赖（无 server-only / @/db / @/auth 导入）', () => {
    const constants = stripComments(read('constants.ts'))
    // 去注释后再匹配：不误伤注释里描述 data.ts 的 `import 'server-only'` 文本。
    expect(
      /^\s*import\s+['"]server-only['"]/m.test(constants),
      "constants.ts 引入了 'server-only' → 客户端值导入会再次击穿",
    ).toBe(false)
    const serverSpecs = parseStaticImports(constants).filter((i) => /^@\/(db|auth)\b/.test(i.spec))
    expect(
      serverSpecs.map((i) => i.spec),
      'constants.ts 从 @/db 或 @/auth 导入 → 会把 server 链带回客户端',
    ).toEqual([])
  })
})

// ── 同一 bundle 边界不变量扩展到 portal/notes（本次新增 notes-list.tsx 客户端筛选 + filter.ts 纯逻辑） ──────
//
// notes/data.ts 同样 `import 'server-only'`（postgres 驱动 / @/auth/portal 依赖链）。新的 'use client' 组件
// notes-list.tsx 只能从 ./data 做 `import type`，其依赖的纯逻辑 filter.ts 亦然 —— 任一处对 ./data 建立运行时
// 依赖都会把 server 链打进 client bundle，next build 失败。这里守住 notes 侧与 reports 侧同构的边界。
const notesClientTsxFiles = readdirSync(notesDir).filter(
  (f) => f.endsWith('.tsx') && isClientModule(readNote(f)),
)

describe('bundle 边界 — portal/notes 客户端 / 服务端', () => {
  it("notes-list.tsx 存在且是 'use client' 组件（守卫的锚点）", () => {
    expect(notesClientTsxFiles).toContain('notes-list.tsx')
  })

  it("任何 'use client' 模块都不得对 server-only 的 ./data 建立运行时依赖", () => {
    for (const file of notesClientTsxFiles) {
      expect(
        runtimeDataRefs(readNote(file)),
        `${file} 对 server-only ./data 建立了运行时依赖 → 会把 postgres/@auth 链打进 client bundle`,
      ).toEqual([])
    }
  })

  it('filter.ts（被客户端组件导入的纯逻辑）不得对 server-only 的 ./data 建立运行时依赖', () => {
    expect(
      runtimeDataRefs(readNote('filter.ts')),
      'notes/filter.ts 只能从 ./data 做 import type，绝不值导入',
    ).toEqual([])
  })
})
