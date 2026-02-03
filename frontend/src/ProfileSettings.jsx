import { useState, useEffect } from 'react';
import './ProfileSettings.css';

function ProfileSettings({ token, onProfileUpdate }) {
    const [profile, setProfile] = useState(null);
    const [nickname, setNickname] = useState('');
    const [defaultShare, setDefaultShare] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [avatarUploading, setAvatarUploading] = useState(false);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const res = await fetch('/api/v1/user/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setProfile(data);
                setNickname(data.nickname || '');
                setDefaultShare(data.default_share || false);
            }
        } catch (err) {
            console.error("Failed to fetch profile", err);
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setMessage({ type: '', text: '' });

        // Validate password match
        if (password && password !== confirmPassword) {
            setMessage({ type: 'error', text: '两次输入的密码不一致' });
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/v1/user/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    nickname: nickname || null,
                    password: password || null,
                    default_share: defaultShare
                })
            });

            if (res.ok) {
                setMessage({ type: 'success', text: '资料更新成功！' });
                setPassword('');
                setConfirmPassword('');
                fetchProfile();
                if (onProfileUpdate) onProfileUpdate();
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.detail || '更新失败' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: '网络错误：' + err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleAvatarUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            setMessage({ type: 'error', text: '头像文件大小不能超过 2MB' });
            return;
        }

        setAvatarUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/v1/user/avatar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                setProfile(prev => ({ ...prev, avatar: data.avatar }));
                setMessage({ type: 'success', text: '头像上传成功！' });
                if (onProfileUpdate) onProfileUpdate();
            } else {
                const data = await res.json();
                setMessage({ type: 'error', text: data.detail || '上传失败' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: '上传错误：' + err.message });
        } finally {
            setAvatarUploading(false);
        }
    };

    if (!profile) {
        return <div className="profile-loading">加载中...</div>;
    }

    return (
        <div className="profile-settings">
            <div className="profile-header">
                <h2>个人设置</h2>
                <p className="profile-subtitle">管理您的账户信息和偏好设置</p>
            </div>

            {/* User Level Card */}
            <div className="profile-card level-card">
                <div className="level-display">
                    <label className="level-avatar-clickable">
                        <img src={profile.avatar || '/default-avatar.jpg'} alt="Avatar" />
                        <div className="avatar-overlay">
                            {avatarUploading ? '⏳' : '📷'}
                        </div>
                        <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            onChange={handleAvatarUpload}
                            disabled={avatarUploading}
                            hidden
                        />
                    </label>
                    <div className="level-info">
                        <div className="level-name">{profile.nickname || profile.username}</div>
                        <div className="level-badge">
                            <span className="level-number">Lv.{profile.level || 1}</span>
                            <span className="level-title">{profile.level_name || '凡人'}</span>
                        </div>
                        <div className="level-exp-bar">
                            <div className="level-exp-fill" style={{ width: `${profile.level_progress || 0}%` }} />
                        </div>
                        <div className="level-exp-text">{profile.experience || 0} / {profile.next_level_exp || 100} EXP</div>
                    </div>
                </div>
            </div>

            {/* Profile Form */}
            <div className="profile-card">
                <h3>基本信息</h3>
                <form onSubmit={handleUpdateProfile}>
                    <div className="form-group">
                        <label>用户名（登录名）</label>
                        <input
                            type="text"
                            value={profile.username}
                            disabled
                            className="disabled-input"
                        />
                        <p className="field-hint">用户名不可更改</p>
                    </div>

                    <div className="form-group">
                        <label>昵称</label>
                        <input
                            type="text"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="设置您的显示昵称"
                        />
                        <p className="field-hint">昵称将显示在您的作品中</p>
                    </div>

                    <h3 style={{ marginTop: '2rem' }}>隐私设置</h3>
                    <div className="form-group">
                        <label className="toggle-label">
                            <span>默认分享创作</span>
                            <div
                                className={`toggle-switch ${defaultShare ? 'active' : ''}`}
                                onClick={() => setDefaultShare(!defaultShare)}
                            >
                                <div className="toggle-knob"></div>
                            </div>
                        </label>
                        <p className="field-hint">
                            {defaultShare
                                ? '开启：您创作的内容默认对他人可见'
                                : '关闭：您创作的内容默认仅自己可见'}
                        </p>
                    </div>

                    <h3 style={{ marginTop: '2rem' }}>修改密码</h3>
                    <div className="form-group">
                        <label>新密码</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="留空则不修改"
                        />
                    </div>

                    <div className="form-group">
                        <label>确认新密码</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="再次输入新密码"
                        />
                    </div>

                    {message.text && (
                        <div className={`message ${message.type}`}>
                            {message.text}
                        </div>
                    )}

                    <button type="submit" className="save-btn" disabled={loading}>
                        {loading ? '保存中...' : '保存更改'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default ProfileSettings;
