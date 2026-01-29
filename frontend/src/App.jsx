import { useState, useEffect } from 'react'
import ImageGenerator from './ImageGenerator'
import VideoGenerator from './VideoGenerator'
import SimpleBatchGenerator from './SimpleBatchGenerator'
import Login from './Login'
import Settings from './Settings';
import StoryGenerator from './StoryGenerator';
import UserManagement from './UserManagement';
import FloatingGallery from './FloatingGallery';
import AdminDashboard from './AdminDashboard';
import PublicGallery from './PublicGallery';
import ProfileSettings from './ProfileSettings';
import { useWebSocket } from './hooks/useWebSocket';
import './App.css';

const BACKEND_URL = ''

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '')
  // User Info
  const [userRole, setUserRole] = useState(localStorage.getItem('role') || 'user')
  const [username, setUsername] = useState(localStorage.getItem('username') || '')
  const [userProfile, setUserProfile] = useState(null)

  useEffect(() => {
    console.log("App Component Mounted");
    fetchPublicConfig();
  }, []);
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showLoginPage, setShowLoginPage] = useState(false)
  const [publicConfig, setPublicConfig] = useState({})

  const fetchPublicConfig = async () => {
    try {
      const res = await fetch('/api/v1/public/config');
      if (res.ok) {
        const data = await res.json();
        setPublicConfig(data);
      }
    } catch (e) {
      console.error("Failed to fetch public config", e);
    }
  };

  // Tabs: 'image', 'video', 'story', 'settings', 'users'
  const [activeTab, setActiveTab] = useState('simple-batch')

  // Floating Gallery state
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Mobile menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Theme state: 'light' (default) or 'dark'
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light'
  })

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  // Shared State
  const [config, setConfig] = useState({})

  // Image Generation Results
  const [generatedImages, setGeneratedImages] = useState([])
  // Video Generation Transfer
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedVideoPrompt, setSelectedVideoPrompt] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('daily')
  const [selectionTimestamp, setSelectionTimestamp] = useState(0)

  // WebSocket connection for real-time updates
  const { isConnected, lastMessage, updateActivity } = useWebSocket(token, {
    onMessage: (data) => {
      // Handle real-time updates
      if (data.type === 'queue_update') {
        // Could trigger a refresh of queue data
        console.log('Queue update received:', data);
      }
    }
  });

  // Update browser tab title when config changes
  useEffect(() => {
    if (config.site_title) {
      document.title = config.site_title;
    }
  }, [config.site_title]);

  useEffect(() => {
    if (token) {
      verifyToken(token)
    }
  }, [token])

  const verifyToken = async (t) => {
    setIsLoggedIn(true)
    fetchConfig(t)
    fetchUserProfile(t)
    // If we have stored role, use it. In real app, verify endpoint should return it.
  }

  const fetchUserProfile = async (t) => {
    try {
      const res = await fetch('/api/v1/user/profile', {
        headers: { 'Authorization': `Bearer ${t}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUserProfile(data);
      }
    } catch (e) {
      console.error("Failed to fetch user profile", e);
    }
  };

  const handleLogin = (data) => {
    // data: { access_token, role, username, user_id, ... }
    const t = data.access_token || data; // Fallback if just token string
    const role = data.role || 'user'; // Default to user if not provided
    const user = data.username || 'user';
    const userId = data.user_id || 0;

    localStorage.setItem('token', t)
    localStorage.setItem('role', role)
    localStorage.setItem('username', user)
    localStorage.setItem('userId', userId.toString())

    setToken(t)
    setUserRole(role)
    setUsername(user)
    setIsLoggedIn(true)
    setActiveTab('batch')  // Redirect to batch generator after login
    fetchConfig(t)
    fetchUserProfile(t)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('username')
    localStorage.removeItem('userId')
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

  const handleSelectForVideo = (imgUrl, prompt, category) => {
    setSelectedImage(imgUrl)
    setSelectedVideoPrompt(prompt || '')
    setSelectedCategory(category || 'daily')  // Pass category
    setSelectionTimestamp(Date.now())
    setActiveTab('video')
  }

  if (!isLoggedIn) {
    if (showLoginPage) {
      return <Login onLogin={handleLogin} onBack={() => setShowLoginPage(false)} />;
    }
    return <PublicGallery onLoginClick={() => setShowLoginPage(true)} siteConfig={publicConfig} />;
  }

  return (
    <div className={`app-container ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile hamburger button */}
      <button 
        className="hamburger-btn"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label={mobileMenuOpen ? "关闭菜单" : "打开菜单"}
        aria-expanded={mobileMenuOpen}
      >
        <span className={`hamburger-line ${mobileMenuOpen ? 'open' : ''}`}></span>
        <span className={`hamburger-line ${mobileMenuOpen ? 'open' : ''}`}></span>
        <span className={`hamburger-line ${mobileMenuOpen ? 'open' : ''}`}></span>
      </button>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div 
          className="mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="nav-brand">
            <div className="brand-icon">🍌</div>
            {!sidebarCollapsed && (
              <div className="brand-text">
                <span className="brand-name">{config.site_title || 'Banana Product'}</span>
                <span className="brand-user">{config.site_subtitle || `${username} (${userRole})`}</span>
              </div>
            )}
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <div className="sidebar-menu">
          <button
            className={`sidebar-item ${activeTab === 'simple-batch' ? 'active' : ''}`}
            onClick={() => { setActiveTab('simple-batch'); setMobileMenuOpen(false); }}
            title="单图批量"
            aria-label="单图批量"
            aria-current={activeTab === 'simple-batch' ? 'page' : undefined}
          >
            <span className="icon">📦</span>
            {!sidebarCollapsed && <span className="label">单图批量</span>}
          </button>
          <button
            className={`sidebar-item ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => { setActiveTab('batch'); setMobileMenuOpen(false); }}
            title="批量场景"
            aria-label="批量场景"
            aria-current={activeTab === 'batch' ? 'page' : undefined}
          >
            <span className="icon">🎨</span>
            {!sidebarCollapsed && <span className="label">批量场景</span>}
          </button>
          <button
            className={`sidebar-item ${activeTab === 'video' ? 'active' : ''}`}
            onClick={() => { setActiveTab('video'); setMobileMenuOpen(false); }}
            title="视频生成"
            aria-label="视频生成"
            aria-current={activeTab === 'video' ? 'page' : undefined}
          >
            <span className="icon">📹</span>
            {!sidebarCollapsed && <span className="label">视频生成</span>}
          </button>
          <button
            className={`sidebar-item ${activeTab === 'story' ? 'active' : ''}`}
            onClick={() => { setActiveTab('story'); setMobileMenuOpen(false); }}
            title="故事模式"
            aria-label="故事模式"
            aria-current={activeTab === 'story' ? 'page' : undefined}
          >
            <span className="icon">🎬</span>
            {!sidebarCollapsed && <span className="label">故事模式</span>}
          </button>

          <button
            className="sidebar-item"
            onClick={() => window.open('https://ai.studio/apps/drive/1yz74ruD7ppy6XwVXm-4NcnU1a09AzATR', '_blank')}
            title="泰语配音"
            aria-label="泰语配音 - 在新标签页打开"
          >
            <span className="icon">🎙️</span>
            {!sidebarCollapsed && <span className="label">泰语配音</span>}
          </button>

          {/* Profile - All Users */}
          <button
            className={`sidebar-item ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => { setActiveTab('profile'); setMobileMenuOpen(false); }}
            title="个人设置"
            aria-label="个人设置"
            aria-current={activeTab === 'profile' ? 'page' : undefined}
          >
            <span className="icon">👤</span>
            {!sidebarCollapsed && <span className="label">个人设置</span>}
          </button>

          {/* Admin Only */}
          {userRole === 'admin' && (
            <>
              <div className="sidebar-divider"></div>
              <button
                className={`sidebar-item ${activeTab === 'monitor' ? 'active' : ''}`}
                onClick={() => { setActiveTab('monitor'); setMobileMenuOpen(false); }}
                title="实时监控"
                aria-label="实时监控"
                aria-current={activeTab === 'monitor' ? 'page' : undefined}
              >
                <span className="icon">📊</span>
                {!sidebarCollapsed && <span className="label">实时监控</span>}
              </button>
              <button
                className={`sidebar-item ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => { setActiveTab('settings'); setMobileMenuOpen(false); }}
                title="系统设置"
                aria-label="系统设置"
                aria-current={activeTab === 'settings' ? 'page' : undefined}
              >
                <span className="icon">⚙️</span>
                {!sidebarCollapsed && <span className="label">系统设置</span>}
              </button>
              <button
                className={`sidebar-item ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => { setActiveTab('users'); setMobileMenuOpen(false); }}
                title="用户管理"
                aria-label="用户管理"
                aria-current={activeTab === 'users' ? 'page' : undefined}
              >
                <span className="icon">👥</span>
                {!sidebarCollapsed && <span className="label">用户管理</span>}
              </button>
            </>
          )}
        </div>

        {/* User Profile in Sidebar */}
        {!sidebarCollapsed && userProfile && (
          <div className="sidebar-user-profile">
            <div className="sidebar-avatar">
              <img src={userProfile.avatar || '/default-avatar.jpg'} alt="Avatar" />
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{userProfile.nickname || userProfile.username}</span>
              <span className="sidebar-user-level">Lv.{userProfile.level || 1} {userProfile.level_name || '凡人'}</span>
            </div>
            <div className="sidebar-exp-bar">
              <div
                className="sidebar-exp-fill"
                style={{ width: `${userProfile.level_progress || 0}%` }}
              />
            </div>
            <span className="sidebar-exp-text">{userProfile.experience || 0} EXP</span>
          </div>
        )}

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
              aria-label={theme === 'dark' ? '切换到白天模式' : '切换到夜间模式'}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                color: 'var(--text-main)',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.1rem',
                transition: 'background 0.2s'
              }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {!sidebarCollapsed && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {theme === 'dark' ? '夜间模式' : '白天模式'}
              </span>
            )}
          </div>
          <div className="connection-status" title={isConnected ? '实时连接' : '离线'}>
            <div className={`status-dot ${isConnected ? 'online' : 'offline'}`}></div>
            {!sidebarCollapsed && <span>{isConnected ? '实时连接' : '离线'}</span>}
          </div>
          <button
            className="logout-btn"
            onClick={handleLogout}
            title="登出"
            aria-label="退出登录"
          >
            {sidebarCollapsed ? '🚪' : '登出 🚪'}
          </button>
        </div>
      </aside>

      <main className="main-content" id="main-content" tabIndex={-1}>
        <div style={{ display: activeTab === 'batch' ? 'block' : 'none', height: '100%' }}>
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

        <div style={{ display: activeTab === 'simple-batch' ? 'block' : 'none' }}>
          <SimpleBatchGenerator
            token={token}
            config={config}
            onTabChange={setActiveTab}
          />
        </div>



        <div style={{ display: activeTab === 'video' ? 'block' : 'none' }}>
          <VideoGenerator
            token={token}
            initialImage={selectedImage}
            initialPrompt={selectedVideoPrompt}
            initialCategory={selectedCategory}
            requestTimestamp={selectionTimestamp}
            config={config}
            onConfigChange={handleConfigChange}
            isActive={activeTab === 'video'}
          />
        </div>

        {/* FloatingGallery is rendered at root level, not here */}

        <div style={{ display: activeTab === 'profile' ? 'block' : 'none', height: '100%', overflow: 'auto' }}>
          <ProfileSettings token={token} onProfileUpdate={() => { }} />
        </div>

        {/* Admin Tabs */}
        {userRole === 'admin' && (
          <>
            <div style={{ display: activeTab === 'monitor' ? 'block' : 'none', height: '100%' }}>
              <AdminDashboard token={token} isConnected={isConnected} lastMessage={lastMessage} />
            </div>
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

      {/* Floating Gallery Trigger Button - Right Side */}
      <button
        className={`gallery-trigger-btn ${isGalleryOpen ? 'active' : ''}`}
        onClick={() => setIsGalleryOpen(!isGalleryOpen)}
        title="打开画廊"
      >
        <span className="gallery-trigger-icon">🖼️</span>
        <span className="gallery-trigger-arrow">{isGalleryOpen ? '›' : '‹'}</span>
      </button>

      {/* Floating Gallery Drawer */}
      <FloatingGallery
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
        onSelectForVideo={handleSelectForVideo}
      />
    </div>
  )
}

export default App

