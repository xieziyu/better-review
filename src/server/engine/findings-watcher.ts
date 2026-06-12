import { parseFindings, type ParseResult } from './findings-parser'
import { watchParsedJson } from './json-file'

export function watchFindings(
  file: string,
  onParsed: (r: ParseResult) => void,
): Promise<() => Promise<void>> {
  return watchParsedJson(file, parseFindings, onParsed)
}
