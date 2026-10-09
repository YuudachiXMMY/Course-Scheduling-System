import { DateTime } from 'luxon'
import { APP_TIME_ZONE } from '@/lib/timezone'

// <input type="datetime-local"> ↔ 存储用 ISO 的往返转换 —— 纯函数、无 server-only
// (弹窗表单是 Client Component)。单元测试见 tests/site-form-time.test.ts。
//
// 为什么要往返转换:datetime-local 给的是**无时区**的本地挂钟串，而库里存 UTC。
// 不显式按 APP_TIME_ZONE 解读，运营方填的"晚上八点"会被当成 UTC 八点，在多伦多变成下午三四点。

/** 存储用的 Date → datetime-local 需要的 APP_TIME_ZONE 挂钟串。null → 空串(表示未设置)。 */
export function toLocalInput(d: Date | null): string {
  if (!d) return ''
  return DateTime.fromJSDate(d, { zone: 'utc' })
    .setZone(APP_TIME_ZONE)
    .toFormat("yyyy-MM-dd'T'HH:mm")
}

// 空串 → 清空;合法 → ISO;不合法/不存在 → 带原因，好让界面说清到底哪里不对。
export type ParsedTime =
  | { ok: true; iso: string | null }
  | { ok: false; reason: '格式不正确' | '该时刻不存在（夏令时跳表）' }

/** datetime-local 挂钟串 → 带偏移的 ISO(交给 zod 的 datetime 校验)。 */
export function fromLocalInput(v: string): ParsedTime {
  if (!v) return { ok: true, iso: null }
  const dt = DateTime.fromISO(v, { zone: APP_TIME_ZONE })
  if (!dt.isValid) return { ok: false, reason: '格式不正确' }

  // ⚠️ .isValid 不足以兜住夏令时"跳表"的那一小时。多伦多在春季某天 02:00 直接跳到 03:00,
  // 02:30 这个挂钟时刻**根本不存在**;Luxon 对它既不报错也不标 invalid，而是静默挪到 03:30。
  // 于是运营方填的 02:30 会被存成 03:30，界面还显示"已保存"。
  //
  // 判别办法是把结果折回挂钟串再比:存在的时刻折回来必然等于输入，被挪过的必然不等。
  // 这比硬编码各地区的 DST 规则可靠 —— 规则由 IANA 时区库说了算，不该在这里复刻。
  //
  // 原因要分开报:对用户来说"格式不对"和"这个时刻不存在"是两件完全不同的事，
  // 报错报成前者会让他对着一个格式完全正确的输入反复检查格式。
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== v) {
    return { ok: false, reason: '该时刻不存在（夏令时跳表）' }
  }
  return { ok: true, iso: dt.toISO() }
}
