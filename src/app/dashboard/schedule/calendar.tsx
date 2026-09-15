'use client'

import { useMemo, useState, useTransition } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventDropArg, EventClickArg, EventContentArg } from '@fullcalendar/core'
import zhCn from '@fullcalendar/core/locales/zh-cn'
import { createLessonAction, rescheduleLessonAction } from './actions'
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
  return (
    <div className="overflow-hidden px-1 text-xs leading-tight">
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
  const [, startTransition] = useTransition()

  function toggleVisible(id: string) {
    setVisibleSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
      alert('请先在上方选择一个班级')
      return
    }
    startTransition(async () => {
      const res = await createLessonAction({
        sectionId,
        startAt: info.start,
        endAt: info.end,
      })
      if (!res.ok) {
        alert(`时间冲突，可用时段：${res.suggestions.join('、') || '当天已排满'}`)
      } else {
        setEvents((prev) => [...prev, res.event])
      }
    })
  }

  function handleDrop(info: EventDropArg) {
    startTransition(async () => {
      const res = await rescheduleLessonAction({
        id: info.event.id,
        startAt: info.event.start!,
        endAt: info.event.end ?? info.event.start!,
      })
      if (!res.ok) {
        info.revert()
        alert(`时间冲突，可用时段：${res.suggestions.join('、') || '当天已排满'}`)
      } else {
        setEvents((prev) => prev.map((e) => (e.id === res.event.id ? res.event : e)))
      }
    })
  }

  function handleEventClick(info: EventClickArg) {
    setSelectedId(info.event.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">拖拽新建课节的班级：</span>
        <select
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
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={zhCn}
        timeZone="Asia/Shanghai"
        initialDate={initialEvents[0]?.start}
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
