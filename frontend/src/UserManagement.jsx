import { useState, useEffect } from 'react'
import './UserManagement.css'

function UserManagement({ token }) {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [showAddModal, setShowAddModal] = useState(false)
    const [stats, setStats] = useState(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [statsError, setStatsError] = useState('')
    const [lastRefreshed, setLastRefreshed] = useState(Date.now())
    const [hoveredRow, setHoveredRow] = useState(null)

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
        setStatsLoading(true)
        setStatsError('')
        try {
            const res = await fetch('/api/v1/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                setStats(await res.json())
            } else {
                setStatsError('加载统计数据失败')
            }
        } catch (e) {
            console.error("Fetch stats failed", e)
            setStatsError('网络错误，无法加载统计数据')
        } finally {
            setStatsLoading(false)
        }
    }

    const handleRefresh = () => {
        setLastRefreshed(Date.now())
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
        // Return placeholder object when stats unavailable to show '--' instead of misleading zeros
        if (!stats || !stats.user_stats) return null
        const s = stats.user_stats.find(u => u.id === uid)
        return s || null
    }

    // 计算统计总数 - Calibrated for data source consistency
    const getTotalStats = () => {
        if (!stats || !stats.user_stats) return { users: 0, images: 0, videos: 0, todayImages: 0, todayVideos: 0 }
        return {
            // Total users count from users array (table source) for consistency
            users: users.length,
            images: stats.user_stats.reduce((a, b) => a + (b.image_count || 0), 0),
            videos: stats.user_stats.reduce((a, b) => a + (b.video_count || 0), 0),
            todayImages: stats.user_stats.reduce((a, b) => a + (b.today_images || 0), 0),
            todayVideos: stats.user_stats.reduce((a, b) => a + (b.today_videos || 0), 0)
        }
    }

    const totals = getTotalStats()

    // 统计卡片配置
    const statCards = [
        { label: '总用户数', value: totals.users, color: '#6366f1', icon: '👥' },
        { label: '累计生成图片', value: totals.images, color: '#a855f7', icon: '🖼️' },
        { label: '累计生成视频', value: totals.videos, color: '#f59e0b', icon: '🎬' },
        { label: '今日图片', value: totals.todayImages, color: '#22c55e', icon: '📅', highlight: true },
        { label: '今日视频', value: totals.todayVideos, color: '#3b82f6', icon: '📅', highlight: true }
    ]

    return (
        <div className="user-management-container">
            <div className="user-management-toolbar">
                <div className="user-management-toolbar-meta">
                    <span className="user-management-helper">
                        实时监控全站用户活动与资源消耗情况，数据来源：系统日志与数据库统计。
                    </span>
                    <span className="user-management-last-update">
                        上次更新: {new Date(lastRefreshed).toLocaleTimeString()}
                    </span>
                </div>
                <button 
                    className="user-management-refresh-button"
                    onClick={handleRefresh}
                    disabled={loading || statsLoading}
                >
                    {loading || statsLoading ? '🔄 更新中...' : '🔄 刷新数据'}
                </button>
            </div>

            <div className="user-management-header">
                <h2 className="user-management-title">👥 用户管理 & 统计</h2>
                <button 
                    className="btn-primary user-management-add-button" 
                    onClick={() => setShowAddModal(true)}
                >
                    + 添加新用户
                </button>
            </div>

            {statsLoading ? (
                <div className="user-management-stats-loading">
                    📊 正在校准统计数据...
                </div>
            ) : statsError ? (
                <div className="user-management-stats-error">
                    ⚠️ {statsError}
                    <button onClick={fetchStats} className="btn-secondary">重试</button>
                </div>
            ) : stats && stats.user_stats && (
                <div className="user-management-stats-grid">
                    {statCards.map((card, index) => (
                        <div 
                            key={index}
                            className={`glass-card user-management-stat-card ${card.highlight ? 'highlight' : ''}`}
                            style={{ '--stat-color': card.color }}
                        >
                            <h4 className="user-management-stat-label">
                                {card.icon} {card.label}
                            </h4>
                            <div className="user-management-stat-value">
                                {card.value.toLocaleString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="glass-card user-management-table-wrapper">
                <div className="user-management-table-container">
                    <table className="user-management-table">
                        <thead className="user-management-table-head">
                            <tr>
                                <th className="user-management-th user-management-th-id">ID</th>
                                <th className="user-management-th user-management-th-username">用户名</th>
                                <th className="user-management-th user-management-th-role">角色</th>
                                <th className="user-management-th user-management-th-level">等级</th>
                                <th className="user-management-th user-management-th-exp">经验值</th>
                                <th className="user-management-th user-management-th-images">生成图片</th>
                                <th className="user-management-th user-management-th-videos">生成视频</th>
                                <th className="user-management-th user-management-th-actions">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u, index) => {
                                const uStats = getUserStats(u.id);
                                const isHovered = hoveredRow === u.id;
                                const isEvenRow = index % 2 === 0;
                                const isAdmin = u.role === 'admin';
                                const exp = u.experience || 0;
                                
                                return (
                                    <tr 
                                        key={u.id} 
                                        className={`user-management-row ${isHovered ? 'hover' : ''} ${isEvenRow ? 'even' : ''}`}
                                        onMouseEnter={() => setHoveredRow(u.id)}
                                        onMouseLeave={() => setHoveredRow(null)}
                                    >
                                        <td className="user-management-td user-management-td-id">
                                            {u.id}
                                        </td>
                                        <td className="user-management-td user-management-td-username">
                                            {u.username}
                                        </td>
                                        <td className="user-management-td user-management-td-center">
                                            <span className={`user-management-role-badge ${isAdmin ? 'admin' : 'user'}`}>
                                                {isAdmin ? '管理员' : '用户'}
                                            </span>
                                        </td>
                                        <td className="user-management-td user-management-td-center">
                                            <span className={`user-management-level-badge ${exp < 0 ? 'negative' : 'positive'}`}>
                                                {exp < 0 ? '🔻' : '⭐'}
                                                {u.level_name || '凡人'}
                                            </span>
                                        </td>
                                        <td className={`user-management-td user-management-td-center user-management-exp-text ${exp < 0 ? 'negative' : 'positive'}`}>
                                            {exp.toLocaleString()}
                                        </td>
                                        <td className="user-management-td user-management-td-images">
                                            {uStats ? uStats.image_count.toLocaleString() : '--'}
                                        </td>
                                        <td className="user-management-td user-management-td-videos">
                                            {uStats ? uStats.video_count.toLocaleString() : '--'}
                                        </td>
                                        <td className="user-management-td user-management-td-center">
                                            {editUserId === u.id ? (
                                                <div className="user-management-action-edit-row">
                                                    <input
                                                        type="password"
                                                        placeholder="新密码"
                                                        value={newPass}
                                                        onChange={e => setNewPass(e.target.value)}
                                                        className="user-management-password-input"
                                                    />
                                                    <button 
                                                        className="btn-primary user-management-action-button" 
                                                        onClick={() => handleUpdatePassword(u.id)}
                                                    >
                                                        确认
                                                    </button>
                                                    <button 
                                                        className="btn-secondary user-management-action-button" 
                                                        onClick={() => setEditUserId(null)}
                                                    >
                                                        取消
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="user-management-action-row">
                                                    <button
                                                        className="btn-secondary user-management-action-button"
                                                        onClick={() => { setEditUserId(u.id); setNewPass(''); }}
                                                    >
                                                        修改密码
                                                    </button>
                                                    {!isAdmin && (
                                                        <button
                                                            className="user-management-delete-button"
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
                    
                    {users.length === 0 && !loading && (
                        <div className="user-management-empty-state">
                            <div className="user-management-empty-icon">👥</div>
                            <div>暂无用户数据</div>
                        </div>
                    )}

                    {loading && (
                        <div className="user-management-loading-state">
                            <div className="user-management-loading-text">加载中...</div>
                        </div>
                    )}
                </div>
            </div>

            {showAddModal && (
                <div className="user-management-modal-overlay">
                    <div className="glass-card user-management-modal-content">
                        <h3 className="user-management-modal-title">✨ 添加新用户</h3>
                        <form onSubmit={handleAddUser}>
                            <div className="user-management-form-group">
                                <label className="user-management-form-label">用户名</label>
                                <input
                                    type="text"
                                    value={newUserUser}
                                    onChange={e => setNewUserUser(e.target.value)}
                                    className="user-management-form-input"
                                    placeholder="请输入用户名"
                                    required
                                />
                            </div>
                            <div className="user-management-form-group">
                                <label className="user-management-form-label">密码</label>
                                <input
                                    type="password"
                                    value={newUserPass}
                                    onChange={e => setNewUserPass(e.target.value)}
                                    className="user-management-form-input"
                                    placeholder="请输入密码"
                                    required
                                />
                            </div>
                            <div className="user-management-modal-actions">
                                <button 
                                    type="button" 
                                    className="btn-secondary user-management-modal-button-cancel" 
                                    onClick={() => setShowAddModal(false)}
                                >
                                    取消
                                </button>
                                <button 
                                    type="submit" 
                                    className="btn-primary user-management-modal-button-submit"
                                >
                                    创建用户
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default UserManagement
