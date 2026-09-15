import { relations } from 'drizzle-orm'
import { course, classSection, sectionMeeting } from './course'
import { student } from './student'
import { enrollment } from './enrollment'
import { lesson } from './lesson'
import { attendance } from './attendance'
import { grade } from './grade'
import { note } from './note'

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
