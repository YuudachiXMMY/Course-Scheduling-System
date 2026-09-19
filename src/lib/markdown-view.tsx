'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

// 渲染 Markdown（GFM：表格 / 任务列表 / 删除线）+ LaTeX 数学公式（KaTeX：行内 $...$、块级 $$...$$）。
// 课节笔记的教师端预览与门户学生/家长视图共用此组件。
//
// 安全：不启用 rehype-raw —— react-markdown 默认不解析笔记正文里的裸 HTML（当作纯文本），从源头杜绝
// 存储型 XSS。笔记虽由教师撰写，但会渲染给门户的不可信学生/家长，故按不可信内容处理。KaTeX 默认
// throwOnError=false，非法公式回退为红字源码而非崩溃。
//
// 样式：容器挂 `.markdown-body`（见 globals.css）补回 Tailwind preflight 抹平的标题/列表/表格排版，
// 无需引入 @tailwindcss/typography。
export default function MarkdownView({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
