import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { demoSnapshot } from './demo';
import { isDesktop, checkOnDesktop, describeDesktopStatus, saveDesktopPreference, type DesktopStatus } from './desktop';
import { isFresh, parseSnapshot, statusLabels, type Snapshot, type ResetEvent } from './domain';
const dataBase = import.meta.env.VITE_DATA_BASE_URL || import.meta.env.BASE_URL + 'data/';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} saveDesktopPreference(k, v); };
const date = (v?: string) => v ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)) : '尚未明确';
const time = (v: string) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));
function Icon({ name, size = 20 }: { name: 'arrow' | 'mail' | 'check' | 'clock' | 'close' | 'refresh' | 'external' | 'spark'; size?: number }) {
  const p = { arrow: 'M4 12h16m-6-6 6 6-6 6', mail: 'M3 5h18v14H3z M3 6l9 7 9-7', check: 'm5 12 4 4L19 6', clock: 'M12 7v5l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', close: 'm6 6 12 12M6 18 18 6', refresh: 'M20 7a9 9 0 1 0 1 9M20 3v5h-5', external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7', spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p[name]} /></svg>;
}
function Trend({ data, window }: { data: Snapshot['history']; window: 24 | 48 }) {
  if (!data.length) return <div className="empty-chart">第一条有效评分到来后，趋势会出现在这里。</div>;
  const items = data.slice(-24), v = items.map(d => window === 24 ? d.probability24h : d.probability48h);
  const points = v.map((p, i) => `${36 + i * 564 / Math.max(v.length - 1, 1)},${132 - p * 1.06}`).join(' ');
  return <div className="trend"><svg viewBox="0 0 636 166" role="img" aria-label={`信号评分趋势，从 ${v[0]} 分到 ${v.at(-1)} 分`}>
    {[20, 50, 80].map(p => <g key={p}><line x1="36" x2="602" y1={132 - p * 1.06} y2={132 - p * 1.06} stroke={p === 80 ? '#bd691d' : '#d9dfdf'} strokeDasharray={p === 80 ? '6 6' : '0'} /><text x="0" y={137 - p * 1.06} fill="#636b74" fontSize="12">{p}</text></g>)}
    <polygon points={`36,132 ${points} ${v.length === 1 ? 36 : 600},132`} fill="#dcecff" /><polyline points={points} fill="none" stroke="#246ace" strokeWidth="3" strokeLinejoin="round" /><circle cx={v.length === 1 ? 36 : 600} cy={132 - v.at(-1)! * 1.06} r="6" fill="#ffcc32" stroke="#26314a" strokeWidth="2" /><text x="36" y="158" fill="#636b74" fontSize="12">{time(items[0].at)}</text><text x="602" y="158" textAnchor="end" fill="#636b74" fontSize="12">{time(items.at(-1)!.at)}</text>
  </svg></div>;
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [demo, setDemo] = useState(true), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const window = 48;
  const [view, setView] = useState<'overview' | 'history' | 'method'>('overview'), [selected, setSelected] = useState<ResetEvent | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false), [desktopStatus, setDesktopStatus] = useState('自动检查已开启 · 每 15 分钟一次');
  const [health, setHealth] = useState<{ status: string; source?: string; posts?: number; attemptedAt?: string } | null>(null);
  const hasLoadedLive = useRef(false);
  const [subscriptionUrl, setSubscriptionUrl] = useState(''), [consent, setConsent] = useState(false), [subscribeMessage, setSubscribeMessage] = useState('');
  const [personalTime, setPersonalTime] = useState(read('reset:personalTime') || ''), [plan, setPlan] = useState(read('reset:plan') || 'Plus'), [saved, setSaved] = useState(false), [now, setNow] = useState(Date.now());
  const subscribeDialog = useRef<HTMLDialogElement>(null), eventDialog = useRef<HTMLDialogElement>(null);
  const data = demo ? demoSnapshot : snapshot, fresh = data && (demo || (isFresh(data, now) && health?.status === 'ok' && health.attemptedAt === data.checkedAt)), f = data?.forecast;
  const fFresh = f && (demo || (f.method === 'rules-v2' && Date.parse(f.windowEndsAt) > now && Date.parse(f.validUntil) > now && Date.parse(f.generatedAt) <= now && now - Date.parse(f.generatedAt) < 3600_000));
  const probability = fresh && fFresh && f ? f.probability48h : null;
  const event = data?.events.find(e => e.id === f?.eventId), confirmed = data?.events.filter(e => e.status === 'confirmed') || [];
  async function refresh(switchToLive = true) {
    setLoading(true); setLoadError('');
    try { const h = await fetch(`${dataBase}health.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null); setHealth(h && ['ok', 'unavailable'].includes(h.status) ? h : null); const r = await fetch(`${dataBase}snapshot.json?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw Error(); const s = parseSnapshot(await r.json()); if (s.mode !== 'live') throw Error(); setSnapshot(s); if (switchToLive || (isDesktop && !hasLoadedLive.current)) setDemo(false); hasLoadedLive.current = true; }
    catch { setLoadError('本次未取得新的实时数据。请检查采集状态，历史记录不会被当作新消息。'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    fetch(import.meta.env.BASE_URL + 'config.json').then(r => r.json()).then(c => { if (typeof c.subscriptionUrl === 'string' && c.subscriptionUrl.startsWith('https://')) setSubscriptionUrl(c.subscriptionUrl); }).catch(() => {});
    const onMonitor = (event: Event) => {
      const detail = (event as CustomEvent<DesktopStatus>).detail;
      if (!detail || !['running', 'ok', 'cooldown', 'source-unavailable', 'failed', 'paused'].includes(detail.status)) return;
      setDesktopBusy(detail.status === 'running');
      setDesktopStatus(describeDesktopStatus(detail));
      if (detail.status !== 'running') void refresh(false);
    };
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); void refresh(false); } };
    globalThis.addEventListener('tibo:monitor', onMonitor);
    if (globalThis.window.__TIBO_DESKTOP_STATUS__) onMonitor(new CustomEvent('tibo:monitor', { detail: globalThis.window.__TIBO_DESKTOP_STATUS__ }));
    document.addEventListener('visibilitychange', onVisible);
    const id = globalThis.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, isDesktop ? 60_000 : 30_000);
    const poll = isDesktop ? undefined : globalThis.setInterval(() => { if (!document.hidden) void refresh(false); }, 300_000);
    return () => { globalThis.clearInterval(id); globalThis.clearInterval(poll); globalThis.removeEventListener('tibo:monitor', onMonitor); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  function requestRefresh() {
    if (!isDesktop) { void refresh(); return; }
    if (checkOnDesktop()) { setDesktopBusy(true); setDesktopStatus('正在检查公开动态…'); }
    else setDesktopStatus('无法启动检查，请重新打开应用。');
  }
  const openSubscribe = () => { setSubscribeMessage(''); subscribeDialog.current?.showModal(); };
  const openEvent = (e: ResetEvent) => { setSelected(e); eventDialog.current?.showModal(); };
  function subscribe(e: FormEvent) { e.preventDefault(); if (!subscriptionUrl) { setSubscribeMessage('订阅服务还没有连接。此操作没有提交邮箱，也不会发送邮件。'); return; } globalThis.open(subscriptionUrl, '_blank', 'noopener,noreferrer'); setSubscribeMessage('已打开 Brevo 订阅页面。新订阅请按提示确认邮箱。'); }
  const status = !demo && (!data || !fresh) ? '等待新数据' : f ? statusLabels[f.status] : '暂无明确线索';
  const collectionLabel = health?.status === 'unavailable' ? '采集暂时不可用' : !snapshot ? '等待首次采集' : !fresh ? '数据已过期' : '采集正常';
  const collectionNote = !snapshot ? '完成首次采集后，这里会显示真实结果。' : !fresh ? '暂不显示当前评分，历史记录仍可查看。' : !f ? '已读取' + (Number.isInteger(health?.posts) ? ' ' + health?.posts + ' 条' : '') + '公开动态，暂未发现符合条件的重置线索。评分显示“—”属于正常状态。' : '每 15 分钟尝试检查一次，有变化才值得打扰你。';
  return <>
    <a className="skip" href="#main">跳到主要内容</a>
    <header className="topbar"><div className="top-inner"><button className="brand" onClick={() => setView('overview')} aria-label="Tibo 观察站首页"><span className="brand-mark">T<span>!</span></span><span>Tibo 观察站<small>RESET OBSERVATORY</small></span></button><nav aria-label="主导航">{([['overview', '重置雷达'], ['history', '事件档案'], ['method', '我们怎么算']] as const).map(([v, title]) => <button key={v} className={view === v ? 'nav-active' : ''} onClick={() => setView(v)} aria-current={view === v ? 'page' : undefined}>{title}</button>)}</nav><button className="button yellow header-subscribe" onClick={openSubscribe}><Icon name="mail" />订阅提醒</button></div></header>
    <main id="main" className="page">{isDesktop && <div className="desktop-status" role="status"><span className="desktop-badge">本地应用</span><span>{desktopStatus}</span><small>{globalThis.window.__TIBO_DESKTOP__?.platform === 'macos' ? '关闭面板继续监控 · 右键菜单栏图标可退出' : '界面随应用加载 · 关闭窗口后停止监控'}</small></div>}<div className={`notice ${demo ? 'demo' : !fresh ? 'outdated' : ''}`} role="status"><span>{demo ? '演示模式' : collectionLabel}</span><p>{demo ? '先逛一逛。以下数值和记录用于展示，不会触发邮件。' : collectionNote}</p><button onClick={() => { if (demo && snapshot) setDemo(false); else if (!demo) setDemo(true); else { setDemo(false); void refresh(); } }} disabled={loading}>{demo ? '查看实时' : '体验演示'}<Icon name="arrow" size={15} /></button></div>
      {view === 'overview' && <><div className="page-title"><div><p className="eyebrow">A LITTLE HOPE, WITH EVIDENCE.</p><h1>今天，重置有戏吗<span className="question">?</span></h1></div><button className="text-button refresh" onClick={requestRefresh} disabled={loading || desktopBusy}><Icon name="refresh" />{loading || desktopBusy ? '正在检查' : isDesktop ? '立即检查' : '刷新消息'}</button></div>
        <div className="dashboard"><section className="forecast-card" aria-labelledby="forecast-title"><div className="card-top"><span className="pill blue">{status}</span><span className="small-label">观察上限 48 小时</span></div>
          <div className="forecast-body"><div className="probability"><p id="forecast-title">重置信号评分</p><div className="number">{probability ?? '—'}<span>{probability !== null ? '/100' : ''}</span><i><Icon name="spark" size={34} /></i></div><p className="estimate-label">{demo ? '演示数值' : probability === null ? (!demo && fresh ? '暂无有效线索，暂不估计' : '等待有效数据，暂不估计') : '信号强度 · 不是发生概率'}</p></div><div className="forecast-copy"><span className="small-label">观察结论</span><h2>{probability === null ? (!demo && fresh ? '还没有新的重置线索。' : '等待下一次有效检查。') : probability >= 80 ? '有消息了，再等一个实锤。' : '有一点动静，继续保持观察。'}</h2><p>{f?.summary || '只有取得有效公开线索后，才会生成信号评分。没有消息，也是一种正常状态。'}</p></div></div>
          <div className="chart-header"><span>信号评分变化</span><span className="legend"><i />虚线为 80 分邮件提醒线</span></div><Trend data={data?.history.filter(point => point.eventId === f?.eventId) || []} window={window} /><div className="card-bottom"><span><Icon name="clock" size={16} />{demo ? '示例记录' : '上次成功检查'} · {date(data?.checkedAt)}</span><button className="text-button" onClick={() => setView('method')}>查看依据 <Icon name="arrow" size={16} /></button></div></section>
          <aside className="subscribe-card"><div className="mail-symbol"><Icon name="mail" size={36} /></div><p className="eyebrow">GOOD NEWS, IN YOUR INBOX.</p><h2>到 <span>80 分</span>，<br />我们喊你。</h2><p>不用反复刷新。有界时间内的重置信号评分达到提醒线，就给你寄一封信。</p><div className="threshold-track"><div /><span>80 分</span></div><div className="threshold-labels"><span>继续观察</span><span>邮件提醒</span></div><button className="button navy" onClick={openSubscribe}>有消息叫我 <Icon name="arrow" /></button><ul className="mini-list"><li><Icon name="check" size={16} />同一事件只提醒一次</li><li><Icon name="check" size={16} />确认订阅后接收，随时退订</li></ul><p className="small-text">{subscriptionUrl ? '订阅由 Brevo 管理' : '订阅通道尚未开放 · 可查看流程'}</p></aside></div>
          <section className="event-section"><div className="section-title"><h2>这次消息，走到哪了？</h2><button className="text-button" onClick={() => setView('history')}>全部事件 <Icon name="arrow" size={16} /></button></div>{event ? <div className="event-strip"><div className="event-summary"><span className="pill pale">{event.type === 'credit-grant' ? '赠送重置机会' : '额度重置'}</span><h3>{event.title}</h3><p>{event.scope}</p></div><ol className="stage-track">{['出现线索', '明确承诺', '确认完成'].map((title, i) => { const n = event.status === 'confirmed' ? 2 : event.status === 'promised' ? 1 : 0; return <li className={i <= n ? 'done' : ''} key={title}><span>{i < n ? <Icon name="check" size={16} /> : i + 1}</span><strong>{title}</strong></li>; })}</ol><button className="button white" onClick={() => openEvent(event)}>打开事件 <Icon name="arrow" size={17} /></button></div> : <div className="empty-panel">还没有可展示的事件。相关线索会在采集成功后归档。</div>}</section>
          <div className="lower-grid"><section className="note-card"><span className="eyebrow">LAST RESET</span><h2>上一次，好消息是…</h2><p className="last-date">{date(confirmed[0]?.confirmedAt)}</p><p>{confirmed[0] ? `${confirmed[0].title}。预告与完成公告只计为同一件事。` : '目前还没有识别到明确完成公告。'}</p>{confirmed[0] && <button className="text-button" onClick={() => openEvent(confirmed[0])}>看这次记录 <Icon name="arrow" size={16} /></button>}</section><section className="note-card personal"><span className="eyebrow">MY NEXT BREAK</span><h2>也别忘了，你自己的恢复时间。</h2><details><summary>设置我的恢复时间 <span>只保存在这台设备</span></summary><form onSubmit={e => { e.preventDefault(); save('reset:personalTime', personalTime); save('reset:plan', plan); setSaved(true); }}><label>当前套餐<select value={plan} onChange={e => { setPlan(e.target.value); setSaved(false); }}>{['Plus', 'Pro', 'Business', '其他'].map(p => <option key={p}>{p}</option>)}</select></label><label>客户端显示的正常恢复时间<input type="datetime-local" value={personalTime} onChange={e => { setPersonalTime(e.target.value); setSaved(false); }} required /></label><button className="button white" type="submit">保存</button><span role="status">{saved ? '已保存在本机' : ''}</span></form></details>{personalTime && Number.isFinite(Date.parse(personalTime)) && <p className="personal-saved">{plan} · {date(new Date(personalTime).toISOString())}（手动记录）</p>}</section></div></>}
      {view === 'history' && <section><div className="page-title"><div><p className="eyebrow">ONE EVENT. THE WHOLE STORY.</p><h1>好消息档案</h1></div><span className="pill yellow">{data?.events.length || 0} 个事件</span></div><p className="intro">每次重置只占一张卡，预告、修正和完成都留在一起。</p><div className="archive">{data?.events.map(e => <button className="archive-card" key={e.id} onClick={() => openEvent(e)}><span className={`pill ${e.status === 'confirmed' ? 'yellow' : 'blue'}`}>{statusLabels[e.status]}</span><h2>{e.title}</h2><p>{e.scope}</p><div><span>{date(e.confirmedAt || e.announcedAt)}</span><span>{e.evidenceIds.length} 条线索 <Icon name="arrow" size={17} /></span></div></button>)}</div>{!data?.events.length && <div className="empty-panel">采集到的第一条相关线索，会从这里开始。</div>}</section>}
      {view === 'method' && <section><div className="page-title"><div><p className="eyebrow">A LITTLE LESS GUESSWORK.</p><h1>把依据，摊开来说。</h1></div></div><div className="method-grid">{[
        ['先看消息，再下结论','通过第三方 RSS 读取公开推文。转述、玩笑、个人周期恢复，不等于一次新的全局重置。回复缺少上下文时，不会自动升到邮件提醒线。'],
        ['80 分是提醒线','80 分是人为设置的提醒门槛，不是 80% 发生概率。新版 85 分要求同一段原文同时具备 Codex 重置、明确承诺、广泛范围和有界时间；不按推文数量叠加。'],
        ['同一件事，只记一次','预告与后续确认会尽量合并。同一事件只触发一次提醒。被撤回、已完成或数据过期的预测不会发送新的提醒；模糊关系留待核验。'],
        ['不确定，就说不确定','来源失效时保留历史并显示过期。镜像无法保证真实性和完整覆盖。当前没有足够样本宣称命中率。']
      ].map(([title, body], i) => <article key={title}><span className="method-number">0{i + 1}</span><h2>{title}</h2><p>{body}</p></article>)}</div><div className="method-footer"><h2>你的邮箱，不会写进公开仓库。</h2><p>订阅通过 Brevo 的确认表单完成，名单与退订状态由它管理。提醒邮件包含时间窗口、依据和退订入口。网页无账户登录，也不读取你的 Codex 额度。</p><button className="button yellow" onClick={openSubscribe}>查看订阅流程 <Icon name="mail" /></button></div></section>}
      {loadError && <p className="inline-error" role="status">{loadError}</p>}<footer><span><b>Tibo 观察站</b> · 独立公益项目</span><span>非 OpenAI 官方服务 · 时间按设备时区显示</span><button onClick={() => setView('method')}>信息与方法 <Icon name="external" size={14} /></button></footer></main>
    <dialog aria-label="订阅提醒" ref={subscribeDialog} className="dialog" onClick={e => { if (e.target === e.currentTarget) subscribeDialog.current?.close(); }}><button className="dialog-close" aria-label="关闭订阅窗口" onClick={() => subscribeDialog.current?.close()}><Icon name="close" /></button><span className="pill yellow">只在值得关注时打扰</span><h2>好消息，送到邮箱。</h2><p>有界时间内的重置信号评分达到 80 分时接收提醒。同一事件一次，每封邮件都可以退订。</p><ol className="subscribe-steps"><li><span>1</span>到 Brevo 填写邮箱</li><li><span>2</span>点击确认邮件里的订阅链接</li><li><span>3</span>等待有依据的重置提醒</li></ol><form onSubmit={subscribe}><label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required /><span>我愿意接收重置预测提醒，知道预测不保证发生。</span></label><button className="button navy full" disabled={!consent} type="submit">{subscriptionUrl ? '前往确认订阅' : '检查订阅通道'} <Icon name="external" size={18} /></button><p role="status" className="form-message">{subscribeMessage || (!subscriptionUrl ? '尚未连接 Brevo。本地预览不会收集邮箱。' : '将打开 Brevo 托管的订阅表单。')}</p></form></dialog>
    <dialog aria-label="事件证据" ref={eventDialog} className="dialog event-dialog" onClick={e => { if (e.target === e.currentTarget) eventDialog.current?.close(); }}><button className="dialog-close" aria-label="关闭事件窗口" onClick={() => eventDialog.current?.close()}><Icon name="close" /></button>{selected && <><span className="pill blue">{statusLabels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.scope}</p>{demo && <p className="demo-label">以下为示例摘要与示例时间，不作为实时重置证据。</p>}<div className="event-times"><div><span>预告</span><b>{date(selected.announcedAt)}</b></div><div><span>观察截止</span><b>{date(selected.expectedAt)}</b></div></div><div className="evidence-list">{data?.evidence.filter(e => selected.evidenceIds.includes(e.id)).map(e => <article key={e.id}><div><strong>{e.author}</strong><time>{date(e.postedAt)}</time></div><h3>{e.summary}</h3><p>{e.text}</p><a href={e.url} target="_blank" rel="noopener noreferrer">{demo ? '相关公开帖链接' : '查看原帖'} <Icon name="external" size={15} /></a></article>)}</div></>}</dialog>
  </>;
}
