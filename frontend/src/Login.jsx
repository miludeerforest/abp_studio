import { useState, useEffect, useRef } from 'react'
import './Login.css'

function Login({ onLogin, onBack }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [turnstileToken, setTurnstileToken] = useState('')
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const turnstileRef = useRef(null)

    // Cloudflare Turnstile Site Key from env
    const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '0x4AAAAAAB_ISJIMCgQPi5oQ'

    useEffect(() => {
        // Load Turnstile script
        const script = document.createElement('script')
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        script.defer = true
        document.head.appendChild(script)

        return () => {
            // Cleanup
            if (document.head.contains(script)) {
                document.head.removeChild(script)
            }
        }
    }, [])

    useEffect(() => {
        // Render Turnstile widget when script is loaded
        const renderTurnstile = () => {
            if (window.turnstile && turnstileRef.current && !turnstileRef.current.hasChildNodes()) {
                window.turnstile.render(turnstileRef.current, {
                    sitekey: TURNSTILE_SITE_KEY,
                    callback: (token) => {
                        setTurnstileToken(token)
                    },
                    'expired-callback': () => {
                        setTurnstileToken('')
                    },
                    'error-callback': () => {
                        setError('验证码加载失败，请刷新页面')
                    },
                    theme: 'dark'
                })
            }
        }

        // Check if turnstile is already loaded
        if (window.turnstile) {
            renderTurnstile()
        } else {
            // Wait for script to load
            const checkTurnstile = setInterval(() => {
                if (window.turnstile) {
                    clearInterval(checkTurnstile)
                    renderTurnstile()
                }
            }, 100)

            return () => clearInterval(checkTurnstile)
        }
    }, [])

    const resetTurnstile = () => {
        if (window.turnstile && turnstileRef.current) {
            window.turnstile.reset(turnstileRef.current)
            setTurnstileToken('')
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)

        // Validate turnstile token
        if (!turnstileToken) {
            setError('请完成人机验证')
            return
        }

        setLoading(true)

        try {
            const formData = new URLSearchParams()
            formData.append('username', username)
            formData.append('password', password)
            formData.append('turnstile_token', turnstileToken)

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
                const errorData = await res.json().catch(() => ({}))
                setError(errorData.detail || '登录失败：用户名或密码错误')
                resetTurnstile()
            }
        } catch (e) {
            setError('登录错误：' + e.message)
            resetTurnstile()
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="login-container">
            <div className="glass-card login-box">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="login-back-btn"
                    >
                        ←
                    </button>
                )}
                <div className="login-emoji">🍌</div>
                <h2>系统登录</h2>
                <p className="login-subtitle">Banana Product Studio</p>
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
                    <div className="input-group turnstile-group">
                        <label>人机验证</label>
                        <div ref={turnstileRef} className="turnstile-container"></div>
                    </div>
                    {error && <div className="error-msg login-error-text">{error}</div>}
                    <button type="submit" className="btn-primary login-submit-btn" disabled={loading || !turnstileToken}>
                        {loading ? '登录中...' : '立即登录'}
                    </button>
                </form>
            </div>
        </div>
    )
}

export default Login
