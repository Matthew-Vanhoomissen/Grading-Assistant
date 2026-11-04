// Read-only code display with line numbers.

/**
 * Monospace code with a line-number gutter. Highlighted lines get the
 * "uncertain" style used for lines the model was unsure about.
 *
 * @param {object} props
 * @param {string} props.code - Source to show; a single trailing newline is not shown as an empty line.
 * @param {number[]} [props.highlight] - 1-indexed line numbers to highlight.
 */
export default function CodeBlock({ code, highlight = [] }) {
  const lines = code.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const marked = new Set(highlight)

  return (
    <pre className="code">
      {lines.map((line, i) => {
        const n = i + 1
        return (
          <div key={n} className={marked.has(n) ? 'line uncertain' : 'line'}>
            <span className="gutter">{n}</span>
            <span className="text">{line || ' '}</span>
          </div>
        )
      })}
    </pre>
  )
}
