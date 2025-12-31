import { useState, useEffect } from 'react'

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

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px', width: '100%' }}>
            <div className="section-title">系统设置</div>

            <div className="glass-card" style={{ padding: '32px' }}>

                {/* Image Generation Settings */}
                <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '20px', borderBottom: '1px solid var(--card-border)', paddingBottom: '12px', fontSize: '1.1rem', color: 'var(--text-main)' }}>📦 批量场景生成配置</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>API URL</label>
                            <input
                                type="text"
                                value={localConfig.api_url}
                                onChange={(e) => handleChange('api_url', e.target.value)}
                                placeholder="e.g. https://generativelanguage.googleapis.com"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>API Key</label>
                            <input
                                type="password"
                                value={localConfig.api_key}
                                onChange={(e) => handleChange('api_key', e.target.value)}
                                placeholder="Your API Key"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>Model Name</label>
                            <input
                                type="text"
                                value={localConfig.model_name}
                                onChange={(e) => handleChange('model_name', e.target.value)}
                                placeholder="e.g. gemini-3-pro-image-preview"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>Visual Analysis Model (Step 1)</label>
                            <input
                                type="text"
                                value={localConfig.analysis_model_name}
                                onChange={(e) => handleChange('analysis_model_name', e.target.value)}
                                placeholder="e.g. gemini-3-pro-preview"
                                style={{ width: '100%' }}
                            />
                            <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>Used for analyzing product and reference images.</small>
                        </div>
                    </div>
                </div>

                {/* Video Generation Settings */}
                <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid var(--card-border)', paddingBottom: '12px', fontSize: '1.1rem', color: 'var(--text-main)' }}>🎬 视频生成配置</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>API URL</label>
                            <input
                                type="text"
                                value={localConfig.video_api_url}
                                onChange={(e) => handleChange('video_api_url', e.target.value)}
                                placeholder="Video Generation API URL"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>API Key</label>
                            <input
                                type="password"
                                value={localConfig.video_api_key}
                                onChange={(e) => handleChange('video_api_key', e.target.value)}
                                placeholder="Video Generation API Key"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>Model Name</label>
                            <input
                                type="text"
                                value={localConfig.video_model_name}
                                onChange={(e) => handleChange('video_model_name', e.target.value)}
                                placeholder="e.g. sora-video-portrait"
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Video Quality Review Settings */}
                <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid var(--card-border)', paddingBottom: '12px', fontSize: '1.1rem', color: 'var(--text-main)' }}>验️ 视频质量审查配置</h3>
                    <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontWeight: '600', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={localConfig.review_enabled}
                                onChange={(e) => handleChange('review_enabled', e.target.checked)}
                                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                            启用自动审查
                        </label>
                        <small style={{ color: 'var(--text-muted)' }}>视频生成完成后自动调用AI评估内容质量</small>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>审查 API URL (OAI兼容)</label>
                            <input
                                type="text"
                                value={localConfig.review_api_url}
                                onChange={(e) => handleChange('review_api_url', e.target.value)}
                                placeholder="e.g. https://api.openai.com/v1"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>审查 API Key</label>
                            <input
                                type="password"
                                value={localConfig.review_api_key}
                                onChange={(e) => handleChange('review_api_key', e.target.value)}
                                placeholder="Your Review API Key"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>审查模型名称</label>
                            <input
                                type="text"
                                value={localConfig.review_model_name}
                                onChange={(e) => handleChange('review_model_name', e.target.value)}
                                placeholder="e.g. gpt-4o, claude-3.5-sonnet"
                                style={{ width: '100%' }}
                            />
                            <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>支持图片输入的模型 (如 GPT-4o, Claude 3.5)</small>
                        </div>
                    </div>
                </div>

                {/* System Settings */}
                <div style={{ marginBottom: '32px' }}>
                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid var(--card-border)', paddingBottom: '12px', fontSize: '1.1rem', color: 'var(--text-main)' }}>🖥️ 系统配置</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>网站标题 (Site Title)</label>
                            <input
                                type="text"
                                value={localConfig.site_title || ''}
                                onChange={(e) => handleChange('site_title', e.target.value)}
                                placeholder="e.g. Banana Product"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>网站副标题 (Subtitle)</label>
                            <input
                                type="text"
                                value={localConfig.site_subtitle || ''}
                                onChange={(e) => handleChange('site_subtitle', e.target.value)}
                                placeholder="e.g. AI Product Design Studio"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>应用地址 (App URL)</label>
                            <input
                                type="text"
                                value={localConfig.app_url}
                                onChange={(e) => handleChange('app_url', e.target.value)}
                                placeholder="e.g. http://localhost:33012"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600' }}>📁 缓存保留 (天)</label>
                            <input
                                type="number"
                                min="0"
                                value={localConfig.cache_retention_days}
                                onChange={(e) => handleChange('cache_retention_days', parseInt(e.target.value) || 0)}
                                placeholder="0 = 永久保留"
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Concurrency Settings */}
                <div style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid var(--card-border)', paddingBottom: '12px', fontSize: '1.1rem', color: 'var(--text-main)' }}>⚡ 并行处理配置</h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600', fontSize: '0.9rem' }}>🖼️ 图片并发</label>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={localConfig.max_concurrent_image}
                                onChange={(e) => handleChange('max_concurrent_image', parseInt(e.target.value) || 5)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600', fontSize: '0.9rem' }}>🎬 视频并发</label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={localConfig.max_concurrent_video}
                                onChange={(e) => handleChange('max_concurrent_video', parseInt(e.target.value) || 3)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600', fontSize: '0.9rem' }}>📖 Story并发</label>
                            <input
                                type="number"
                                min="1"
                                max="5"
                                value={localConfig.max_concurrent_story}
                                onChange={(e) => handleChange('max_concurrent_story', parseInt(e.target.value) || 2)}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-main)', fontWeight: '600', fontSize: '0.9rem' }}>👤 用户限额</label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={localConfig.max_concurrent_per_user}
                                onChange={(e) => handleChange('max_concurrent_per_user', parseInt(e.target.value) || 2)}
                                style={{ width: '100%' }}
                            />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '32px', borderTop: '1px solid var(--card-border)', paddingTop: '24px' }}>
                    <button
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={saving}
                        style={{ padding: '12px 48px', fontSize: '1rem' }}
                    >
                        {saving ? '💾 保存中...' : '💾 保存所有配置'}
                    </button>
                    {msg && <span style={{ color: 'var(--success-color)', fontWeight: '500' }}>✅ {msg}</span>}
                    {error && <span style={{ color: 'var(--error-color)', fontWeight: '500' }}>❌ {error}</span>}
                </div>

            </div>
        </div>
    )
}

export default Settings
