import { useState } from 'react'

function Login({ onLogin }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const formData = new URLSearchParams()
            formData.append('username', username)
            formData.append('password', password)

            const res = await fetch('/api/v1/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            })

            if (res.ok) {
                const data = await res.json()
                onLogin(data)
            } else {
                setError('登录失败：用户名或密码错误')
            }
        } catch (e) {
            setError('登录错误：' + e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-container">
            <div className="glass-card login-box">
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🍌</div>
                <h2>系统登录</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Banana Product Studio</p>
                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <label>账号</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="请输入管理员账号"
                            required
                        />
                    </div>
                    <div className="input-group">
                        <label>密码</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="请输入密码"
                            required
                        />
                    </div>
                    {error && <div className="error-msg" style={{ color: 'var(--error-color)', fontSize: '0.9rem' }}>{error}</div>}
                    <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '1rem' }}>
                        {loading ? '登录中...' : '立即登录'}
                    </button>
                </form>
            </div>
        </div>
    )
}

export default Login
