// Download the drawing as a standalone SVG. The live paths are hidden behind a
// dash offset that a CSS animation reveals, so that styling is stripped here or
// the file would open blank. Anything marked data-export="skip" (debug overlays,
// click targets) is left out.
export function exportSvg(svg, name) {
  if (!svg) return
  const clone = svg.cloneNode(true)
  clone.querySelectorAll('[data-export="skip"]').forEach((node) => node.remove())
  clone.querySelectorAll('path').forEach((path) => {
    path.removeAttribute('class')
    path.removeAttribute('style')
  })
  const [, , width, height] = clone.getAttribute('viewBox').split(/\s+/).map(Number)
  clone.removeAttribute('class')
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(Math.round(width)))
  clone.setAttribute('height', String(Math.round(height)))

  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.svg`
  link.click()
  URL.revokeObjectURL(url)
}
