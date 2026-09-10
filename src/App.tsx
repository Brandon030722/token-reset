import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSnapshot, statusLabels, type Snapshot, type ResetEvent } from './domain';
import { parseHealth, parseSiteConfig, selectSignal, type Health, type SiteConfig } from './site-state';
const dataBase = import.meta.env.VITE_DATA_BASE_URL || import.meta.env.BASE_URL + 'data/';
const tabs = [{ id: 'overview', label: '概览' }, { id: 'activity', label: '动态' }, { id: 'mail', label: '邮件' }, { id: 'download', label: '下载' }] as const;
type Tab = typeof tabs[number]['id'];
const currentTab = (): Tab => tabs.find(t => '#' + t.id === window.location.hash)?.id ?? 'overview';
const formatTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '尚未成功';
function Arrow() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>; }
function EventCard({ event, snapshot }: { event: ResetEvent; snapshot: Snapshot }) {
  return <article className="event-card"><div className="event-meta"><span className={event.type === 'limited-reset' ? 'scope limited' : 'scope'}>{event.type === 'limited-reset' ? '限定人群' : event.type === 'credit-grant' ? '重置机会' : '广泛重置'}</span><time dateTime={event.announcedAt}>{formatTime(event.announcedAt)}</time></div>
    <h3>{event.title}</h3><p>{event.scope}</p><p className="muted">{event.reviewRequired ? '上下文待核验' : event.status === 'confirmed' ? '原帖宣布完成 · 请核对实际到账' : statusLabels[event.status]}</p>
    <details><summary>查看依据与原帖</summary>{snapshot.evidence.filter(e => event.evidenceIds.includes(e.id)).map(e => <div className="evidence" key={e.id}><p>{e.text}</p><a href={e.url} target="_blank" rel="noopener noreferrer">查看原帖 ↗</a></div>)}</details></article>;
}
export default function App() {
  const [tab, setTab] = useState<Tab>(currentTab);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true);
    const timeout = window.setTimeout(() => request.abort(), 15_000);
    const read = async (name: string) => {
      const response = await fetch(`${dataBase}${name}.json?t=${Date.now()}`, { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw Error('Data unavailable');
      return response.json() as Promise<unknown>;
    };
    try {
      const [h, s] = await Promise.allSettled([read('health').then(parseHealth), read('snapshot').then(v => {
        const parsed = parseSnapshot(v); if (parsed.mode !== 'live') throw Error('Live data required'); return parsed;
      })]);
      if (seq !== sequence.current) return;
      setHealth(h.status === 'fulfilled' ? h.value : null);
      if (s.status === 'fulfilled') setSnapshot(s.value);
      setReadFailed(h.status === 'rejected' || s.status === 'rejected');
      setNow(Date.now()); setLoading(false);
    } finally { clearTimeout(timeout); }
  }, []);
  useEffect(() => {
    void refresh();
    const request = new AbortController();
    const timeout = window.setTimeout(() => request.abort(), 15_000);
    let active = true;
    fetch(import.meta.env.BASE_URL + 'config.json', { cache: 'no-store', signal: request.signal }).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(parseSiteConfig)
      .then(c => { if (active) setConfig(c); }).catch(() => { if (active) setConfigFailed(true); }).finally(() => clearTimeout(timeout));
    const visible = () => { if (!document.hidden) { setNow(Date.now()); void refresh(); } };
    const hash = () => setTab(currentTab());
    const clock = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 30_000);
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, 300_000);
    document.addEventListener('visibilitychange', visible); window.addEventListener('hashchange', hash);
    return () => { active = false; ++sequence.current; controller.current?.abort(); request.abort(); clearTimeout(timeout); clearInterval(clock); clearInterval(poll); document.removeEventListener('visibilitychange', visible); window.removeEventListener('hashchange', hash); };
  }, [refresh]);
  useEffect(() => { document.title = `Token重置 · ${tabs.find(t => t.id === tab)!.label}`; }, [tab]);
  const select = (next: Tab) => { setTab(next); window.history.replaceState(null, '', '#' + next); };
  const signal = selectSignal(snapshot, health, readFailed, now);
  const unavailable = readFailed || health?.status === 'unavailable';
  const state = unavailable ? '采集暂不可用' : !snapshot ? '等待首次检查' : !signal.fresh ? '数据待更新' : '采集正常';
  const title = signal.score !== null ? signal.reachesThreshold ? '出现明确重置线索' : '还需要更多线索' : unavailable ? '暂时无法判断' : !snapshot ? '等待首次有效检查' : !signal.fresh ? '等待新数据' : '暂无广泛重置预告';
  const description = signal.summary ?? (unavailable ? '本轮未取得有效结果，历史动态仍可查看。' : !signal.fresh ? '取得新的有效数据后，才会显示当前评分。' : '已读取公开动态，目前没有符合条件的广泛重置预告。');
  const events = [...(snapshot?.events ?? [])].sort((a, b) => Date.parse(b.announcedAt ?? '') - Date.parse(a.announcedAt ?? ''));
  return <div className="site" data-ark-theme="popucom" data-ark-depth="moderate">
    <a className="skip" href="#content">跳到主要内容</a>
    <header className="masthead"><div className="masthead-inner"><a className="brand" href="#overview" onClick={() => select('overview')}><img src={import.meta.env.BASE_URL + 'favicon.svg'} width="44" height="44" alt="" /><span>Token重置<small>有消息，再提醒。</small></span></a><button className="header-action" onClick={() => select('download')}>获取桌面版 <Arrow /></button></div></header>
    <div className="workspace"><nav className="tabs" role="tablist" aria-label="观察站页面">{tabs.map((item, index) => <button key={item.id} id={'tab-' + item.id} role="tab" aria-selected={tab === item.id} aria-controls={'panel-' + item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => select(item.id)} onKeyDown={e => {
      const next = e.key === 'ArrowRight' ? (index + 1) % tabs.length : e.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (next >= 0) { e.preventDefault(); select(tabs[next].id); document.getElementById('tab-' + tabs[next].id)?.focus(); }
    }}>{item.label}</button>)}</nav>
    <main id="content" tabIndex={-1}>
      <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={tab !== 'overview'}>
        <div className="section-heading"><div><p className="eyebrow">公开消息 · 观察上限 48 小时</p><h1>重置，等一个明确信号。</h1></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}>{loading ? '正在读取…' : '刷新数据'} <span aria-hidden="true">↻</span></button></div>
        <div className="overview-grid"><article className="signal-card"><div className="card-heading"><span>重置信号评分</span><span className={'status ' + (signal.fresh ? 'healthy' : '')} role="status">{state}</span></div><div className="score" aria-label={signal.score === null ? '暂无有效评分' : `重置信号评分 ${signal.score} 分`}>{signal.score ?? '—'}{signal.score !== null && <small>/ 100</small>}</div><h2>{title}</h2><p className="signal-description">{description}</p><div className="score-rule"><strong>80 分提醒线</strong><span>信号强度，不是发生概率</span></div><div className="read-status"><span>最近成功检查 <time dateTime={snapshot?.checkedAt}>{formatTime(snapshot?.checkedAt)}</time></span>{health?.status === 'ok' && signal.fresh && health.posts !== undefined && <span>{health.posts} 条公开动态</span>}</div></article>
          <aside className="mail-preview"><span className="mail-glyph" aria-hidden="true">✉</span><p className="eyebrow">邮件提醒</p><h2>有值得关注的消息，<br />就寄一封信。</h2><p>凭邀请码订阅。由云端监控和发信，电脑关机也能收到。</p><button className="primary-button" onClick={() => select('mail')}>开启邮件提醒 <Arrow /></button><span className="muted">同一事件一次 · 随时退订</span></aside></div>
        {events[0] && snapshot && <div className="recent"><div className="section-heading compact"><h2>最近动态</h2><button className="quiet-button" onClick={() => select('activity')}>查看全部 <Arrow /></button></div>{!signal.fresh && <p className="muted">以下为历史记录，当前状态待更新。</p>}<EventCard event={events[0]} snapshot={snapshot} /></div>}
        <details className="method"><summary>80 分怎么算？</summary><div className="method-grid"><div><h3>同一段原文，四个条件</h3><p>明确提到 Codex 重置、明确承诺、广泛适用范围和有界时间，才可能达到提醒线；不会靠推文数量叠加分数。</p></div><div><h3>过期、撤回，就停止判断</h3><p>有效数据超过一小时、消息已完成或已撤回时，不再展示当前评分。回复缺少上下文时不会自动升级为邮件提醒。</p></div><div><h3>小范围消息，单独标注</h3><p>限定人群的重置或补偿会出现在「动态」。桌面版可发送本机通知；公共邮件目前提醒广泛重置信号。</p></div><div><h3>保留不确定性</h3><p>信息来自第三方公开镜像，可能遗漏或延迟。80 分是规则门槛，未经命中率校准，不代表 80% 的发生概率。</p></div></div></details>
      </section>
      <section id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={tab !== 'activity'}><div className="section-heading"><div><p className="eyebrow">@thsottiaux · 公开消息</p><h1>动态与依据</h1></div><span className="count">{events.length} 个事件</span></div>{!signal.fresh && <p className="notice">{snapshot ? '以下是历史记录，尚未确认当前状态。' : loading ? '正在读取公开动态…' : '暂无可用动态，请稍后刷新。'}</p>}<div className="events">{snapshot && events.map(event => <EventCard key={event.id} event={event} snapshot={snapshot} />)}</div>{signal.fresh && !events.length && <p className="empty">已完成检查，暂未发现符合条件的重置消息。</p>}</section>
      <section id="panel-mail" role="tabpanel" aria-labelledby="tab-mail" hidden={tab !== 'mail'}><div className="section-heading"><div><p className="eyebrow">凭邀请开启</p><h1>好消息，送进你的邮箱。</h1></div></div><div className="mail-layout"><article className="invitation-card"><h2>与你的桌面版，用同一套订阅。</h2><p>无需准备发件邮箱，也不需要配置邮件服务。</p><ol className="steps"><li><span>1</span><div><strong>填写邮箱和邀请码</strong><p>邀请码向邀请人获取，免费查看看板无需邀请码。</p></div></li><li><span>2</span><div><strong>点击邮件中的确认按钮</strong><p>确认邮箱属于你，才会开启邮件提醒。</p></div></li><li><span>3</span><div><strong>有明确信号，再收到提醒</strong><p>由 Token重置统一发信，每封提醒邮件都可退订。</p></div></li></ol>{config ? <a className="primary-button" href={config.subscriptionUrl} target="_blank" rel="noopener noreferrer">验证邀请码并订阅 <Arrow /></a> : <p className="notice" role="status">{configFailed ? '订阅入口暂时无法读取，请刷新页面重试。' : '正在读取订阅入口…'}</p>}<p className="muted">将在新的页面完成验证。已订阅的邮箱无需重复订阅。</p></article><aside className="mail-rules"><h2>你会收到什么？</h2><div><h3>公共重置消息</h3><p>广泛重置信号评分达到 80 分时提醒，同一事件一次。</p></div><div><h3>你自己的每周恢复提醒</h3><p>在桌面版读取 Codex 后单独开启。已同步的时间由云端预约，关机也能收到。</p><button className="quiet-button" onClick={() => select('download')}>获取桌面版 <Arrow /></button></div><details><summary>管理订阅与隐私</summary><p>通过邮件底部的退订入口或桌面版「提醒」管理订阅。退订会关闭公共邮件和个人预约。</p><p>邮箱与订阅状态由私有云端服务管理，不写入公开仓库。网页不读取你的 Codex 登录信息或额度。</p></details></aside></div></section>
      <section id="panel-download" role="tabpanel" aria-labelledby="tab-download" hidden={tab !== 'download'}><div className="section-heading"><div><p className="eyebrow">菜单栏 / 托盘常驻</p><h1>把提醒，放到桌面上。</h1></div>{config && <span className="version">v{config.desktopVersion}</span>}</div><p className="download-intro">点击 T! 打开看板，关闭面板后继续监控。</p><div className="downloads">{([{name:'macOS',detail:'Apple 芯片 · M1 及更新机型',url:config?.macDownloadUrl,instruction:'解压后，将 Token重置.app 放入「应用程序」并打开。',symbol:'M'},{name:'Windows',detail:'Intel / AMD · 64 位',url:config?.windowsDownloadUrl,instruction:'解压整个目录，双击 TiboMonitor.exe；保留同目录的其他文件。',symbol:'W'}]).map(platform => <article className="download-card" key={platform.name}><span className="platform-mark" aria-hidden="true">{platform.symbol}</span><h2>{platform.name}</h2><p>{platform.detail}</p>{platform.url ? <a className="primary-button" href={platform.url}>下载 {platform.name} 版 <Arrow /></a> : <p className="notice">{configFailed ? '下载入口读取失败，请刷新重试。' : '正在读取下载入口…'}</p>}<p className="install-note">{platform.instruction}</p></article>)}</div><div className="desktop-features"><span>每 15 分钟检查</span><span>独立四页看板</span><span>本机系统通知</span><span>每周额度与云端预约</span></div><details className="method"><summary>安装与使用说明</summary><p>更新前先退出旧版本再替换。Windows 包已包含 .NET，无需安装 Python 或 Node.js；缺少系统 WebView2 时会提示官方安装入口。Windows 图标可能位于任务栏隐藏图标区域。</p><p>个人额度需要本机 Codex 已安装并登录，Windows 暂不直接读取 WSL 内的 Codex。下一周期需要本机重新读取恢复时间，不会自动假定每七天循环。</p><p>系统通知是否显示取决于通知权限和勿扰设置。到点邮件表示记录的时间已到，不保证额度已到账。</p>{config && <a href={config.releaseUrl} target="_blank" rel="noopener noreferrer">查看完整发布说明 ↗</a>}</details></section>
    </main><footer><span>Token重置 · 独立公益项目</span><span>非 OpenAI 或 X 官方服务</span><span>约每 15 分钟采集 · 时间按设备时区显示</span></footer></div>
  </div>;
}
