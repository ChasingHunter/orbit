import type { LucideIcon } from 'lucide-react'

export const dash = window.orbit.dash

export function PageHeader(props: { title: string; subtitle?: string; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-50">{props.title}</h1>
        {props.subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-400">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
    </div>
  )
}

export function Card(props: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={`rounded-xl border border-white/[0.07] bg-zinc-900/70 ${props.className ?? ''}`}>{props.children}</div>
}

type ButtonProps = {
  children?: React.ReactNode
  icon?: LucideIcon
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger' | 'outline'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}

export function Button({ children, icon: Icon, onClick, variant = 'outline', disabled, title, type = 'button' }: ButtonProps): React.JSX.Element {
  const styles = {
    primary: 'bg-sky-500 text-white hover:bg-sky-400',
    outline: 'border border-white/10 text-zinc-200 hover:bg-white/[0.06]',
    ghost: 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100',
    danger: 'text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300'
  }[variant]
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        children ? '' : 'px-2'
      } ${styles}`}
    >
      {Icon && <Icon size={15} />}
      {children}
    </button>
  )
}

export function Empty(props: { icon: LucideIcon; title: string; children?: React.ReactNode }): React.JSX.Element {
  const Icon = props.icon
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-6 py-14 text-center">
      <Icon size={28} className="text-zinc-600" />
      <div className="mt-3 text-sm font-medium text-zinc-300">{props.title}</div>
      {props.children && <div className="mt-1 max-w-sm text-sm text-zinc-500">{props.children}</div>}
    </div>
  )
}

const fieldBase =
  'rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-400/60'
export const inputClass = `w-full ${fieldBase}`
export const selectClass = `w-auto ${fieldBase}`

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}
