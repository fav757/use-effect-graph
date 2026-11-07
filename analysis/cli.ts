import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export class ProcessFailure extends Error {
  readonly exitCode: number
  constructor(exitCode: number, executable: string) {
    super(`${executable} failed with exit code ${exitCode}`)
    this.exitCode = exitCode
  }
}
export type Command = (
  executable: string,
  arguments_: string[],
  capture?: boolean,
) => string
export const command: Command = (executable, arguments_, capture = false) => {
  const child = spawnSync(executable, arguments_, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (child.error) throw child.error
  if (child.status !== 0)
    throw new ProcessFailure(child.status ?? 1, executable)
  return child.stdout ?? ''
}

/** Accept the existing -PascalCase options and conventional --kebab-case aliases. */
export function options(
  arguments_: string[],
  values: string[],
  switches: string[] = [],
) {
  const normalize = (name: string) =>
    name.replace(/^-+/, '').replaceAll('-', '').toLowerCase()
  const names = new Map(
    [...values, ...switches].map((name) => [normalize(name), name]),
  )
  const parsed: Record<string, string | boolean> = {}
  for (let index = 0; index < arguments_.length; index++) {
    const [flag, ...inline] = arguments_[index].split('=')
    const name = names.get(normalize(flag))
    if (!flag.startsWith('-') || !name)
      throw new Error(`Unknown option: ${flag}`)
    if (switches.includes(name)) {
      if (inline.length)
        throw new Error(`Switch ${flag} does not accept a value`)
      parsed[name] = true
    } else {
      const value = inline.length ? inline.join('=') : arguments_[++index]
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for ${flag}`)
      parsed[name] = value
    }
  }
  return parsed
}
export function isMain(url: string) {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url)
}
export function main(action: () => unknown) {
  try {
    action()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = error instanceof ProcessFailure ? error.exitCode : 1
  }
}
