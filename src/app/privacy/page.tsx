import type { Metadata } from 'next'

// PIPL 数据处理告知 (P4-10). Static, public. Linked from the read-only share page footer.
export const metadata: Metadata = {
  title: '数据处理告知',
  robots: { index: false, follow: false },
}

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: 24,
        lineHeight: 1.7,
        color: '#171717',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>数据处理告知</h1>
      <p style={{ fontSize: 13, color: '#737373', marginTop: 4 }}>
        依据《中华人民共和国个人信息保护法》（PIPL）向您说明本课表分享功能如何处理个人信息。
      </p>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>我们处理哪些信息</h2>
        <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 14 }}>
          <li>学生姓名（及可选的英文名、年级等基本标识信息）。</li>
          <li>与该学生相关的课程安排：上课日期、时间、课程名称与上课地点。</li>
        </ul>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          分享页面仅展示上述与本学生相关的课表信息，不包含其他学生的数据。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>处理目的与方式</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们处理上述信息，仅用于向家长展示、导出学生本人的课表（网页链接、图片或日历文件），
          方便家长查看与保存孩子的上课安排。分享链接为只读，无法通过该链接修改任何数据。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>关于课程报告与人工智能</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          后续版本可能提供「课程报告」功能，届时可能借助 Claude API（由 Anthropic 提供的
          大语言模型服务）辅助起草报告文本。相关功能上线前会再次向您告知，并取得必要的同意。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>链接的只读与撤销</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          每个分享链接均为只读，且可由老师随时重新生成或停用。链接一经重新生成或停用，
          原链接立即失效，无法再访问任何课表信息。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>联系我们</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          如需查询、更正或删除相关信息，或对本告知有任何疑问，请通过您与老师的日常联系方式
          （如微信）与我们联系。
        </p>
      </section>
    </main>
  )
}
