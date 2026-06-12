import { findingsFileSchema, type FindingFromAgent } from '../../shared/findings-schema'
import { parseJsonWithSchema, type JsonParseResult } from './json-file'

export type ParseResult = JsonParseResult<FindingFromAgent[]>

export function parseFindings(raw: string): ParseResult {
  return parseJsonWithSchema(findingsFileSchema, raw)
}
