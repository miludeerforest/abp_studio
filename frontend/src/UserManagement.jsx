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

    const getUserStats = (uid) => {
        if (!stats || !stats.user_stats) return { total_images: 0, total_videos: 0 }
        const s = stats.user_stats.find(u => u.id === uid)
        return s || { total_images: 0, total_videos: 0 }
    }

    return (
        <div className="container-fluid" style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2>用户管理 & 统计</h2>
                <button className="btn-primary" onClick={() => setShowAddModal(true)}>+ 添加新用户</button>
            </div>

            {/* Stats Summary Panel */}
            {stats && stats.user_stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                    <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
                        <h3>总用户数</h3>
                        <div style={{ fontSize: '2rem', color: 'var(--primary-color)' }}>{stats.user_stats.length}</div>
                    </div>
                    <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
                        <h3>累计生成图片</h3>
                        <div style={{ fontSize: '2rem', color: '#a855f7' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.total_images || 0), 0)}
                        </div>
                    </div>
                    <div className="glass-card" style={{ padding: '20px', textAlign: 'center' }}>
                        <h3>累计生成视频</h3>
                        <div style={{ fontSize: '2rem', color: '#f59e0b' }}>
                            {stats.user_stats.reduce((a, b) => a + (b.total_videos || 0), 0)}
                        </div>
                    </div>
                </div>
            )}

            <div className="glass-card" style={{ padding: '20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff' }}>
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
                                            background: u.role === 'admin' ? 'var(--primary-color)' : '#666',
                                            padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem'
                                        }}>
                                            {u.role}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px' }}>{uStats.total_images}</td>
                                    <td style={{ padding: '10px' }}>{uStats.total_videos}</td>
                                    <td style={{ padding: '10px' }}>
                                        {editUserId === u.id ? (
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <input
                                                    type="password"
                                                    placeholder="新密码"
                                                    value={newPass}
                                                    onChange={e => setNewPass(e.target.value)}
                                                    style={{ width: '100px', padding: '4px', background: '#333', border: '1px solid #555', color: '#fff' }}
                                                />
                                                <button className="btn-primary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleUpdatePassword(u.id)}>确认</button>
                                                <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setEditUserId(null)}>取消</button>
                                            </div>
                                        ) : (
                                            <button
                                                className="btn-secondary"
                                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                                onClick={() => { setEditUserId(u.id); setNewPass(''); }}
                                            >
                                                修改密码
                                            </button>
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
                    <div className="glass-card" style={{ padding: '30px', width: '400px', background: '#1a1a1a' }}>
                        <h3>添加新用户</h3>
                        <form onSubmit={handleAddUser}>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>用户名</label>
                                <input
                                    type="text"
                                    value={newUserUser}
                                    onChange={e => setNewUserUser(e.target.value)}
                                    style={{ width: '100%', padding: '8px', background: '#333', border: '1px solid #555', color: '#fff' }}
                                    required
                                />
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={{ display: 'block', marginBottom: '5px' }}>密码</label>
                                <input
                                    type="password"
                                    value={newUserPass}
                                    onChange={e => setNewUserPass(e.target.value)}
                                    style={{ width: '100%', padding: '8px', background: '#333', border: '1px solid #555', color: '#fff' }}
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
