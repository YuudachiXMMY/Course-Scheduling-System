import { pgEnum } from 'drizzle-orm/pg-core'

export const studentStatus = pgEnum('student_status', ['active', 'inactive', 'archived'])
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'dropped', 'completed'])
export const lessonStatus = pgEnum('lesson_status', ['scheduled', 'completed', 'canceled'])
export const attendanceStatus = pgEnum('attendance_status', ['present', 'absent', 'late', 'excused'])
export const noteVisibility = pgEnum('note_visibility', ['internal', 'shared']) // 'shared' reserved (Phase 4)
// --- RESERVED (Phase 7) — declared now so migrations are stable ---
export const rescheduleStatus = pgEnum('reschedule_status', [
  'pending',
  'approved',
  'rejected',
  'canceled',
])
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'refunded', 'void'])
