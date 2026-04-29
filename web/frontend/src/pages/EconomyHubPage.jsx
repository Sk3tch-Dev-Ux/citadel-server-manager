import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { FileCode, Zap, Globe, Layers, FolderOpen } from '../components/Icon';

const CARDS = [
  {
    key: 'types',
    title: 'Types Editor',
    icon: FileCode,
    color: 'var(--accent-blue)',
    route: 'types',
    description: 'Item spawns, loot economy, quantities, and lifetime settings',
    unit: 'items',
    fetch: (serverId) => API.get(`/api/servers/${serverId}/types/items`).then(d => d.items?.length ?? 0),
  },
  {
    key: 'events',
    title: 'Events Editor',
    icon: Zap,
    color: 'var(--accent-orange)',
    route: 'events',
    description: 'Dynamic events, zombie and animal spawn configurations',
    unit: 'events',
    fetch: (serverId) => API.get(`/api/servers/${serverId}/events`).then(d => d.events?.length ?? 0),
  },
  {
    key: 'globals',
    title: 'Globals Editor',
    icon: Globe,
    color: 'var(--accent-green)',
    route: 'globals',
    description: 'Economy variables, cleanup timers, and global limits',
    unit: 'variables',
    fetch: (serverId) => API.get(`/api/servers/${serverId}/globals`).then(d => d.globals?.length ?? 0),
  },
  {
    key: 'spawnabletypes',
    title: 'Spawnable Types',
    icon: Layers,
    color: 'var(--accent-purple)',
    route: 'spawnabletypes',
    description: 'Item attachments, cargo presets, and randomization rules',
    unit: 'items',
    fetch: (serverId) => API.get(`/api/servers/${serverId}/spawnabletypes`).then(d => d.items?.length ?? 0),
  },
  {
    key: 'economycore',
    title: 'Economy Core',
    icon: FolderOpen,
    color: 'var(--accent)',
    route: 'economycore',
    description: 'CE folder paths and XML file mappings — the root config that ties everything together',
    unit: 'folders',
    fetch: (serverId) => API.get(`/api/servers/${serverId}/economycore`).then(d => d.folders?.length ?? 0),
  },
];

function formatCount(n) {
  return n.toLocaleString();
}

export default function EconomyHubPage({ serverId }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.allSettled(
      CARDS.map(card =>
        card.fetch(serverId).then(count => ({ key: card.key, count }))
      )
    ).then(results => {
      if (cancelled) return;
      const next = {};
      // Use index-based access instead of indexOf (fixes the original bug
      // where indexOf could return wrong index for rejected promises)
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          next[r.value.key] = { count: r.value.count, error: false };
        } else {
          next[CARDS[i].key] = { count: 0, error: true };
        }
      });
      setCounts(next);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [serverId]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>Economy Hub</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
          Overview of all economy configuration files for this server.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {CARDS.map(card => {
          const Icon = card.icon;
          const data = counts[card.key];
          const isLoading = loading;
          const hasError = data?.error;

          return (
            <div
              key={card.key}
              className="card"
              onClick={() => navigate(`/servers/${serverId}/${card.route}`)}
              style={{
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = card.color;
                e.currentTarget.style.boxShadow = `0 0 0 1px ${card.color}30`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: card.color + '18',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: card.color,
                  flexShrink: 0,
                }}>
                  <Icon size={20} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {card.title}
                </div>
              </div>

              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
                {isLoading ? (
                  <div style={{
                    width: 80,
                    height: 28,
                    borderRadius: 6,
                    background: 'var(--border)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }} />
                ) : hasError ? (
                  <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>Not configured</span>
                ) : (
                  <>
                    {formatCount(data.count)}{' '}
                    <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>
                      {card.unit}
                    </span>
                  </>
                )}
              </div>

              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5, flex: 1 }}>
                {card.description}
              </p>

              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
                onClick={(e) => { e.stopPropagation(); navigate(`/servers/${serverId}/${card.route}`); }}
              >
                Open Editor
              </button>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
