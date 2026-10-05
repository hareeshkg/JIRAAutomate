import { useEffect, useRef, useState } from 'react';
import type { Teaching, Workflow } from '../../../packages/contracts/src/workflows';
import type { Run } from '../../../packages/contracts/src/index';
type Props = { screen: string; flows: Workflow[]; api: (path: string, body?: unknown) => Promise<any>; changed: () => void; openTeach: () => void };
export function WorkflowStudio({ screen, flows, api, changed, openTeach }: Props) {
  const [name, setName] = useState('Custom Epic transition');
  const [source, setSource] = useState('Ready');
  const [target, setTarget] = useState('In Review');
  const [label, setLabel] = useState('Send for review');
  const [mode, setMode] = useState('direct');
  const [previous, setPrevious] = useState<string>();
  const [sample, setSample] = useState('DEMO-11');
  const [flowId, setFlowId] = useState('fixture-implement-v1');
  const [approved, setApproved] = useState(false);
  const [teach, setTeach] = useState<Teaching>();
  const [script, setScript] = useState('');
  const [recordName, setRecordName] = useState('My recorded Epic workflow');
  const [reviewed, setReviewed] = useState(false);
  const [saved, setSaved] = useState<Workflow>();
  const [validationKey, setValidationKey] = useState('DEMO-12');
  const [validation, setValidation] = useState<Run>();
  const [image, setImage] = useState('');
  const [metadata, setMetadata] = useState<any>();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const imageRef = useRef('');
  const loaded = useRef('');
  const teachingScreen = screen === 'Teach Workflow';
  useEffect(() => {
    if (!teach?.id || !['starting','recording'].includes(teach.state)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const session: Teaching = await api('/teach/' + teach.id);
        if (stopped) return;
        setTeach(session);
        if (session.state === 'recording' || loaded.current !== 'review' && session.state === 'review') setScript(session.script);
        loaded.current = session.state;
      } catch (e) { if (!stopped) setError((e as Error).message); }
    };
    poll(); const timer = setInterval(poll, 600);
    return () => { stopped = true; clearInterval(timer); };
  }, [teach?.id,teach?.state]);
  useEffect(() => {
    if (!teachingScreen || !teach || !['starting', 'recording'].includes(teach.state)) return;
    let stopped = false, pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/jobs/${teach.id}/preview/frame`);
        if (stopped) return;
        if (response.status === 204) { setMetadata(undefined); setImage(''); return; }
        if (!response.ok) return;
        const meta = JSON.parse(response.headers.get('X-Frame-Metadata') || '{}');
        const blob = await response.blob();
        if (stopped || meta.jobId !== teach.id) return;
        if (imageRef.current) URL.revokeObjectURL(imageRef.current);
        imageRef.current = URL.createObjectURL(blob);setImage(imageRef.current);setMetadata(meta);
      } catch {} finally { pending = false; }
    };
    poll(); const timer = setInterval(poll, 500);
    return () => { stopped = true; clearInterval(timer); if (imageRef.current) URL.revokeObjectURL(imageRef.current);imageRef.current = '';setImage('');setMetadata(undefined); };
  }, [teachingScreen, teach?.id, teach?.state]);
  useEffect(() => {
    if (!validation?.id || !['running','paused','pause_requested','stop_requested'].includes(validation.state)) return;
    let stopped = false;
    const poll = async () => {
      try { const run = await api('/runs/' + validation.id);if (stopped) return;setValidation(run);if (!['running', 'paused', 'pause_requested', 'stop_requested'].includes(run.state)) changed(); } catch (e) { if (!stopped) setError((e as Error).message); }
    };
    poll(); const timer = setInterval(poll, 800);
    return () => { stopped = true; clearInterval(timer); };
  }, [validation?.id,validation?.state]);
  async function task(work: () => Promise<void>) {
    setBusy(true);setError('');setMessage('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function action(body: unknown) {
    await task(async () => { await api(`/teach/${teach!.id}/actions`, body);const session = await api('/teach/' + teach!.id);setTeach(session);if (session.state === 'review') { setScript(session.script);loaded.current = 'review'; }setMetadata(undefined); });
  }
  async function validate(flow: Workflow) {
    if (!window.confirm(`Execute ${flow.label} on ${validationKey} to validate ${flow.name} v${flow.version}? This changes the local fixture Epic.`)) return;
    await task(async () => { const job = await api(`/flows/${flow.id}/validate`, { key: validationKey, confirmed: true });setValidation(await api('/runs/' + job.id)); });
  }
  async function saveScript() {
    await task(async () => {
      const flow = saved
        ? await api(`/flows/${saved.id}/revise`, { name: recordName, script, reviewed: true })
        : await api(`/teach/${teach!.id}/save`, { name: recordName, script, reviewed: true });
      setSaved(flow);setReviewed(false);changed();setMessage(`Saved immutable draft version ${flow.version}. Validate it on another Epic before bulk use.`);
    });
  }
  const recording = teach && ['starting', 'recording'].includes(teach.state);
  const validationActive = validation && ['running', 'paused', 'pause_requested', 'stop_requested'].includes(validation.state);
  return <div hidden={!['Teach Workflow', 'Status transitions'].includes(screen)}>
    {error && <div className="error" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {screen === 'Status transitions' && <>
      <div className="two"><section><h2>Define an Epic transition</h2><p>Define one direct workflow edge at a time. The transition label can differ from the destination status.</p>
        <label htmlFor="flow-name">Workflow name</label><input id="flow-name" value={name} onChange={e => setName(e.target.value)} />
        <label htmlFor="source-status">Source status</label><input id="source-status" value={source} onChange={e => setSource(e.target.value)} />
        <label htmlFor="transition-label">Transition label in Jira</label><input id="transition-label" value={label} onChange={e => setLabel(e.target.value)} />
        <label htmlFor="destination-status">Destination status</label><input id="destination-status" value={target} onChange={e => setTarget(e.target.value)} />
        <label htmlFor="transition-mode">Transition screen</label><select id="transition-mode" value={mode} onChange={e => setMode(e.target.value)}><option value="direct">Immediate transition</option><option value="resolution">Resolution dialog</option></select>
        <div className="actions"><button className="primary" disabled={busy || !!recording || !!validationActive} onClick={() => task(async () => { const f = await api('/flows', { definition: { name, source, target, label, mode }, previousId: previous });setPrevious(f.id);changed();setMessage(`Saved draft v${f.version}: ${f.source} → ${f.target}. Validate it before bulk use.`); })}>Save transition draft</button><button onClick={() => { setPrevious(undefined);setName('Custom Epic transition'); }}>New definition</button></div>
      </section><section><h2>Your status flow</h2><div className="notice">Definitions configure the local fixture and the application's workflow model. They do not change a Jira administrator's workflow.</div>
        {flows.filter((f, i, a) => a.findIndex(o => o.familyId === f.familyId) === i).map(f => <div className="row" key={f.id}><div><strong>{f.source} → {f.target}</strong><p>{f.label} · {f.mode === 'direct' ? 'Immediate' : 'Resolution dialog'} · v{f.version} · {f.state}</p></div>{f.kind === 'configured' && <button onClick={() => { setPrevious(f.id);setName(f.name);setSource(f.source);setTarget(f.target);setLabel(f.label);setMode(f.mode); }}>Edit as new version</button>}</div>)}
      </section></div>
    </>}
    {teachingScreen && <>
      <section><h2>Teach a workflow on one Epic</h2><div className="studioSetup"><div><label htmlFor="sample-key">Sample Epic</label><input id="sample-key" value={sample} disabled={!!recording} onChange={e => setSample(e.target.value)} /></div><div><label htmlFor="teach-flow">Workflow to demonstrate</label><select id="teach-flow" value={flowId} disabled={!!recording} onChange={e => setFlowId(e.target.value)}>{flows.map(f => <option key={f.id} value={f.id}>{f.name} v{f.version} · {f.source} → {f.target}</option>)}</select></div></div>
        <label className="checkbox"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I understand teaching changes the sample Epic in the local fixture.</label>
        <button className="primary" disabled={!approved || busy || !!recording || !!validationActive} onClick={() => task(async () => { const session = await api('/teach', { sampleKey: sample, flowId, confirmed: true });loaded.current = '';setTeach(session);setSaved(undefined);setReviewed(false);setScript(session.script); })}>Start teaching</button>
      </section>
      {teach && <div className="live"><section><div className="row"><h2>Interactive Chrome preview</h2><span className="badge">{teach.state}</span></div><p>Click browser controls in the image. Select a field, then enter its value using the field editor. Only actions performed here are recorded.</p>
        {image ? <img className={`frame interactive ${busy ? 'disabled' : ''}`} src={image} alt="Interactive teaching browser" onClick={e => { if (busy || !metadata || Date.now() - Date.parse(metadata.at) > 3000) return;const box = e.currentTarget.getBoundingClientRect();action({ action: 'click', frameSequence: metadata.sequence, x: Math.min(1279, Math.floor((e.clientX - box.left) * 1280 / box.width)), y: Math.min(799, Math.floor((e.clientY - box.top) * 800 / box.height)) }); }} /> : <div className="placeholder">{recording ? 'Waiting for a fresh browser frame…' : 'Recording finished. Review the generated script.'}</div>}
        <p className="muted">{metadata ? `${metadata.key} · ${new Date(metadata.at).toLocaleTimeString()} · click to interact` : '1280 × 800 browser viewport · frames stay in memory'}</p>
        {teach.selectedControl && <div className="notice"><label htmlFor="field-value">Selected field: {teach.selectedControl.locator.value}</label>{teach.selectedControl.kind === 'select' ? <select id="field-value" value={value} onChange={e => setValue(e.target.value)}><option value="">Choose…</option>{teach.selectedControl.options?.filter(o => o !== 'Select resolution').map(o => <option key={o}>{o}</option>)}</select> : <input id="field-value" value={value} onChange={e => setValue(e.target.value)} />}<button disabled={busy || !metadata || !value} onClick={() => action({ action: 'value', frameSequence: metadata.sequence, value })}>Apply and record value</button></div>}
        <button disabled={busy || teach.state !== 'recording'} onClick={() => action({ action: 'finish' })}>Finish and verify recording</button>
        {teach.error && <div className="error">{teach.error}</div>}
        {teach.state === 'review' && <div className="notice">Reloaded status: {teach.status}. Expected: {teach.flow.target}. {teach.status !== teach.flow.target && 'The demonstration did not reach its expected status; review the script before validation.'}</div>}
      </section><section><h2>Recorded steps</h2>{teach.steps.map((s, i) => <div className="row" key={i}><div><strong>{i + 1}. {s.action} {s.locator.value}</strong>{s.value && <p>Value: {s.value}</p>}</div><span className="badge">{s.effect === 'mayMutate' ? 'May update' : 'Read / field'}</span></div>)}<p className="muted">Selecting a transition may immediately change Jira. The first “May update” step is the mutation boundary.</p></section></div>}
      {(teach?.state === 'review' || saved?.kind === 'recorded') && <section><h2>Review, modify and save Playwright script</h2><label htmlFor="record-name">Workflow name</label><input id="record-name" value={recordName} onChange={e => setRecordName(e.target.value)} /><label htmlFor="playwright-script">Playwright script</label><textarea id="playwright-script" className="scriptEditor" spellCheck={false} value={script} onChange={e => { setScript(e.target.value);setReviewed(false); }} /><p>Supported edits: exact control locators, click, fill and selectOption with literal values. Keep the initial sample navigation and final reload/status assertion. Unsupported code is rejected with a line number.</p><label className="checkbox"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I reviewed the actions, field values and first mutation step.</label><div className="actions"><button className="primary" disabled={busy || !reviewed || !!recording} onClick={saveScript}>Save {saved ? 'new version' : 'workflow draft'}</button><button onClick={() => { const url = URL.createObjectURL(new Blob([script], { type: 'text/plain' }));const a = document.createElement('a');a.href = url;a.download = 'recorded-workflow.spec.ts';a.click();setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download script</button></div>{saved && <p>Saved {saved.name} v{saved.version}. Select its row below to validate it on another Epic.</p>}</section>}
    </>}
    <section><h2>Saved workflow versions</h2><label htmlFor="validation-key">Epic for validation (different from the teaching sample)</label><input id="validation-key" value={validationKey} onChange={e => setValidationKey(e.target.value)} />
      <div className="tableWrap"><table><thead><tr><th>Workflow</th><th>Source → destination</th><th>Transition</th><th>State</th><th>Actions</th></tr></thead><tbody>{flows.map(f => <tr key={f.id}><td>{f.name} v{f.version}<p>{f.kind}</p></td><td>{f.source} → {f.target}</td><td>{f.label}</td><td>{f.state}{f.validation && <p>Verified on {f.validation.key}</p>}</td><td><div className="actions">{f.kind !== 'builtin' && <button disabled={busy || !!recording || !!validationActive} onClick={() => validate(f)}>Validate on Epic</button>}{f.kind === 'recorded' && <button disabled={!!recording} onClick={() => { openTeach();setSaved(f);setScript(f.script || '');setRecordName(f.name);setReviewed(false); }}>Load script for editing</button>}</div></td></tr>)}</tbody></table></div>
      {validation && <div className="notice" role="status">Validation: {validation.state}. {validation.items.map(i => `${i.key}: ${i.state} — ${i.reason}`).join(' ')}{validation.state === 'completed' && ' This version is now available in Prepare batch.'}</div>}
    </section>
  </div>;
}
