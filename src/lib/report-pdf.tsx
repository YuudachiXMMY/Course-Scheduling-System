import 'server-only'
import path from 'node:path'
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import {
  wrapCjkText,
  narrativeMaxWidthEm,
  REPORT_PAGE_PADDING,
  REPORT_BODY_FONT_SIZE,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
} from '@/lib/report-pdf-layout'

// P5: PDF progress report, Chromium-free via @react-pdf/renderer. Numbers come from `model`
// (rendered from the DB), never from the LLM. CJK MUST use a locally-registered .ttf — a Google
// Fonts URL or the OS .ttc (which only serves Playwright) renders 豆腐 (the PRD's #1 risk).
Font.register({
  family: 'NotoSansSC',
  src: path.join(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf'),
})

const A = { present: '出勤', absent: '缺勤', late: '迟到', excused: '请假' } as const

export interface ReportPdfModel {
  studentName: string
  schoolGrade: string | null
  periodStart: string | null
  periodEnd: string | null
  title: string | null
  status: 'draft' | 'approved'
  narrative: string | null
  attendance: {
    total: number
    present: number
    absent: number
    late: number
    excused: number
    rate: number
  }
  grades: {
    title: string | null
    score: number | null
    maxScore: number | null
    comment: string | null
  }[]
  gradeAverage: number | null
  generatedAt: string // ISO datetime, passed in (Date.now is unavailable to keep renders deterministic in tests)
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansSC',
    fontSize: REPORT_BODY_FONT_SIZE,
    padding: REPORT_PAGE_PADDING,
    color: '#1a1a1a',
  },
  h1: { fontSize: 20, marginBottom: 2 },
  sub: { fontSize: 10, color: '#666', marginBottom: 16 },
  badge: { fontSize: 9, color: '#666' },
  section: { marginBottom: 14 },
  h2: { fontSize: 13, marginBottom: 6, borderBottom: '1 solid #ddd', paddingBottom: 2 },
  row: { flexDirection: 'row', marginBottom: 3 },
  cell: { flex: 1 },
  label: { color: '#666' },
  para: { lineHeight: 1.6, marginBottom: 8 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#999',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

function ReportDocument({ model: m }: { model: ReportPdfModel }) {
  const period = m.periodStart && m.periodEnd ? `${m.periodStart} 至 ${m.periodEnd}` : '—'
  const paras = (m.narrative ?? '').split(/\n+/).filter((p) => p.trim().length > 0)
  // @react-pdf 无 CJK 断行,会让长中文整行冲出页面或在错处折行。用嵌入字体的字符宽度
  // 把每段预折成不超内容宽度的硬行(逐字断、拉丁词不拆、避头尾),渲染侧不再二次折行。
  const narrativeWidthEm = narrativeMaxWidthEm()
  return (
    <Document>
      <Page size={[A4_WIDTH_PT, A4_HEIGHT_PT]} style={styles.page}>
        <Text style={styles.h1}>{m.title || `${m.studentName} 进度报告`}</Text>
        <Text style={styles.sub}>
          {m.studentName}
          {m.schoolGrade ? ` · ${m.schoolGrade}` : ''} · 时间段 {period}
        </Text>

        <View style={styles.section}>
          <Text style={styles.h2}>出勤统计</Text>
          <View style={styles.row}>
            <Text style={styles.cell}>
              <Text style={styles.label}>总课次: </Text>
              {m.attendance.total}
            </Text>
            <Text style={styles.cell}>
              <Text style={styles.label}>出勤率: </Text>
              {Math.round(m.attendance.rate * 100)}%
            </Text>
          </View>
          <View style={styles.row}>
            {(['present', 'absent', 'late', 'excused'] as const).map((k) => (
              <Text key={k} style={styles.cell}>
                <Text style={styles.label}>{A[k]}: </Text>
                {m.attendance[k]}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>成绩</Text>
          {m.grades.length === 0 ? (
            <Text style={styles.label}>本时间段暂无成绩记录。</Text>
          ) : (
            m.grades.map((g, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.cell}>{g.title || '未命名'}</Text>
                <Text style={styles.cell}>
                  {g.score == null ? '—' : g.score}
                  {g.maxScore != null ? ` / ${g.maxScore}` : ''}
                </Text>
                <Text style={{ flex: 2 }}>{g.comment || ''}</Text>
              </View>
            ))
          )}
          {m.gradeAverage != null ? (
            <View style={styles.row}>
              <Text style={styles.cell}>
                <Text style={styles.label}>平均分(百分制): </Text>
                {m.gradeAverage}%
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>教师评语</Text>
          {paras.length === 0 ? (
            <Text style={styles.label}>（暂无叙述）</Text>
          ) : (
            paras.map((p, i) => (
              <Text key={i} style={styles.para}>
                {wrapCjkText(p, narrativeWidthEm).join('\n')}
              </Text>
            ))
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>{m.status === 'approved' ? '已定稿' : '草稿'}</Text>
          <Text>生成于 {m.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  )
}

export function renderReportPdf(model: ReportPdfModel): Promise<Buffer> {
  return renderToBuffer(<ReportDocument model={model} />)
}
