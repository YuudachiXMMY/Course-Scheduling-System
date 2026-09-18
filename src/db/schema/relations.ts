import { relations } from 'drizzle-orm'
import { course, classSection, sectionMeeting } from './course'
import { student } from './student'
import { enrollment } from './enrollment'
import { lesson } from './lesson'
import { attendance } from './attendance'
import { grade } from './grade'
import { note } from './note'
import { progressReport } from './progress-report'
import { rescheduleRequest, creditPackage, payment } from './reserved'
import { shareLink } from './share-link'
import { sectionShareLink } from './section-share-link'
import { portalLink } from './portal-link'
import { notification } from './notification'

export const courseRelations = relations(course, ({ many }) => ({ sections: many(classSection) }))
export const sectionRelations = relations(classSection, ({ one, many }) => ({
  course: one(course, { fields: [classSection.courseId], references: [course.id] }),
  lessons: many(lesson),
  enrollments: many(enrollment),
  meetings: many(sectionMeeting),
}))
export const sectionMeetingRelations = relations(sectionMeeting, ({ one }) => ({
  section: one(classSection, {
    fields: [sectionMeeting.sectionId],
    references: [classSection.id],
  }),
}))
export const studentRelations = relations(student, ({ many }) => ({
  enrollments: many(enrollment),
  attendance: many(attendance),
  grades: many(grade),
}))
export const enrollmentRelations = relations(enrollment, ({ one }) => ({
  student: one(student, { fields: [enrollment.studentId], references: [student.id] }),
  section: one(classSection, { fields: [enrollment.sectionId], references: [classSection.id] }),
}))
export const lessonRelations = relations(lesson, ({ one, many }) => ({
  section: one(classSection, { fields: [lesson.sectionId], references: [classSection.id] }),
  attendance: many(attendance),
  grades: many(grade),
  notes: many(note),
}))
export const attendanceRelations = relations(attendance, ({ one }) => ({
  lesson: one(lesson, { fields: [attendance.lessonId], references: [lesson.id] }),
  student: one(student, { fields: [attendance.studentId], references: [student.id] }),
}))

// DB5: reciprocal one() sides for the many() targets already declared above (studentRelations.grades,
// lessonRelations.grades/notes) plus one() links for the remaining FK-bearing domain tables. Code-only
// metadata (no migration); enables the drizzle relational query API (`db.query...with`) consistently.
// calendarFeed & pushSubscription intentionally omitted — they carry only tenant_id + an auth-owned
// userId/teacherId (no domain FK), so there is no domain relation to declare.
export const gradeRelations = relations(grade, ({ one }) => ({
  student: one(student, { fields: [grade.studentId], references: [student.id] }),
  lesson: one(lesson, { fields: [grade.lessonId], references: [lesson.id] }),
  section: one(classSection, { fields: [grade.sectionId], references: [classSection.id] }),
}))
export const noteRelations = relations(note, ({ one }) => ({
  lesson: one(lesson, { fields: [note.lessonId], references: [lesson.id] }),
  section: one(classSection, { fields: [note.sectionId], references: [classSection.id] }),
  student: one(student, { fields: [note.studentId], references: [student.id] }),
}))
export const progressReportRelations = relations(progressReport, ({ one }) => ({
  student: one(student, { fields: [progressReport.studentId], references: [student.id] }),
  section: one(classSection, { fields: [progressReport.sectionId], references: [classSection.id] }),
}))
export const rescheduleRequestRelations = relations(rescheduleRequest, ({ one }) => ({
  lesson: one(lesson, { fields: [rescheduleRequest.lessonId], references: [lesson.id] }),
  student: one(student, { fields: [rescheduleRequest.studentId], references: [student.id] }),
}))
export const creditPackageRelations = relations(creditPackage, ({ one, many }) => ({
  student: one(student, { fields: [creditPackage.studentId], references: [student.id] }),
  payments: many(payment),
}))
export const paymentRelations = relations(payment, ({ one }) => ({
  student: one(student, { fields: [payment.studentId], references: [student.id] }),
  creditPackage: one(creditPackage, {
    fields: [payment.creditPackageId],
    references: [creditPackage.id],
  }),
}))
export const shareLinkRelations = relations(shareLink, ({ one }) => ({
  student: one(student, { fields: [shareLink.studentId], references: [student.id] }),
}))
export const sectionShareLinkRelations = relations(sectionShareLink, ({ one }) => ({
  section: one(classSection, {
    fields: [sectionShareLink.sectionId],
    references: [classSection.id],
  }),
}))
export const portalLinkRelations = relations(portalLink, ({ one }) => ({
  student: one(student, { fields: [portalLink.studentId], references: [student.id] }),
}))
export const notificationRelations = relations(notification, ({ one }) => ({
  lesson: one(lesson, { fields: [notification.lessonId], references: [lesson.id] }),
  student: one(student, { fields: [notification.studentId], references: [student.id] }),
}))
