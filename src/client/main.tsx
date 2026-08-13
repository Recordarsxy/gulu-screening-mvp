import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { api, currentAppMode } from './api.js';
import './styles.css';
import './modes.css';

function ModeChooser() {
  return <main className="mode-chooser">
    <p className="eyebrow">GULU SCREENING v1.4.0</p>
    <h1>选择运行模式</h1>
    <p className="mode-intro">离线演示使用完整的虚构案例，不需要谷露账号、浏览器扩展或 DeepSeek Key。</p>
    <div className="mode-cards">
      <a className="mode-card demo" href="/demo/jobs">
        <span>推荐</span><h2>离线演示</h2><p>固定虚构岗位 · 完整筛选流程 · 可导出结果</p><b>进入离线演示 →</b>
      </a>
      <a className="mode-card live" href="/live">
        <span>受保护</span><h2>真实谷露</h2><p>先检查扩展、配对、登录与 DeepSeek 环境</p><b>检查真实环境 →</b>
      </a>
    </div>
  </main>;
}

function LivePreflight() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.livePreflight>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api.livePreflight().then(setStatus).catch((reason) => setError(reason.message)); }, []);
  const checks = status ? [
    ['浏览器扩展在线', status.extensionOnline],
    ['谷露扩展已配对', status.paired],
    ['谷露登录状态', status.guluStatus === 'ready' || status.guluStatus === 'online'],
    ['DeepSeek 已配置', status.deepSeekConfigured],
  ] as const : [];
  return <main className="mode-chooser preflight-page">
    <p className="eyebrow">LIVE PREFLIGHT</p><h1>真实谷露环境检查</h1>
    {error && <div className="notice">环境检查失败：{error}</div>}
    {!status ? <p>正在检查本机环境…</p> : <div className="preflight-list">{checks.map(([label, ok]) => <div key={label}><b>{ok ? '✓' : '!'}</b><span>{label}</span><em>{ok ? '可用' : '未就绪'}</em></div>)}</div>}
    <div className="preflight-actions"><a className="ghost button" href="/">返回模式选择</a><a className="primary button" href="/live/jobs">进入真实工作台</a></div>
    <p className="muted">真实模式仍保留 dry-run、人工确认、只读限制和现有安全门。检查结果不会返回令牌或 API Key。</p>
  </main>;
}

function Root() {
  if (window.location.pathname === '/') return <ModeChooser />;
  if (window.location.pathname === '/live') return <LivePreflight />;
  const mode = currentAppMode();
  return <>
    <div className={`mode-banner ${mode}`}>
      <strong>{mode === 'demo' ? '离线演示模式 · 虚构演示数据' : '真实谷露模式'}</strong>
      <a href="/">切换模式</a>
    </div>
    <App mode={mode} />
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
