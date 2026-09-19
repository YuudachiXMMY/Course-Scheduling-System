'use client'

import { useMemo, useState, useTransition } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
// FullCalendar 的原生 Date 无法计算命名时区（如 America/Toronto）的偏移，未注册时区实现时会把
// timeZone 静默回退为 UTC 强制渲染（官方文档 "faked in UTC"）。luxon3 插件提供命名时区实现，让
// timeZone={APP_TIME_ZONE} 真正生效，使日历时间与 formatDateTime / schedule-card / 门户 / 报告
// （均 luxon setZone(Toronto)）保持一致。
import luxonPlugin from '@fullcalendar/luxon3'
import type {
  DateSelectArg,
  EventDropArg,
  EventClickArg,
  EventContentArg,
  EventMountArg,
} from '@fullcalendar/core'
import zhCn from '@fullcalendar/core/locales/zh-cn'
import { createLessonAction, rescheduleLessonAction } from './actions'
import { APP_TIME_ZONE } from '@/lib/timezone'
import type { CalendarEvent } from './types'
import LessonDetail from './lesson-detail'

interface SectionOption {
  id: string
  name: string
}

// Render the event as "课程名 · 学生名" plus an online/location hint (req6).
function renderEventContent(arg: EventContentArg) {
  const p = arg.event.extendedProps as {
    courseTitle?: string | null
    studentNames?: string[]
    location?: string | null
    meetingUrl?: string | null
  }
  const label = p.courseTitle || arg.event.title
  const names = p.studentNames ?? []
  const shown = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等${names.length}人` : '')
  const place = p.meetingUrl ? '线上' : (p.location ?? '')
  // arg.timeText 是 FullCalendar 按当前 timeZone（America/Toronto）+ eventTimeFormat 计算出的开始时间。
  // 自定义 eventContent 会替换掉 FC 默认的 .fc-event-time，故在此显式展示，让用户在事件块上直接看到
  // 多伦多 wall-clock（此前事件块不显示时间，时区错误只体现在网格位置上，难以察觉）。
  return (
    <div className="overflow-hidden px-1 text-xs leading-tight">
      {arg.timeText && (
        <div data-testid="event-time" className="truncate font-medium tabular-nums">
          {arg.timeText}
        </div>
      )}
      <div className="truncate font-medium">{label}</div>
      {shown && <div className="truncate opacity-80">{shown}</div>}
      {place && <div className="truncate opacity-70">{place}</div>}
    </div>
  )
}

export default function ScheduleCalendar({
  initialEvents,
  sections,
}: {
  initialEvents: CalendarEvent[]
  sections: SectionOption[]
}) {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents)
  const [sectionId, setSectionId] = useState<string>(sections[0]?.id ?? '')
  const [visibleSectionIds, setVisibleSectionIds] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Inline notice replaces window.alert for the "no section" + conflict paths — a native alert blocks
  // the whole tab (and the extension's event loop); this amber bar is dismissible and non-modal.
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggleVisible(id: string) {
    setVisibleSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // CR5: open the calendar on a DETERMINISTIC week. listLessonsInRange has no ORDER BY, so
  // initialEvents[0] was an arbitrary lesson within the ~6-week window (random opening week). Anchor on
  // the EARLIEST lesson instead — start is an ISO UTC string, so lexicographic min == chronological min.
  const initialDate = useMemo(() => {
    if (initialEvents.length === 0) return undefined
    return initialEvents.reduce((min, e) => (e.start < min ? e.start : min), initialEvents[0].start)
  }, [initialEvents])

  const fcEvents = useMemo(
    () =>
      events
        .filter((e) => visibleSectionIds.has(e.sectionId))
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          extendedProps: {
            courseTitle: e.courseTitle,
            studentNames: e.studentNames,
            location: e.location,
            meetingUrl: e.meetingUrl,
          },
        })),
    [events, visibleSectionIds],
  )

  function handleSelect(info: DateSelectArg) {
    if (!sectionId) {
      setNotice('请先在上方选择一个班级')
      return
    }
    setNotice(null)
    startTransition(async () => {
      const res = await createLessonAction({
        sectionId,
        startAt: info.start,
        endAt: info.end,
      })
      if (!res.ok) {
        setNotice(`时间冲突，可用时段：${res.suggestions.join('、') || '当天已排满'}`)
      } else {
        setEvents((prev) => [...prev, res.event])
      }
    })
  }

  function handleDrop(info: EventDropArg) {
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await rescheduleLessonAction({
          id: info.event.id,
          startAt: info.event.start!,
          endAt: info.event.end ?? info.event.start!,
        })
        if (!res.ok) {
          info.revert()
          setNotice(`时间冲突，可用时段：${res.suggestions.join('、') || '当天已排满'}`)
        } else {
          setEvents((prev) => prev.map((e) => (e.id === res.event.id ? res.event : e)))
        }
      } catch {
        // rescheduleLessonCore 对"课节不存在/无权/缺教师/排他约束竞态 ConflictError"是 throw 而非
        // 返回 {ok:false}；抛错会在到达 revert 前中断回调，而 FullCalendar 已乐观移动了事件块。
        // 因此 catch 分支同样调用 info.revert() 把事件块归位，避免 UI 与 DB 静默不一致。
        info.revert()
        setNotice('改期失败，请稍后重试或刷新页面')
      }
    })
  }

  function handleEventClick(info: EventClickArg) {
    setSelectedId(info.event.id)
  }

  // Stable per-event anchor for E2E: fcEvents sets id: e.id, which is the underlying lesson id.
  function handleEventDidMount(info: EventMountArg) {
    info.el.setAttribute('data-testid', 'calendar-event-' + info.event.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">拖拽新建课节的班级：</span>
        <select
          data-testid="section-select"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          {sections.length === 0 && <option value="">（暂无班级）</option>}
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {notice && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="关闭提示"
            className="shrink-0 text-amber-600 hover:text-amber-900"
          >
            关闭
          </button>
        </div>
      )}

      {sections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-neutral-600">显示班级：</span>
          {sections.map((s) => (
            <label key={s.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={visibleSectionIds.has(s.id)}
                onChange={() => toggleVisible(s.id)}
              />
              {s.name}
            </label>
          ))}
        </div>
      )}

      <FullCalendar
        plugins={[luxonPlugin, timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={zhCn}
        timeZone={APP_TIME_ZONE}
        // 24 小时制 HH:mm，和全应用一致（formatDateTime / schedule-card 均 'HH:mm'），避免日历用
        // 本地化 12 小时制导致同一时刻两种写法。zh-cn locale 默认会带午别，这里显式统一。
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        initialDate={initialDate}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        height="auto"
        selectable
        editable
        events={fcEvents}
        eventContent={renderEventContent}
        select={handleSelect}
        eventDrop={handleDrop}
        eventClick={handleEventClick}
        eventDidMount={handleEventDidMount}
      />
      {selectedId && (
        <LessonDetail
          lessonId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={(id) => setEvents((prev) => prev.filter((e) => e.id !== id))}
        />
      )}
    </div>
  )
}
