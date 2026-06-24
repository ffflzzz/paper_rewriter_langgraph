/**
 * Wrap text to a given width, breaking at word boundaries.
 */
export function wrapText(text: string, width: number): string[] {
  if (!text) return ['']
  
  const lines: string[] = []
  const paragraphs = text.split('\n')
  
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push('')
      continue
    }
    
    let remaining = para
    while (remaining.length > 0) {
      if (remaining.length <= width) {
        lines.push(remaining)
        break
      }
      
      // Find a break point
      let breakAt = remaining.lastIndexOf(' ', width)
      if (breakAt <= 0) breakAt = width
      
      lines.push(remaining.slice(0, breakAt))
      remaining = remaining.slice(breakAt).trimStart()
    }
  }
  
  return lines.length > 0 ? lines : ['']
}
