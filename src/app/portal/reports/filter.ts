// 门户进度报告的**纯**筛选/分组/计数逻辑，供客户端组件（reports-list.tsx）与单元测试共用。
//
// 客户端 bundle 边界（B2 不变量，见 tests/portal-reports-client-boundary.test.ts）：本模块只从 server-only
// 的 ./data 做 `import type`，并从无 server 依赖的 ./constants 值导入 WHOLE_SCHEDULE_KEY —— 绝不值导入 ./data。
import { WHOLE_SCHEDULE_KEY } from './constants'
import type { PortalReportRow } from './data'

// 筛选状态：按学生 + 按课程班级 + 按月份。空串 = 该维度不过滤（<option value="">）。
export interface ReportsFilterState {
  studentId: string
  sectionId: string
  month: string // 'YYYY-MM'；'' = 全部月份
}

export interface ReportsFilterOption {
  id: string
  label: string
  count: number
}

// 报告的「月份」桶 key = periodStart（周期起始）优先，缺失时回退 createdAt，取 'YYYY-MM'。
// 二者均为 ISO date 字符串（'YYYY-MM-DD' / 'YYYY-MM-DDT...'），slice(0,7) 即月份。月度报告以周期归月最自然，
// 无周期的整程/单次报告退回创建月，保证每条报告都能落入某个月份桶。
export function reportMonthKey(r: PortalReportRow): string {
  return (r.periodStart ?? r.createdAt).slice(0, 7)
}

// 按学生 + 班级 + 月份筛选（各维度空串即放行），三者取交集。班级维度沿用 WHOLE_SCHEDULE_KEY 处理整程(null)桶。
export function filterReports(
  reports: PortalReportRow[],
  state: ReportsFilterState,
): PortalReportRow[] {
  const { studentId, sectionId, month } = state
  return reports.filter(
    (r) =>
      (!studentId || r.studentId === studentId) &&
      (!sectionId || (r.sectionId ?? WHOLE_SCHEDULE_KEY) === sectionId) &&
      (!month || reportMonthKey(r) === month),
  )
}

// 「按月份」下拉选项：报告里出现过的月份去重，各带数量徽标，按月份倒序（最近月在前）。
export function monthOptions(reports: PortalReportRow[]): ReportsFilterOption[] {
  const count = new Map<string, number>()
  for (const r of reports) {
    const k = reportMonthKey(r)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[0].localeCompare(a[0])) // 月份倒序
    .map(([id, c]) => ({ id, label: id, count: c }))
}

export interface ReportMonthGroup {
  month: string // 'YYYY-MM'
  reports: PortalReportRow[]
}

// 把（已筛选后的）报告按月份倒序分组；组内保持传入顺序（data.ts 已按 createdAt 倒序）。
export function groupReportsByMonth(reports: PortalReportRow[]): ReportMonthGroup[] {
  const byMonth = new Map<string, PortalReportRow[]>()
  for (const r of reports) {
    const k = reportMonthKey(r)
    const bucket = byMonth.get(k)
    if (bucket) bucket.push(r)
    else byMonth.set(k, [r])
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, rs]) => ({ month, reports: rs }))
}

// 通用计数：给定选项 id 列表与报告，返回各 id 命中数（供班级/学生下拉的数量徽标复用）。
export function countByKey(
  reports: PortalReportRow[],
  keyOf: (r: PortalReportRow) => string,
): Map<string, number> {
  const count = new Map<string, number>()
  for (const r of reports) {
    const k = keyOf(r)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  return count
}
