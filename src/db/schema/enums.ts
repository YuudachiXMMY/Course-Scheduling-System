import { pgEnum } from 'drizzle-orm/pg-core'

export const studentStatus = pgEnum('student_status', ['active', 'inactive', 'archived'])
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'dropped', 'completed'])
export const lessonStatus = pgEnum('lesson_status', ['scheduled', 'completed', 'canceled'])
export const attendanceStatus = pgEnum('attendance_status', [
  'present',
  'absent',
  'late',
  'excused',
])
export const noteVisibility = pgEnum('note_visibility', ['internal', 'shared']) // 'shared' reserved (Phase 4)
// --- RESERVED (Phase 7) — declared now so migrations are stable ---
export const rescheduleStatus = pgEnum('reschedule_status', [
  'pending',
  'approved',
  'rejected',
  'canceled',
])
export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'refunded', 'void'])
// Phase 5: progress report lifecycle — draft (Claude-drafted, editable) → approved (teacher-locked)
export const reportStatus = pgEnum('report_status', ['draft', 'approved'])
// Phase 7a: how a portal user (Better Auth user.id) relates to a domain student — a guardian
// ('parent') or the student themselves ('student'). Drives the login-portal per-child scope.
export const portalRelationship = pgEnum('portal_relationship', ['parent', 'student'])
// Phase 7b: in-app notification kind. Declared up-front (reserved-enum style) so migrations stay
// stable — 'lesson_reminder' from the cron scan, 'reschedule_approved'/'reschedule_rejected' from
// the reschedule review outcome.
export const notificationType = pgEnum('notification_type', [
  'lesson_reminder',
  'reschedule_approved',
  'reschedule_rejected',
])
