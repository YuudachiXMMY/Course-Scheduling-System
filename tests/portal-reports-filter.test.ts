import { describe, it, expect } from 'vitest'
import {
  reportMonthKey,
  filterReports,
  monthOptions,
  groupReportsByMonth,
  countByKey,
} from '@/app/portal/reports/filter'
import { WHOLE_SCHEDULE_KEY } from '@/app/portal/reports/constants'
import type { PortalReportRow } from '@/app/portal/reports/data'

// 门户进度报告「按月份」筛选 + 按月倒序分组的行为规格（纯函数，无 DB）。本次 change-feature 的期望新行为：
// 在既有「学生 + 课程班级」筛选之外新增月份维度，并把结果按月份倒序分组展示；课程/月份选项带数量徽标。

const row = (o: Partial<PortalReportRow> & Pick<PortalReportRow, 'id'>): PortalReportRow => ({
  title: '进度报告',
  studentId: 'stu1',
  studentName: '学生1',
  sectionId: 'sec_a',
  sectionLabel: '数学 · A班',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  narrative: '叙述',
  createdAt: '2026-09-30',
  ...o,
})

const reports: PortalReportRow[] = [
  row({ id: 'r1', periodStart: '2026-09-01', periodEnd: '2026-09-30', createdAt: '2026-10-02' }),
  row({ id: 'r2', periodStart: '2026-08-01', periodEnd: '2026-08-31', createdAt: '2026-09-05', sectionId: 'sec_b', sectionLabel: '英语 · B班' }),
  row({ id: 'r3', periodStart: '2026-09-01', periodEnd: '2026-09-30', createdAt: '2026-10-01', studentId: 'stu2', studentName: '学生2' }),
  // 整程报告：无 sectionId + 无 period → 月份回退 createdAt。
  row({ id: 'r4', sectionId: null, sectionLabel: '全程', periodStart: null, periodEnd: null, createdAt: '2026-07-15' }),
]

describe('门户报告 — 月份 key 派生', () => {
  it('periodStart 优先取 YYYY-MM', () => {
    expect(reportMonthKey(reports[0])).toBe('2026-09')
  })
  it('无 periodStart 时回退 createdAt', () => {
    expect(reportMonthKey(reports[3])).toBe('2026-07')
  })
})

describe('门户报告 — 按月份筛选与组合', () => {
  it('空 month 返回全部', () => {
    expect(filterReports(reports, { studentId: '', sectionId: '', month: '' })).toHaveLength(4)
  })
  it('按月份收敛', () => {
    const r = filterReports(reports, { studentId: '', sectionId: '', month: '2026-09' })
    expect(r.map((x) => x.id).sort()).toEqual(['r1', 'r3'])
  })
  it('月份 + 学生 + 班级三维取交集', () => {
    const r = filterReports(reports, { studentId: 'stu1', sectionId: 'sec_a', month: '2026-09' })
    expect(r.map((x) => x.id)).toEqual(['r1'])
  })
  it('整程(null section)桶用 WHOLE_SCHEDULE_KEY 命中', () => {
    const r = filterReports(reports, { studentId: '', sectionId: WHOLE_SCHEDULE_KEY, month: '' })
    expect(r.map((x) => x.id)).toEqual(['r4'])
  })
})

describe('门户报告 — 月份选项与徽标', () => {
  it('月份去重、倒序、带数量徽标', () => {
    expect(monthOptions(reports)).toEqual([
      { id: '2026-09', label: '2026-09', count: 2 },
      { id: '2026-08', label: '2026-08', count: 1 },
      { id: '2026-07', label: '2026-07', count: 1 },
    ])
  })
  it('countByKey 可复用于班级维度徽标', () => {
    const c = countByKey(reports, (r) => r.sectionId ?? WHOLE_SCHEDULE_KEY)
    expect(c.get('sec_a')).toBe(2)
    expect(c.get('sec_b')).toBe(1)
    expect(c.get(WHOLE_SCHEDULE_KEY)).toBe(1)
  })
})

describe('门户报告 — 按月份倒序分组', () => {
  it('分组按月份倒序，组内保持传入顺序', () => {
    const groups = groupReportsByMonth(reports)
    expect(groups.map((g) => g.month)).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(groups[0].reports.map((r) => r.id)).toEqual(['r1', 'r3']) // 保持传入顺序
  })
})
