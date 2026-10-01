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
    codespan({ text }) {
      return isPath(unescape(text)) ? pathLink(unescape(text)) : `<code>${text}</code>`
    },
    link({ href, text }) {
      const safe = /^https?:\/\//i.test(href) ? href : '#'
      return `<a href="${escape(safe)}" target="_blank" rel="noreferrer">${text}</a>`
    }
  }
})
// $x^2$ inline and $$...$$ blocks (strict rules, so "$5 and $10" stays text). KaTeX builds its own markup and ignores \href and friends
// unless trust is on, so formulas can't smuggle in links or HTML.
marked.use(markedKatex({ throwOnError: false, output: 'html' }))

/** A Windows path to a file or folder, like C:\\Users\\me\\report.docx. */
const PATH = /^[A-Za-z]:\\[^<>"|?*\n]*[^<>"|?*\n\s.,;:)]$/
const PATH_IN_TEXT = /\b[A-Za-z]:\\(?:[^<>"|?*\s\\]+\\)*[^<>"|?*\s\\]+\.[A-Za-z0-9]{1,6}\b/g
const isPath = (t: string): boolean => PATH.test(t.trim())
const unescape = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const pathLink = (p: string): string =>
  `<a href="#" data-path="${escape(p.trim())}" title="Click to open, Shift+click to show in its folder">${escape(p.trim())}</a>`

/** Turns file paths in plain text into links, leaving links and code that are already there alone. */
function linkPaths(html: string): string {
  return html.replace(/(<a\b[^>]*>[\s\S]*?<\/a>|<code\b[^>]*>[\s\S]*?<\/code>|<[^>]+>)|([^<]+)/g, (m, tag: string | undefined, text: string | undefined) =>
    tag ? tag : (text ?? '').replace(PATH_IN_TEXT, (p) => pathLink(unescape(p)))
  )
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = useMemo(() => linkPaths(marked.parse(text, { async: false })), [text])
  return (
    <div
      className="md select-text"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('[data-path]')
        if (!a) return
        e.preventDefault()
        void window.orbit.fileAction(a.dataset.path!, e.shiftKey ? 'reveal' : 'open')
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
