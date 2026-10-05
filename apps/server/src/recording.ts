import ts from 'typescript';
import type { RecordedLocator, RecordedStep } from '../../../packages/contracts/src/workflows.js';
export { generateScript } from '../../../packages/contracts/src/script.js';
export function normalizeScript(script: string, key: string, target: string, transitionLabel?: string): RecordedStep[] {
  if (Buffer.byteLength(script) > 100_000) throw new Error('Script exceeds 100 KB');
  const source = ts.createSourceFile('recording.ts', script, ts.ScriptTarget.Latest, true);
  const fail = (node: ts.Node, message: string): never => { const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1; throw new Error(`Line ${line}: ${message}`); };
  const diagnostics=(source as ts.SourceFile & {parseDiagnostics:readonly ts.Diagnostic[]}).parseDiagnostics;
  if(diagnostics.length)fail(source,'Invalid TypeScript syntax');
  const literal = (node: ts.Node | undefined): string => node && ts.isStringLiteral(node) ? node.text : fail(node || source, 'Expected a literal string');
  const isId = (node: ts.Node, name: string) => ts.isIdentifier(node) && node.text === name;
  const locator = (node: ts.Expression): RecordedLocator => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !isId(node.expression.expression, 'page')) return fail(node, 'Use a supported page locator');
    const method = node.expression.name.text;
    if (method === 'locator') { const value = literal(node.arguments[0]); if (node.arguments.length !== 1 || !['#status-menu','#submit','#cancel','#resolution','#approval'].includes(value)) return fail(node, 'Only explicit fixture control IDs are supported as CSS'); return { kind: 'css', value }; }
    if (method === 'getByLabel') { const value = literal(node.arguments[0]); if (node.arguments.length !== 2 || node.arguments[1].getText(source).replace(/\s/g, '') !== '{exact:true}') return fail(node, 'Label locator requires exact: true'); return { kind: 'label', value }; }
    if (method === 'getByRole') {
      const role = literal(node.arguments[0]); if (!['button', 'menuitem'].includes(role)) return fail(node, 'Supported roles: button and menuitem');
      const options = node.arguments[1]; if (node.arguments.length !== 2 || !options || !ts.isObjectLiteralExpression(options)) return fail(node, 'Role requires literal name and exact: true');
      let name: string | undefined, exact = false;
      for (const property of options.properties) {
        if (!ts.isPropertyAssignment(property)) return fail(property, 'Unsupported locator property');
        const k = property.name.getText(source);
        if (k === 'name') name = literal(property.initializer); else if (k === 'exact' && property.initializer.kind === ts.SyntaxKind.TrueKeyword) exact = true; else return fail(property, 'Unsupported role option');
      }
      if (!name || !exact || options.properties.length !== 2) return fail(options, 'Role requires name and exact: true');
      return { kind: 'role', role: role as 'button' | 'menuitem', value: name };
    }
    return fail(node, 'Unsupported locator method');
  };
  let wrapper: ts.CallExpression | undefined;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (literal(statement.moduleSpecifier) !== 'playwright/test' || statement.importClause?.getText(source).replace(/\s/g, '') !== '{test,expect}') return fail(statement, 'Only the generated test/expect import is allowed');
    } else if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && isId(statement.expression.expression, 'test') && !wrapper) wrapper = statement.expression;
    else fail(statement, 'Only one test wrapper is allowed; arbitrary code is not executed');
  }
  if (!wrapper || wrapper.arguments.length !== 2 || !ts.isArrowFunction(wrapper.arguments[1])) return fail(source, 'Use the generated test wrapper');
  literal(wrapper.arguments[0]);
  const fn = wrapper.arguments[1]; if (!ts.isBlock(fn.body) || fn.parameters.length !== 1 || fn.parameters[0].getText(source).replace(/\s/g, '') !== '{page}' || !fn.modifiers?.some(x => x.kind === ts.SyntaxKind.AsyncKeyword)) return fail(fn, 'Use async ({ page }) => { ... }');
  const steps: RecordedStep[] = []; let goto = false, reload = false, assertion = false;
  for (const statement of fn.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression) || !ts.isCallExpression(statement.expression.expression)) return fail(statement, 'Only awaited supported actions are allowed');
    const call = statement.expression.expression;
    if (!ts.isPropertyAccessExpression(call.expression)) return fail(call, 'Unsupported action');
    const receiver = call.expression.expression, method = call.expression.name.text;
    if (isId(receiver, 'page') && method === 'goto') {
      if (goto || steps.length || call.arguments.length !== 1 || literal(call.arguments[0]) !== '/fixture/browse/' + key) return fail(call, 'Keep the initial sample issue navigation'); goto = true; continue;
    }
    if (!goto || assertion) return fail(call, 'Actions must follow navigation and precede the final assertion');
    if (isId(receiver, 'page') && method === 'reload') { if (reload || call.arguments.length) return fail(call, 'Keep one final reload'); reload = true; continue; }
    if (method === 'toHaveText' && ts.isCallExpression(receiver) && isId(receiver.expression, 'expect')) {
      if (!reload || call.arguments.length !== 1 || literal(call.arguments[0]) !== target || receiver.arguments.length !== 1 || receiver.arguments[0].getText(source).replace(/\s/g, '') !== "page.getByTestId('issue-status')" && receiver.arguments[0].getText(source).replace(/\s/g, '') !== 'page.getByTestId("issue-status")') return fail(call, 'Keep the exact destination status assertion after reload'); assertion = true; continue;
    }
    if (reload || !['click', 'fill', 'selectOption'].includes(method)) return fail(call, 'Unsupported action; use click, fill or selectOption');
    const l = locator(receiver);
    if (call.arguments.length !== (method === 'click' ? 0 : 1)) return fail(call, 'Unsupported action arguments');
    steps.push({ action: method as RecordedStep['action'], locator: l, value: method === 'click' ? undefined : literal(call.arguments[0]), effect: method === 'click' && !(l.kind === 'css' && l.value === '#status-menu') ? 'mayMutate' : 'read' });
    if (steps.length > 100) return fail(call, 'Maximum 100 actions');
  }
  if (!assertion || !steps.some(x => x.effect === 'mayMutate')) return fail(source, 'Record a transition and keep the reload/status assertion');
  if(transitionLabel){const transitions=steps.filter(s=>s.locator.kind==='role'&&s.locator.role==='menuitem');if(transitions.length!==1||transitions[0].locator.value!==transitionLabel)fail(source,'Keep exactly one selection of the configured transition label');}
  return steps;
}
