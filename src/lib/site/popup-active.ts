// 弹窗"此刻是否生效"的判定 —— 纯函数，无 DB(单元测试见 tests/site-popup-active.test.ts)。
//
// 官网原实现把这套时间窗语义编码在一个四分支的 Prisma OR 里:
//   { startDate: null, endDate: null }                    // 无窗 = 永久生效
//   { startDate: <= now, endDate: null }                  // 只有开始时间 = 已开始
//   { startDate: null, endDate: >= now }                  // 只有结束时间 = 未结束
//   { startDate: <= now, endDate: >= now }                // 两端都有 = 在窗内
//
// 那四个分支展开后等价于一句话:**startDate 为空或已过，且 endDate 为空或未到**。
// 这里按这个等价式写，并用测试钉住四种组合，避免把一个本可以证明的恒等式当作巧合。
// 边界沿用原语义:lte / gte —— 开始时刻和结束时刻本身都算在窗内(闭区间)。

export interface PopupWindow {
  isActive: boolean
  startDate: Date | null
  endDate: Date | null
}

export function isPopupLive(p: PopupWindow, now: Date): boolean {
  if (!p.isActive) return false
  if (p.startDate && p.startDate.getTime() > now.getTime()) return false
  if (p.endDate && p.endDate.getTime() < now.getTime()) return false
  return true
}
