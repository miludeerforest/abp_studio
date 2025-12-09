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
        site_subtitle: ''
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
                site_subtitle: config.site_subtitle || ''
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
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
            <div className="section-title">系统设置</div>

            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>

                {/* Image Generation Settings */}
                <h3 style={{ marginTop: 0, marginBottom: '16px', borderBottom: '1px solid var(--card-border)', paddingBottom: '8px' }}>📦 批量场景生成配置</h3>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>API URL</label>
                    <input
                        type="text"
                        value={localConfig.api_url}
                        onChange={(e) => handleChange('api_url', e.target.value)}
                        placeholder="e.g. https://generativelanguage.googleapis.com"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>API Key</label>
                    <input
                        type="password"
                        value={localConfig.api_key}
                        onChange={(e) => handleChange('api_key', e.target.value)}
                        placeholder="Your API Key"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>Model Name</label>
                    <input
                        type="text"
                        value={localConfig.model_name}
                        onChange={(e) => handleChange('model_name', e.target.value)}
                        placeholder="e.g. gemini-3-pro-image-preview"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>Visual Analysis Model Name (Step 1)</label>
                    <input
                        type="text"
                        value={localConfig.analysis_model_name}
                        onChange={(e) => handleChange('analysis_model_name', e.target.value)}
                        placeholder="e.g. gemini-3-pro-preview"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>Used for analyzing product and reference images.</small>
                </div>

                {/* Video Generation Settings */}
                <h3 style={{ marginBottom: '16px', borderBottom: '1px solid var(--card-border)', paddingBottom: '8px' }}>🎬 视频生成配置</h3>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>API URL</label>
                    <input
                        type="text"
                        value={localConfig.video_api_url}
                        onChange={(e) => handleChange('video_api_url', e.target.value)}
                        placeholder="Video Generation API URL"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>
                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>API Key</label>
                    <input
                        type="password"
                        value={localConfig.video_api_key}
                        onChange={(e) => handleChange('video_api_key', e.target.value)}
                        placeholder="Video Generation API Key"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>
                <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>Model Name</label>
                    <input
                        type="text"
                        value={localConfig.video_model_name}
                        onChange={(e) => handleChange('video_model_name', e.target.value)}
                        placeholder="e.g. sora-video-portrait"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                </div>

                {/* System Settings */}
                <h3 style={{ marginBottom: '16px', borderBottom: '1px solid var(--card-border)', paddingBottom: '8px' }}>🖥️ 系统配置</h3>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>网站标题 (Site Title)</label>
                    <input
                        type="text"
                        value={localConfig.site_title || ''}
                        onChange={(e) => handleChange('site_title', e.target.value)}
                        placeholder="e.g. Banana Product"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>显示在侧边栏顶部的主标题</small>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>网站副标题 (Site Subtitle)</label>
                    <input
                        type="text"
                        value={localConfig.site_subtitle || ''}
                        onChange={(e) => handleChange('site_subtitle', e.target.value)}
                        placeholder="e.g. AI Product Design Studio"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>显示在主标题下方的副标题</small>
                </div>

                <div className="form-group" style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#ccc' }}>应用地址 (App URL)</label>
                    <input
                        type="text"
                        value={localConfig.app_url}
                        onChange={(e) => handleChange('app_url', e.target.value)}
                        placeholder="e.g. http://localhost:33012"
                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)', color: '#fff' }}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>用于生成分享链接或回调地址</small>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={saving}
                        style={{ padding: '12px 32px' }}
                    >
                        {saving ? '💾 保存中...' : '💾 保存所有配置'}
                    </button>
                    {msg && <span style={{ color: '#4ade80' }}>✅ {msg}</span>}
                    {error && <span style={{ color: 'var(--error-color)' }}>❌ {error}</span>}
                </div>

            </div>
        </div>
    )
}

export default Settings
