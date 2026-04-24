import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import { timeAgo } from '../utils';

export default function UsersPage() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer', description: '' });
  const [newRole, setNewRole] = useState({ name: '', color: '#8b919a', permissions: [] });

  useEffect(() => { API.get('/api/users').then(d => setUsers(Array.isArray(d) ? d : [])); API.get('/api/roles').then(d => setRoles(Array.isArray(d) ? d : [])); }, []);
  // Audit log moved to its own dedicated page at /audit (full filters + CSV export)

  const addUser = async () => {
    if (!newUser.username || !newUser.password) return;
    const u = await API.post('/api/users', newUser);
    if (u.error) { window.addToast(u.error, 'error'); return; }
    setUsers(us => [...us, u]); setShowAddUser(false);
    setNewUser({ username: '', password: '', role: 'viewer', description: '' });
    window.addToast('User created', 'success');
  };

  const deleteUser = async (id) => {
    await API.del(`/api/users/${id}`);
    setUsers(us => us.filter(u => u.id !== id));
    window.addToast('User deleted', 'success');
  };

  const addRole = async () => {
    if (!newRole.name) return;
    const r = await API.post('/api/roles', newRole);
    if (r.error) { window.addToast(r.error, 'error'); return; }
    setRoles(rs => [...rs, r]); setShowAddRole(false);
    setNewRole({ name: '', color: '#8b919a', permissions: [] });
    window.addToast('Role created', 'success');
  };

  const deleteRole = async (id) => {
    await API.del(`/api/roles/${id}`);
    setRoles(rs => rs.filter(r => r.id !== id));
    window.addToast('Role deleted', 'success');
  };

  const allPermissions = ['server.view','server.start','server.stop','server.restart','server.rcon','server.config','server.deploy','players.view','players.kick','players.ban','mods.view','mods.install','files.browse','files.edit','logs.view','metrics.view','chat.send','users.manage','webhooks.manage'];

  const togglePerm = (perm) => {
    setNewRole(r => ({
      ...r,
      permissions: r.permissions.includes(perm) ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm]
    }));
  };

  return (
    <div>
      <div className="tabs" style={{ display: 'flex', alignItems: 'center' }}>
        <div className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>Users</div>
        <div className={`tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>Roles</div>
        <div style={{ flex: 1 }} />
        <Link to="/audit" className="btn btn-sm btn-ghost" style={{ marginRight: 8 }}>
          Audit Log →
        </Link>
      </div>

      {tab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowAddUser(true)}>+ Add User</button>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{users.map(u => {
              const role = roles.find(r => r.id === u.role);
              return (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: role?.color || 'var(--text-muted)' }}>{u.username[0]?.toUpperCase()}</div>
                    <div><div style={{ fontWeight: 600 }}>{u.username}</div>{u.isRoot && <div style={{ fontSize: 10, color: 'var(--accent-red)' }}>Root User</div>}{u.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.description}</div>}</div>
                  </div></td>
                  <td><span className="role-badge" style={{ background: (role?.color || '#8b919a') + '20', color: role?.color || '#8b919a' }}>{role?.name || u.role}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(u.createdAt)}</td>
                  <td>{!u.isRoot && <button className="btn btn-sm btn-danger" onClick={() => deleteUser(u.id)}>Delete</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>

          {showAddUser && (
            <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
              <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Add New User</div>
                <div className="input-group"><label className="input-label">Username</label><input className="input" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} /></div>
                <div className="input-group"><label className="input-label">Password</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} /></div>
                <div className="input-group"><label className="input-label">Role</label><select className="input" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                <div className="input-group"><label className="input-label">Description</label><input className="input" value={newUser.description} onChange={e => setNewUser({ ...newUser, description: e.target.value })} /></div>
                <div className="btn-group"><button className="btn btn-primary" onClick={addUser}>Create User</button><button className="btn btn-secondary" onClick={() => setShowAddUser(false)}>Cancel</button></div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'roles' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowAddRole(true)}>+ Add Role</button>
          </div>
          <div className="grid grid-2">
            {roles.map(role => (
              <div key={role.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: role.color }} />
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{role.name}</span>
                    {role.builtIn && <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 4 }}>Built-in</span>}
                  </div>
                  {!role.builtIn && <button className="btn btn-sm btn-danger" onClick={() => deleteRole(role.id)}>Delete</button>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
                  {role.permissions.includes('*') ? <span className="perm-chip active">* (all)</span> : role.permissions.map(p => <span key={p} className="perm-chip">{p}</span>)}
                </div>
              </div>
            ))}
          </div>

          {showAddRole && (
            <div className="modal-overlay" onClick={() => setShowAddRole(false)}>
              <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Create New Role</div>
                <div className="input-group"><label className="input-label">Name</label><input className="input" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} /></div>
                <div className="input-group"><label className="input-label">Color</label><input type="color" value={newRole.color} onChange={e => setNewRole({ ...newRole, color: e.target.value })} style={{ width: 50, height: 36, border: 'none', cursor: 'pointer', background: 'transparent' }} /></div>
                <div className="input-group">
                  <label className="input-label">Permissions</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {allPermissions.map(p => (
                      <span key={p} className={`perm-chip ${newRole.permissions.includes(p) ? 'active' : ''}`} onClick={() => togglePerm(p)} style={{ cursor: 'pointer' }}>{p}</span>
                    ))}
                  </div>
                </div>
                <div className="btn-group"><button className="btn btn-primary" onClick={addRole}>Create Role</button><button className="btn btn-secondary" onClick={() => setShowAddRole(false)}>Cancel</button></div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
