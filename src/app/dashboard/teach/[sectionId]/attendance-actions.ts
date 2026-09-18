'use server'

import { revalidatePath } from 'next/cache'
import { upsertAttendance } from '@/app/dashboard/schedule/attendance-actions'

// Thin teach-path wrapper over the schedule module's upsertAttendance. The underlying action already
// runs requireAuthContext + requirePermission(lesson:update) + zod + actorOwnsLesson + select-then-write
// on the forTenant spine, and revalidates '/dashboard/schedule'. Here we only add the '/dashboard/teach'
// revalidate so the 教务工作台 inline editor re-fetches the freshly recorded attendance.
export async function upsertTeachAttendance(input: Parameters<typeof upsertAttendance>[0]) {
  const row = await upsertAttendance(input)
  revalidatePath('/dashboard/teach')
  return row
}
