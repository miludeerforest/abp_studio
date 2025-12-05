import { useState, useEffect } from 'react'
import ImageGenerator from './ImageGenerator'
import VideoGenerator from './VideoGenerator'
import Login from './Login'
import Settings from './Settings';
import StoryGenerator from './StoryGenerator';
import UserManagement from './UserManagement';
import './App.css';

const BACKEND_URL = ''

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  // User Info
  const [userRole, setUserRole] = useState(localStorage.getItem('role') || 'user')
  const [username, setUsername] = useState(localStorage.getItem('username') || '')

  useEffect(() => {
    console.log("App Component Mounted");
  }, []);
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Tabs: 'image', 'video', 'story', 'settings', 'users'
  const [activeTab, setActiveTab] = useState('image')

  // Shared State
  const [config, setConfig] = useState({})

  // Image Generation Results
  const [generatedImages, setGeneratedImages] = useState([])
  // Video Generation Transfer
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedVideoPrompt, setSelectedVideoPrompt] = useState('')
  const [selectionTimestamp, setSelectionTimestamp] = useState(0)

  useEffect(() => {
    if (token) {
      verifyToken(token)
    }
  }, [token])

  const verifyToken = async (t) => {
    setIsLoggedIn(true)
    fetchConfig(t)
    // If we have stored role, use it. In real app, verify endpoint should return it.
  }

  const handleLogin = (data) => {
    // data: { access_token, role, username, ... }
    const t = data.access_token || data; // Fallback if just token string
    const role = data.role || 'user'; // Default to user if not provided
    const user = data.username || 'user';

    localStorage.setItem('token', t)
    localStorage.setItem('role', role)
    localStorage.setItem('username', user)

    setToken(t)
    setUserRole(role)
    setUsername(user)
    setIsLoggedIn(true)
    fetchConfig(t)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('username')
    setToken('')
    setUserRole('user')
    setIsLoggedIn(false)
  }

  const fetchConfig = async (t) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/config`, {
        headers: { 'Authorization': `Bearer ${t}` }
      })
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
      }
    } catch (e) {
      console.error("Failed to fetch config", e)
    }
  }

  const handleConfigChange = async (newConfig) => {
    setConfig(newConfig)
    try {
      await fetch(`${BACKEND_URL}/api/v1/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newConfig)
      })
    } catch (e) {
      console.error("Failed to save config", e)
    }
  }

  const handleImageResult = (results) => {
    setGeneratedImages(results)
  }

  const handleSelectForVideo = (imgUrl, prompt) => {
    setSelectedImage(imgUrl)
    setSelectedVideoPrompt(prompt || '')
    setSelectionTimestamp(Date.now())
    setActiveTab('video')
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <nav className="top-nav">
        <div className="nav-brand">
          <div className="brand-icon">🍌</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontWeight: 'bold' }}>Banana Product</span>
            <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{username} ({userRole})</span>
          </div>
        </div>

        <div className="nav-center">
          <button
            className={`nav-tab ${activeTab === 'image' ? 'active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            <span className="icon">🎨</span>
            批量场景生成
          </button>
          <button
            className={`nav-tab ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => setActiveTab('video')}
          >
            <span className="icon">📹</span>
            视频生成
          </button>
          <button
            className={`nav-tab ${activeTab === 'story' ? 'active' : ''}`}
            onClick={() => setActiveTab('story')}
          >
            <span className="icon">🎬</span>
            一镜到底
          </button>

          {/* Admin Only Tabs */}
          {userRole === 'admin' && (
            <>
              <button
                className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                <span className="icon">⚙️</span>
                系统设置
              </button>
              <button
                className={`nav-tab ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => setActiveTab('users')}
              >
                <span className="icon">👥</span>
                用户管理
              </button>
            </>
          )}
        </div>

        <div className="status-indicator" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="dot" style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: (config.api_key && config.api_key.length > 10) ? '#4ade80' : '#ef4444',
              boxShadow: (config.api_key && config.api_key.length > 10) ? '0 0 8px #4ade80' : 'none'
            }}></div>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {(config.api_key && config.api_key.length > 10) ? 'System Online' : 'Offline'}
            </span>
          </div>

          <button
            onClick={handleLogout}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            登出 🚪
          </button>
        </div>
      </nav>

      <main className="main-content">
        <div style={{ display: activeTab === 'image' ? 'block' : 'none', height: '100%' }}>
          <ImageGenerator
            token={token}
            config={config}
            results={generatedImages}
            onResultsChange={setGeneratedImages}
            onSelectForVideo={handleSelectForVideo}
            onTabChange={setActiveTab}
          />
        </div>

        <div style={{ display: activeTab === 'story' ? 'block' : 'none' }}>
          <StoryGenerator
            token={token}
            config={config}
            onSelectForVideo={handleSelectForVideo}
          />
        </div>

        <div style={{ display: activeTab === 'video' ? 'block' : 'none' }}>
          <VideoGenerator
            token={token}
            initialImage={selectedImage}
            initialPrompt={selectedVideoPrompt}
            requestTimestamp={selectionTimestamp}
            config={config}
            onConfigChange={handleConfigChange}
            isActive={activeTab === 'video'}
          />
        </div>

        {/* Admin Tabs */}
        {userRole === 'admin' && (
          <>
            <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
              <Settings
                token={token}
                config={config}
                onConfigChange={handleConfigChange}
              />
            </div>
            <div style={{ display: activeTab === 'users' ? 'block' : 'none' }}>
              <UserManagement token={token} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default App
