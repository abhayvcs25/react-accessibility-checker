import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { run } from 'axe-core'
import App from '../App'

// Runs axe on the element and returns critical/serious/moderate violations.
// color-contrast is disabled because jsdom has no canvas (axe throws);
// document-title/html-has-lang are ignored because jsdom does not load
// index.html, so they are environment artifacts, not app bugs.
async function getViolations(element: HTMLElement) {
  const results = await run(element, {
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations.filter(
    v =>
      (v.impact === 'critical' || v.impact === 'serious' || v.impact === 'moderate') &&
      v.id !== 'document-title' &&
      v.id !== 'html-has-lang',
  )
}

describe('Accessibility Audit', () => {
  it('should have no accessibility violations on initial render', async () => {
    render(<App />)
    expect(await getViolations(document.body)).toEqual([])
  })

  it('should have no accessibility violations in HTML mode', async () => {
    render(<App />)
    expect(await getViolations(document.body)).toEqual([])
  })

  it('should have no accessibility violations in React Source mode', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'React Source (.jsx, .tsx)' }))
    expect(await getViolations(document.body)).toEqual([])
  })

  it('should have no accessibility violations in Project mode', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'React Project (folder)' }))
    expect(await getViolations(document.body)).toEqual([])
  })
})
