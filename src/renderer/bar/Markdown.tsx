import { useMemo } from 'react'
import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import 'katex/dist/katex.min.css'

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Model output can echo untrusted page content: render raw HTML as text, never as markup.
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, text }) {
      const safe = /^https?:\/\//i.test(href) ? href : '#'
      return `<a href="${escape(safe)}" target="_blank" rel="noreferrer">${text}</a>`
    }
  }
})
// $x^2$ inline and $$...$$ blocks (strict rules, so "$5 and $10" stays text). KaTeX builds its own markup and ignores \href and friends
// unless trust is on, so formulas can't smuggle in links or HTML.
marked.use(markedKatex({ throwOnError: false, output: 'html' }))

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = useMemo(() => marked.parse(text, { async: false }), [text])
  return <div className="md select-text" dangerouslySetInnerHTML={{ __html: html }} />
}
