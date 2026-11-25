import { useContext } from 'react'
import type { ReactNode } from 'react'
import { SourceDirectory } from './sourceDirectory.ts'
import type { Location } from './types.ts'

export function SourceLink({
  location,
  children,
  className,
}: {
  location: Location
  children: ReactNode
  className?: string
}) {
  const directory = useContext(SourceDirectory)?.replaceAll('\\', '/')
  const file = location.file.replaceAll('\\', '/')

  if (
    !directory ||
    !file ||
    /^(?:\/|[a-z]:)/i.test(file) ||
    file.split('/').includes('..')
  ) {
    return <span className={className}>{children}</span>
  }

  const path = [directory.replace(/\/+$/, ''), file].join('/')
  const encoded = path
    .split('/')
    .map((part, index) =>
      index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part),
    )
    .join('/')
  const uriPath = encoded.startsWith('/') ? encoded : '/' + encoded
  const position = `${location.startLine}:${location.startColumn}`

  return (
    <a
      className={`source-link ${className ?? ''}`}
      href={`vscode://file${uriPath}:${position}`}
      title={`Open ${location.file}:${position} in VS Code`}
    >
      {children}
    </a>
  )
}
