/** A unified diff, git style: removed lines red, added lines green, hunk headers dim. */
export function DiffView({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return (
    <div className={`overflow-auto rounded-lg bg-black/40 py-1.5 font-mono text-[11px] leading-[1.45] ${className}`} data-diff>
      {text.split('\n').map((line, i) => {
        const cls = line.startsWith('+')
          ? 'bg-emerald-500/15 text-emerald-200'
          : line.startsWith('-')
            ? 'bg-rose-500/15 text-rose-200'
            : line.startsWith('@@')
              ? 'text-sky-300/70'
              : line.startsWith('Careful:')
                ? 'text-amber-300'
                : 'text-zinc-400'
        return (
          <div key={i} className={`px-2.5 whitespace-pre-wrap break-words ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}
