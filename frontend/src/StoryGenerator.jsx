import React, { useState, useEffect, useRef } from 'react';
import './StoryGenerator.css';

const StoryGenerator = ({ token, config, onSelectForVideo }) => {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [connectionWarning, setConnectionWarning] = useState(false); // 网络连接警告，不影响任务执行
    const abortControllerRef = useRef(null);

    // Step 1: Input
    const [topic, setTopic] = useState('一个产品的故事');
    const [productImg, setProductImg] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [shotCount, setShotCount] = useState(5);
    const [category, setCategory] = useState('daily'); // Product category
    const [visualStyle, setVisualStyle] = useState(''); // Visual art style
    const [cameraMovement, setCameraMovement] = useState(''); // Camera movement style

    // Generation Mode: 'linear' (串行) or 'fission' (裂变并发)
    const [generationMode, setGenerationMode] = useState('fission');

    // Fission Mode State
    const [fissionId, setFissionId] = useState(null);
    const [fissionStatus, setFissionStatus] = useState(null);

    // Product Categories
    const CATEGORIES = [
        { id: 'security', label: '安防监控', icon: '📹' },
        { id: 'daily', label: '日用百货', icon: '🧴' },
        { id: 'beauty', label: '美妆护肤', icon: '💄' },
        { id: 'electronics', label: '数码3C', icon: '🎧' },
        { id: 'other', label: '其他品类', icon: '📦' }
    ];

    // Visual Art Styles
    const VISUAL_STYLES = [
        { id: '', label: '🎬 不指定风格', prompt: '' },
        { id: 'cyberpunk', label: '🌃 赛博朋克/霓虹', prompt: 'Cyberpunk neon style, vibrant neon lights, futuristic urban aesthetic, high contrast colors, glowing effects.' },
        { id: 'cinematic', label: '🎥 电影写实', prompt: 'Natural realistic style, soft natural daylight, balanced exposure, subtle shadows, true-to-life colors, everyday authenticity, smartphone camera aesthetic.' },
        { id: 'vlog', label: '📹 生活VLOG', prompt: 'Casual vlog style, handheld camera feel, natural ambient lighting, authentic everyday moments, warm tones, slightly desaturated, real-life atmosphere, no heavy post-processing.' },
        { id: 'watercolor', label: '🎨 水彩画', prompt: 'Watercolor painting style, soft edges, flowing colors, artistic brush strokes.' },
        { id: 'anime', label: '🌸 动漫风', prompt: '{anime} Anime style, clean lines, vibrant colors, Japanese animation aesthetic.' },
        { id: 'bw_film', label: '🎞️ 黑白胶片', prompt: 'Black and white film photography style, classic noir aesthetic, high contrast, film grain.' },
        { id: 'ghibli', label: '🏯 吉卜力风', prompt: 'Studio Ghibli style, whimsical and dreamy, soft pastel colors, hand-painted look.' },
        { id: 'oil_painting', label: '🖼️ 油画风', prompt: 'Oil painting style, rich textures, visible brush strokes, classical art aesthetic.' },
        { id: 'pixar3d', label: '🧸 皮克斯3D', prompt: 'Pixar 3D animation style, smooth rendering, vibrant colors, friendly aesthetic.' },
        { id: 'chinese_ink', label: '🏔️ 水墨国风', prompt: 'Chinese ink wash painting style, traditional brushwork, minimalist elegance.' },
        { id: 'scifi_future', label: '🚀 科幻未来', prompt: 'Sci-fi futuristic style, sleek metallic surfaces, holographic elements.' },
        { id: 'fantasy_magic', label: '🔮 奇幻魔法', prompt: 'Fantasy magical style, ethereal glow, mystical atmosphere, enchanted elements.' },
        { id: 'vintage_retro', label: '📻 复古怀旧', prompt: 'Vintage retro style, nostalgic color grading, faded tones, 70s/80s vibe.' },
        { id: 'minimalist', label: '⬜ 极简主义', prompt: 'Minimalist style, clean composition, negative space, simple forms.' },
        { id: 'steampunk', label: '⚙️ 蒸汽朋克', prompt: 'Steampunk style, Victorian industrial aesthetic, brass and copper tones.' },
        // Sora2API 视频风格标签
        { id: 'festive', label: '🎉 节日风格', prompt: '{festive} Festive celebration style, holiday atmosphere, colorful decorations, joyful mood.' },
        { id: 'kakalaka', label: '🐔🦎 混沌风格', prompt: '{kakalaka} Chaotic creative style, unexpected elements, surreal combinations, artistic chaos.' },
        { id: 'news', label: '📺 新闻风格', prompt: '{news} News broadcast style, professional journalism aesthetic, clean and informative presentation.' },
        { id: 'selfie', label: '🤳 自拍风格', prompt: '{selfie} Selfie style, front-facing camera perspective, personal and intimate, social media aesthetic.' },
        { id: 'handheld', label: '📱 手持风格', prompt: '{handheld} Handheld camera style, natural movement, authentic feel, documentary-like.' },
        { id: 'golden', label: '✨ 金色风格', prompt: '{golden} Golden hour style, warm golden light, luxurious atmosphere, rich golden tones.' },
        { id: 'retro', label: '📼 复古风格', prompt: '{retro} Retro style, vintage aesthetics, old-school vibes, nostalgic feel.' },
        { id: 'nostalgic', label: '🌅 怀旧风格', prompt: '{nostalgic} Nostalgic vintage style, warm faded colors, memories of the past, sentimental atmosphere.' },
        { id: 'comic', label: '💥 漫画风格', prompt: '{comic} Comic book style, bold lines, dynamic panels, pop art colors, action-packed visuals.' }
    ];

    // Camera Movement Options
    const CAMERA_MOVEMENTS = [
        { id: '', label: '自动选择运镜', prompt: '' },
        { id: 'push_in', label: '推进镜头', prompt: 'slow push-in camera movement, gradually moving closer to the subject' },
        { id: 'pull_back', label: '拉远镜头', prompt: 'gentle pull-back camera movement, revealing more of the scene' },
        { id: 'pan', label: '横摇镜头', prompt: 'smooth pan left to right or right to left camera movement' },
        { id: 'tilt', label: '俯仰镜头', prompt: 'subtle tilt up or down camera movement' },
        { id: 'orbit', label: '环绕镜头', prompt: 'orbit around the subject, 360-degree rotating camera movement' },
        { id: 'dolly', label: '轨道跟踪', prompt: 'dolly tracking shot, camera following the subject movement' },
        { id: 'static', label: '固定镜头', prompt: 'static camera with subject motion, no camera movement' },
        { id: 'crane', label: '摇臂镜头', prompt: 'crane shot, rising or descending camera movement' },
        { id: 'handheld', label: '手持抖动', prompt: 'handheld camera style, slight natural shake for realism' }
    ];

    // Step 2: Storyboard
    const [shots, setShots] = useState([]);

    // Step 3: Chain Status
    const [chainId, setChainId] = useState(null);
    const [chainStatus, setChainStatus] = useState(null);
    const [polling, setPolling] = useState(false);

    const BACKEND_URL = ''; // Relative path via proxy

    // Reset polling when stepping back
    useEffect(() => {
        if (step !== 3) {
            setPolling(false);
            setChainId(null);
            setChainStatus(null);
        }
    }, [step]);

    // Polling Effect for Linear (Chain) Mode with dynamic interval
    useEffect(() => {
        let intervalId;
        let consecutiveErrors = 0;

        // Dynamic interval based on progress - faster when closer to completion
        const getInterval = () => {
            if (!chainStatus) return 2000;
            const progress = (chainStatus.completed_shots || 0) / (chainStatus.total_shots || 1);
            if (progress > 0.8) return 1000;  // Fast polling near completion
            if (progress > 0.5) return 1500;
            return 2000;
        };

        if (polling && chainId && generationMode === 'linear') {
            const poll = async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/story-chain/${chainId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setChainStatus(data);
                        setConnectionWarning(false);
                        consecutiveErrors = 0;
                        if (data.status === 'completed' || data.status === 'failed') {
                            setPolling(false);
                        }
                    } else {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 3) {
                            setConnectionWarning(true);
                        }
                    }
                } catch (e) {
                    console.error("Polling error", e);
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        setConnectionWarning(true);
                    }
                }
                // Schedule next poll with dynamic interval
                if (polling) {
                    intervalId = setTimeout(poll, getInterval());
                }
            };
            intervalId = setTimeout(poll, getInterval());
        }
        return () => clearTimeout(intervalId);
    }, [polling, chainId, token, generationMode, chainStatus]);

    // Polling Effect for Fission Mode with dynamic interval
    useEffect(() => {
        let intervalId;
        let consecutiveErrors = 0;

        // Dynamic interval based on progress
        const getInterval = () => {
            if (!fissionStatus) return 2000;
            const progress = (fissionStatus.completed_branches || 0) / (fissionStatus.total_branches || 1);
            if (progress > 0.8) return 1000;
            if (progress > 0.5) return 1500;
            return 2000;
        };

        if (polling && fissionId && generationMode === 'fission') {
            const poll = async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/story-fission/${fissionId}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setFissionStatus(data);
                        setConnectionWarning(false);
                        consecutiveErrors = 0;
                        if (data.status === 'completed' || data.status === 'failed') {
                            setPolling(false);
                        }
                    } else {
                        consecutiveErrors++;
                        if (consecutiveErrors >= 3) {
                            setConnectionWarning(true);
                        }
                    }
                } catch (e) {
                    console.error("Fission polling error", e);
                    consecutiveErrors++;
                    if (consecutiveErrors >= 3) {
                        setConnectionWarning(true);
                    }
                }
                if (polling) {
                    intervalId = setTimeout(poll, getInterval());
                }
            };
            intervalId = setTimeout(poll, getInterval());
        }
        return () => clearTimeout(intervalId);
    }, [polling, fissionId, token, generationMode, fissionStatus]);


    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProductImg(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleAnalyze = async () => {
        if (!productImg) return;
        setLoading(true);
        setError(null);

        // Abort Controller Init
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        // Convert image to Base64
        const reader = new FileReader();
        reader.readAsDataURL(productImg);

        reader.onload = async () => {
            const base64Image = reader.result;

            if (generationMode === 'fission') {
                // Fission Mode: Direct API call with parallel generation
                const payload = {
                    initial_image_url: base64Image,
                    topic: topic,
                    branch_count: shotCount,  // Use shotCount as branch count
                    visual_style: visualStyle,
                    visual_style_prompt: VISUAL_STYLES.find(s => s.id === visualStyle)?.prompt || '',
                    camera_movement: cameraMovement,
                    camera_movement_prompt: CAMERA_MOVEMENTS.find(c => c.id === cameraMovement)?.prompt || '',
                    category: category,  // Product category for gallery/video classification
                    api_url: config.api_url,
                    api_key: config.api_key,
                    model_name: config.video_model_name
                };

                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/story-fission`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload),
                        signal: abortControllerRef.current.signal
                    });
                    const data = await res.json();
                    if (res.ok) {
                        setFissionId(data.fission_id);
                        setStep(3);
                        setPolling(true);
                    } else {
                        setError(data.detail || 'Failed to start fission generation');
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        console.log("Fission Generation Aborted");
                    } else {
                        setError(e.message);
                    }
                } finally {
                    setLoading(false);
                }
            } else {
                // Linear Mode: Original analyze + chain flow
                const formData = new FormData();
                formData.append('image', productImg);
                formData.append('topic', topic);
                formData.append('shot_count', shotCount);
                formData.append('category', category);
                if (config.api_url) formData.append('api_url', config.api_url);
                if (config.api_key) formData.append('gemini_api_key', config.api_key);
                if (config.model_name) formData.append('model_name', config.analysis_model_name || config.model_name);

                try {
                    const res = await fetch(`${BACKEND_URL}/api/v1/story-analyze`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData,
                        signal: abortControllerRef.current.signal
                    });
                    const data = await res.json();
                    if (res.ok) {
                        let processedShots = data.shots;
                        if (visualStyle) {
                            const stylePrompt = VISUAL_STYLES.find(s => s.id === visualStyle)?.prompt || '';
                            if (stylePrompt) {
                                processedShots = data.shots.map(shot => ({
                                    ...shot,
                                    prompt: `[Visual Style: ${stylePrompt}] ${shot.prompt}`
                                }));
                            }
                        }
                        setShots(processedShots);
                        await startChainGeneration(processedShots);
                    } else {
                        setError(data.detail || 'Analysis failed');
                        setLoading(false);
                    }
                } catch (e) {
                    if (e.name === 'AbortError') {
                        console.log("Story Analysis Aborted");
                    } else {
                        setError(e.message);
                    }
                    setLoading(false);
                }
            }
        };

        reader.onerror = () => {
            setLoading(false);
            setError("Failed to read image file");
        };
    };

    const stopAnalysis = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
        }
    }

    // Auto-triggered chain generation (skips step 2)
    const startChainGeneration = async (processedShots) => {
        setError(null);
        // Loading is already true from handleAnalyze

        // Convert productImg to Base64 for the chain request
        const reader = new FileReader();
        reader.readAsDataURL(productImg);

        reader.onload = async () => {
            const base64Image = reader.result;

            const payload = {
                initial_image_url: base64Image,
                shots: processedShots,
                api_url: config.video_api_url,
                api_key: config.video_api_key,
                model_name: config.video_model_name,
                visual_style: visualStyle,
                visual_style_prompt: VISUAL_STYLES.find(s => s.id === visualStyle)?.prompt || '',
                camera_movement: cameraMovement,
                camera_movement_prompt: CAMERA_MOVEMENTS.find(c => c.id === cameraMovement)?.prompt || '',
                category: category  // Product category for gallery/video classification
            };

            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/story-chain`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (res.ok) {
                    setChainId(data.chain_id);
                    setStep(3);  // Skip step 2, go directly to step 3
                    setPolling(true);
                } else {
                    setError(data.detail || 'Failed to start story generation');
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        reader.onerror = () => {
            setLoading(false);
            setError("Failed to read image file");
        };
    };

    const handleStartChain = async () => {
        setLoading(true);
        setError(null);

        // Convert productImg to Base64 for the chain request
        const reader = new FileReader();
        reader.readAsDataURL(productImg);
        reader.onload = async () => {
            const base64Image = reader.result;

            const payload = {
                initial_image_url: base64Image,
                shots: shots,
                api_url: config.video_api_url, // Use Video API config specifically
                api_key: config.video_api_key,
                model_name: config.video_model_name
            };

            try {
                const res = await fetch(`${BACKEND_URL}/api/v1/story-chain`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (res.ok) {
                    setChainId(data.chain_id);
                    setStep(3);
                    setPolling(true);
                } else {
                    setError(data.detail || 'Failed to start story generation');
                }
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };
        reader.onerror = () => {
            setLoading(false);
            setError("Failed to read image file");
        };
    };

    const handleShotChange = (index, field, value) => {
        const newShots = [...shots];
        newShots[index] = { ...newShots[index], [field]: value };
        setShots(newShots);
    };

    return (
        <div className="story-generator-root">
            {/* Progress Header */}
            <div className="steps-header">
                {[1, 2, 3].map(s => (
                    <div key={s} className={`step-item ${step >= s ? 'active' : ''}`}>
                        <div className="step-number">{s}</div>
                        <div className="step-label">
                            {s === 1 ? '上传与设定' : s === 2 ? '剧本确认' : '生成中'}
                        </div>
                    </div>
                ))}
            </div>

            {error && <div className="error-banner">{error}</div>}

            {/* \u7f51\u7edc\u8fde\u63a5\u8b66\u544a - \u4e0d\u540c\u4e8e\u4efb\u52a1\u9519\u8bef */}
            {connectionWarning && !error && (
                <div className="connection-warning-banner">
                    <span className="icon">⚠️</span>
                    <div className="content">
                        <div className="title">
                            网络连接不稳定
                        </div>
                        <div className="message">
                            无法获取最新状态，但您的任务仍在后台执行中，请稍候刷新页面查看结果
                        </div>
                    </div>
                    <button
                        onClick={() => setConnectionWarning(false)}
                        className="close-btn"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="workspace">
                {/* Step 1: Input */}
                {step === 1 && (
                    <div className="input-section">
                        <div className="upload-area">
                            <div className="upload-box" onClick={() => document.getElementById('story-upload').click()}>
                                {previewUrl ? (
                                    <img src={previewUrl} alt="Product" className="preview-img" />
                                ) : (
                                    <div className="upload-placeholder">
                                        <span className="icon">📁</span>
                                        <p>点击上传初始图片</p>
                                    </div>
                                )}
                                <input
                                    id="story-upload"
                                    type="file"
                                    hidden
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                />
                            </div>
                        </div>
                        <div className="config-panel">
                            <h3>故事设定</h3>

                            {/* Generation Mode Toggle */}
                            <div className="form-group">
                                <label className="form-group-label">生成模式</label>
                                <div className="button-row">
                                    <button
                                        onClick={() => setGenerationMode('fission')}
                                        className={`mode-button ${generationMode === 'fission' ? 'fission' : ''}`}
                                    >
                                        🚀 裂变模式
                                    </button>
                                    <button
                                        onClick={() => setGenerationMode('linear')}
                                        className={`mode-button ${generationMode === 'linear' ? 'linear' : ''}`}
                                    >
                                        🔗 一镜到底
                                    </button>
                                </div>
                                <p className="form-group-hint">
                                    {generationMode === 'fission'
                                        ? '从产品图片裂变出多个独立场景，并发生成后合并'
                                        : '分镜脚本串行生成，保持画面连贯性'}
                                </p>
                            </div>

                            {/* Product Category */}
                            <div className="form-group">
                                <label className="form-group-label">产品类别</label>
                                <div className="button-grid">
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setCategory(cat.id)}
                                            className={`category-button ${category === cat.id ? 'active' : ''}`}
                                        >
                                            {cat.icon} {cat.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Visual Style */}
                            <div className="form-group">
                                <label className="form-group-label">视觉风格</label>
                                <select
                                    value={visualStyle}
                                    onChange={(e) => setVisualStyle(e.target.value)}
                                    className="form-select"
                                >
                                    {VISUAL_STYLES.map(style => (
                                        <option key={style.id} value={style.id}>{style.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Camera Movement */}
                            <div className="form-group">
                                <label className="form-group-label">运镜风格</label>
                                <select
                                    value={cameraMovement}
                                    onChange={(e) => setCameraMovement(e.target.value)}
                                    className="form-select"
                                >
                                    {CAMERA_MOVEMENTS.map(cam => (
                                        <option key={cam.id} value={cam.id}>{cam.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-group-label-inline">
                                    镜头数量: {shotCount}
                                </label>
                                <input
                                    type="range"
                                    min="3"
                                    max="5"
                                    value={shotCount}
                                    onChange={(e) => setShotCount(parseInt(e.target.value))}
                                    className="range-input-full"
                                />
                            </div>

                            <textarea
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="输入故事主题..."
                                rows={3}
                                className="script-input"
                            />
                            <button
                                className="primary-btn"
                                disabled={!productImg || loading}
                                onClick={handleAnalyze}
                            >
                                {loading ? '正在分析...' : '生成分镜脚本'}
                            </button>
                            {loading && (
                                <button className="secondary-btn stop-button" onClick={stopAnalysis}>
                                    ⏹ 停止分析
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 2: Storyboard Edit */}
                {step === 2 && (
                    <div className="storyboard-editor">
                        <h3>确认分镜脚本 (共 {shots.length} 个镜头)</h3>
                        <p className="form-group-hint">
                            无需生成关键帧。系统将自动串行生成视频，保证画面连贯。
                        </p>
                        <div className="shots-grid">
                            {shots.map((shot, idx) => (
                                <div key={idx} className="shot-card">
                                    <div className="shot-header">Shot {shot.shot} ({shot.duration}s)</div>
                                    <div className="shot-body">
                                        <label>剧情:</label>
                                        <textarea
                                            value={shot.description}
                                            onChange={(e) => handleShotChange(idx, 'description', e.target.value)}
                                            rows={2}
                                        />
                                        <label>Cue (English):</label>
                                        <textarea
                                            value={shot.prompt}
                                            onChange={(e) => handleShotChange(idx, 'prompt', e.target.value)}
                                            rows={3}
                                            className="code-font"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="actions-bar">
                            <button className="secondary-btn" onClick={() => setStep(1)}>上一步</button>
                            <button className="primary-btn" onClick={handleStartChain} disabled={loading}>
                                {loading ? '启动中...' : '开始生成故事 (串行)'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Generation Progress */}
                {step === 3 && (
                    <div className="results-view">
                        <div className="status-display">

                            {/* Fission Mode Progress */}
                            {generationMode === 'fission' && (
                                <>
                                    {(!fissionStatus || fissionStatus.status === 'processing') && (
                                        <div className="processing-state">
                                            <div className="spinner"></div>
                                            <h2>🚀 裂变生成中...</h2>
                                            {fissionStatus && (
                                                <div className="progress-wrapper">
                                                    <p className="phase-text">
                                                        阶段: {fissionStatus.phase === 'analyzing' ? '分析裂变场景' :
                                                            fissionStatus.phase === 'generating_images' ? (
                                                                fissionStatus.retry_round && fissionStatus.retry_round > 1
                                                                    ? `生成场景图片 (第${fissionStatus.retry_round}轮重试)`
                                                                    : '生成场景图片'
                                                            ) :
                                                                fissionStatus.phase === 'generating_videos' ? '生成场景视频' :
                                                                    fissionStatus.phase === 'merging' ? '合并视频' : fissionStatus.phase}
                                                    </p>
                                                    <p className="progress-text">
                                                        完成 {fissionStatus.completed_branches || 0} / {fissionStatus.total_branches || shotCount} 个分支
                                                    </p>

                                                    {/* Retry Info */}
                                                    {fissionStatus.failed_count && fissionStatus.failed_count > 0 && (
                                                        <p className="retry-warning">
                                                            ⚠️ {fissionStatus.failed_count} 个分支失败，正在重试...
                                                        </p>
                                                    )}

                                                    {/* Branch Progress Grid */}
                                                    {fissionStatus.branches && fissionStatus.branches.length > 0 && (
                                                        <div className="branch-grid">
                                                            {fissionStatus.branches.map((branch, idx) => (
                                                                <div key={idx} className={`branch-card ${
                                                                    branch.status === 'done' ? 'done' :
                                                                    branch.status === 'pending' ? 'pending' :
                                                                    branch.status?.includes('error') ? 'error' : ''
                                                                }`}>
                                                                    <div className="branch-id">
                                                                        分支 {branch.branch_id}
                                                                    </div>
                                                                    <div className="branch-scene">
                                                                        {branch.scene_name || '等待中...'}
                                                                    </div>
                                                                    <div className={`branch-status ${
                                                                        branch.status === 'done' ? 'done' :
                                                                        branch.status?.includes('error') ? 'error' : 'processing'
                                                                    }`}>
                                                                        {branch.status === 'done' ? '✅ 完成' :
                                                                            branch.status === 'pending' ? '⏳ 等待' :
                                                                                branch.status === 'image_done' ? '🖼️ 图片完成' :
                                                                                    branch.status === 'processing' ? '🎬 生成中' :
                                                                                        branch.status?.includes('error') ? '❌ 失败' : '🎬 生成中'}
                                                                    </div>
                                                                    {/* Retry Count Badge */}
                                                                    {branch.retry_count && branch.retry_count > 0 && (
                                                                        <div className="retry-badge">
                                                                            🔄 重试 {branch.retry_count} 次
                                                                        </div>
                                                                    )}
                                                                    {/* Retry Button for Failed Branches */}
                                                                    {branch.status?.includes('error') && branch.image_url && (
                                                                        <button
                                                                            onClick={async () => {
                                                                                try {
                                                                                    const res = await fetch(`/api/v1/story-fission/${fissionId}/branch/${branch.branch_id}/retry`, {
                                                                                        method: 'POST',
                                                                                        headers: { 'Authorization': `Bearer ${token}` }
                                                                                    });
                                                                                    if (res.ok) {
                                                                                        // Refresh status
                                                                                        setPolling(true);
                                                                                    } else {
                                                                                        const err = await res.json();
                                                                                        alert(`重试失败: ${err.detail || '未知错误'}`);
                                                                                    }
                                                                                } catch (e) {
                                                                                    alert(`重试失败: ${e.message}`);
                                                                                }
                                                                            }}
                                                                            className="retry-button"
                                                                        >
                                                                            🔄 重试
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Overall Progress Bar */}
                                                    <div className="progress-bar-container">
                                                        <div
                                                            className="progress-bar-fill"
                                                            style={{
                                                                '--progress-width': `${((fissionStatus.completed_branches || 0) / (fissionStatus.total_branches || shotCount)) * 100}%`
                                                            }}
                                                        ></div>
                                                    </div>

                                                    {/* Estimated Time */}
                                                    <p className="time-estimate">
                                                        {(() => {
                                                            const completed = fissionStatus.completed_branches || 0;
                                                            const total = fissionStatus.total_branches || shotCount;
                                                            const remaining = total - completed;
                                                            // 估算：每个分支约2-3分钟
                                                            const minTime = remaining * 2;
                                                            const maxTime = remaining * 3;
                                                            if (remaining > 0) {
                                                                return `预计剩余 ${minTime}-${maxTime} 分钟`;
                                                            }
                                                            return '即将完成...';
                                                        })()}
                                                    </p>

                                                    {/* New Task Button - Allow queueing multiple tasks */}
                                                    <button
                                                        onClick={() => {
                                                            // Reset for new task, but keep current task running in background
                                                            setStep(1);
                                                            setFissionId(null);
                                                            setFissionStatus(null);
                                                            setPolling(false);
                                                            setProductImg(null);
                                                            setPreviewUrl(null);
                                                            setShots([]);
                                                            setError(null);
                                                        }}
                                                        className="new-task-button-hover"
                                                    >
                                                        ➕ 新建任务 (当前任务后台运行)
                                                    </button>

                                                    <p className="result-hint">
                                                        💡 可继续上传新任务，系统将自动排队处理
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {fissionStatus && fissionStatus.status === 'completed' && (
                                        <div className="completed-state">
                                            <h2>✨ 裂变故事生成完成!</h2>
                                            <p className="result-message">
                                                成功生成 {fissionStatus.completed_branches} 个场景并合并
                                            </p>
                                            <div className="video-result">
                                                <video
                                                    src={fissionStatus.merged_video_url}
                                                    controls
                                                    autoPlay
                                                    className="video-player"
                                                />
                                            </div>
                                            <div className="actions-bar">
                                                <a
                                                    href={fissionStatus.merged_video_url}
                                                    download={`story_fission_${fissionId}.mp4`}
                                                    className="primary-btn download-link"
                                                >
                                                    ⬇️ 下载完整视频
                                                </a>
                                                {/* Remerge Button - useful after retrying failed branches */}
                                                <button
                                                    className="secondary-btn gallery-link"
                                                    onClick={async () => {
                                                        try {
                                                            const res = await fetch(`/api/v1/story-fission/${fissionId}/remerge`, {
                                                                method: 'POST',
                                                                headers: { 'Authorization': `Bearer ${token}` }
                                                            });
                                                            if (res.ok) {
                                                                alert('重新合成已启动，请稍等片刻后刷新查看结果');
                                                                setPolling(true);
                                                            } else {
                                                                const err = await res.json();
                                                                alert(`合成失败: ${err.detail || '未知错误'}`);
                                                            }
                                                        } catch (e) {
                                                            alert(`合成失败: ${e.message}`);
                                                        }
                                                    }}
                                                >
                                                    🔄 重新合成
                                                </button>
                                                <button className="secondary-btn" onClick={() => {
                                                    // Complete reset for new task
                                                    setStep(1);
                                                    setFissionId(null);
                                                    setFissionStatus(null);
                                                    setPolling(false);
                                                    setProductImg(null);
                                                    setPreviewUrl(null);
                                                    setShots([]);
                                                    setError(null);
                                                    setLoading(false);
                                                }}>再做一个</button>
                                            </div>
                                        </div>
                                    )}

                                    {fissionStatus && fissionStatus.status === 'failed' && (
                                        <div className="failed-state">
                                            <h2 className="error-title">裂变生成失败</h2>
                                            <p>{fissionStatus.error}</p>
                                            <button className="secondary-btn retry-button-spacing" onClick={() => {
                                                setStep(1);
                                                setFissionId(null);
                                                setFissionStatus(null);
                                                setPolling(false);
                                                setProductImg(null);
                                                setPreviewUrl(null);
                                                setShots([]);
                                                setError(null);
                                                setLoading(false);
                                            }}>返回重试</button>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Linear Mode Progress (Original) */}
                            {generationMode === 'linear' && (
                                <>
                                    {(!chainStatus || chainStatus.status === 'processing' || chainStatus.status === 'merging') && (
                                        <div className="processing-state">
                                            <div className="spinner"></div>
                                            <h2>正在生成故事...</h2>
                                            {chainStatus && (
                                                <div className="progress-wrapper">
                                                    <p className="linear-progress-text">
                                                        {chainStatus.status === 'merging'
                                                            ? '所有镜头完成，正在合并视频...'
                                                            : `正在生成镜头 ${chainStatus.current_shot} / ${chainStatus.total_shots}`}
                                                    </p>
                                                    <div className="progress-bar-container">
                                                        <div
                                                            className="progress-bar-fill linear-mode-fill"
                                                            style={{
                                                                '--progress-width': `${(chainStatus.current_shot / chainStatus.total_shots) * 100}%`
                                                            }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {chainStatus && chainStatus.status === 'completed' && (
                                        <div className="completed-state">
                                            <h2>✨ 故事生成完成!</h2>
                                            <div className="video-result">
                                                <video
                                                    src={chainStatus.merged_video_url}
                                                    controls
                                                    autoPlay
                                                    className="video-player"
                                                />
                                            </div>
                                            <div className="actions-bar">
                                                <a
                                                    href={chainStatus.merged_video_url}
                                                    download={`story_chain_${chainId}.mp4`}
                                                    className="primary-btn download-link"
                                                >
                                                    ⬇️ 下载完整视频
                                                </a>
                                                <button className="secondary-btn" onClick={() => setStep(1)}>再做一个</button>
                                            </div>
                                        </div>
                                    )}

                                    {chainStatus && chainStatus.status === 'failed' && (
                                        <div className="failed-state">
                                            <h2 className="error-title">生成失败</h2>
                                            <p>{chainStatus.error}</p>
                                            <button className="secondary-btn retry-button-spacing" onClick={() => setStep(1)}>返回重试</button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StoryGenerator;
