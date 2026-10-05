import type { RecordedLocator, RecordedStep } from './workflows.js';
export function locatorCode(l: RecordedLocator) {
  if (l.kind === 'role') return `page.getByRole(${JSON.stringify(l.role)}, { name: ${JSON.stringify(l.value)}, exact: true })`;
  if (l.kind === 'label') return `page.getByLabel(${JSON.stringify(l.value)}, { exact: true })`;
  return `page.locator(${JSON.stringify(l.value)})`;
}
export function generateScript(key: string, target: string, steps: RecordedStep[]) {
  return `import { test, expect } from 'playwright/test';\n\n// Configure Playwright baseURL for the fixture. The app replays typed actions, never this raw code.\ntest('Recorded Epic transition', async ({ page }) => {\n  await page.goto(${JSON.stringify('/fixture/browse/' + key)});\n${steps.map(s => `  await ${locatorCode(s.locator)}.${s.action}(${s.value === undefined ? '' : JSON.stringify(s.value)});`).join('\n')}\n  await page.reload();\n  await expect(page.getByTestId('issue-status')).toHaveText(${JSON.stringify(target)});\n});\n`;
}
