import { useState, useEffect, useRef } from 'react'

const BACKEND_URL = ''

const CATEGORIES = [
    { id: 'security', label: '安防监控', icon: '📹' },
    { id: 'daily', label: '日用百货', icon: '🧴' },
    { id: 'beauty', label: '美妆护肤', icon: '💄' },
    { id: 'digital', label: '数码3C', icon: '🎧' },
    { id: 'other', label: '其他品类', icon: '📦' }
]

const PLACEMENT_MODES = [
    { id: 'Wall-mounted', label: '壁挂 (Wall)' },
    { id: 'Tabletop', label: '平放 (Flat)' },
    { id: 'Ceiling', label: '吸顶 (Ceiling)' },
    { id: 'Hanging', label: '悬挂 (Hanging)' },
    { id: 'Embedded', label: '嵌入 (Embedded)' }
]

function ImageGenerator({ token, config, onConfigChange, results = [], onResultsChange, onSelectForVideo, onTabChange }) {
    // Workflow Step: 'input' | 'analyzing' | 'review' | 'generating' | 'done'
    const [step, setStep] = useState('input')

    // Input State
    const [productImg, setProductImg] = useState(null)
    const [productFileName, setProductFileName] = useState('Product')
    const [refImg, setRefImg] = useState(null)
    const [category, setCategory] = useState('security')
    const [customProductName, setCustomProductName] = useState('')
    const [genCount, setGenCount] = useState(9)
    const [aspectRatio, setAspectRatio] = useState('1:1')
    const [isAutoMode, setIsAutoMode] = useState(false) // New Auto Mode State
    const [sceneStyle, setSceneStyle] = useState('') // Scene style for batch generation

    // Visual Art Style Options (视觉艺术风格)
    const SCENE_STYLES = [
        { id: '', label: '🎬 不指定风格', prompt: '' },
        { id: 'cyberpunk', label: '🌃 赛博朋克/霓虹', prompt: 'Cyberpunk neon style, vibrant neon lights, futuristic urban aesthetic, high contrast colors, glowing effects, sci-fi atmosphere.' },
        { id: 'cinematic', label: '🎥 电影写实', prompt: 'Cinematic realistic style, professional film lighting, shallow depth of field, dramatic shadows, movie-quality composition.' },
        { id: 'watercolor', label: '🎨 水彩画', prompt: 'Watercolor painting style, soft edges, flowing colors, artistic brush strokes, delicate washes, traditional art aesthetic.' },
        { id: 'anime', label: '🌸 动漫风', prompt: '{anime} Anime style, clean lines, vibrant colors, Japanese animation aesthetic, cel-shaded look, expressive highlights.' },
        { id: 'bw_film', label: '🎞️ 黑白胶片', prompt: 'Black and white film photography style, classic noir aesthetic, high contrast, film grain, timeless elegance.' },
        { id: 'ghibli', label: '🏯 吉卜力风', prompt: 'Studio Ghibli style, whimsical and dreamy, soft pastel colors, hand-painted look, magical realism, warm atmosphere.' },
        { id: 'oil_painting', label: '🖼️ 油画风', prompt: 'Oil painting style, rich textures, visible brush strokes, classical art aesthetic, warm tones, museum-quality finish.' },
        { id: 'pixar3d', label: '🧸 皮克斯3D', prompt: 'Pixar 3D animation style, smooth rendering, vibrant colors, friendly aesthetic, high-quality CGI, appealing character design.' },
        { id: 'chinese_ink', label: '🏔️ 水墨国风', prompt: 'Chinese ink wash painting style, traditional brushwork, minimalist elegance, black ink on white, Eastern aesthetic.' },
        { id: 'scifi_future', label: '🚀 科幻未来', prompt: 'Sci-fi futuristic style, sleek metallic surfaces, holographic elements, advanced technology aesthetic, clean lines.' },
        { id: 'fantasy_magic', label: '🔮 奇幻魔法', prompt: 'Fantasy magical style, ethereal glow, mystical atmosphere, enchanted elements, sparkling effects, dreamlike quality.' },
        { id: 'vintage_retro', label: '📻 复古怀旧', prompt: 'Vintage retro style, nostalgic color grading, faded tones, classic aesthetic, 70s/80s vibe, warm sepia.' },
        { id: 'american_comic', label: '🦸 美漫风', prompt: 'American comic book style, bold outlines, dynamic shading, halftone dots, superhero aesthetic, vibrant primary colors.' },
        { id: 'minimalist', label: '⬜ 极简主义', prompt: 'Minimalist style, clean composition, negative space, simple forms, monochromatic palette, modern design.' },
        { id: 'steampunk', label: '⚙️ 蒸汽朋克', prompt: 'Steampunk style, Victorian industrial aesthetic, brass and copper tones, gears and clockwork, vintage machinery.' },
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
    ]

    // Analysis State
    const [analysisResult, setAnalysisResult] = useState(null)
    const [scripts, setScripts] = useState([])
    const [placementMode, setPlacementMode] = useState('')

    const ASPECT_RATIOS = [
        { id: '1:1', label: '1:1 (Square)', icon: '🖼️' },
        { id: '4:3', label: '4:3 (Landscape)', icon: '📺' },
        { id: '16:9', label: '16:9 (Cinema)', icon: '🎬' },
        { id: '9:16', label: '9:16 (Story)', icon: '📱' }
    ]

    // Generation State
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // Lightbox State
    const [lightboxImage, setLightboxImage] = useState(null)

    // Video Prompt State
    const [videoPromptLoading, setVideoPromptLoading] = useState({})

    // Loading Messages
    const [loadingMessage, setLoadingMessage] = useState('')

    // Abort Controller
    const abortControllerRef = useRef(null);

    // Timeout warning state
    const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);

    // Restore saved state on mount (handle refresh)
    useEffect(() => {
        const savedState = localStorage.getItem('batchSceneState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                const timeDiff = Date.now() - state.timestamp;

                // Restore if less than 30 minutes old
                if (timeDiff < 30 * 60 * 1000) {
                    console.log('恢复之前的分析结果...');
                    setAnalysisResult(state.analysisResult);
                    setScripts(state.scripts);
                    setPlacementMode(state.placementMode);
                    setCategory(state.category || 'security');
                    setGenCount(state.genCount || 9);
                    setAspectRatio(state.aspectRatio || '1:1');
                    setSceneStyle(state.sceneStyle || '');
                    setStep('review');
                } else {
                    // Clear expired state
                    localStorage.removeItem('batchSceneState');
                }
            } catch (err) {
                console.error('恢复状态失败:', err);
                localStorage.removeItem('batchSceneState');
            }
        }
    }, []);

    // Timeout warning timer (10 minutes after reaching review step)
    useEffect(() => {
        if (step === 'review') {
            const warningTimer = setTimeout(() => {
                setShowTimeoutWarning(true);
            }, 10 * 60 * 1000); // 10 minutes

            return () => clearTimeout(warningTimer);
        } else {
            setShowTimeoutWarning(false);
        }
    }, [step]);

    // AUTO MODE LOGIC
    useEffect(() => {
        if (!isAutoMode) return;

        // Auto Step 1 -> 2 (Review) -> 3 (Generate)
        // Reduced delay for faster auto mode
        if (step === 'review' && analysisResult && !loading) {
            console.log("Auto Mode: Analysis success. Triggering Generation in 200ms...");
            const timer = setTimeout(() => {
                handleGenerate();
            }, 200);  // Reduced from 500ms to 200ms for faster processing
            return () => clearTimeout(timer);
        }

        // Auto Step 3 (Done) -> Queue
        if (step === 'done' && results.length > 0 && !loading) {
            console.log("Auto Mode: Generation done. Triggering Video Queue...");
            autoSendToQueue();
        }
    }, [step, isAutoMode, analysisResult, loading, results]);

    // Refactored Batch Video Function
    const handleBatchVideo = async (skipConfirm = false) => {
        if (loading) return;

        // Only show confirm and disable auto mode when NOT in auto mode
        if (!skipConfirm) {
            // Stop Auto Mode if active
            setIsAutoMode(false);

            // Confirm
            if (!window.confirm(`确定要将这 ${results.length} 张图片全部加入视频生成队列吗？`)) {
                return;
            }
        }

        // Use parallel requests for speed optimization
        const sendPromises = results.map(async (res, idx) => {
            const imgData = res.image_base64;
            const formData = new FormData();

            if (imgData.startsWith('http')) {
                formData.append('image_url', imgData);
            } else {
                const cleanBase64 = imgData.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
                const byteCharacters = atob(cleanBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'image/jpeg' });
                formData.append('file', blob, `auto_gen_${idx}.jpg`);
            }

            formData.append('prompt', res.video_prompt || "Product video");

            try {
                await fetch(`${BACKEND_URL}/api/v1/queue`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                return true;
            } catch (e) {
                console.error("Auto Queue Failed", e);
                return false;
            }
        });

        const results_status = await Promise.all(sendPromises);
        const sentCount = results_status.filter(Boolean).length;

        // Only show alert in manual mode, not in auto mode
        if (!skipConfirm) {
            alert(`已将 ${sentCount} 个任务发送至视频生成队列。正在切换至视频界面...`);
        } else {
            console.log(`Auto Mode: ${sentCount} tasks sent to video queue.`);
        }
        if (onTabChange) onTabChange('video');
    }

    // Auto Mode Wrapper - skip confirm dialog
    const autoSendToQueue = () => {
        handleBatchVideo(true);  // Skip confirm in auto mode
    }

    const LOADING_MESSAGES = {
        physical: [
            "正在指挥像素小人排队站好，不许插队...",
            "正在把杂乱的线条熨平，强迫症表示很舒适...",
            "正在后台疯狂踩单车，为显卡提供电力...",
            "正在从云端搬运灵感，虽然云有点沉...",
            "正在用赛博砂纸打磨模型的棱角...",
            "正在把多余的噪点扫进垃圾桶，呼...好累...",
            "正在给每一个多边形涂上防晒霜，防止过曝..."
        ],
        brain: [
            "正在翻阅《3秒钟学会空间几何》，请稍等...",
            "AI 设计师正在疯狂挠头，发量即将告急...",
            "正在和 GPU 吵架，讨论到底该用哪个光影参数...",
            "正在戴上老花镜，试图看清这个复杂的结构...",
            "正在召唤牛顿的棺材板... 哦不，是牛顿定律...",
            "正在试图用二次元的逻辑理解三维世界...",
            "大脑正在飞速运转，显卡风扇已经起飞了..."
        ],
        slack: [
            "虽然是 24 小时待命，但偶尔也要喝口机油提提神...",
            "为了让您满意，AI 决定献祭两根内存条...",
            "别催别催，AI 已经在用百米冲刺的速度计算了...",
            "正在去隔壁服务器借点算力，希望能借到...",
            "老板（您）的要求就是命令，正在死磕细节中...",
            "正在把 59 分的作业修改成 100 分..."
        ]
    }

    // Effect to rotate messages when loading
    useEffect(() => {
        let interval;
        if (loading) {
            // 1. Pick a random theme
            const themes = ['physical', 'brain', 'slack'];
            const randomTheme = themes[Math.floor(Math.random() * themes.length)];
            const messages = LOADING_MESSAGES[randomTheme];

            // 2. Initial message
            setLoadingMessage(messages[Math.floor(Math.random() * messages.length)]);

            // 3. Rotate every 2.5s
            interval = setInterval(() => {
                setLoadingMessage(messages[Math.floor(Math.random() * messages.length)]);
            }, 2500);
        }
        return () => clearInterval(interval);
    }, [loading]);
    const handleFileChange = (e, setter) => {
        if (e.target.files && e.target.files[0]) {
            setter(e.target.files[0])
            if (setter === setProductImg) {
                const name = e.target.files[0].name
                setProductFileName(name.substring(0, name.lastIndexOf('.')) || name)
            }
        }
    }

    // Step 1 -> 2: Analyze
    const handleAnalyze = async () => {
        if (!productImg || !refImg) {
            setError("请上传产品图和参考图")
            return
        }

        setLoading(true)
        setError(null)
        setStep('analyzing')

        // Init AbortController
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        const formData = new FormData()
        formData.append('product_img', productImg)
        formData.append('ref_img', refImg)
        formData.append('category', category)
        if (category === 'other' && customProductName) {
            formData.append('custom_product_name', customProductName)
        }
        formData.append('api_url', config.api_url || '')
        formData.append('gemini_api_key', config.api_key || '')
        formData.append('model_name', config.analysis_model_name || 'gemini-3-pro-preview')
        formData.append('gen_count', genCount)  // User-selected generation count

        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
                signal: abortControllerRef.current.signal
            })

            if (!response.ok) {
                // Check if response is JSON before parsing
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    const errData = await response.json()
                    throw new Error(errData.detail || '分析失败')
                } else {
                    // Not JSON - probably HTML error page
                    const text = await response.text()
                    console.error("Non-JSON error response:", text.substring(0, 200))
                    throw new Error(`服务器错误 (${response.status}): ${response.statusText}`)
                }
            }

            const data = await response.json()
            setAnalysisResult(data)
            setPlacementMode(data.placement_mode)

            // Integrate scene style prompt into each script's 'script' field if selected
            // data.scripts is an array of objects: [{angle_name: "...", script: "..."}, ...]
            let finalScripts = data.scripts || []
            if (sceneStyle && finalScripts.length > 0) {
                const stylePrompt = SCENE_STYLES.find(s => s.id === sceneStyle)?.prompt || ''
                if (stylePrompt) {
                    finalScripts = finalScripts.map(item => ({
                        ...item,
                        script: `[Scene Style: ${stylePrompt}] ${item.script}`
                    }))
                }
            }
            setScripts(finalScripts)
            setStep('review')

            // Save to localStorage for persistence
            try {
                localStorage.setItem('batchSceneState', JSON.stringify({
                    analysisResult: data,
                    scripts: finalScripts,
                    placementMode: data.placement_mode,
                    category: category,
                    genCount: genCount,
                    aspectRatio: aspectRatio,
                    sceneStyle: sceneStyle,
                    timestamp: Date.now()
                }));
                console.log('分析结果已保存，页面刷新后可恢复');
            } catch (saveErr) {
                console.warn('保存状态失败:', saveErr);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log("Analysis Aborted");
                setStep('input'); // Reset to input
            } else {
                setError(err.message)
                setStep('input')
            }
        } finally {
            setLoading(false)
        }
    }

    const stopAnalysis = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            setLoading(false);
            setStep('input');
        }
    }

    const handleGenerateVideoPrompt = async (index, imageBase64) => {
        setVideoPromptLoading(prev => ({ ...prev, [index]: true }))

        // Optimistic update or loading state could be added here
        const newResults = [...results];
        // Set a temporary loading state for this item if needed, but for now just simple

        const formData = new FormData()
        // Convert base64 to blob
        const byteCharacters = atob(imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, ''));
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });

        formData.append('image', blob, 'image.jpg')
        formData.append('api_url', config.api_url || '')
        formData.append('gemini_api_key', config.api_key || '')
        if (config.analysis_model_name) {
            formData.append('model_name', config.analysis_model_name)
        }

        try {
            const response = await fetch(`${BACKEND_URL}/api/v1/generate-video-prompt`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            })

            if (!response.ok) {
                throw new Error('Failed to generate prompt');
            }

            const data = await response.json()
            newResults[index].video_prompt = data.video_prompt
            onResultsChange(newResults)
        } catch (err) {
            console.error("Prompt Gen Error:", err)
            alert("生成提示词失败: " + err.message)
        } finally {
            setVideoPromptLoading(prev => ({ ...prev, [index]: false }))
        }
    }

    // Step 2 -> 3: Generate
    const handleGenerate = async () => {
        if (!productImg || !refImg) {
            setError("图片已过期，请重新上传产品图和参考图后再生成")
            setStep('input')
            localStorage.removeItem('batchSceneState')
            return
        }
        
        setLoading(true)
        setError(null)
        setStep('generating')
        onResultsChange([])

        // Slice scripts based on genCount
        const activeScripts = (scripts && Array.isArray(scripts)) ? scripts.slice(0, genCount) : [];
        console.log("HandleGenerate: Scripts prepared", activeScripts);

        // Smart concurrency: Manual mode uses lower concurrency to avoid 524 timeouts
        const CONCURRENT_LIMIT = isAutoMode 
            ? (config.max_concurrent_image || 3)  // Auto mode: use config
            : 1;  // Manual mode: single request to avoid API timeout
        const allResults = [];
        // Init AbortController
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            // Process in blocks of 3
            for (let i = 0; i < activeScripts.length; i += CONCURRENT_LIMIT) {
                // Check signal
                if (signal.aborted) throw new Error('Aborted');

                // Prepare up to 3 promises
                const batchPromises = [];
                for (let j = 0; j < CONCURRENT_LIMIT; j++) {
                    const idx = i + j;
                    if (idx >= activeScripts.length) break;

                    const singleScript = [activeScripts[idx]]; // Send array of 1
                    console.log(`Starting Request for Item ${idx + 1}`);

                    // Create Promise for this single item
                    const p = (async () => {
                        const formData = new FormData()
                        formData.append('product_img', productImg)
                        formData.append('ref_img', refImg)
                        formData.append('scripts', JSON.stringify(singleScript))
                        formData.append('api_url', config.api_url || '')
                        formData.append('gemini_api_key', config.api_key || '')
                        formData.append('model_name', config.model_name || '')
                        formData.append('aspect_ratio', aspectRatio)
                        formData.append('category', category)  // Add product category
                        // Add scene style prompt for image generation
                        const stylePrompt = SCENE_STYLES.find(s => s.id === sceneStyle)?.prompt || ''
                        formData.append('scene_style_prompt', stylePrompt)

                        const targetUrl = `${BACKEND_URL || ''}/api/v1/batch-generate`;

                        const response = await fetch(targetUrl, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}` },
                            body: formData,
                            signal: signal
                        });

                        if (!response.ok) {
                            const text = await response.text();
                            throw new Error(`Item ${idx + 1} Failed: ${text.slice(0, 50)}`);
                        }

                        const data = await response.json();
                        if (data.results) {
                            // Update State immediately
                            allResults.push(...data.results);
                            // Functional update to ensure no race conditions overwriting previous states
                            onResultsChange(prev => {
                                console.log("Updating Results with:", data.results);
                                return [...prev, ...data.results];
                            });
                        }
                    })();

                    batchPromises.push(p);
                }

                // Wait for this block to finish
                await Promise.all(batchPromises);
                
                // Manual mode: add delay between batches to avoid API overload
                if (!isAutoMode && i + CONCURRENT_LIMIT < activeScripts.length) {
                    await new Promise(r => setTimeout(r, 800));
                }
            }

            setStep('done')
        } catch (err) {
            if (err.name === 'AbortError' || err.message === 'Aborted') {
                console.log("Generation Aborted");
                // If we have some results, maybe stay on done/review?
                // For now, let's go to done if we have results, else stay/reset.
                if (allResults.length > 0) {
                    setStep('done');
                } else {
                    setStep('review'); // Go back to review so they can try again
                }
            } else {
                console.error("Generation Error:", err)
                setError(err.message)
            }
        } finally {
            setLoading(false)
        }
    }

    const stopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }

    const handleScriptChange = (idx, newVal) => {
        const newScripts = [...scripts]
        newScripts[idx].script = newVal
        setScripts(newScripts)
    }

    const resetFlow = () => {
        console.log("Resetting Flow to Input");

        // Abort any pending requests
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // Reset all states
        setProductImg(null)
        setRefImg(null)
        setProductFileName('Product')
        setStep('input')
        setAnalysisResult(null)
        setScripts([])
        onResultsChange([])
        setError(null)
        setCustomProductName('')
        setIsAutoMode(false)  // Also reset Auto Mode
        setSceneStyle('')  // Reset scene style

        // Clear saved state
        localStorage.removeItem('batchSceneState');
        setShowTimeoutWarning(false);
    }

    return (
        <div className="image-workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>

            {/* Lightbox Modal */}
            {lightboxImage && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.9)',
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'zoom-out'
                    }}
                    onClick={() => setLightboxImage(null)}
                >
                    <img
                        src={lightboxImage}
                        style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}
                        alt="Zoomed"
                    />
                </div>
            )}

            {/* Progress Header */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', padding: '20px 0', borderBottom: '1px solid var(--card-border)' }}>
                <div style={{ opacity: step === 'input' ? 1 : 0.5, fontWeight: 'bold' }}>1. 输入与定义</div>
                <div style={{ opacity: step === 'analyzing' || step === 'review' ? 1 : 0.5, fontWeight: 'bold' }}>2. 智能分析 & 确认</div>
                <div style={{ opacity: step === 'generating' || step === 'done' ? 1 : 0.5, fontWeight: 'bold' }}>3. 生成与交付</div>
            </div>

            {/* Error Banner */}
            {error && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--error-color)', color: 'var(--error-color)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                    ❌ {error}
                </div>
            )}

            {/* Step 1: Input */}
            {step === 'input' && (
                <div style={{ maxWidth: '1000px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        {/* Product Upload */}
                        <div className="upload-zone" onClick={() => document.getElementById('prod-upload').click()} style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--card-border)', borderRadius: '12px', cursor: 'pointer', background: 'var(--card-bg)', backdropFilter: 'blur(20px)' }}>
                            {productImg ? (
                                <img src={URL.createObjectURL(productImg)} style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain' }} alt="Product" />
                            ) : (
                                <>
                                    <div className="icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>📦</div>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>上传产品主图</div>
                                    <div style={{ color: 'var(--text-muted)' }}>支持 PNG/JPG (白底最佳)</div>
                                </>
                            )}
                            <input id="prod-upload" type="file" hidden onChange={(e) => handleFileChange(e, setProductImg)} accept="image/*" />
                        </div>

                        {/* Reference Upload */}
                        <div className="upload-zone" onClick={() => document.getElementById('ref-upload').click()} style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--card-border)', borderRadius: '12px', cursor: 'pointer', background: 'var(--card-bg)', backdropFilter: 'blur(20px)' }}>
                            {refImg ? (
                                <img src={URL.createObjectURL(refImg)} style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain' }} alt="Ref" />
                            ) : (
                                <>
                                    <div className="icon" style={{ fontSize: '3rem', marginBottom: '16px' }}>🖼️</div>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>上传风格参考图</div>
                                    <div style={{ color: 'var(--text-muted)' }}>提取光影与环境结构</div>
                                </>
                            )}
                            <input id="ref-upload" type="file" hidden onChange={(e) => handleFileChange(e, setRefImg)} accept="image/*" />
                        </div>
                    </div>

                    {/* Category Selection */}
                    <div>
                        <div className="section-title">选择产品类目</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setCategory(cat.id)}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '8px',
                                        border: category === cat.id ? '2px solid var(--primary-color)' : '1px solid var(--card-border)',
                                        background: category === cat.id ? 'rgba(99, 102, 241, 0.2)' : 'var(--card-bg)',
                                        backdropFilter: 'blur(20px)',
                                        color: category === cat.id ? 'var(--primary-color)' : 'var(--text-muted)',
                                        cursor: 'pointer',
                                        fontSize: '0.95rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <span className="icon" style={{ fontSize: '1.5rem' }}>{cat.icon}</span>
                                    <span>{cat.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Custom Product Name Input */}
                        {category === 'other' && (
                            <div style={{ marginTop: '16px', animation: 'fadeIn 0.3s' }}>
                                <input
                                    type="text"
                                    placeholder="请输入产品名称 (如: 运动鞋, 陶瓷花瓶...)"
                                    value={customProductName}
                                    onChange={(e) => setCustomProductName(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '12px',
                                        borderRadius: '8px',
                                        background: 'transparent',
                                        border: '1px solid var(--primary-color)',
                                        color: 'var(--text-main)',
                                        outline: 'none'
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Aspect Ratio Selection */}
                    <div>
                        <div className="section-title">画面比例</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                            {ASPECT_RATIOS.map(ratio => (
                                <button
                                    key={ratio.id}
                                    onClick={() => setAspectRatio(ratio.id)}
                                    style={{
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: aspectRatio === ratio.id ? '2px solid var(--primary-color)' : '1px solid var(--card-border)',
                                        background: aspectRatio === ratio.id ? 'rgba(99, 102, 241, 0.2)' : 'var(--card-bg)',
                                        backdropFilter: 'blur(20px)',
                                        color: aspectRatio === ratio.id ? 'var(--primary-color)' : 'var(--text-muted)',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '4px',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <span className="icon" style={{ fontSize: '1.2rem' }}>{ratio.icon}</span>
                                    <span>{ratio.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Count Slider */}
                    <div>
                        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span><span className="icon">🔢</span> 生成数量</span>
                            <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{genCount} 张</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="9"
                            value={genCount}
                            onChange={(e) => setGenCount(parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--primary-color)' }}
                        />
                    </div>

                    {/* Scene Style Selector */}
                    <div style={{ marginTop: '20px' }}>
                        <div className="section-title"><span className="icon">🎨</span> 场景风格 (批量统一)</div>
                        <select
                            value={sceneStyle}
                            onChange={(e) => setSceneStyle(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                background: 'var(--card-bg)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid var(--card-border)',
                                borderRadius: '8px',
                                color: 'var(--text-main)',
                                fontSize: '1rem',
                                cursor: 'pointer',
                                outline: 'none'
                            }}
                        >
                            {SCENE_STYLES.map(style => (
                                <option key={style.id} value={style.id}>{style.label}</option>
                            ))}
                        </select>
                        {sceneStyle && (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '8px', fontStyle: 'italic' }}>
                                {SCENE_STYLES.find(s => s.id === sceneStyle)?.prompt.substring(0, 80)}...
                            </p>
                        )}
                    </div>

                    {/* Auto Mode Checkbox */}
                    <div style={{ marginTop: '20px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '8px' }}>
                        <input
                            type="checkbox"
                            id="autoMode"
                            checked={isAutoMode}
                            onChange={(e) => setIsAutoMode(e.target.checked)}
                            style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--success-color)' }}
                        />
                        <label htmlFor="autoMode" style={{ cursor: 'pointer', color: isAutoMode ? 'var(--success-color)' : 'var(--text-muted)', fontWeight: isAutoMode ? 'bold' : 'normal', fontSize: '1rem' }}>
                            全自动模式 (一键生成+转视频)
                        </label>
                    </div>

                    {/* Action */}
                    <button
                        className="btn-primary"
                        onClick={handleAnalyze}
                        disabled={loading}
                        style={{ padding: '16px', fontSize: '1.2rem', marginTop: '20px' }}
                    >
                        {loading ? <><span className="icon">🧠</span> 正在进行视觉分析...</> : <><span className="icon">✨</span> 第一步：智能视觉分析 (Gemini 3 Pro)</>}
                    </button>
                </div>
            )}

            {/* Step 1.5: Analyzing Loading State */}
            {step === 'analyzing' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="radar-spinner" style={{ marginBottom: '24px' }}></div>
                    <h2 className="loading-gradient" style={{ fontSize: '2rem', marginBottom: '12px' }}>正在分析视觉结构...</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', minHeight: '1.5em' }}>{loadingMessage || "识别产品特征 • 解析空间几何 • 推理物理逻辑"}</p>
                    <button className="btn-secondary" onClick={stopAnalysis} style={{ marginTop: '20px', borderColor: 'var(--error-color)', color: 'var(--error-color)' }}>⏹ 停止分析</button>
                </div>
            )}

            {/* Step 2: Review */}
            {step === 'review' && analysisResult && (
                <div style={{ maxWidth: '1600px', margin: '0 auto', width: '100%', display: 'grid', gridTemplateColumns: '400px 1fr', gap: '32px', height: '100%', overflow: 'hidden' }}>

                    {/* Timeout Warning Banner (Full Width, spanning both columns) */}
                    {showTimeoutWarning && (
                        <div style={{
                            gridColumn: '1 / -1',
                            background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.15))',
                            border: '1px solid rgba(251, 191, 36, 0.5)',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            animation: 'pulse 2s infinite',
                            marginBottom: '-12px'
                        }}>
                            <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 'bold', color: '#f59e0b', marginBottom: '4px' }}>
                                    页面可能即将刷新
                                </div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                    建议尽快完成生成操作。如页面刷新，您的分析结果将自动恢复。
                                </div>
                            </div>
                            <button
                                onClick={() => setShowTimeoutWarning(false)}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid rgba(251, 191, 36, 0.5)',
                                    color: '#f59e0b',
                                    padding: '4px 12px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem'
                                }}
                            >
                                知道了
                            </button>
                        </div>
                    )}

                    {/* Left: Sidebar Configuration (Reference Style) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingRight: '10px' }}>

                        {/* Analysis Report Box */}
                        <div style={{ border: '1px solid var(--primary-color)', background: 'rgba(99, 102, 241, 0.05)', borderRadius: '8px', padding: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--primary-color)', fontWeight: 'bold' }}>
                                <span><span className="icon">✨</span></span> 分析报告
                            </div>
                            <div style={{ fontSize: '0.9rem', marginBottom: '8px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>识别产品: </span>
                                <b>{analysisResult.product_description}</b>
                            </div>
                            <div style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
                                <span style={{ color: 'var(--text-muted)' }}>建议摆放: </span>
                                <b>{analysisResult.placement_mode}</b>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: '1.4' }}>
                                "{analysisResult.environment_analysis}"
                            </div>
                        </div>

                        {/* Placement Mode Selector */}
                        <div>
                            <div className="section-title"><span className="icon">📍</span> 确认产品摆放方式 (智能识别)</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {PLACEMENT_MODES.map(mode => (
                                    <button
                                        key={mode.id}
                                        onClick={() => setPlacementMode(mode.id)}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '4px',
                                            border: placementMode === mode.id ? '1px solid var(--primary-color)' : '1px solid var(--card-border)',
                                            background: placementMode === mode.id ? 'var(--primary-color)' : 'transparent',
                                            color: placementMode === mode.id ? '#fff' : 'var(--text-muted)',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Requirements Editor */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div className="section-title"><span className="icon">📝</span> 具体要求与建议 (可修改)</div>
                            <textarea
                                onChange={(e) => {
                                    // Placeholder
                                }}
                                readOnly
                                style={{ flex: 1, minHeight: '150px', background: 'var(--input-bg, rgba(0,0,0,0.05))', border: '1px solid var(--card-border)', borderRadius: '8px', padding: '12px', color: 'var(--text-main)', resize: 'none', fontSize: '0.9rem', lineHeight: '1.5' }}
                                defaultValue={`AI 建议: ${analysisResult.environment_analysis}\n\n(此分析将指导所有图片的生成)`}
                            />
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button
                                className="btn-primary"
                                onClick={handleGenerate}
                                style={{ padding: '16px', fontSize: '1.1rem' }}
                            >
                                确认方案并生成 ({genCount}张)
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={resetFlow}
                                style={{ padding: '12px', fontSize: '0.95rem' }}
                            >
                                <span className="icon">🔄</span> 重新上传图片
                            </button>
                        </div>
                    </div>

                    {/* Right: Scripts Preview (Grid) */}
                    <div style={{ overflowY: 'auto', paddingRight: '10px' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '20px' }}>生成脚本预览</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                            {Array.isArray(scripts) && scripts.slice(0, genCount).map((item, idx) => (
                                <div key={idx} style={{ background: 'var(--card-bg)', backdropFilter: 'blur(20px)', padding: '16px', borderRadius: '8px', border: '1px solid var(--card-border)' }}>
                                    <div style={{ fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '8px', fontSize: '0.9rem' }}>
                                        #{idx + 1} {item.angle_name}
                                    </div>
                                    <textarea
                                        value={item.script}
                                        onChange={(e) => handleScriptChange(idx, e.target.value)}
                                        rows={6}
                                        style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--card-border)', color: 'var(--text-muted)', padding: '8px', borderRadius: '4px', resize: 'none', fontSize: '0.8rem' }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Step 3: Generating / Results */}
            {(step === 'generating' || step === 'done') && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {step === 'generating' && (
                        <div style={{ textAlign: 'center', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <div className="radar-spinner" style={{ marginBottom: '24px' }}></div>
                            <h3 className="loading-gradient" style={{ fontSize: '1.8rem', marginBottom: '12px' }}>
                                正在批量合成场景 ({results.length}/{genCount})...
                            </h3>
                            <button className="btn-secondary" onClick={stopGeneration} style={{ marginTop: '10px', borderColor: 'var(--error-color)', color: 'var(--error-color)' }}>⏹ 停止生成</button>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', minHeight: '1.5em' }}>{loadingMessage || "主体抽离 • 风格迁移 • 物理约束渲染"}</p>
                        </div>
                    )}

                    {step === 'done' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '0 20px' }}>
                            <h3>🎉 生成完成 (已自动清洗提示词)</h3>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button className="btn-primary"
                                    style={{ background: 'linear-gradient(45deg, #8b5cf6, #ec4899)' }}
                                    onClick={handleBatchVideo}
                                >
                                    <span className="icon">🎬</span> 一键批量转视频
                                </button>
                                <button className="btn-secondary" onClick={resetFlow}><span className="icon">🔄</span> 开始新任务</button>
                            </div>
                        </div>
                    )}

                    <div className="results-grid" style={{ padding: '0 20px 20px 20px' }}>
                        {Array.isArray(results) && results.map((res, idx) => (
                            <div key={idx} className="result-card" style={{ display: 'flex', flexDirection: 'column' }}>
                                <div style={{ position: 'relative', cursor: 'zoom-in' }} onClick={() => setLightboxImage(res.image_base64.startsWith('http') || res.image_base64.startsWith('data:') ? res.image_base64 : `data:image/jpeg;base64,${res.image_base64}`)}>
                                    {res.image_base64 ? (
                                        <img
                                            src={res.image_base64.startsWith('http') || res.image_base64.startsWith('data:') ? res.image_base64 : `data:image/jpeg;base64,${res.image_base64}`}
                                            className="result-image"
                                            alt={res.angle_name}
                                        />
                                    ) : (
                                        <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                                            {res.error || 'Error'}
                                        </div>
                                    )}
                                    <div style={{ position: 'absolute', top: '8px', left: '8px', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>
                                        {res.angle_name}
                                    </div>
                                </div>

                                {/* Cleaned Prompt Display (Always Show if exists) */}
                                {/* Cleaned Prompt Display */}
                                <div style={{
                                    padding: '12px',
                                    background: 'rgba(0,0,0,0.3)',
                                    borderTop: '1px solid var(--card-border)',
                                    fontSize: '0.85rem',
                                    color: 'var(--text-muted)',
                                    minHeight: '60px',
                                    maxHeight: '120px',
                                    overflowY: 'auto',
                                    whiteSpace: 'pre-wrap'
                                }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: '0.75rem', color: '#666' }}>VIDEO PROMPT:</div>
                                    {res.video_prompt || <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Pending prompt generation...</span>}
                                </div>

                                <div className="result-actions" style={{ marginTop: 'auto' }}>
                                    <button
                                        className="btn-secondary"
                                        style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            // 1. Download Image
                                            const baseName = `${productFileName}_${res.angle_name.replace(/\s+/g, '_')}_${Math.floor(Math.random() * 10000)}`

                                            const imageUrl = res.image_base64.startsWith('http') || res.image_base64.startsWith('data:')
                                                ? res.image_base64
                                                : `data:image/jpeg;base64,${res.image_base64}`;

                                            // For remote URLs, fetch as blob to force download
                                            if (imageUrl.startsWith('http')) {
                                                try {
                                                    const response = await fetch(imageUrl);
                                                    const blob = await response.blob();
                                                    const blobUrl = URL.createObjectURL(blob);
                                                    const link = document.createElement('a');
                                                    link.href = blobUrl;
                                                    link.download = `${baseName}.jpg`;
                                                    document.body.appendChild(link);
                                                    link.click();
                                                    document.body.removeChild(link);
                                                    URL.revokeObjectURL(blobUrl);
                                                } catch (error) {
                                                    console.error('Download failed:', error);
                                                    // Fallback: open in new tab
                                                    window.open(imageUrl, '_blank');
                                                }
                                            } else {
                                                const link = document.createElement('a');
                                                link.href = imageUrl;
                                                link.download = `${baseName}.jpg`;
                                                document.body.appendChild(link);
                                                link.click();
                                                document.body.removeChild(link);
                                            }

                                            // 2. Download Text (if exists) - Add small delay
                                            if (res.video_prompt) {
                                                setTimeout(() => {
                                                    const blob = new Blob([res.video_prompt], { type: 'text/plain' });
                                                    const txtLink = document.createElement('a');
                                                    txtLink.href = URL.createObjectURL(blob);
                                                    txtLink.download = `${baseName}.txt`;
                                                    document.body.appendChild(txtLink);
                                                    txtLink.click();
                                                    document.body.removeChild(txtLink);
                                                }, 300);
                                            }
                                        }}
                                    >
                                        ⬇️ 下载 (图+文)
                                    </button>



                                    <button
                                        className="btn-secondary"
                                        style={{ fontSize: '0.8rem', padding: '4px 8px', background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectForVideo(
                                                res.image_base64.startsWith('http') || res.image_base64.startsWith('data:') ? res.image_base64 : `data:image/jpeg;base64,${res.image_base64}`,
                                                res.video_prompt,
                                                category  // Pass category to VideoGenerator
                                            )
                                        }}
                                    >
                                        🎬 转视频
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
            }
        </div >
    )
}

export default ImageGenerator
