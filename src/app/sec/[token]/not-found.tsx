// Rendered by notFound() for a bad/revoked section share token (P4-2). Intentionally vague —
// does not leak whether the link ever existed or auth semantics.
export default function SectionShareNotFound() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 48 }}>链接无效或已停用</h1>
      <p style={{ fontSize: 14, color: '#737373', marginTop: 12 }}>
        该分享链接可能已被重新生成或停用，请向老师索取新的链接。
      </p>
    </main>
  )
}
