import { useState, useEffect } from 'react'

const styles = {
    container: {
        padding: '20px',
        maxWidth: '1400px',
        margin: '0 auto',
        width: '100%'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px'
    },
    title: {
        fontSize: '1.4rem',
        fontWeight: '700',
        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text'
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '12px',
        marginBottom: '20px'
    },
    statCard: {
        padding: '14px',
        textAlign: 'center',
        borderRadius: '10px',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease'
    },
    statLabel: {
        margin: 0,
        fontSize: '0.75rem',
        color: '#9ca3af',
        marginBottom: '4px',
        fontWeight: '500'
    },
    statValue: {
        fontSize: '1.5rem',
        fontWeight: 'bold',
        lineHeight: 1.2
    },
    tableContainer: {
        overflowX: 'auto',
        borderRadius: '10px'
    },
    table: {
        width: '100%',
        borderCollapse: 'separate',
        borderSpacing: 0,
        minWidth: '800px'
    },
    tableHead: {
        background: 'rgba(99, 102, 241, 0.1)'
    },
    th: {
        padding: '10px 8px',
        fontSize: '0.75rem',
        fontWeight: '600',
        color: '#a5b4fc',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap'
    },
    td: {
        padding: '10px 8px',
        borderBottom: '1px solid var(--card-border)',
        verticalAlign: 'middle',
        fontSize: '0.85rem'
    },
    actionButton: {
        padding: '4px 10px',
        fontSize: '0.75rem',
        borderRadius: '5px',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s ease'
    },
    deleteButton: {
        padding: '4px 10px',
        fontSize: '0.75rem',
        borderRadius: '5px',
        background: 'rgba(239, 68, 68, 0.15)',
        color: '#f87171',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s ease'
    },
    roleBadge: (isAdmin) => ({
        background: isAdmin ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(156, 163, 175, 0.2)',
        color: '#fff',
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '0.7rem',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        display: 'inline-block'
    }),
    levelBadge: (exp) => ({
        background: exp < 0
            ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1))'
            : 'linear-gradient(135deg, rgba(255, 165, 0, 0.2), rgba(255, 215, 0, 0.15))',
        color: exp < 0 ? '#f87171' : '#fbbf24',
        padding: '3px 10px',
        borderRadius: '12px',
        fontSize: '0.7rem',
        fontWeight: '600',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        border: exp < 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 165, 0, 0.3)'
    }),
    expText: (exp) => ({
        color: exp < 0 ? '#f87171' : '#9ca3af',
        fontWeight: exp < 0 ? '600' : '500',
        fontSize: '0.8rem'
    }),
    modalOverlay: {
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
    },
    modalContent: {
        padding: '24px',
        width: '380px',
        maxWidth: '90vw',
        borderRadius: '14px'
    },
    modalTitle: {
        marginBottom: '18px',
        fontSize: '1.2rem',
        fontWeight: '600'
    },
    formGroup: {
        marginBottom: '14px'
    },
    formLabel: {
        display: 'block',
        marginBottom: '6px',
        fontSize: '0.85rem',
        fontWeight: '500',
        color: '#9ca3af'
    },
    formInput: {
        width: '100%',
        padding: '12px 16px',
        borderRadius: '10px',
        border: '1px solid var(--card-border)',
        background: 'rgba(0, 0, 0, 0.2)',
        color: 'var(--text-main)',
        fontSize: '1rem',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
    },
    modalActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        marginTop: '28px'
    }
}

