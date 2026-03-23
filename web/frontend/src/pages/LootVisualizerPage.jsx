import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import { Search, Filter, ChevronDown, ChevronRight, ChevronUp, Eye, Layers, BarChart3, Tag, X, Loader } from '../components/Icon';

// ─── Rarity Classification ─────────────────────────────────

function getRarity(nominal) {
  if (nominal <= 0) return { label: 'Disabled', color: '#6b7280' };
  if (nominal <= 3) return { label: 'Legendary', color: '#f59e0b' };
  if (nominal <= 10) return { label: 'Rare', color: '#a78bfa' };
  if (nominal <= 25) return { label: 'Uncommon', color: '#3b82f6' };
  return { label: 'Common', color: '#22c55e' };
}

// ─── Utility: format seconds to human-readable ─────────────

function fmtTime(seconds) {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

// ─── Category color mapping ────────────────────────────────

const CATEGORY_COLORS = {
  weapons: '#ef4444',
  tools: '#f59e0b',
  food: '#22c55e',
  clothes: '#3b82f6',
  containers: '#a78bfa',
  vehiclesparts: '#ec4899',
  explosives: '#f97316',
  default: '#6b7280',
};

function getCategoryColor(cat) {
  if (!cat) return CATEGORY_COLORS.default;
  const key = cat.toLowerCase();
  return CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
}

// ─── Badge Component ───────────────────────────────────────

function Badge({ label, color, small }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '1px 6px' : '2px 8px',
      borderRadius: 4,
      fontSize: small ? 10 : 11,
      fontWeight: 600,
      background: color + '22',
      color: color,
      border: `1px solid ${color}44`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── Stat Card Component ───────────────────────────────────

function StatCard({ label, value, color, sub }) {
  return (
    <div className="card" style={{ padding: '16px 20px', minWidth: 140, flex: '1 1 0' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Bar Chart Row ─────────────────────────────────────────

function BarRow({ label, count, maxCount, color }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ width: 120, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: 'var(--bg-deep)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ width: 40, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{count}</span>
    </div>
  );
}

// ─── Item Detail Panel ─────────────────────────────────────

function ItemDetail({ item, onClose }) {
  if (!item) return null;
  const rarity = getRarity(item.nominal);
  return (
    <div className="card" style={{ padding: 20, marginBottom: 16, borderLeft: `3px solid ${rarity.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{item.name}</h3>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Badge label={rarity.label} color={rarity.color} />
            {item.category && <Badge label={item.category} color={getCategoryColor(item.category)} />}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}><X size={14} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Nominal', value: item.nominal },
          { label: 'Min', value: item.min },
          { label: 'Lifetime', value: fmtTime(item.lifetime) },
          { label: 'Restock', value: fmtTime(item.restock) },
          { label: 'Cost', value: item.cost },
          { label: 'Quant Min', value: item.quantmin },
          { label: 'Quant Max', value: item.quantmax },
        ].map(f => (
          <div key={f.label} style={{ background: 'var(--bg-deep)', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>{f.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{f.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Flags</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {item.count_in_cargo ? <Badge label="Count in Cargo" color="#3b82f6" small /> : null}
            {item.count_in_hoarder ? <Badge label="Count in Hoarder" color="#a78bfa" small /> : null}
            {item.count_in_map ? <Badge label="Count in Map" color="#22c55e" small /> : null}
            {item.count_in_player ? <Badge label="Count in Player" color="#f59e0b" small /> : null}
            {item.crafted ? <Badge label="Crafted" color="#ec4899" small /> : null}
            {item.deloot ? <Badge label="DE Loot" color="#ef4444" small /> : null}
          </div>
        </div>
        {item.usage?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Usage Zones</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {item.usage.map(u => <Badge key={u} label={u} color="#3b82f6" small />)}
            </div>
          </div>
        )}
        {item.value?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Value Tiers</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {item.value.map(v => <Badge key={v} label={v} color="#a78bfa" small />)}
            </div>
          </div>
        )}
        {item.tag?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Tags</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {item.tag.map(t => <Badge key={t} label={t} color="#f59e0b" small />)}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
        Source: <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{item.source_file}</span>
      </div>
    </div>
  );
}

// ─── Tab 1: Item Browser ───────────────────────────────────

function ItemBrowserTab({ items, limits }) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedItem, setSelectedItem] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  // Build category tree with counts
  const categoryTree = useMemo(() => {
    const counts = { '': items.length };
    for (const item of items) {
      const cat = item.category || 'uncategorized';
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [items]);

  const allCategories = useMemo(() => {
    const cats = new Set();
    for (const item of items) {
      if (item.category) cats.add(item.category);
    }
    // Add limit definition categories that may not have items yet
    for (const c of limits.categories || []) cats.add(c);
    return [...cats].sort();
  }, [items, limits.categories]);

  // Filtered + sorted items
  const filtered = useMemo(() => {
    let list = items;
    if (selectedCategory) {
      if (selectedCategory === 'uncategorized') {
        list = list.filter(i => !i.category);
      } else {
        list = list.filter(i => i.category === selectedCategory);
      }
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    // Sort
    list = [...list].sort((a, b) => {
      let av, bv;
      if (sortBy === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (sortBy === 'rarity') { av = a.nominal; bv = b.nominal; }
      else { av = a[sortBy] ?? 0; bv = b[sortBy] ?? 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [items, selectedCategory, search, sortBy, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [selectedCategory, search, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      {/* Category sidebar */}
      <div className="card" style={{ width: 200, flexShrink: 0, padding: 0, overflow: 'auto' }}>
        <div style={{ padding: '10px 12px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          Categories
        </div>
        <div
          onClick={() => setSelectedCategory('')}
          style={{
            padding: '8px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between',
            background: selectedCategory === '' ? 'var(--accent-blue)11' : 'transparent',
            color: selectedCategory === '' ? 'var(--accent-blue)' : 'var(--text-secondary)',
            borderLeft: selectedCategory === '' ? '3px solid var(--accent-blue)' : '3px solid transparent',
          }}
        >
          <span>All Items</span>
          <span style={{ fontWeight: 600, fontSize: 11 }}>{items.length}</span>
        </div>
        {allCategories.map(cat => (
          <div
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            style={{
              padding: '7px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between',
              background: selectedCategory === cat ? 'var(--accent-blue)11' : 'transparent',
              color: selectedCategory === cat ? 'var(--accent-blue)' : 'var(--text-secondary)',
              borderLeft: selectedCategory === cat ? '3px solid var(--accent-blue)' : '3px solid transparent',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat}</span>
            <span style={{ fontWeight: 600, fontSize: 11, flexShrink: 0 }}>{categoryTree[cat] || 0}</span>
          </div>
        ))}
        {/* Uncategorized bucket */}
        {categoryTree['uncategorized'] > 0 && (
          <div
            onClick={() => setSelectedCategory('uncategorized')}
            style={{
              padding: '7px 12px', cursor: 'pointer', fontSize: 13, display: 'flex', justifyContent: 'space-between',
              background: selectedCategory === 'uncategorized' ? 'var(--accent-blue)11' : 'transparent',
              color: selectedCategory === 'uncategorized' ? 'var(--accent-blue)' : 'var(--text-muted)',
              borderLeft: selectedCategory === 'uncategorized' ? '3px solid var(--accent-blue)' : '3px solid transparent',
              fontStyle: 'italic',
            }}
          >
            <span>Uncategorized</span>
            <span style={{ fontWeight: 600, fontSize: 11 }}>{categoryTree['uncategorized']}</span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Search + sort bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              className="input"
              placeholder="Search items..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 32, width: '100%' }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Item detail panel (if selected) */}
        {selectedItem && <ItemDetail item={selectedItem} onClose={() => setSelectedItem(null)} />}

        {/* Table */}
        <div className="card" style={{ overflow: 'auto', padding: 0 }}>
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => toggleSort('name')}>Name <SortIcon col="name" /></th>
                <th style={{ padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', width: 80, textAlign: 'right' }} onClick={() => toggleSort('nominal')}>Nominal <SortIcon col="nominal" /></th>
                <th style={{ padding: '8px 12px', width: 60, textAlign: 'right' }}>Min</th>
                <th style={{ padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', width: 90, textAlign: 'right' }} onClick={() => toggleSort('lifetime')}>Lifetime <SortIcon col="lifetime" /></th>
                <th style={{ padding: '8px 12px', width: 80, textAlign: 'right' }}>Restock</th>
                <th style={{ padding: '8px 12px', width: 100 }}>Rarity</th>
                <th style={{ padding: '8px 12px' }}>Category</th>
                <th style={{ padding: '8px 12px' }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {paged.map(item => {
                const rarity = getRarity(item.nominal);
                return (
                  <tr
                    key={item.name + item.source_file}
                    onClick={() => setSelectedItem(item)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-surface, var(--bg-deep))'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 500, fontSize: 12 }}>{item.name}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{item.nominal}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{item.min}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{fmtTime(item.lifetime)}</td>
                    <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>{fmtTime(item.restock)}</td>
                    <td style={{ padding: '6px 12px' }}><Badge label={rarity.label} color={rarity.color} small /></td>
                    <td style={{ padding: '6px 12px' }}>
                      {item.category && <Badge label={item.category} color={getCategoryColor(item.category)} small />}
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {item.value?.slice(0, 4).map(v => <Badge key={v} label={v} color="#a78bfa" small />)}
                        {item.value?.length > 4 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{item.value.length - 4}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No items match your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Economy Overview ───────────────────────────────

function EconomyOverviewTab({ items, limits }) {
  // Summary stats
  const stats = useMemo(() => {
    const total = items.length;
    const disabled = items.filter(i => i.nominal <= 0).length;
    const active = total - disabled;
    const avgNominal = active > 0 ? Math.round(items.filter(i => i.nominal > 0).reduce((s, i) => s + i.nominal, 0) / active) : 0;
    const avgLifetime = active > 0 ? Math.round(items.filter(i => i.nominal > 0).reduce((s, i) => s + i.lifetime, 0) / active) : 0;
    return { total, disabled, active, avgNominal, avgLifetime };
  }, [items]);

  // Rarity distribution
  const rarityDist = useMemo(() => {
    const dist = { Disabled: 0, Legendary: 0, Rare: 0, Uncommon: 0, Common: 0 };
    for (const item of items) {
      const r = getRarity(item.nominal);
      dist[r.label] = (dist[r.label] || 0) + 1;
    }
    return dist;
  }, [items]);

  const rarityColors = { Disabled: '#6b7280', Legendary: '#f59e0b', Rare: '#a78bfa', Uncommon: '#3b82f6', Common: '#22c55e' };
  const maxRarity = Math.max(...Object.values(rarityDist), 1);

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    const map = {};
    for (const item of items) {
      const cat = item.category || 'uncategorized';
      if (!map[cat]) map[cat] = { count: 0, totalNominal: 0, totalLifetime: 0 };
      map[cat].count++;
      map[cat].totalNominal += item.nominal;
      map[cat].totalLifetime += item.lifetime;
    }
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        count: d.count,
        avgNominal: Math.round(d.totalNominal / d.count),
        avgLifetime: Math.round(d.totalLifetime / d.count),
      }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const maxCategoryCount = Math.max(...categoryBreakdown.map(c => c.count), 1);

  // Usage zone breakdown
  const usageBreakdown = useMemo(() => {
    const map = {};
    for (const item of items) {
      for (const u of item.usage || []) {
        map[u] = (map[u] || 0) + 1;
      }
    }
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  const maxUsageCount = Math.max(...usageBreakdown.map(u => u.count), 1);

  return (
    <div>
      {/* Summary stat cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Total Items" value={stats.total} color="var(--text-primary)" />
        <StatCard label="Active Items" value={stats.active} color="#22c55e" sub={`${stats.disabled} disabled`} />
        <StatCard label="Avg Nominal" value={stats.avgNominal} color="#3b82f6" sub="active items" />
        <StatCard label="Avg Lifetime" value={fmtTime(stats.avgLifetime)} color="#a78bfa" sub="active items" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16 }}>
        {/* Rarity Distribution */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Rarity Distribution</h4>
          {Object.entries(rarityDist).map(([label, count]) => (
            <BarRow key={label} label={label} count={count} maxCount={maxRarity} color={rarityColors[label]} />
          ))}
        </div>

        {/* Category Breakdown Chart */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Items by Category</h4>
          {categoryBreakdown.slice(0, 12).map(cat => (
            <BarRow key={cat.name} label={cat.name} count={cat.count} maxCount={maxCategoryCount} color={getCategoryColor(cat.name)} />
          ))}
        </div>

        {/* Usage Zone Breakdown */}
        <div className="card" style={{ padding: 16 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700 }}>Items by Usage Zone</h4>
          {usageBreakdown.length > 0 ? (
            usageBreakdown.map(u => (
              <BarRow key={u.name} label={u.name} count={u.count} maxCount={maxUsageCount} color="#3b82f6" />
            ))
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No usage zone data found</div>
          )}
        </div>

        {/* Category Breakdown Table */}
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, borderBottom: '1px solid var(--border)' }}>Category Details</div>
          <table className="table" style={{ width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px' }}>Category</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Items</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Avg Nominal</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Avg Lifetime</th>
              </tr>
            </thead>
            <tbody>
              {categoryBreakdown.map(cat => (
                <tr key={cat.name}>
                  <td style={{ padding: '6px 12px' }}>
                    <Badge label={cat.name} color={getCategoryColor(cat.name)} small />
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{cat.count}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{cat.avgNominal}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'var(--font-mono, monospace)' }}>{fmtTime(cat.avgLifetime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 3: Spawn Analysis ─────────────────────────────────

function SpawnGroup({ label, groups, color }) {
  const [expanded, setExpanded] = useState(false);
  if (!groups || groups.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color, fontWeight: 600 }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label} ({groups.length} group{groups.length !== 1 ? 's' : ''})
      </div>
      {expanded && (
        <div style={{ marginLeft: 16, marginTop: 4 }}>
          {groups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                Group {gi + 1} - Chance: {(group.chance * 100).toFixed(0)}%
              </div>
              <div style={{ marginLeft: 12 }}>
                {group.items.map((it, ii) => (
                  <div key={ii} style={{ fontSize: 12, padding: '1px 0', display: 'flex', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)' }}>{it.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{(it.chance * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpawnAnalysisTab({ spawnableTypes, items }) {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all'); // all, with-attachments, plain
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Merge spawnable types with types.xml data for richer display
  const merged = useMemo(() => {
    const typesMap = {};
    for (const item of items) typesMap[item.name] = item;

    return spawnableTypes.map(st => ({
      ...st,
      typeData: typesMap[st.name] || null,
      hasAttachments: (st.attachments?.length > 0) || (st.cargo?.length > 0),
      totalAttachmentItems: (st.attachments || []).reduce((s, g) => s + g.items.length, 0),
      totalCargoItems: (st.cargo || []).reduce((s, g) => s + g.items.length, 0),
    }));
  }, [spawnableTypes, items]);

  const filtered = useMemo(() => {
    let list = merged;
    if (filterMode === 'with-attachments') list = list.filter(i => i.hasAttachments);
    else if (filterMode === 'plain') list = list.filter(i => !i.hasAttachments);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [merged, filterMode, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [filterMode, search]);

  const statsWithAttachments = merged.filter(i => i.hasAttachments).length;
  const statsPlain = merged.length - statsWithAttachments;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label="Spawnable Types" value={merged.length} color="var(--text-primary)" />
        <StatCard label="With Attachments" value={statsWithAttachments} color="#22c55e" />
        <StatCard label="Plain Items" value={statsPlain} color="var(--text-muted)" />
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search spawnable types..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'with-attachments', label: 'With Attachments' },
            { id: 'plain', label: 'Plain' },
          ].map(f => (
            <button
              key={f.id}
              className={`btn btn-sm ${filterMode === f.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterMode(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} item{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Spawnable types list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {paged.map(st => {
          const rarity = st.typeData ? getRarity(st.typeData.nominal) : null;
          return (
            <div key={st.name} className="card" style={{
              padding: '12px 16px',
              borderLeft: st.hasAttachments ? '3px solid #22c55e' : '3px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600, fontSize: 14 }}>{st.name}</span>
                {rarity && <Badge label={rarity.label} color={rarity.color} small />}
                {st.typeData?.category && <Badge label={st.typeData.category} color={getCategoryColor(st.typeData.category)} small />}
                {st.hoarder && <Badge label="Hoarder" color="#f59e0b" small />}
                {st.totalAttachmentItems > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {st.totalAttachmentItems} attachment{st.totalAttachmentItems !== 1 ? 's' : ''}
                  </span>
                )}
                {st.totalCargoItems > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {st.totalCargoItems} cargo item{st.totalCargoItems !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <SpawnGroup label="Attachments" groups={st.attachments} color="#22c55e" />
              <SpawnGroup label="Cargo" groups={st.cargo} color="#3b82f6" />
            </div>
          );
        })}
        {paged.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            No spawnable types match your filters
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────

const TABS = [
  { id: 'browser', label: 'Item Browser', icon: <Search size={14} /> },
  { id: 'overview', label: 'Economy Overview', icon: <BarChart3 size={14} /> },
  { id: 'spawns', label: 'Spawn Analysis', icon: <Layers size={14} /> },
];

export default function LootVisualizerPage({ serverId }) {
  const [activeTab, setActiveTab] = useState('browser');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [limits, setLimits] = useState({ categories: [], usages: [], values: [], tags: [] });
  const [spawnableTypes, setSpawnableTypes] = useState([]);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typesData, limitsData, spawnData] = await Promise.all([
        API.get(`/api/servers/${serverId}/types/items`),
        API.get(`/api/servers/${serverId}/types/limits`),
        API.get(`/api/servers/${serverId}/spawnabletypes`).catch(() => ({ items: [] })),
      ]);
      if (typesData.items) setItems(typesData.items);
      if (!limitsData.error) setLimits(limitsData);
      if (spawnData.items) setSpawnableTypes(spawnData.items);
    } catch (err) {
      setError(err.message || 'Failed to load data');
      window.addToast?.('Failed to load loot data', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <Loader size={24} className="spin" style={{ margin: '0 auto 12px' }} />
        <div style={{ color: 'var(--text-muted)' }}>Loading loot data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ color: 'var(--accent-red, #ef4444)', marginBottom: 12 }}>Failed to load loot data</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{error}</div>
        <button className="btn btn-primary" onClick={loadData}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={20} /> Loot Table Visualizer
        </h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Read-only view combining types.xml, cfgspawnabletypes.xml, and cfglimitsdefinition.xml
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px',
              fontSize: 13, fontWeight: 600,
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--accent-blue)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'browser' && <ItemBrowserTab items={items} limits={limits} />}
      {activeTab === 'overview' && <EconomyOverviewTab items={items} limits={limits} />}
      {activeTab === 'spawns' && <SpawnAnalysisTab spawnableTypes={spawnableTypes} items={items} />}
    </div>
  );
}
