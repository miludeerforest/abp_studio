import { useState, useEffect } from 'react'

function UserManagement({ token }) {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [showAddModal, setShowAddModal] = useState(false)
    const [stats, setStats] = useState(null)
    const [lastRefreshed, setLastRefreshed] = useState(Date.now())

    // Form State
    const [newUserUser, setNewUserUser] = useState('')
    const [newUserPass, setNewUserPass] = useState('')

    // Changing Password Form
    const [editUserId, setEditUserId] = useState(null)
    const [newPass, setNewPass] = useState('')

    useEffect(() => {
        fetchUsers()
        fetchStats()
    }, [lastRefreshed])

    const fetchUsers = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/v1/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setUsers(await res.json())
            }
        } catch (e) {
            console.error("Fetch users failed", e)
        } finally {
            setLoading(false)
        }
    }

    const fetchStats = async () => {
        try {
            const res = await fetch('/api/v1/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setStats(await res.json())
            }
        } catch (e) {
            console.error("Fetch stats failed", e)
        }
    }

    const handleAddUser = async (e) => {
        e.preventDefault()
        try {
            const res = await fetch('/api/v1/users', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username: newUserUser, password: newUserPass, role: 'user' })
            })
            if (res.ok) {
                alert("用户创建成功")
                setShowAddModal(false)
                setNewUserUser('')
                setNewUserPass('')
                setLastRefreshed(Date.now())
            } else {
                const txt = await res.json()
                alert("失败: " + txt.detail)
            }
        } catch (e) {
            alert("Error: " + e.message)
        }
    }

    const handleUpdatePassword = async (uid) => {
        if (!newPass) return
        try {
            const res = await fetch(`/api/v1/users/${uid}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password: newPass })
            })
            if (res.ok) {
                alert("密码修改成功")
                setEditUserId(null)
                setNewPass('')
            } else {
                alert("失败")
            }
        } catch (e) {
            alert(e.message)
        }
    }

    const handleDeleteUser = async (uid, username) => {
        // First confirmation
        if (!window.confirm(`确定要删除用户 "${username}" 吗？`)) return
        // Second confirmation
        if (!window.confirm(`再次确认：删除用户 "${username}" 将无法恢复，是否继续？`)) return

        try {
            const res = await fetch(`/api/v1/users/${uid}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                alert("用户已删除")
                setLastRefreshed(Date.now())
            } else {
                const data = await res.json()
                alert("删除失败: " + data.detail)
            }
        } catch (e) {
            alert("Error: " + e.message)
        }
    }

    const getUserStats = (uid) => {
        if (!stats || !stats.user_stats) return { image_count: 0, video_count: 0 }
        const s = stats.user_stats.find(u => u.id === uid)
        return s || { image_count: 0, video_count: 0 }
    }

    return (
        <div className="container-fluid" style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2>用户管理 & 统计</h2>
                <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ 添加新用户</button>
            </div>

            {/* Stats Summary Panel */}
            {stats && stats.user_stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '30px' }}>
                    <div className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#9ca3af' }}>总用户数</h4>
                        <div style={{ fontSize: '1.8rem', color: 'var(--primary-color)', fontWeight: 'bold' }}>{stats.user_stats.length}</div>
                    </div>
                    <div className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#9ca3af' }}>累计生成图片</h4>
                        <div style={{ fontSize: '1.8rem', color: '#a855f7', fontWeight: 'bold' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.image_count || 0), 0)}
                        </div>
                    </div>
                    <div className="glass-card" style={{ padding: '16px', textAlign: 'center' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#9ca3af' }}>累计生成视频</h4>
                        <div style={{ fontSize: '1.8rem', color: '#f59e0b', fontWeight: 'bold' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.video_count || 0), 0)}
                        </div>
                    </div>
                    <div className="glass-card" style={{ padding: '16px', textAlign: 'center', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#22c55e' }}>📅 今日图片</h4>
                        <div style={{ fontSize: '1.8rem', color: '#22c55e', fontWeight: 'bold' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.today_images || 0), 0)}
                        </div>
                    </div>
                    <div className="glass-card" style={{ padding: '16px', textAlign: 'center', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#3b82f6' }}>📅 今日视频</h4>
                        <div style={{ fontSize: '1.8rem', color: '#3b82f6', fontWeight: 'bold' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.today_videos || 0), 0)}
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-card" style={{ padding: '20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                            <th style={{ padding: '10px' }}>ID</th>
                            <th style={{ padding: '10px' }}>用户名</th>
                            <th style={{ padding: '10px' }}>角色</th>
                            <th style={{ padding: '10px' }}>生成图片数</th>
                            <th style={{ padding: '10px' }}>生成视频数</th>
                            <th style={{ padding: '10px' }}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => {
                            const uStats = getUserStats(u.id);
                            return (
                                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '10px', opacity: 0.7 }}>{u.id}</td>
                                    <td style={{ padding: '10px', fontWeight: 'bold' }}>{u.username}</td>
                                    <td style={{ padding: '10px' }}>
                                        <span style={{
                                            background: u.role === 'admin' ? 'var(--primary-color)' : 'var(--text-muted)',
                                            color: '#fff',
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem'
                                        }}>
                                            {u.role}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px' }}>{uStats.image_count}</td>
                                    <td style={{ padding: '10px' }}>{uStats.video_count}</td>
                                    <td style={{ padding: '10px' }}>
                                        {editUserId === u.id ? (
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <input
                                                    type="password"
                                                    placeholder="新密码"
                                                    value={newPass}
                                                    onChange={e => setNewPass(e.target.value)}
                                                    style={{ width: '100px', padding: '4px' }}
                                                />
                                                <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleUpdatePassword(u.id)}>确认</button>
                                                <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setEditUserId(null)}>取消</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <button
                                                    className="btn-secondary"
                                                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                                    onClick={() => { setEditUserId(u.id); setNewPass(''); }}
                                                >
                                                    修改密码
                                                </button>
                                                {u.role !== 'admin' && (
                                                    <button
                                                        className="btn-secondary"
                                                        style={{ padding: '4px 10px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
                                                        onClick={() => handleDeleteUser(u.id, u.username)}
                                                    >
                                                        删除
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Add User Modal */}
            {showAddModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div className="glass-card" style={{ padding: '30px', width: '400px' }}>
                        <h3>添加新用户</h3>
                        <form onSubmit={handleAddUser}>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>用户名</label>
                                <input
                                    type="text"
                                    value={newUserUser}
                                    onChange={e => setNewUserUser(e.target.value)}
                                    style={{ width: '100%', padding: '8px' }}
                                    required
                                />
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>密码</label>
                                <input
                                    type="password"
                                    value={newUserPass}
                                    onChange={e => setNewUserPass(e.target.value)}
                                    style={{ width: '100%', padding: '8px' }}
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>取消</button>
                                <button type="submit" className="btn-primary">创建</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default UserManagement
