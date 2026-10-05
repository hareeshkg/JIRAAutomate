import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { builtins, transitionSchema, type Workflow, type Teaching } from '../../../packages/contracts/src/workflows.js';
import { keySchema, type Run } from '../../../packages/contracts/src/index.js';
import { generateScript, normalizeScript } from './recording.js';
import type { Store } from './storage.js';
export function allFlows(store: Store) { return [...builtins, ...store.list<Workflow>('flow')]; }
export function resolveFlow(store: Store, id?: string, target?: string) {
  const flow = id ? allFlows(store).find(f => f.id === id) : builtins.find(f => f.target === target);
  if (!flow) throw new Error('Choose a saved workflow');
  return flow;
}
export function registerWorkflows(app: FastifyInstance, store: Store, services: {
  busy: () => unknown; launch: (job: any) => void;
  action: (id: string, body: any) => Promise<any>;
}) {
  function available() { if (services.busy()) throw Object.assign(new Error('The browser profile is busy'), { statusCode: 409 }); }
  function compatible(definition: Workflow) {
    if (allFlows(store).some(f => f.source === definition.source && f.label === definition.label && (f.target !== definition.target || f.mode !== definition.mode))) throw new Error('This source/transition label already maps to another destination or dialog. Use a distinct label.');
  }
  app.get('/api/flows', async () => allFlows(store));
  app.post('/api/flows', async req => {
    const body = z.object({ definition: transitionSchema, previousId: z.string().optional() }).parse(req.body);
    const previous = body.previousId ? resolveFlow(store, body.previousId) : undefined;
    if (previous?.kind === 'builtin') throw new Error('Built-in workflows are preserved; create a separate definition');
    const id = randomUUID();
    const flow: Workflow = { ...body.definition, id, familyId: previous?.familyId || id, version: (previous?.version || 0) + 1, state: 'draft', kind: 'configured' };
    compatible(flow);store.put('flow', id, flow);return flow;
  });
  app.post('/api/teach', async (req, reply) => {
    available();
    const body = z.object({ sampleKey: keySchema, flowId: z.string(), confirmed: z.literal(true) }).parse(req.body);
    if (!body.sampleKey.startsWith('DEMO-')) throw new Error('Teaching currently supports local DEMO issues only');
    const flow = resolveFlow(store, body.flowId);
    const id = randomUUID();
    const session: Teaching = { id, state: 'starting', sampleKey: body.sampleKey, flow, steps: [], script: generateScript(body.sampleKey, flow.target, []) };
    store.put('teaching', id, session);services.launch({ id, kind: 'teach', sampleKey: body.sampleKey, flow, target: flow.target });
    return reply.code(202).send(session);
  });
  app.get('/api/teach/:id', async (req, reply) => store.get('teaching', (req.params as any).id) || reply.code(404).send({ error: 'Teaching session not found' }));
  app.post('/api/teach/:id/actions', async req => {
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('click'), frameSequence: z.number().int(), x: z.number().min(0).max(1279), y: z.number().min(0).max(799) }),
      z.object({ action: z.literal('value'), frameSequence: z.number().int(), value: z.string().max(1000) }),
      z.object({ action: z.literal('finish') }),
    ]).parse(req.body);
    return services.action((req.params as any).id, body);
  });
  app.post('/api/teach/:id/save', async req => {
    const session = store.get<Teaching>('teaching', (req.params as any).id);
    if (!session || session.state !== 'review') throw new Error('Finish recording before saving');
    const body = z.object({ name: z.string().trim().min(1).max(120), script: z.string(), reviewed: z.literal(true), previousId: z.string().optional() }).parse(req.body);
    const steps = normalizeScript(body.script, session.sampleKey, session.flow.target, session.flow.label);
    const previous = body.previousId ? resolveFlow(store, body.previousId) : undefined;
    if (previous && (previous.kind !== 'recorded' || previous.sampleKey !== session.sampleKey || previous.target !== session.flow.target)) throw new Error('Choose a version from this recording');
    const id = randomUUID();
    const flow: Workflow = { ...session.flow, id, familyId: previous?.familyId || id, version: (previous?.version || 0) + 1, state: 'draft', kind: 'recorded', name: body.name, sampleKey: session.sampleKey, script: body.script, steps, validation: undefined };
    compatible(flow);store.put('flow', id, flow);return flow;
  });
  app.post('/api/flows/:id/revise', async req => {
    const previous = resolveFlow(store, (req.params as any).id);
    if (previous.kind !== 'recorded') throw new Error('Script editing is available for recorded workflows');
    const body = z.object({ script: z.string(), name: z.string().trim().min(1).max(120), reviewed: z.literal(true) }).parse(req.body);
    const steps = normalizeScript(body.script, previous.sampleKey!, previous.target, previous.label);
    const id = randomUUID();const flow: Workflow = { ...previous, id, version: previous.version + 1, state: 'draft', script: body.script, name: body.name, steps, validation: undefined };
    store.put('flow', id, flow);return flow;
  });
  app.post('/api/flows/:id/validate', async (req, reply) => {
    available();const flow = resolveFlow(store, (req.params as any).id);
    if (flow.kind === 'builtin') throw new Error('Built-in fixture workflows already have fixture coverage');
    const body = z.object({ key: keySchema, confirmed: z.literal(true) }).parse(req.body);
    if (!body.key.startsWith('DEMO-') || body.key === flow.sampleKey) throw new Error('Use a different DEMO Epic for validation');
    if (store.list<Run>('run').some(r => r.items.some(i => i.key === body.key && i.state === 'outcome_uncertain'))) throw new Error('Reconcile the previous outcome for this issue first');
    const id = randomUUID();
    const run: Run = { id, planId: 'validation', version: flow.id, flowId: flow.id, validationFlowId: flow.id, target: flow.target, state: 'running', createdAt: new Date().toISOString(), events: [], items: [{ key: body.key, summary: 'Validation issue', type: 'Epic', from: flow.source, target: flow.target, eligibility: 'eligible', state: 'pending', reason: 'Confirmed workflow validation' }] };
    store.event(run, `Confirmed validation of ${flow.name} v${flow.version}`);
    services.launch({ id, kind: 'run', flow, rows: run.items, target: flow.target, values: { resolution: 'Done' } });
    return reply.code(202).send({ id });
  });
}
