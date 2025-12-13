import { useState, useEffect, useCallback } from 'react';
import './AdminDashboard.css';

/**
 * Admin Dashboard Component
 * 
 * Real-time monitoring for administrators:
 * - Online users
 * - Active tasks
 * - Queue statistics
 * - Recent activities
 */
function AdminDashboard({ token, isConnected = false, lastMessage = null }) {
    const [liveStatus, setLiveStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activities, setActivities] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [userTasks, setUserTasks] = useState(null);

    // Handle WebSocket messages from parent
    useEffect(() => {
        if (!lastMessage) return;

        // Handle real-time updates
        if (lastMessage.type === 'user_connected' || lastMessage.type === 'user_disconnected') {
            // Refresh live status when users connect/disconnect
            fetchLiveStatus();
        } else if (lastMessage.type === 'user_activity') {
            // Add new activity to the list
            setActivities(prev => [lastMessage.data, ...prev.slice(0, 49)]);
        } else if (lastMessage.type === 'user_activity_update') {
            // Update user's current activity in real-time
            setLiveStatus(prev => {
                if (!prev?.online_users) return prev;
                return {
                    ...prev,
                    online_users: prev.online_users.map(user =>
                        user.user_id === lastMessage.data.user_id
                            ? { ...user, current_activity: lastMessage.data.current_activity }
                            : user
                    )
                };
            });
        } else if (lastMessage.type === 'task_progress' || lastMessage.type === 'task_completed') {
            // Refresh stats on task updates
            fetchLiveStatus();
        }
    }, [lastMessage]);

    // Fetch live status from API
    const fetchLiveStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/v1/admin/live-status', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setLiveStatus(data);
                setActivities(data.recent_activities || []);
                setError(null);
            } else {
                throw new Error('Failed to fetch status');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    // Fetch user tasks
    const fetchUserTasks = useCallback(async (userId) => {
        try {
            const res = await fetch(`/api/v1/admin/user/${userId}/tasks`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUserTasks(data);
            }
        } catch (e) {
            console.error('Failed to fetch user tasks:', e);
        }
    }, [token]);

    // Initial fetch and periodic refresh
    useEffect(() => {
        fetchLiveStatus();

        // Refresh every 30 seconds as fallback
        const interval = setInterval(fetchLiveStatus, 30000);
        return () => clearInterval(interval);
    }, [fetchLiveStatus]);

    // Handle user click
    const handleUserClick = (userId) => {
        setSelectedUser(userId);
        fetchUserTasks(userId);
    };

    if (loading) {
        return (
            <div className="admin-dashboard loading">
                <div className="spinner"></div>
                <p>加载监控数据...</p>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            {/* Header */}
            <div className="dashboard-header">
                <h2>📊 实时监控面板</h2>
                <div className="connection-status">
                    <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
                    {isConnected ? '实时连接' : '连接断开'}
                </div>
            </div>

            {error && (
                <div className="error-banner">
                    ❌ {error}
                    <button onClick={fetchLiveStatus}>重试</button>
                </div>
            )}

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card online-users">
                    <div className="stat-icon">👥</div>
                    <div className="stat-content">
                        <div className="stat-value">{liveStatus?.online_count || 0}</div>
                        <div className="stat-label">在线用户</div>
                    </div>
                </div>

                <div className="stat-card processing">
                    <div className="stat-icon">⚙️</div>
                    <div className="stat-content">
                        <div className="stat-value">
                            {liveStatus?.queue_stats?.total_active || liveStatus?.queue_stats?.video_processing || 0}
                        </div>
                        <div className="stat-label">处理中任务</div>
                        {(liveStatus?.queue_stats?.fission_active > 0 || liveStatus?.queue_stats?.chain_active > 0) && (
                            <div className="stat-detail">
                                {liveStatus?.queue_stats?.video_processing > 0 && `视频: ${liveStatus?.queue_stats?.video_processing}`}
                                {liveStatus?.queue_stats?.fission_active > 0 && ` 裂变: ${liveStatus?.queue_stats?.fission_active}`}
                                {liveStatus?.queue_stats?.chain_active > 0 && ` 故事: ${liveStatus?.queue_stats?.chain_active}`}
                            </div>
                        )}
                    </div>
                </div>

                <div className="stat-card pending">
                    <div className="stat-icon">⏳</div>
                    <div className="stat-content">
                        <div className="stat-value">
                            {liveStatus?.queue_stats?.video_pending || 0}
                        </div>
                        <div className="stat-label">等待中任务</div>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="dashboard-grid">
                {/* Online Users Panel */}
                <div className="panel online-users-panel">
                    <h3>🟢 在线用户</h3>
                    <div className="users-list">
                        {liveStatus?.online_users?.length > 0 ? (
                            liveStatus.online_users.map(user => (
                                <div
                                    key={user.user_id}
                                    className={`user-item ${selectedUser === user.user_id ? 'selected' : ''}`}
                                    onClick={() => handleUserClick(user.user_id)}
                                >
                                    <div className="user-avatar">
                                        {user.username?.charAt(0).toUpperCase() || '?'}
                                    </div>
                                    <div className="user-info">
                                        <div className="user-name">{user.username}</div>
                                        <div className="user-activity">
                                            {user.current_activity || '空闲'}
                                        </div>
                                    </div>
                                    <div className="user-badge">
                                        {user.role === 'admin' && <span className="admin-badge">管理员</span>}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="empty-state">暂无在线用户</div>
                        )}
                    </div>
                </div>

                {/* Activity Feed */}
                <div className="panel activity-panel">
                    <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        📋 活动记录
                        <button
                            className="clear-activities-btn"
                            onClick={async () => {
                                if (!window.confirm('确定要清空所有活动记录吗？')) return;
                                try {
                                    const res = await fetch('/api/v1/admin/activities', {
                                        method: 'DELETE',
                                        headers: { 'Authorization': `Bearer ${token}` }
                                    });
                                    if (res.ok) {
                                        setActivities([]);
                                    }
                                } catch (e) {
                                    console.error('Failed to clear activities:', e);
                                }
                            }}
                            style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.5)',
                                color: '#ef4444',
                                padding: '4px 10px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer'
                            }}
                            title="清空活动记录"
                        >
                            🗑️ 清空
                        </button>
                    </h3>
                    <div className="activity-feed">
                        {activities.length > 0 ? (
                            activities.map((activity, index) => (
                                <div key={activity.id || index} className="activity-item">
                                    <div className="activity-icon">
                                        {getActivityIcon(activity.action)}
                                    </div>
                                    <div className="activity-content">
                                        <div className="activity-action">
                                            <strong>{activity.username || `用户 ${activity.user_id}`}</strong>
                                            {' '}{formatAction(activity.action)}
                                        </div>
                                        {activity.details && (
                                            <div className="activity-details">{activity.details}</div>
                                        )}
                                        <div className="activity-time">
                                            {formatTime(activity.created_at || activity.timestamp)}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="empty-state">暂无活动记录</div>
                        )}
                    </div>
                </div>

                {/* User Tasks Detail */}
                {selectedUser && userTasks && (
                    <div className="panel user-tasks-panel">
                        <h3>📁 用户任务详情 (ID: {selectedUser})</h3>
                        <button
                            className="close-btn"
                            onClick={() => { setSelectedUser(null); setUserTasks(null); }}
                        >
                            ✕
                        </button>
                        <div className="tasks-list">
                            <h4>视频任务</h4>
                            {userTasks.video_tasks?.length > 0 ? (
                                userTasks.video_tasks.map(task => (
                                    <div key={task.id} className="task-item">
                                        <span className={`status-badge ${task.status}`}>
                                            {task.status}
                                        </span>
                                        <span className="task-name">{task.filename}</span>
                                        <span className="task-time">
                                            {formatTime(task.created_at)}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="empty-state">无视频任务</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Helper functions
function getActivityIcon(action) {
    const icons = {
        'image_gen_start': '🎨',
        'image_gen_complete': '✅',
        'video_gen_start': '🎬',
        'video_gen_complete': '✅',
        'login': '🔑',
        'logout': '👋',
        'default': '📝'
    };
    return icons[action] || icons.default;
}

function formatAction(action) {
    const actions = {
        'image_gen_start': '开始生成图片',
        'image_gen_complete': '完成图片生成',
        'video_gen_start': '开始生成视频',
        'video_gen_complete': '完成视频生成',
        'login': '登录系统',
        'logout': '退出系统'
    };
    return actions[action] || action;
}

function formatTime(timestamp) {
    if (!timestamp) return '';

    // Backend stores time in China timezone (UTC+8) without timezone info
    // Append +08:00 to parse correctly if not already present
    let dateStr = timestamp;
    if (!timestamp.includes('+') && !timestamp.includes('Z')) {
        dateStr = timestamp + '+08:00';
    }

    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 0) return '刚刚'; // Future time (edge case)
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    return date.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export default AdminDashboard;