function UserManagement({ token }) {
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(false)
    const [showAddModal, setShowAddModal] = useState(false)
    const [stats, setStats] = useState(null)
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

    // 计算统计总数
    const getTotalStats = () => {
        if (!stats || !stats.user_stats) return { users: 0, images: 0, videos: 0, todayImages: 0, todayVideos: 0 }
        return {
            users: stats.user_stats.length,
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
        <div style={styles.container}>
            {/* 页面标题 */}
            <div style={styles.header}>
                <h2 style={styles.title}>👥 用户管理 & 统计</h2>
                <button 
                    className="btn-primary" 
                    onClick={() => setShowAddModal(true)}
                    style={{ padding: '12px 24px', fontSize: '0.95rem', borderRadius: '10px' }}
                >
                    + 添加新用户
                </button>
            </div>

            {/* 统计卡片 */}
            {stats && stats.user_stats && (
                <div style={styles.statsGrid}>
                    {statCards.map((card, index) => (
                        <div 
                            key={index}
                            className="glass-card" 
                            style={{
                                ...styles.statCard,
                                background: card.highlight 
                                    ? `linear-gradient(135deg, ${card.color}15, ${card.color}08)` 
                                    : undefined,
                                border: card.highlight ? `1px solid ${card.color}40` : undefined
                            }}
                        >
                            <h4 style={styles.statLabel}>
                                {card.icon} {card.label}
                            </h4>
                            <div style={{ ...styles.statValue, color: card.color }}>
                                {card.value.toLocaleString()}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 用户列表表格 */}
            <div className="glass-card" style={{ padding: '24px', ...styles.tableContainer }}>
                <table style={styles.table}>
                    <thead style={styles.tableHead}>
                        <tr>
                            <th style={{ ...styles.th, width: '70px', textAlign: 'center' }}>ID</th>
                            <th style={{ ...styles.th, textAlign: 'left', minWidth: '200px' }}>用户名</th>
                            <th style={{ ...styles.th, width: '100px', textAlign: 'center' }}>角色</th>
                            <th style={{ ...styles.th, width: '120px', textAlign: 'center' }}>等级</th>
                            <th style={{ ...styles.th, width: '100px', textAlign: 'center' }}>经验值</th>
                            <th style={{ ...styles.th, width: '100px', textAlign: 'center' }}>生成图片</th>
                            <th style={{ ...styles.th, width: '100px', textAlign: 'center' }}>生成视频</th>
                            <th style={{ ...styles.th, width: '180px', textAlign: 'center' }}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u, index) => {
                            const uStats = getUserStats(u.id);
                            const isHovered = hoveredRow === u.id;
                            const isEvenRow = index % 2 === 0;
                            
                            return (
                                <tr 
                                    key={u.id} 
                                    onMouseEnter={() => setHoveredRow(u.id)}
                                    onMouseLeave={() => setHoveredRow(null)}
                                    style={{ 
                                        background: isHovered 
                                            ? 'rgba(99, 102, 241, 0.08)' 
                                            : isEvenRow ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
                                        transition: 'background 0.2s ease'
                                    }}
                                >
                                    <td style={{ ...styles.td, textAlign: 'center', opacity: 0.6, fontSize: '0.9rem' }}>
                                        {u.id}
                                    </td>
                                    <td style={{ ...styles.td, fontWeight: '600', fontSize: '0.95rem' }}>
                                        {u.username}
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center' }}>
                                        <span style={styles.roleBadge(u.role === 'admin')}>
                                            {u.role === 'admin' ? '管理员' : '用户'}
                                        </span>
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center' }}>
                                        <span style={styles.levelBadge(u.experience || 0)}>
                                            {(u.experience || 0) < 0 ? '🔻' : '⭐'}
                                            {u.level_name || '凡人'}
                                        </span>
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center', ...styles.expText(u.experience || 0) }}>
                                        {(u.experience || 0).toLocaleString()}
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center', fontSize: '0.95rem' }}>
                                        {uStats.image_count.toLocaleString()}
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center', fontSize: '0.95rem' }}>
                                        {uStats.video_count.toLocaleString()}
                                    </td>
                                    <td style={{ ...styles.td, textAlign: 'center' }}>
                                        {editUserId === u.id ? (
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                                                <input
                                                    type="password"
                                                    placeholder="新密码"
                                                    value={newPass}
                                                    onChange={e => setNewPass(e.target.value)}
                                                    style={{ 
                                                        width: '100px', 
                                                        padding: '6px 10px',
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--card-border)',
                                                        background: 'rgba(0, 0, 0, 0.2)',
                                                        color: 'var(--text-main)',
                                                        fontSize: '0.85rem'
                                                    }}
                                                />
                                                <button 
                                                    className="btn-primary" 
                                                    style={styles.actionButton} 
                                                    onClick={() => handleUpdatePassword(u.id)}
                                                >
                                                    确认
                                                </button>
                                                <button 
                                                    className="btn-secondary" 
                                                    style={styles.actionButton} 
                                                    onClick={() => setEditUserId(null)}
                                                >
                                                    取消
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                                <button
                                                    className="btn-secondary"
                                                    style={styles.actionButton}
                                                    onClick={() => { setEditUserId(u.id); setNewPass(''); }}
                                                >
                                                    修改密码
                                                </button>
                                                {u.role !== 'admin' && (
                                                    <button
                                                        style={styles.deleteButton}
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
                
                {/* 无数据提示 */}
                {users.length === 0 && !loading && (
                    <div style={{ textAlign: 'center', padding: '48px', color: '#9ca3af' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>👥</div>
                        <div>暂无用户数据</div>
                    </div>
                )}

                {/* 加载中提示 */}
                {loading && (
                    <div style={{ textAlign: 'center', padding: '48px', color: '#9ca3af' }}>
                        <div style={{ fontSize: '1.5rem' }}>加载中...</div>
                    </div>
                )}
            </div>

            {/* 添加用户弹窗 */}
            {showAddModal && (
                <div style={styles.modalOverlay}>
                    <div className="glass-card" style={styles.modalContent}>
                        <h3 style={styles.modalTitle}>✨ 添加新用户</h3>
                        <form onSubmit={handleAddUser}>
                            <div style={styles.formGroup}>
                                <label style={styles.formLabel}>用户名</label>
                                <input
                                    type="text"
                                    value={newUserUser}
                                    onChange={e => setNewUserUser(e.target.value)}
                                    style={styles.formInput}
                                    placeholder="请输入用户名"
                                    required
                                />
                            </div>
                            <div style={styles.formGroup}>
                                <label style={styles.formLabel}>密码</label>
                                <input
                                    type="password"
                                    value={newUserPass}
                                    onChange={e => setNewUserPass(e.target.value)}
                                    style={styles.formInput}
                                    placeholder="请输入密码"
                                    required
                                />
                            </div>
                            <div style={styles.modalActions}>
                                <button 
                                    type="button" 
                                    className="btn-secondary" 
                                    onClick={() => setShowAddModal(false)}
                                    style={{ padding: '10px 20px', borderRadius: '8px' }}
                                >
                                    取消
                                </button>
                                <button 
                                    type="submit" 
                                    className="btn-primary"
                                    style={{ padding: '10px 24px', borderRadius: '8px' }}
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
