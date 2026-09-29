import { useEffect, useMemo, useState } from 'react';
import { definePluginApp, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contract';
import type { z } from 'zod';
import './app.css';

type Report = z.infer<typeof rpcContract.inspect.output>;
const number = (n: number) => n.toLocaleString();

export function ContextHealth({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [source, setSource] = useState<'shared' | 'codex'>('shared');
  const [view, setView] = useState<'content' | 'skills' | 'loaded'>('content');
  const [skillQuery, setSkillQuery] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [entrySort, setEntrySort] = useState('largest');
  const [entryLimit, setEntryLimit] = useState(25);
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    setReport(null); setProvider(null); setError(null); setCategory(null); setQuery(''); setSource('shared'); setSkillQuery(''); setView('content');
  }, [threadId]);
  useEffect(() => {
    let disposed = false, pending = false;
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true; setBusy(true);
      try {
        const result = await rpc.call('inspect', { threadId, source });
        if (!disposed) { setReport(result); setProvider(result.provider); setError(null); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        pending = false;
        if (!disposed) setBusy(false);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [rpc, threadId, revision, source]);
  const categories = useMemo(() => {
    const groups = new Map<string, { tokens: number; count: number }>();
    for (const entry of report?.entries ?? []) {
      const group = groups.get(entry.category) ?? { tokens: 0, count: 0 };
      group.tokens += entry.tokens; group.count++;
      groups.set(entry.category, group);
    }
    return [...groups.entries()].sort((a,b) => b[1].tokens - a[1].tokens);
  }, [report]);
  const total = categories.reduce((sum, [,g]) => sum + g.tokens, 0);
  const filtered = (report?.entries ?? []).filter(e => (!category || e.category === category) && `${e.title} ${e.category} ${e.preview}`.toLowerCase().includes(query.toLowerCase()));
  filtered.sort((a, b) => entrySort === 'name' ? a.title.localeCompare(b.title) : entrySort === 'smallest' ? a.tokens - b.tokens : b.tokens - a.tokens);
  const visibleEntries = filtered.slice(0, entryLimit);
  const filteredTokens = filtered.reduce((sum, entry) => sum + entry.tokens, 0);
  useEffect(() => { setEntryLimit(25); }, [query, category, entrySort, source, threadId]);
  const loadedSkills = [...new Map((report?.entries ?? []).filter(e => e.loadedSkill).map(e => [e.loadedSkill!.filePath, e])).values()];
  const usage = report?.usage;
  const percent = usage && usage.modelContextWindow > 0 ? 100 * usage.usedTokens / usage.modelContextWindow : null;
  const matchingSkills = (report?.skills ?? []).filter(s => `${s.name} ${s.description ?? ''} ${s.pluginId ?? ''}`.toLowerCase().includes(skillQuery.toLowerCase()));
  return <section className="context-health" aria-label="Context Health">
    <header className="ch-toolbar">
      <span className="ch-provider"><span className="ch-status-dot" />{provider ?? 'Thread context'}</span>
      <button onClick={() => setRevision(r => r + 1)} disabled={busy} aria-label="Refresh context health"><span aria-hidden="true" className={busy ? 'ch-refreshing' : ''}>↻</span> {busy ? 'Refreshing…' : 'Refresh'}</button>
    </header>
    {error && <p role="alert" className="ch-error">{error} {report && 'Showing the last successful snapshot.'}</p>}
    {!report && !error && <p role="status">Reading context…</p>}
    {report &&
      <div className={`ch-meter-card ${percent !== null && percent >= 90 ? 'ch-critical' : ''}`}>
        <div className="ch-meter-heading"><span className="ch-eyebrow">Context window</span><span className="ch-badge">{usage ? usage.estimated ? 'Estimated' : 'Provider reported' : 'Awaiting usage'}</span></div>
        <div className="ch-metric">{percent === null ? 'Unavailable' : `${Math.round(percent)}%`}<span>{usage ? `${number(usage.usedTokens)} / ${number(usage.modelContextWindow)} tokens` : 'The provider has not reported usage.'}</span></div>
        {percent !== null && <progress className={percent >= 90 ? 'ch-high' : ''} value={Math.min(percent, 100)} max={100} aria-label="Context window used" />}
        <p className="ch-muted">{usage ? `${percent !== null && percent >= 90 ? 'Context nearly full' : percent !== null && percent >= 70 ? 'Context is filling up' : 'Room to continue'}` : 'Usage may appear after the next model response.'}</p>
      </div>}
    {provider === 'codex' && <label className="ch-source-picker">Data source <select aria-label="Context data source" value={source} onChange={e => { setSource(e.target.value as 'shared' | 'codex'); setCategory(null); setQuery(''); setReport(null); setError(null); }}><option value="shared">BB recorded activity (all providers)</option><option value="codex">Codex session detail</option></select></label>}
    {report && <>
      <nav className="ch-view-switch" aria-label="Context views">
        <button aria-pressed={view === 'content'} onClick={() => setView('content')}>Recorded content <span>{report.entries.length}</span></button>
        <button aria-pressed={view === 'skills'} onClick={() => setView('skills')}>Available skills <span>{report.skills.length}</span></button>
        <button aria-pressed={view === 'loaded'} onClick={() => setView('loaded')}>Loaded skills <span>{loadedSkills.length}</span></button>
      </nav>
      {view === 'content' ? <>
      <div className="ch-section-heading"><h2>Recorded content</h2><span className="ch-muted">Estimated text</span></div>
      <p className="ch-muted">Explore the largest contributions below. Text estimates are separate from the usage meter.</p>
      {categories.length > 0 ? <>
        <div className="ch-categories">
          {categories.map(([name, group]) => <button key={name} className="ch-category" aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}>
            <span className="ch-category-line"><strong><span className="ch-category-dot" />{name}</strong><span>≈ {number(group.tokens)}</span></span>
            <span className="ch-bar"><span style={{ width: `${total ? group.tokens / total * 100 : 0}%` }} /></span>
            <span className="ch-muted">{number(group.count)} {group.count === 1 ? 'entry' : 'entries'} · {total ? Math.round(group.tokens / total * 100) : 0}% of estimated text</span>
          </button>)}
        </div>
        <section className="ch-entry-browser" aria-label="Context entries">
          <div className="ch-section-heading"><h2>{category ?? 'All entries'}</h2><span className="ch-badge">{number(filtered.length)}</span></div>
          <div className="ch-entry-controls">
            <input type="search" aria-label="Search context entries" placeholder="Search titles, categories or previews…" value={query} onChange={e => setQuery(e.target.value)} />
            <select aria-label="Sort context entries" value={entrySort} onChange={e => setEntrySort(e.target.value)}>
              <option value="largest">Largest first</option><option value="smallest">Smallest first</option><option value="name">Name A–Z</option>
            </select>
          </div>
          <div className="ch-entry-summary">
            <span className="ch-muted" role="status">{number(visibleEntries.length)} of {number(filtered.length)} entries · ≈ {number(filteredTokens)} tokens</span>
            {(category || query) && <button onClick={() => { setCategory(null); setQuery(''); }}>Clear filters</button>}
          </div>
          <div className="ch-entries ch-content-entries">
            {visibleEntries.map(entry => <details key={entry.id}>
              <summary>
                <span className="ch-entry-title"><strong title={entry.title}>{entry.title}</strong><small className="ch-entry-category">{entry.category}</small><span className="ch-entry-snippet">{entry.preview.replace(/\s+/g, ' ').trim() || 'No text preview available.'}</span></span>
                <span className="ch-entry-size"><b>≈ {number(entry.tokens)}</b><small>tokens</small></span>
              </summary>
              <div className="ch-entry-body">
                <div className="ch-entry-facts"><span>{number(entry.characters)} characters</span><span>{total ? (entry.tokens / total * 100).toFixed(1) : '0'}% of recorded text estimates</span></div>
                <pre tabIndex={0} aria-label={`Text preview: ${entry.title}`}>{entry.preview || 'No text preview available.'}</pre>
                {entry.characters > Array.from(entry.preview).length && <p className="ch-muted">Showing the first 1,200 characters. The estimate covers the full recorded entry.</p>}
              </div>
            </details>)}
          </div>
          {filtered.length === 0 && <div role="status" className="ch-empty"><strong>No matching entries</strong><p>Try a shorter search or clear the category filter.</p><button onClick={() => { setCategory(null); setQuery(''); }}>Reset search</button></div>}
          {filtered.length > entryLimit && <button className="ch-load-more" onClick={() => setEntryLimit(limit => limit + 25)}>Show {Math.min(25, filtered.length - entryLimit)} more <span>({number(filtered.length - entryLimit)} remaining)</span></button>}
        </section>
      </> : <p className="ch-empty">No recorded text is available in this inspection window.</p>}
      </> : view === 'loaded' ? <>
      <div className="ch-section-heading"><h2>Loaded skills</h2><span className="ch-muted">{loadedSkills.length}</span></div>
      <p className="ch-muted">Skill contents observed in recorded tool results. This does not guarantee they remain in the current context. Estimates are already included in tool results.</p>
      <div className="ch-entries">{loadedSkills.map(entry => <details key={entry.loadedSkill!.filePath}><summary><span className="ch-entry-title">{entry.loadedSkill!.name}<small>Read observed · ≈ {number(entry.tokens)} result tokens</small></span></summary><div className="ch-entry-body"><p className="ch-source">{entry.loadedSkill!.filePath}</p><pre>{entry.preview}</pre></div></details>)}</div>
      {!loadedSkills.length && <p role="status" className="ch-empty">No skill loads could be verified in this inspection window.{report.provider === 'codex' && source === 'shared' ? ' Try Codex session detail for additional recorded evidence.' : ''}</p>}
      </> : <>
      <div className="ch-section-heading"><h2>Available skills</h2><span className="ch-muted">{report.skills.length}</span></div>
      <p className="ch-muted">Current inventory for this provider. Availability does not mean a skill is loaded; excluded from token totals.</p>
      <input type="search" aria-label="Search available skills" placeholder="Search skills and plugins…" value={skillQuery} onChange={e => setSkillQuery(e.target.value)} />
      <div className="ch-entries">{matchingSkills.map(s => <details key={s.id}><summary><span className="ch-entry-title">{s.name}<small>{s.pluginId || s.scope} · available</small></span></summary><div className="ch-entry-body"><p>{s.description || 'No description available.'}</p><p className="ch-source">{s.filePath}</p></div></details>)}</div>
      {matchingSkills.length === 0 && <p role="status" className="ch-empty">{skillQuery ? 'No skills match this search.' : 'No skills are available in this inventory.'}</p>}
      </>}
      <details className="ch-coverage"><summary>Data coverage &amp; accuracy</summary><ul>{report.notices.map(n => <li key={n}>{n}</li>)}</ul>{report.source && <p className="ch-source">Source: {report.source}</p>}</details>
      {!report.entries.length && report.notices.map(n => <p className="ch-muted" key={n}>{n}</p>)}
      <p className="ch-muted ch-updated">Updated {new Date(report.updatedAt).toLocaleTimeString()} · refreshes every 30 seconds while visible</p>
    </>}
  </section>;
}
export default definePluginApp(app => {
  app.slots.threadPanelAction({ id: 'context-health', title: 'Context Health', component: ContextHealth });
});
