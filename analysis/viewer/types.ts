import type { Result } from '../export.ts'
export type { Entity, Result } from '../export.ts'
export type Effect = Result['effects'][number]
export type Dependency = Result['dependencies'][number]
export type FlowPath = Result['paths'][number]
export type Edge = Result['edges'][number]
export type SourceRole = 'origin' | 'observation'
export type ReportAssets = { svg: string; stem: string }
declare global {
  interface Window {
    ANALYSIS_DATA: Result
    REPORT_ASSETS: ReportAssets
  }
}
