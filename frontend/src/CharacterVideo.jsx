import React, { useState, useEffect, useRef } from 'react';
import './CharacterVideo.css';

/**
 * CharacterVideo - 角色视频生成组件（简化版）
 * 
 * 单一流程：上传角色视频 → 输入提示词 → 生成视频 / 保存角色
 */
const CharacterVideo = ({ token, config }) => {
    // 状态：视频上传
    const [videoFile, setVideoFile] = useState(null);
    const [videoPreview, setVideoPreview] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    // 状态：角色和生成
    const [actionPrompt, setActionPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState(null);
    const [resultVideoUrl, setResultVideoUrl] = useState(null);

    // 状态：已保存角色列表
    const [characters, setCharacters] = useState([]);
    const [selectedCharacterId, setSelectedCharacterId] = useState(null);

    // 引用
    const fileInputRef = useRef(null);

    // 从 localStorage 加载已保存的角色
    useEffect(() => {
        const savedCharacters = localStorage.getItem('sora_characters');
        if (savedCharacters) {
            try {
                setCharacters(JSON.parse(savedCharacters));
            } catch (e) {
                console.error('加载角色失败:', e);
            }
        }
    }, []);

    // 保存角色到 localStorage
    const saveCharactersToStorage = (chars) => {
        localStorage.setItem('sora_characters', JSON.stringify(chars));
        setCharacters(chars);
    };

    // 处理视频文件
    const processVideoFile = (file) => {
        if (!file.type.startsWith('video/')) {
            alert('请上传视频文件');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            alert('视频文件过大，请上传小于 50MB 的视频');
            return;
        }
        setVideoFile(file);
        setVideoPreview(URL.createObjectURL(file));
        setStatusMessage(null);
        setResultVideoUrl(null);
        setSelectedCharacterId(null);
    };

    // 拖拽处理
    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) processVideoFile(file);
    };

    // 视频转 Base64
    const videoToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
        });
    };

    // 使用已保存的角色
    const handleSelectCharacter = (char) => {
        setSelectedCharacterId(char.id);
        setVideoPreview(char.avatarUrl);
        setStatusMessage({ type: 'info', message: `已选择角色: ${char.name}` });

        // 加载角色的 Base64 视频
        if (char.videoBase64) {
            fetch(char.videoBase64)
                .then(res => res.blob())
                .then(blob => {
                    const file = new File([blob], 'character.mp4', { type: 'video/mp4' });
                    setVideoFile(file);
                })
                .catch(e => console.error('加载角色视频失败:', e));
        }
    };

    // 清除选择
    const handleClearVideo = () => {
        setVideoFile(null);
        setVideoPreview(null);
        setSelectedCharacterId(null);
        setStatusMessage(null);
        setResultVideoUrl(null);
    };

    // 保存角色（仅保存，不生成）
    const handleSaveCharacter = async () => {
        if (!videoFile) {
            alert('请先上传角色视频');
            return;
        }

        setIsSaving(true);
        setStatusMessage({ type: 'processing', message: '正在保存角色...' });

        try {
            const base64Video = await videoToBase64(videoFile);
            const characterName = `角色 ${characters.length + 1}`;

            const newCharacter = {
                id: `char_${Date.now()}`,
                name: characterName,
                avatarUrl: videoPreview,
                createdAt: new Date().toISOString(),
                videoBase64: base64Video
            };

            const updatedCharacters = [newCharacter, ...characters];
            saveCharactersToStorage(updatedCharacters);

            setStatusMessage({ type: 'success', message: `角色 "${characterName}" 已保存！` });
        } catch (error) {
            setStatusMessage({ type: 'error', message: `保存失败: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    // 生成角色视频
    const handleGenerateVideo = async () => {
        if (!videoFile) {
            alert('请先上传角色视频');
            return;
        }
        if (!actionPrompt.trim()) {
            alert('请输入动作提示词');
            return;
        }

        setIsGenerating(true);
        setStatusMessage({ type: 'processing', message: '正在生成角色视频...' });
        setResultVideoUrl(null);

        try {
            const base64Video = await videoToBase64(videoFile);

            // 通过后端代理调用，避免 CORS 问题
            const response = await fetch('/api/v1/character/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    video_base64: base64Video,
                    prompt: actionPrompt
                })
            });

            if (!response.ok) throw new Error(`API 错误: ${response.status}`);

            // 处理 SSE 流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(dataStr);
                            // 检查是否有错误
                            if (data.error) {
                                const errorMsg = typeof data.error === 'string'
                                    ? data.error
                                    : (data.error.message || data.detail || JSON.stringify(data.error));
                                throw new Error(errorMsg);
                            }
                            const content = data.choices?.[0]?.delta?.reasoning_content ||
                                data.choices?.[0]?.delta?.content || '';
                            fullContent += content;
                        } catch (e) {
                            if (e.message && !e.message.includes('Unexpected')) {
                                throw e;
                            }
                        }
                    }
                }
            }

            // 提取视频 URL
            const urlMatch = fullContent.match(/https?:\/\/[^\s<>"'\\)]+/);
            if (urlMatch) {
                const videoUrl = urlMatch[0].replace(/['".,)>]+$/, '');
                setResultVideoUrl(videoUrl);
                setStatusMessage({ type: 'success', message: '视频生成成功！' });
            } else {
                setStatusMessage({ type: 'error', message: '未能获取视频 URL' });
            }
        } catch (error) {
            setStatusMessage({ type: 'error', message: `生成失败: ${error.message}` });
        } finally {
            setIsGenerating(false);
        }
    };

    // 删除角色
    const handleDeleteCharacter = (charId) => {
        if (confirm('确定要删除这个角色吗？')) {
            const updated = characters.filter(c => c.id !== charId);
            saveCharactersToStorage(updated);
            if (selectedCharacterId === charId) {
                setSelectedCharacterId(null);
            }
        }
    };

    // 下载视频
    const handleDownloadVideo = async () => {
        if (!resultVideoUrl) return;
        try {
            const response = await fetch(resultVideoUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `character_video_${Date.now()}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            window.open(resultVideoUrl, '_blank');
        }
    };

    return (
        <div className="character-video-container">
            <div className="character-video-header">
                <h1>🎭 角色视频生成</h1>
                <p>上传角色视频，输入动作提示词，生成角色动作视频</p>
            </div>

            {/* 主操作区 */}
            <div className="character-card character-card-margin">
                <div className="character-main-flow">
                    {/* 左：视频上传/预览 */}
                    <div className="flow-video-section">
                        <h3>📹 角色视频</h3>
                        {!videoPreview ? (
                            <div
                                className={`video-upload-zone ${isDragging ? 'dragging' : ''}`}
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                <div className="upload-icon">🎥</div>
                                <p>点击或拖拽上传视频</p>
                                <small>MP4/WebM，最大 50MB</small>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="video/*"
                                    onChange={(e) => e.target.files?.[0] && processVideoFile(e.target.files[0])}
                                    className="character-hidden-input"
                                />
                            </div>
                        ) : (
                            <div className="video-preview-container">
                                <video src={videoPreview} controls muted />
                                <div className="video-preview-overlay">
                                    <button onClick={handleClearVideo} title="移除">✕</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 右：提示词和操作 */}
                    <div className="flow-action-section">
                        <h3>✨ 动作设置</h3>
                        <div className="prompt-input-wrapper">
                            <label>动作提示词</label>
                            <textarea
                                value={actionPrompt}
                                onChange={(e) => setActionPrompt(e.target.value)}
                                placeholder="例如：角色做一个跳舞的动作、角色微笑挥手..."
                                rows={4}
                            />
                        </div>

                        {/* 操作按钮 */}
                        <div className="action-buttons">
                            <button
                                className="character-btn character-btn-primary"
                                onClick={handleGenerateVideo}
                                disabled={!videoFile || !actionPrompt.trim() || isGenerating}
                            >
                                {isGenerating ? '⏳ 生成中...' : '🎬 生成视频'}
                            </button>
                            <button
                                className="character-btn character-btn-secondary"
                                onClick={handleSaveCharacter}
                                disabled={!videoFile || isSaving}
                            >
                                {isSaving ? '⏳ 保存中...' : '💾 保存角色'}
                            </button>
                        </div>

                        {/* 状态消息 */}
                        {statusMessage && (
                            <div className={`status-message ${statusMessage.type}`}>
                                {statusMessage.type === 'processing' && <span className="spin">⏳</span>}
                                {statusMessage.type === 'success' && '✅'}
                                {statusMessage.type === 'error' && '❌'}
                                {statusMessage.type === 'info' && 'ℹ️'}
                                {statusMessage.message}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 生成结果 */}
            {resultVideoUrl && (
                <div className="character-card result-section character-card-margin">
                    <h3>🎥 生成结果</h3>
                    <div className="result-video-container">
                        <video src={resultVideoUrl} controls autoPlay />
                    </div>
                    <div className="result-actions">
                        <button className="character-btn character-btn-primary" onClick={handleDownloadVideo}>
                            ⬇️ 下载视频
                        </button>
                        <button className="character-btn character-btn-secondary" onClick={() => window.open(resultVideoUrl, '_blank')}>
                            🔗 新窗口打开
                        </button>
                    </div>
                </div>
            )}

            {/* 已保存角色列表 */}
            <div className="character-card">
                <h3>📋 已保存角色 ({characters.length})</h3>
                {characters.length === 0 ? (
                    <div className="empty-state">
                        <div className="icon">🎭</div>
                        <p>暂无保存的角色，上传视频后点击"保存角色"即可添加</p>
                    </div>
                ) : (
                    <div className="character-grid">
                        {characters.map((char) => (
                            <div
                                key={char.id}
                                className={`character-item ${selectedCharacterId === char.id ? 'selected' : ''}`}
                                onClick={() => handleSelectCharacter(char)}
                            >
                                <div className="character-avatar">
                                    {char.avatarUrl ? (
                                        <video src={char.avatarUrl} muted className="character-avatar-video-fit" />
                                    ) : '🎭'}
                                </div>
                                <div className="character-name">{char.name}</div>
                                <div className="character-date">{new Date(char.createdAt).toLocaleDateString()}</div>
                                <button
                                    className="character-btn-secondary character-delete-compact-btn"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteCharacter(char.id); }}
                                >
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CharacterVideo;
