import type { Metadata } from 'next'

// PIPEDA (Ontario) 数据处理告知 (P4-10). Static, public. Linked from the read-only share page footer,
// the portal footer, and the first-login consent modal. Ontario has no private-sector privacy statute,
// so commercial collection of personal information is governed by the federal PIPEDA.
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
        本机构位于加拿大安大略省。安省未设独立的私营部门隐私法，商业活动中个人信息的收集、使用与披露适用
        联邦《个人信息保护及电子文件法》（Personal Information Protection and Electronic Documents
        Act， PIPEDA）。本告知依据 PIPEDA 说明本课表与门户功能如何处理个人信息。
      </p>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>我们收集哪些信息</h2>
        <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 14 }}>
          <li>学生姓名（及可选的英文名、年级等基本标识信息）。</li>
          <li>与该学生相关的课程安排：上课日期、时间、课程名称与上课地点。</li>
          <li>
            若开通登录账号：登录账号信息（登录邮箱/占位账号及密码，密码经加密存储）、您提交的改期申请内容
            （期望的新上课时间与原因）及处理状态，以及相关操作记录。
          </li>
        </ul>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们仅收集为实现下述目的所必需的信息。分享页面仅展示与本学生相关的课表信息，不包含其他学生的数据。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>使用目的</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们处理上述信息，仅用于向家长展示、导出学生本人的课表（网页链接、图片或日历文件），
          并在开通登录账号时支持家长/学生查看课表与提交改期申请。分享链接为只读，无法通过该链接修改任何数据。
          我们不会将上述个人信息用于与上述目的无关的用途，也不会出售您的个人信息。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>同意</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们处理个人信息的依据为您（或监护人）的同意。您在首次登录时通过确认或关闭数据处理告知窗口，
          即表示您已知悉并同意本告知所述的处理方式。您可随时撤回同意；撤回不影响撤回前已进行的处理，
          但撤回后我们可能无法继续为您提供课表查看与改期申请服务。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>监护人同意（未成年人）</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          被查看人可能为未成年人。对未成年人的个人信息，须由具备法律行为能力的父母或监护人代为阅读并同意。
          若您为监护人，您的同意即代表您已知悉并同意本告知所述、针对该未成年人相关信息的处理方式。
          如不同意，请勿使用登录门户，并可通过日常联系方式告知老师停用账号。
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
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>改期申请</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          登录后您可提交「改期申请」。改期申请为「申请 → 老师审批」流程，您无法直接修改课表；
          老师审批通过后由系统更新课节。所有申请与审批均留有操作记录，用于安全审计。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>关于课程报告与人工智能</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          后续版本可能提供「课程报告」功能，届时可能借助 Claude API（由 Anthropic
          提供的大语言模型服务）
          辅助起草报告文本。相关处理可能在加拿大境外（如美国）进行；届时我们仍对您的个人信息负责，
          并会通过合同等方式要求受托方提供与本告知相当的保护。该功能上线前会再次向您告知并取得必要的同意。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>安全保障措施</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们采取与信息敏感程度相称的技术与管理措施保护个人信息，包括访问权限控制、按租户隔离数据、
          密码加密存储，以及对关键操作留存审计记录，以防止未经授权的访问、使用、披露、丢失或篡改。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>数据保留期限</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          我们仅在为实现上述目的所必需的期间内保留个人信息。学生结课或账号停用后，
          相关信息将在合理期限内删除或匿名化，法律法规另有要求的除外。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>您的权利：访问与更正</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          依据 PIPEDA，您有权查询我们是否持有您的个人信息、请求访问该信息，并在信息不准确或不完整时
          请求更正。我们会在合理期限内答复此类请求。行使上述权利，请通过下方联系方式与我们联系。
        </p>
      </section>

      <section style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>投诉与联系我们</h2>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          如需查询、更正或删除相关信息，或对本告知、我们的隐私做法有任何疑问或投诉，请通过您与老师的
          日常联系方式（如微信）与我们联系，我们会及时处理。若您对我们的答复不满意，您还可向
          加拿大隐私专员公署（Office of the Privacy Commissioner of Canada，OPC）提出投诉。
        </p>
      </section>
    </main>
  )
}
