import { z } from 'zod';
export const statusSchema = z.string().trim().min(1).max(100).refine(s => !/[\r\n\x00-\x1f]/.test(s), 'Use a single-line status name');
export const transitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  source: statusSchema,
  target: statusSchema,
  label: statusSchema,
  mode: z.enum(['direct', 'resolution']),
}).refine(x => x.source !== x.target, 'Source and destination must differ');
export type Transition = z.infer<typeof transitionSchema>;
export type RecordedLocator = { kind: 'css' | 'role' | 'label'; value: string; role?: 'button' | 'menuitem' };
export type RecordedStep = { action: 'click' | 'fill' | 'selectOption'; locator: RecordedLocator; value?: string; effect: 'read' | 'mayMutate' };
export type Workflow = Transition & {
  id: string; familyId: string; version: number; state: 'draft' | 'validated';
  kind: 'builtin' | 'configured' | 'recorded'; script?: string; steps?: RecordedStep[];
  sampleKey?: string; validation?: { key: string; at: string; runId: string };
};
export type Teaching = { id: string; state: string; sampleKey: string; flow: Workflow; steps: RecordedStep[]; script: string; error?: string; status?: string; selectedControl?: { locator: RecordedLocator; kind: 'select' | 'input'; options?: string[] }; };
export const builtins: Workflow[] = [
  { id: 'fixture-implement-v1', familyId: 'fixture-implement', version: 1, kind: 'builtin', state: 'validated', name: 'Implement', source: 'Ready', target: 'Implement', label: 'Implement', mode: 'direct' },
  { id: 'fixture-done-v1', familyId: 'fixture-done', version: 1, kind: 'builtin', state: 'validated', name: 'Done', source: 'Implement', target: 'Done', label: 'Done', mode: 'resolution' },
];
