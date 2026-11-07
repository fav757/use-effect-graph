import type { Dependency, Effect, Entity, Result } from './types.ts'

export const compact = (value: string | undefined, length = 60) => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > length ? text.slice(0, length - 1) + '…' : text
}

export const basename = (value: string) => value.split('/').at(-1) ?? value
export const at = (entity: Entity | undefined) =>
  entity
    ? `${basename(entity.location.file)}:${entity.location.startLine}`
    : 'Unknown location'
export const depsFor = (data: Result, effect: Effect) =>
  data.dependencies
    .filter((dep) => dep.effectId === effect.id)
    .sort((first, second) => first.index - second.index)
export const pathsFor = (data: Result, dependency?: Dependency) =>
  dependency
    ? data.paths.filter((path) => path.dependencyId === dependency.id)
    : []
export const color = (entity?: Entity) =>
  entity?.kind === 'react-state'
    ? 'green'
    : entity?.kind === 'unknown-call'
      ? 'amber'
      : ''
export const names: Record<string, string> = {
  'react-state': 'React state',
  literal: 'Literal value',
  'unknown-call': 'External call',
  'function-creation': 'Function identity',
  'object-creation': 'Object identity',
  'array-creation': 'Array identity',
  parameter: 'Parameter',
  'property-read': 'Property read',
  value: 'Value',
}
export const rules: Record<string, string> = {
  'value-flow': 'Value passed through',
  transformation: 'Value transformed',
  'property-read': 'Property read',
  'call-argument': 'Argument → parameter',
  'call-return': 'Returned from function',
  'callback-identity': 'Callback identity',
  'state-initial': 'Initial state value',
  'state-update': 'Possible state update',
  'state-update-functional': 'Functional state update',
  'effect-dependency': 'Declared dependency',
}
export const reasons: Record<string, string> = {
  'unknown-call': 'External calls stop at the available model boundary.',
  'react-state': 'React state is shown as a reactive source.',
  literal: 'Literal values are allocation-time origins.',
  'function-identity': 'Function identities are separate from captured values.',
  'object-identity': 'Object allocation is shown as an identity source.',
  'array-identity': 'Array allocation is shown as an identity source.',
  'parameter-interface': 'Parameter interfaces may have earlier sources.',
  'property-observation': 'Property observations may have earlier sources.',
  'no-modeled-origin': 'No earlier origin was found by the available model.',
}
export const modeName = (mode: string) =>
  mode === 'extended-state'
    ? 'State history'
    : mode === 'extended'
      ? 'State boundaries'
      : mode === 'standard-taint'
        ? 'Standard taint flow'
        : 'Standard value flow'
