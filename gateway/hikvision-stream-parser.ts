export class HikvisionStreamParser {
  private buffer: string = ''
  private boundary: string | null = null
  private readonly maxBufferSize: number

  constructor(maxBufferSize: number = 65536) {
    this.maxBufferSize = maxBufferSize
  }

  setBoundary(boundary: string): void {
    this.boundary = boundary.replace(/^"|"$/g, '').trim()
  }

  /**
   * Appends a chunk of string data from the stream and extracts complete XML event payloads.
   */
  feed(chunk: string): string[] {
    this.buffer += chunk

    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = ''
      throw new Error('STREAM_BUFFER_OVERFLOW')
    }

    const events: string[] = []

    // Discover boundary if not explicitly configured
    if (!this.boundary) {
      const match = this.buffer.match(/--([a-zA-Z0-9_-]+)/)
      if (match && match[1]) {
        this.boundary = match[1]
      } else {
        return events
      }
    }

    const delimiter = `--${this.boundary}`

    while (true) {
      const delimiterPos = this.buffer.indexOf(delimiter)
      if (delimiterPos === -1) {
        break
      }

      // Find end of headers for this part
      const headerStart = delimiterPos + delimiter.length
      const headerEndRNRN = this.buffer.indexOf('\r\n\r\n', headerStart)
      const headerEndNN = this.buffer.indexOf('\n\n', headerStart)

      let headerEnd = -1
      let headerEndLen = 0

      if (headerEndRNRN !== -1 && (headerEndNN === -1 || headerEndRNRN <= headerEndNN)) {
        headerEnd = headerEndRNRN
        headerEndLen = 4
      } else if (headerEndNN !== -1) {
        headerEnd = headerEndNN
        headerEndLen = 2
      }

      if (headerEnd === -1) {
        // Headers still incomplete
        break
      }

      const headers = this.buffer.substring(headerStart, headerEnd)
      const bodyStart = headerEnd + headerEndLen

      // Check if Content-Length header is present
      const clMatch = headers.match(/Content-Length:\s*(\d+)/i)
      if (clMatch && clMatch[1]) {
        const contentLength = parseInt(clMatch[1], 10)
        if (this.buffer.length >= bodyStart + contentLength) {
          const body = this.buffer.substring(bodyStart, bodyStart + contentLength).trim()
          if (body.startsWith('<') && body.endsWith('>')) {
            events.push(body)
          }
          // Consume up to end of body
          this.buffer = this.buffer.substring(bodyStart + contentLength)
          continue
        } else {
          // Body not fully received yet
          break
        }
      }

      // If no Content-Length, look for the next delimiter
      const nextDelimiterPos = this.buffer.indexOf(delimiter, bodyStart)
      if (nextDelimiterPos !== -1) {
        const body = this.buffer.substring(bodyStart, nextDelimiterPos).trim()
        if (body.startsWith('<') && body.endsWith('>')) {
          events.push(body)
        }
        this.buffer = this.buffer.substring(nextDelimiterPos)
        continue
      }

      // No next delimiter and no Content-Length, wait for more data
      break
    }

    return events
  }

  reset(): void {
    this.buffer = ''
  }
}

