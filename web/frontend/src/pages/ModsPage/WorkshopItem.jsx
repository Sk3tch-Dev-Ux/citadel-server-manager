import { formatBytes } from '../../utils';
import { Download, Package, Clock, XCircle, Check, AlertTriangle, Loader, Puzzle } from '../../components/Icon';

export default function WorkshopItem({ item, isInstalled, isInstalling, installProgress, onInstall, formatSubs }) {
  if (!item || !item.workshopId) return null;
  const wid = String(item.workshopId);
  const installed = isInstalled(wid);
  const progress = installProgress[wid];
  const installing = isInstalling(wid);
  const failed = progress && (progress.status === 'error' || progress.status === 'steam_guard');
  const complete = progress && progress.status === 'complete';
  const name = item.name || 'Unknown Mod';
  const desc = typeof item.description === 'string' ? item.description : '';
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
  const subs = Number(item.subscribers) || 0;
  const fSize = Number(item.fileSize) || 0;
  let updatedStr = '';
  try { if (item.updated) updatedStr = new Date(item.updated).toLocaleDateString(); } catch(e) { /* ignore */ }

  const btnLabel = () => {
    if (installed || complete) return <><Check size={14} /> Installed</>;
    if (installing) return <><Loader size={14} /> {progress.progress ? Math.round(progress.progress) + '%' : '...'}</>;
    if (failed) return <><AlertTriangle size={14} /> Retry</>;
    return <><Download size={14} /> Install</>;
  };

  return (
    <div className={`workshop-item${installed ? ' installed' : ''}`}>
      {item.preview ? (
        <img className="workshop-thumb" src={item.preview} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div className="workshop-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}><Puzzle size={16} /></div>
      )}
      <div className="workshop-info">
        <div className="workshop-info-name">{name}</div>
        <div className="workshop-info-meta">
          <span>{'ID: ' + wid}</span>
          {subs > 0 && <span><Download size={12} /> {formatSubs(subs)}</span>}
          {fSize > 0 && <span><Package size={12} /> {formatBytes(fSize)}</span>}
          {updatedStr && <span><Clock size={12} /> {updatedStr}</span>}
        </div>
        {desc && <div className="workshop-info-desc">{desc}</div>}
        {tags.length > 0 && (
          <div className="workshop-info-tags">{tags.slice(0, 5).map((t, i) => <span key={i}>{String(t)}</span>)}</div>
        )}
        {installing && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--accent-blue)', marginBottom: 3 }}>{progress.message || 'Preparing...'}</div>
            <div style={{ background: 'var(--bg-deep)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${progress.progress || 5}%`, height: '100%', background: 'var(--accent-blue)', borderRadius: 4, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        )}
        {failed && <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}><XCircle size={12} /> {progress.message}</div>}
      </div>
      <button className="workshop-btn" disabled={installed || complete || installing}
        onClick={() => onInstall(wid, name)}
        style={installing ? { background: 'var(--accent-blue)', opacity: 0.7 } : failed ? { background: 'var(--accent-red)' } : {}}>
        {btnLabel()}
      </button>
    </div>
  );
}
