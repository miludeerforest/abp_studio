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
        max_concurrent_image: 5,
        max_concurrent_video: 3,
        max_concurrent_story: 2,
        max_concurrent_per_user: 2,
        review_api_url: '',
        review_api_key: '',
        review_model_name: 'gpt-4o',
        review_enabled: false,
        feishu_app_id: '',
        feishu_app_secret: '',
        feishu_app_token: '',
        feishu_table_id: '',
        feishu_description_app_token: '',
        feishu_description_table_id: '',
        content_review_enabled: false,
        content_review_api_url: '',
        content_review_api_key: '',
        content_review_model: '',
        thai_dubbing_url: '',
        voice_clone_api_url: '',
        voice_clone_api_key: '',
        voice_clone_analysis_model: '',
        voice_clone_tts_model: ''
    })
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState(null)
    const [error, setError] = useState(null)
    const [activeSection, setActiveSection] = useState('all')
    
    const [imageModels, setImageModels] = useState([])
    const [videoModels, setVideoModels] = useState([])
    const [reviewModels, setReviewModels] = useState([])
    const [loadingModels, setLoadingModels] = useState({})

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
                max_concurrent_image: config.max_concurrent_image ?? 5,
                max_concurrent_video: config.max_concurrent_video ?? 3,
                max_concurrent_story: config.max_concurrent_story ?? 2,
                max_concurrent_per_user: config.max_concurrent_per_user ?? 2,
                review_api_url: config.review_api_url || '',
                review_api_key: config.review_api_key || '',
                review_model_name: config.review_model_name || 'gpt-4o',
                review_enabled: config.review_enabled === true || config.review_enabled === 'true',
                feishu_app_id: config.feishu_app_id || '',
                feishu_app_secret: config.feishu_app_secret || '',
                feishu_app_token: config.feishu_app_token || '',
                feishu_table_id: config.feishu_table_id || '',
                feishu_description_app_token: config.feishu_description_app_token || '',
                feishu_description_table_id: config.feishu_description_table_id || '',
                content_review_enabled: config.content_review_enabled === true || config.content_review_enabled === 'true',
                content_review_api_url: config.content_review_api_url || '',
                content_review_api_key: config.content_review_api_key || '',
                content_review_model: config.content_review_model || '',
                thai_dubbing_url: config.thai_dubbing_url || '',
                voice_clone_api_url: config.voice_clone_api_url || '',
                voice_clone_api_key: config.voice_clone_api_key || '',
                voice_clone_analysis_model: config.voice_clone_analysis_model || '',
                voice_clone_tts_model: config.voice_clone_tts_model || ''
            })
        }
    }, [config])

    const fetchModels = async (apiUrl, apiKey, type) => {
        if (!apiUrl || !apiKey) {
            return []
        }
        
        setLoadingModels(prev => ({ ...prev, [type]: true }))
        
        try {
            const res = await fetch('/api/v1/models', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ api_url: apiUrl, api_key: apiKey })
            })
            
            if (res.ok) {
                const data = await res.json()
                return data.models || []
            }
        } catch (e) {
            console.error(`Failed to fetch ${type} models:`, e)
        } finally {
            setLoadingModels(prev => ({ ...prev, [type]: false }))
        }
        return []
    }

    const refreshImageModels = async () => {
        const models = await fetchModels(localConfig.api_url, localConfig.api_key, 'image')
        setImageModels(models)
    }

    const refreshVideoModels = async () => {
        const models = await fetchModels(localConfig.video_api_url, localConfig.video_api_key, 'video')
        setVideoModels(models)
    }

    const refreshReviewModels = async () => {
        const models = await fetchModels(localConfig.review_api_url, localConfig.review_api_key, 'review')
        setReviewModels(models)
    }

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
        { id: 'voice_clone', label: '音色模仿', icon: '🎙️' },
        { id: 'review', label: '质量审查', icon: '🔍' },
        { id: 'content_review', label: '内容审核', icon: '🛡️' },
        { id: 'feishu', label: '飞书集成', icon: '📋' },
        { id: 'system', label: '系统配置', icon: '🖥️' },
        { id: 'performance', label: '性能调优', icon: '⚡' }
    ]

    const shouldShow = (sectionId) => {
        return activeSection === 'all' || activeSection === sectionId
    }

    const ModelSelect = ({ value, onChange, models, loading, onRefresh, placeholder, disabled }) => (
        <div className="model-select-wrapper">
            <div className="model-select-row">
                {models.length > 0 ? (
                    <select
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="field-input field-select"
                        disabled={disabled}
                    >
                        <option value="">-- 选择模型 --</option>
                        {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                ) : (
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        className="field-input"
                        disabled={disabled}
                    />
                )}
                <button
                    type="button"
                    className="refresh-models-btn"
                    onClick={onRefresh}
                    disabled={loading || disabled}
                    title="获取模型列表"
                >
                    {loading ? '⏳' : '🔄'}
                </button>
            </div>
        </div>
    )

    return (
        <div className="settings-container">
            <div className="settings-header">
                <h1 className="settings-title">
                    <span className="settings-icon">⚙️</span>
                    系统设置
                </h1>
                <p className="settings-subtitle">管理应用程序的核心配置和参数</p>
            </div>

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

            <div className="settings-grid">

                {shouldShow('image') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon image-icon">📦</div>
                            <div className="card-title-group">
                                <h3 className="card-title">图片生成 API</h3>
                                <p className="card-desc">配置图片生成服务的连接参数</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-group">
                                <label className="field-label">API 地址</label>
                                <input
                                    type="text"
                                    value={localConfig.api_url}
                                    onChange={(e) => handleChange('api_url', e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="field-input"
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">API 密钥</label>
                                <input
                                    type="password"
                                    value={localConfig.api_key}
                                    onChange={(e) => handleChange('api_key', e.target.value)}
                                    placeholder="sk-..."
                                    className="field-input"
                                />
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">生成模型</label>
                                    <ModelSelect
                                        value={localConfig.model_name}
                                        onChange={(v) => handleChange('model_name', v)}
                                        models={imageModels}
                                        loading={loadingModels.image}
                                        onRefresh={refreshImageModels}
                                        placeholder="gemini-imagen"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="field-label">分析模型</label>
                                    <ModelSelect
                                        value={localConfig.analysis_model_name}
                                        onChange={(v) => handleChange('analysis_model_name', v)}
                                        models={imageModels}
                                        loading={loadingModels.image}
                                        onRefresh={refreshImageModels}
                                        placeholder="gemini-2.0-flash"
                                    />
                                    <span className="field-hint">用于分析产品图片</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('video') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon video-icon">🎬</div>
                            <div className="card-title-group">
                                <h3 className="card-title">视频生成 API</h3>
                                <p className="card-desc">配置视频生成服务的连接参数</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-group">
                                <label className="field-label">API 地址</label>
                                <input
                                    type="text"
                                    value={localConfig.video_api_url}
                                    onChange={(e) => handleChange('video_api_url', e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="field-input"
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">API 密钥</label>
                                <input
                                    type="password"
                                    value={localConfig.video_api_key}
                                    onChange={(e) => handleChange('video_api_key', e.target.value)}
                                    placeholder="sk-..."
                                    className="field-input"
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">视频模型</label>
                                <ModelSelect
                                    value={localConfig.video_model_name}
                                    onChange={(v) => handleChange('video_model_name', v)}
                                    models={videoModels}
                                    loading={loadingModels.video}
                                    onRefresh={refreshVideoModels}
                                    placeholder="sora2-portrait-15s"
                                />
                                <span className="field-hint">支持 Sora、Veo 等视频生成模型</span>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('voice_clone') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon voice-clone-icon">🎙️</div>
                            <div className="card-title-group">
                                <h3 className="card-title">音色模仿配置</h3>
                                <p className="card-desc">多语种视频配音与合规功能的API和模型设置</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-group">
                                <label className="field-label">API 地址</label>
                                <input
                                    type="text"
                                    value={localConfig.voice_clone_api_url}
                                    onChange={(e) => handleChange('voice_clone_api_url', e.target.value)}
                                    placeholder="https://api.example.com/v1（留空使用默认API）"
                                    className="field-input"
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">API 密钥</label>
                                <input
                                    type="password"
                                    value={localConfig.voice_clone_api_key}
                                    onChange={(e) => handleChange('voice_clone_api_key', e.target.value)}
                                    placeholder="sk-...（留空使用默认密钥）"
                                    className="field-input"
                                />
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">视频分析模型</label>
                                    <ModelSelect
                                        value={localConfig.voice_clone_analysis_model}
                                        onChange={(v) => handleChange('voice_clone_analysis_model', v)}
                                        models={imageModels}
                                        loading={loadingModels.image}
                                        onRefresh={refreshImageModels}
                                        placeholder="gemini-3-flash-preview"
                                    />
                                    <span className="field-hint">留空使用默认分析模型</span>
                                </div>
                                <div className="form-group">
                                    <label className="field-label">TTS 语音合成模型</label>
                                    <ModelSelect
                                        value={localConfig.voice_clone_tts_model}
                                        onChange={(v) => handleChange('voice_clone_tts_model', v)}
                                        models={imageModels}
                                        loading={loadingModels.image}
                                        onRefresh={refreshImageModels}
                                        placeholder="gemini-2.5-pro-preview-tts"
                                    />
                                    <span className="field-hint">用于将脚本转换为语音</span>
                                </div>
                            </div>
                            <div className="form-hint-box">
                                <p><strong>功能说明：</strong></p>
                                <ul>
                                    <li>支持泰语、西班牙语、英语、日语、韩语配音</li>
                                    <li>自动品牌词脱敏，确保内容合规</li>
                                    <li>10种声线可选，生成高质量音频</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('review') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon review-icon">🔍</div>
                            <div className="card-title-group">
                                <h3 className="card-title">质量审查</h3>
                                <p className="card-desc">AI 自动审查视频生成质量</p>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={localConfig.review_enabled}
                                    onChange={(e) => handleChange('review_enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                        <div className="card-content">
                            <div className="form-group">
                                <label className="field-label">审查 API 地址</label>
                                <input
                                    type="text"
                                    value={localConfig.review_api_url}
                                    onChange={(e) => handleChange('review_api_url', e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="field-input"
                                    disabled={!localConfig.review_enabled}
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">审查 API 密钥</label>
                                <input
                                    type="password"
                                    value={localConfig.review_api_key}
                                    onChange={(e) => handleChange('review_api_key', e.target.value)}
                                    placeholder="sk-..."
                                    className="field-input"
                                    disabled={!localConfig.review_enabled}
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">审查模型</label>
                                <ModelSelect
                                    value={localConfig.review_model_name}
                                    onChange={(v) => handleChange('review_model_name', v)}
                                    models={reviewModels}
                                    loading={loadingModels.review}
                                    onRefresh={refreshReviewModels}
                                    placeholder="gpt-4o"
                                    disabled={!localConfig.review_enabled}
                                />
                                <span className="field-hint">用于评估视频生成质量</span>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('content_review') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon review-icon">🛡️</div>
                            <div className="card-title-group">
                                <h3 className="card-title">内容审核</h3>
                                <p className="card-desc">AI 自动审核生成内容的合规性</p>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={localConfig.content_review_enabled}
                                    onChange={(e) => handleChange('content_review_enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                        <div className="card-content">
                            <div className="form-group">
                                <label className="field-label">审核 API 地址</label>
                                <input
                                    type="text"
                                    value={localConfig.content_review_api_url}
                                    onChange={(e) => handleChange('content_review_api_url', e.target.value)}
                                    placeholder="https://api.example.com/v1"
                                    className="field-input"
                                    disabled={!localConfig.content_review_enabled}
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">审核 API 密钥</label>
                                <input
                                    type="password"
                                    value={localConfig.content_review_api_key}
                                    onChange={(e) => handleChange('content_review_api_key', e.target.value)}
                                    placeholder="sk-..."
                                    className="field-input"
                                    disabled={!localConfig.content_review_enabled}
                                />
                            </div>
                            <div className="form-group">
                                <label className="field-label">审核模型</label>
                                <input
                                    type="text"
                                    value={localConfig.content_review_model}
                                    onChange={(e) => handleChange('content_review_model', e.target.value)}
                                    placeholder="content-review"
                                    className="field-input"
                                    disabled={!localConfig.content_review_enabled}
                                />
                                <span className="field-hint">用于审核生成内容是否合规</span>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('feishu') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon feishu-icon">📋</div>
                            <div className="card-title-group">
                                <h3 className="card-title">飞书多维表格</h3>
                                <p className="card-desc">同步核心词提取结果到飞书</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">App ID</label>
                                    <input
                                        type="text"
                                        value={localConfig.feishu_app_id}
                                        onChange={(e) => handleChange('feishu_app_id', e.target.value)}
                                        placeholder="cli_xxxxxx"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="field-label">App Secret</label>
                                    <input
                                        type="password"
                                        value={localConfig.feishu_app_secret}
                                        onChange={(e) => handleChange('feishu_app_secret', e.target.value)}
                                        placeholder="xxxxxx"
                                        className="field-input"
                                    />
                                </div>
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">App Token</label>
                                    <input
                                        type="text"
                                        value={localConfig.feishu_app_token}
                                        onChange={(e) => handleChange('feishu_app_token', e.target.value)}
                                        placeholder="appbcbWCzen6D8dezhoCH2RpMAh"
                                        className="field-input"
                                    />
                                    <span className="field-hint">从多维表格 URL 获取</span>
                                </div>
                                <div className="form-group">
                                    <label className="field-label">Table ID</label>
                                    <input
                                        type="text"
                                        value={localConfig.feishu_table_id}
                                        onChange={(e) => handleChange('feishu_table_id', e.target.value)}
                                        placeholder="tblsRc9GRRXKqhvW"
                                        className="field-input"
                                    />
                                    <span className="field-hint">数据表 ID</span>
                                </div>
                            </div>
                            <div className="form-hint-box">
                                <p><strong>配置说明：</strong></p>
                                <ol>
                                    <li>在 <a href="https://open.feishu.cn/app" target="_blank" rel="noopener noreferrer">飞书开放平台</a> 创建应用获取 App ID 和 App Secret</li>
                                    <li>在多维表格 URL 中获取 App Token (如: feishu.cn/base/<strong>appXXX</strong>)</li>
                                    <li>在数据表 URL 中获取 Table ID (如: ?table=<strong>tblXXX</strong>)</li>
                                    <li>确保表格有 "标题"、"中文翻译"、"核心大词" 三列</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('feishu') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon feishu-icon">📝</div>
                            <div className="card-title-group">
                                <h3 className="card-title">产品描述飞书表格</h3>
                                <p className="card-desc">同步产品描述生成结果到飞书</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">App Token</label>
                                    <input
                                        type="text"
                                        value={localConfig.feishu_description_app_token}
                                        onChange={(e) => handleChange('feishu_description_app_token', e.target.value)}
                                        placeholder="LLmVbHOOraZfjPsahfEcFGOpnLe"
                                        className="field-input"
                                    />
                                    <span className="field-hint">从多维表格 URL 获取</span>
                                </div>
                                <div className="form-group">
                                    <label className="field-label">Table ID</label>
                                    <input
                                        type="text"
                                        value={localConfig.feishu_description_table_id}
                                        onChange={(e) => handleChange('feishu_description_table_id', e.target.value)}
                                        placeholder="tblE10w3uBiiDO7y"
                                        className="field-input"
                                    />
                                    <span className="field-hint">数据表 ID</span>
                                </div>
                            </div>
                            <div className="form-hint-box">
                                <p><strong>表格列要求：</strong></p>
                                <p>产品标题、序号、类型、策略标题、策略思路、提示词、时间</p>
                            </div>
                        </div>
                    </div>
                )}

                {shouldShow('system') && (
                    <div className="settings-card">
                        <div className="card-header">
                            <div className="card-icon system-icon">🖥️</div>
                            <div className="card-title-group">
                                <h3 className="card-title">网站配置</h3>
                                <p className="card-desc">基础信息和缓存设置</p>
                            </div>
                        </div>
                        <div className="card-content">
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">网站标题</label>
                                    <input
                                        type="text"
                                        value={localConfig.site_title || ''}
                                        onChange={(e) => handleChange('site_title', e.target.value)}
                                        placeholder="ABP Studio"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="field-label">网站副标题</label>
                                    <input
                                        type="text"
                                        value={localConfig.site_subtitle || ''}
                                        onChange={(e) => handleChange('site_subtitle', e.target.value)}
                                        placeholder="AI Product Studio"
                                        className="field-input"
                                    />
                                </div>
                            </div>
                            <div className="form-row-2">
                                <div className="form-group">
                                    <label className="field-label">应用地址</label>
                                    <input
                                        type="text"
                                        value={localConfig.app_url}
                                        onChange={(e) => handleChange('app_url', e.target.value)}
                                        placeholder="https://your-domain.com"
                                        className="field-input"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="field-label">缓存保留天数</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={localConfig.cache_retention_days}
                                        onChange={(e) => handleChange('cache_retention_days', parseInt(e.target.value) || 0)}
                                        className="field-input"
                                    />
                                    <span className="field-hint">0 = 永久保留</span>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="field-label">音色模仿工具链接</label>
                                <input
                                    type="text"
                                    value={localConfig.thai_dubbing_url || ''}
                                    onChange={(e) => handleChange('thai_dubbing_url', e.target.value)}
                                    placeholder="https://ai.studio/apps/drive/..."
                                    className="field-input"
                                />
                                <span className="field-hint">侧边栏「音色模仿」按钮将跳转到此链接</span>
                            </div>
                        </div>
                    </div>
                )}

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
                            <div className="performance-grid">
                                <div className="perf-item">
                                    <span className="perf-icon">🖼️</span>
                                    <span className="perf-label">图片并发</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="20"
                                        value={localConfig.max_concurrent_image}
                                        onChange={(e) => handleChange('max_concurrent_image', parseInt(e.target.value) || 5)}
                                        className="perf-input"
                                    />
                                </div>
                                <div className="perf-item">
                                    <span className="perf-icon">🎬</span>
                                    <span className="perf-label">视频并发</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        value={localConfig.max_concurrent_video}
                                        onChange={(e) => handleChange('max_concurrent_video', parseInt(e.target.value) || 3)}
                                        className="perf-input"
                                    />
                                </div>
                                <div className="perf-item">
                                    <span className="perf-icon">📖</span>
                                    <span className="perf-label">故事并发</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="5"
                                        value={localConfig.max_concurrent_story}
                                        onChange={(e) => handleChange('max_concurrent_story', parseInt(e.target.value) || 2)}
                                        className="perf-input"
                                    />
                                </div>
                                <div className="perf-item">
                                    <span className="perf-icon">👤</span>
                                    <span className="perf-label">用户限额</span>
                                    <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        value={localConfig.max_concurrent_per_user}
                                        onChange={(e) => handleChange('max_concurrent_per_user', parseInt(e.target.value) || 2)}
                                        className="perf-input"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

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
                            保存配置
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

export default Settings
