export function NewlineRuleRepro() {
  return (
    <div>
      <span>first</span>{' '}

      <span
        data-first="a moderately long attribute value"
        data-second="another moderately long attribute value"
      >
        content
      </span>
    </div>
  )
}
