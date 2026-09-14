'use client'

import { useState, useTransition } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { DateSelectArg, EventDropArg, EventClickArg } from '@fullcalendar/core'
import zhCn from '@fullcalendar/core/locales/zh-cn'
import { createLessonAction, rescheduleLessonAction } from './actions'
import type { CalendarEvent } from './types'
import LessonDetail from './lesson-detail'

interface SectionOption {
  id: string
  name: string
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

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
        events={events}
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
