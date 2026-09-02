export interface ParsedAccessEvent {
  eventType: string
  majorEventType?: number
  subEventType?: number
  cardNo?: string
  cardReaderNo?: number
  doorNo?: number
  dateTime?: string
  serialNo?: string
  rawXml: string
}

export interface ParsedResponseStatus {
  requestURL?: string
  statusCode?: number
  statusString?: string
  subStatusCode?: string
  rawXml: string
}

export class HikvisionXmlParser {
  private static readonly MAX_XML_LENGTH = 65536 // 64 KB limit

  /**
   * Validates XML string against size limits, DTDs, and hostile entity declarations (D1-001).
   */
  private static sanitizeXmlInput(xml: string): void {
    if (!xml || typeof xml !== 'string') {
      throw new Error('INVALID_XML_INPUT')
    }

    if (xml.length > this.MAX_XML_LENGTH) {
      throw new Error('XML_PAYLOAD_EXCEEDS_MAX_SIZE')
    }

    // D1-001: Reject DTDs, Entity declarations, and notations regardless of case or whitespace
    if (/<!\s*(?:doctype|entity|element|attlist|notation)\b/i.test(xml)) {
      throw new Error('XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES')
    }

    // Reject CDATA containing nested declarations
    if (/<!\[CDATA\[[\s\S]*?<!/i.test(xml)) {
      throw new Error('XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES')
    }

    // Reject external entity identifiers
    if (/\b(?:system|public)\s+["']/i.test(xml)) {
      throw new Error('XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES')
    }

    // Reject non-standard entity expansions (standard: amp, lt, gt, quot, apos, decimal/hex char refs)
    const hostileEntities = xml.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[a-zA-Z0-9_#]+;/g)
    if (hostileEntities && hostileEntities.length > 0) {
      throw new Error('XML_CONTAINS_FORBIDDEN_DTD_OR_ENTITIES')
    }
  }

  /**
   * Safely extracts the single unique occurrence of <tag>...</tag> within a scoped XML snippet.
   * If duplicate occurrences are found, throws DUPLICATE_XML_FIELD to fail closed (D1-004).
   */
  private static extractScopedUniqueTag(xmlScope: string, tagName: string): string | null {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${escapedTag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${escapedTag}>`, 'g')

    const matches: string[] = []
    let match: RegExpExecArray | null

    while ((match = pattern.exec(xmlScope)) !== null) {
      if (match[1] !== undefined) {
        matches.push(match[1].trim())
      }
    }

    if (matches.length === 0 || matches[0] === undefined) {
      return null
    }

    if (matches.length > 1) {
      throw new Error(`DUPLICATE_XML_FIELD: ${tagName}`)
    }

    return matches[0]
  }

  /**
   * Extracts the inner content of a parent container tag.
   * Fails closed if duplicate container tags exist to prevent container ambiguity.
   */
  private static extractSingleContainerScope(xml: string, containerName: string): string | null {
    const escaped = containerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${escaped}>`, 'g')

    const matches: string[] = []
    let match: RegExpExecArray | null

    while ((match = pattern.exec(xml)) !== null) {
      if (match[1] !== undefined) {
        matches.push(match[1])
      }
    }

    if (matches.length === 0 || matches[0] === undefined) {
      return null
    }

    if (matches.length > 1) {
      throw new Error(`AMBIGUOUS_XML_CONTAINER: ${containerName}`)
    }

    return matches[0]
  }

  /**
   * Sanitizes and parses an AccessControllerEvent XML document.
   * D1-002: Scopes extraction strictly to <AccessControllerEvent> container.
   */
  static parseEvent(xml: string): ParsedAccessEvent {
    this.sanitizeXmlInput(xml)

    // Extract eventType from overall document
    const eventType = this.extractScopedUniqueTag(xml, 'eventType') || 'unknown'

    // D1-002: Scope field extraction strictly to <AccessControllerEvent> block
    const eventScope = this.extractSingleContainerScope(xml, 'AccessControllerEvent')
    if (!eventScope) {
      return {
        eventType,
        rawXml: xml,
      }
    }

    // Extract scoped fields strictly inside <AccessControllerEvent>
    const majorStr = this.extractScopedUniqueTag(eventScope, 'majorEventType')
    const subStr = this.extractScopedUniqueTag(eventScope, 'subEventType')
    const cardNo = this.extractScopedUniqueTag(eventScope, 'cardNo') || undefined
    const readerStr = this.extractScopedUniqueTag(eventScope, 'cardReaderNo')
    const doorStr = this.extractScopedUniqueTag(eventScope, 'doorNo')
    const dateTime = this.extractScopedUniqueTag(eventScope, 'dateTime') || undefined
    const serialNo = this.extractScopedUniqueTag(eventScope, 'serialNo') || undefined

    const majorEventType = majorStr !== null && /^\d+$/.test(majorStr) ? parseInt(majorStr, 10) : undefined
    const subEventType = subStr !== null && /^\d+$/.test(subStr) ? parseInt(subStr, 10) : undefined
    const cardReaderNo = readerStr !== null && /^\d+$/.test(readerStr) ? parseInt(readerStr, 10) : undefined
    const doorNo = doorStr !== null && /^\d+$/.test(doorStr) ? parseInt(doorStr, 10) : undefined

    return {
      eventType,
      majorEventType,
      subEventType,
      cardNo,
      cardReaderNo,
      doorNo,
      dateTime,
      serialNo,
      rawXml: xml,
    }
  }

  /**
   * Safely parses a ResponseStatus XML document.
   */
  static parseResponseStatus(xml: string): ParsedResponseStatus {
    this.sanitizeXmlInput(xml)

    const responseScope = this.extractSingleContainerScope(xml, 'ResponseStatus') || xml

    const requestURL = this.extractScopedUniqueTag(responseScope, 'requestURL') || undefined
    const statusStr = this.extractScopedUniqueTag(responseScope, 'statusCode')
    const statusString = this.extractScopedUniqueTag(responseScope, 'statusString') || undefined
    const subStatusCode = this.extractScopedUniqueTag(responseScope, 'subStatusCode') || undefined

    const statusCode = statusStr !== null && /^-?\d+$/.test(statusStr) ? parseInt(statusStr, 10) : undefined

    return {
      requestURL,
      statusCode,
      statusString,
      subStatusCode,
      rawXml: xml,
    }
  }
}
