import { useState, useEffect } from 'react'
import './Settings.css'

function Settings({ token, config, onConfigChange }) {
    const [localConfig, setLocalConfig] = useState({
        api_url: '',
        api_key: '',
        model_name: '',
        video_api_url: '',
        video_api_key: '',
        video_model_name: '',
        app_url: '',
        analysis_model_name: '',
        site_title: '',
        site_subtitle: '',
        cache_retention_days: 7,
        // Concurrency settings
        max_concurrent_image: 5,
        max_concurrent_video: 3,
        max_concurrent_story: 2,
        max_concurrent_per_user: 2,
        // Video Quality Review
        review_api_url: '',
        review_api_key: '',
        review_model_name: 'gpt-4o',
        review_enabled: false
    })
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState(null)
    const [error, setError] = useState(null)
    const [activeSection, setActiveSection] = useState('all')

    useEffect(() => {
        if (config) {
            setLocalConfig({
                api_url: config.api_url || '',
                api_key: config.api_key || '',
                model_name: config.model_name || '',
                video_api_url: config.video_api_url || '',
                video_api_key: config.video_api_key || '',
                video_model_name: config.video_model_name || '',
                app_url: config.app_url || '',
                analysis_model_name: config.analysis_model_name || '',
                site_title: config.site_title || '',
                site_subtitle: config.site_subtitle || '',
                cache_retention_days: config.cache_retention_days ?? 7,
                // Concurrency settings
                max_concurrent_image: config.max_concurrent_image ?? 5,
                max_concurrent_video: config.max_concurrent_video ?? 3,
                max_concurrent_story: config.max_concurrent_story ?? 2,
                max_concurrent_per_user: config.max_concurrent_per_user ?? 2,
                // Video Quality Review
                review_api_url: config.review_api_url || '',
                review_api_key: config.review_api_key || '',
                review_model_name: config.review_model_name || 'gpt-4o',
                review_enabled: config.review_enabled === true || config.review_enabled === 'true'
            })
        }
    }, [config])

    const handleChange = (key, value) => {
        setLocalConfig(prev => ({ ...prev, [key]: value }))
    }

    const handleSave = async () => {
        setSaving(true)
        setMsg(null)
        setError(null)

        try {
            await onConfigChange(localConfig)
            setMsg("配置已保存")
            setTimeout(() => setMsg(null), 3000)
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    const sections = [
        { id: 'all', label: '全部', icon: '🏠' },
        { id: 'image', label: '图片生成', icon: '📦' },
        { id: 'video', label: '视频生成', icon: '🎬' },
        { id: 'review', label: '质量审查', icon: '🔍' },
        { id: 'system', label: '系统配置', icon: '🖥️' },
        { id: 'performance', label: '性能调优', icon: '⚡' }
    ]

    const shouldShow = (sectionId) => {
        return activeSection === 'all' || activeSection === sectionId
    }

    return (
        <div className="settings-container">
            {/* 页面标题 */}
            <div className="settings-header">
                <h1 className="settings-title">
                    <span className="settings-icon">⚙️</span>
                    系统设置
                </h1>
                <p className="settings-subtitle">管理应用程序的核心配置和参数</p>
            </div>

            {/* 快速导航标签 */}
            <div className="settings-tabs">
                {sections.map(section => (
                    <button
                        key={section.id}
                        className={`settings-tab ${activeSection === section.id ? 'active' : ''}`}
                        onClick={() => setActiveSection(section.id)}
                    >
                        <span className="tab-icon">{section.icon}</span>
                        <span className="tab-label">{section.label}</span>
                    </button>
                ))}
            </div>

            {/* 配置卡片网格 */}
            <div className="settings-grid">

                {/* 批量场景生成配置 */}
                {shouldShow('image') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon image-icon">📦</div>
                            <div className="card-title-group">
                                <h3 className="card-title">批量场景生成</h3>
                                <p className="card-desc">配置图片生成 API 和模型参数</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row">
                                <div className="form-field">
                                    <label className="field-label">API URL</label>
                                    <input
                                        type="text"
                                        value={localConfig.api_url}
                                        onChange={(e) => handleChange('api_url', e.target.value)}
                                        placeholder="https://generativelanguage.googleapis.com"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">API Key</label>
                                    <input
                                        type="password"
                                        value={localConfig.api_key}
                                        onChange={(e) => handleChange('api_key', e.target.value)}
                                        placeholder="Your API Key"
                                        className="field-input"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-field">
                                    <label className="field-label">生成模型</label>
                                    <input
                                        type="text"
                                        value={localConfig.model_name}
                                        onChange={(e) => handleChange('model_name', e.target.value)}
                                        placeholder="gemini-3-pro-image-preview"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">分析模型 (Step 1)</label>
                                    <input
                                        type="text"
                                        value={localConfig.analysis_model_name}
                                        onChange={(e) => handleChange('analysis_model_name', e.target.value)}
                                        placeholder="gemini-3-pro-preview"
                                        className="field-input"
                                    />
                                    <span className="field-hint">用于分析产品和参考图片</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 视频生成配置 */}
                {shouldShow('video') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon video-icon">🎬</div>
                            <div className="card-title-group">
                                <h3 className="card-title">视频生成</h3>
                                <p className="card-desc">配置视频生成服务的连接参数</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row three-col">
                                <div className="form-field">
                                    <label className="field-label">API URL</label>
                                    <input
                                        type="text"
                                        value={localConfig.video_api_url}
                                        onChange={(e) => handleChange('video_api_url', e.target.value)}
                                        placeholder="Video Generation API URL"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">API Key</label>
                                    <input
                                        type="password"
                                        value={localConfig.video_api_key}
                                        onChange={(e) => handleChange('video_api_key', e.target.value)}
                                        placeholder="Video Generation API Key"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">模型名称</label>
                                    <input
                                        type="text"
                                        value={localConfig.video_model_name}
                                        onChange={(e) => handleChange('video_model_name', e.target.value)}
                                        placeholder="sora2-portrait-10s"
                                        className="field-input"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 视频质量审查配置 */}
                {shouldShow('review') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon review-icon">🔍</div>
                            <div className="card-title-group">
                                <h3 className="card-title">视频质量审查</h3>
                                <p className="card-desc">AI 自动评估视频内容质量</p>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={localConfig.review_enabled}
                                    onChange={(e) => handleChange('review_enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                                <span className="toggle-label">{localConfig.review_enabled ? '已启用' : '已禁用'}</span>
                            </label>
                        </div>
                        <div className="card-content">
                            <div className="form-row three-col">
                                <div className="form-field">
                                    <label className="field-label">审查 API URL</label>
                                    <input
                                        type="text"
                                        value={localConfig.review_api_url}
                                        onChange={(e) => handleChange('review_api_url', e.target.value)}
                                        placeholder="https://api.openai.com/v1"
                                        className="field-input"
                                        disabled={!localConfig.review_enabled}
                                    />
                                    <span className="field-hint">OAI 兼容接口</span>
                                </div>
                                <div className="form-field">
                                    <label className="field-label">审查 API Key</label>
                                    <input
                                        type="password"
                                        value={localConfig.review_api_key}
                                        onChange={(e) => handleChange('review_api_key', e.target.value)}
                                        placeholder="Your Review API Key"
                                        className="field-input"
                                        disabled={!localConfig.review_enabled}
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">审查模型</label>
                                    <input
                                        type="text"
                                        value={localConfig.review_model_name}
                                        onChange={(e) => handleChange('review_model_name', e.target.value)}
                                        placeholder="gpt-4o"
                                        className="field-input"
                                        disabled={!localConfig.review_enabled}
                                    />
                                    <span className="field-hint">支持图片输入的模型</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 系统配置 */}
                {shouldShow('system') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon system-icon">🖥️</div>
                            <div className="card-title-group">
                                <h3 className="card-title">系统配置</h3>
                                <p className="card-desc">网站基础信息和缓存设置</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row">
                                <div className="form-field">
                                    <label className="field-label">网站标题</label>
                                    <input
                                        type="text"
                                        value={localConfig.site_title || ''}
                                        onChange={(e) => handleChange('site_title', e.target.value)}
                                        placeholder="Banana Product"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">网站副标题</label>
                                    <input
                                        type="text"
                                        value={localConfig.site_subtitle || ''}
                                        onChange={(e) => handleChange('site_subtitle', e.target.value)}
                                        placeholder="AI Product Design Studio"
                                        className="field-input"
                                    />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-field">
                                    <label className="field-label">应用地址</label>
                                    <input
                                        type="text"
                                        value={localConfig.app_url}
                                        onChange={(e) => handleChange('app_url', e.target.value)}
                                        placeholder="http://localhost:33012"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-field">
                                    <label className="field-label">📁 缓存保留 (天)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={localConfig.cache_retention_days}
                                        onChange={(e) => handleChange('cache_retention_days', parseInt(e.target.value) || 0)}
                                        placeholder="0 = 永久保留"
                                        className="field-input"
                                    />
                                    <span className="field-hint">设置为 0 表示永久保留</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 并行处理配置 */}
                {shouldShow('performance') && (
                    <div className="settings-card full-width">
                        <div className="card-header">
                            <div className="card-icon performance-icon">⚡</div>
                            <div className="card-title-group">
                                <h3 className="card-title">并行处理</h3>
                                <p className="card-desc">调整系统并发任务数量以优化性能</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-icon">🖼️</div>
                                    <div className="stat-info">
                                        <span className="stat-label">图片并发</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="20"
                                            value={localConfig.max_concurrent_image}
                                            onChange={(e) => handleChange('max_concurrent_image', parseInt(e.target.value) || 5)}
                                            className="stat-input"
                                        />
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon">🎬</div>
                                    <div className="stat-info">
                                        <span className="stat-label">视频并发</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={localConfig.max_concurrent_video}
                                            onChange={(e) => handleChange('max_concurrent_video', parseInt(e.target.value) || 3)}
                                            className="stat-input"
                                        />
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon">📖</div>
                                    <div className="stat-info">
                                        <span className="stat-label">Story 并发</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="5"
                                            value={localConfig.max_concurrent_story}
                                            onChange={(e) => handleChange('max_concurrent_story', parseInt(e.target.value) || 2)}
                                            className="stat-input"
                                        />
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon">👤</div>
                                    <div className="stat-info">
                                        <span className="stat-label">用户限额</span>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={localConfig.max_concurrent_per_user}
                                            onChange={(e) => handleChange('max_concurrent_per_user', parseInt(e.target.value) || 2)}
                                            className="stat-input"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 保存按钮区域 */}
            <div className="settings-footer">
                <div className="footer-status">
                    {msg && <span className="status-success">✅ {msg}</span>}
                    {error && <span className="status-error">❌ {error}</span>}
                </div>
                <button
                    className="save-button"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <span className="save-spinner"></span>
                            保存中...
                        </>
                    ) : (
                        <>
                            <span className="save-icon">💾</span>
                            保存所有配置
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

export default Settings
