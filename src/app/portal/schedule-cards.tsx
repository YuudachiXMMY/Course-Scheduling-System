'use client'

import { useState } from 'react'
import { ScheduleCard } from '@/lib/schedule-card'
import type { PortalCard } from './data'

// Client wrapper around the (server-rendered shape) ScheduleCard list. For multi-child parents it
// adds a "选择孩子" filter (default 全部); single-child parents and students see no selector.
export default function ScheduleCards({ cards }: { cards: PortalCard[] }) {
  const [studentId, setStudentId] = useState('') // '' = 全部
  const multi = cards.length > 1
  const shown = studentId ? cards.filter((c) => c.studentId === studentId) : cards

  return (
    <>
      {multi && (
        <select
          aria-label="选择孩子"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          className="mb-3 rounded border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">全部</option>
          {cards.map((c) => (
            <option key={c.studentId} value={c.studentId}>
              {c.studentName}
            </option>
          ))}
        </select>
      )}
      {shown.map((c) => (
        <ScheduleCard
          key={c.studentId}
          data={{ studentName: c.studentName, subtitle: c.subtitle, lessons: c.lessons }}
        />
      ))}
    </>
  )
}
