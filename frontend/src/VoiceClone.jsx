import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import './VoiceClone.css';

const SUPPORTED_LANGUAGES = [
  { code: 'th-TH', name: '泰语', flag: '🇹🇭', nativeName: 'ไทย' },
  { code: 'es-ES', name: '西班牙语', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'en-US', name: '英语', flag: '🇺🇸', nativeName: 'English' },
  { code: 'ja-JP', name: '日语', flag: '🇯🇵', nativeName: '日本語' },
  { code: 'ko-KR', name: '韩语', flag: '🇰🇷', nativeName: '한국어' },
];

const VOICES_METADATA = [
  { name: 'Puck', gender: 'Male', label: '成熟磁性', languages: ['th-TH', 'en-US', 'es-ES', 'ja-JP', 'ko-KR'] },
  { name: 'Charon', gender: 'Male', label: '稳重厚实', languages: ['th-TH', 'en-US', 'es-ES'] },
  { name: 'Kore', gender: 'Female', label: '温柔亲切', languages: ['th-TH', 'en-US', 'es-ES', 'ja-JP', 'ko-KR'] },
  { name: 'Fenrir', gender: 'Male', label: '深沉有力', languages: ['th-TH', 'en-US'] },
  { name: 'Zephyr', gender: 'Female', label: '明快清脆', languages: ['th-TH', 'en-US', 'es-ES', 'ja-JP', 'ko-KR'] },
  { name: 'Aoede', gender: 'Female', label: '甜美悦耳', languages: ['th-TH', 'en-US', 'ja-JP'] },
  { name: 'Leda', gender: 'Female', label: '优雅端庄', languages: ['th-TH', 'en-US', 'ko-KR'] },
  { name: 'Orus', gender: 'Male', label: '朝气活力', languages: ['th-TH', 'en-US', 'es-ES'] },
  { name: 'Umbriel', gender: 'Male', label: '感性动人', languages: ['th-TH', 'en-US', 'ja-JP'] },
  { name: 'Despina', gender: 'Female', label: '活泼俏皮', languages: ['th-TH', 'en-US', 'es-ES', 'ko-KR'] },
];

const AppState = {
  IDLE: 'IDLE',
  PROCESSING_VIDEO: 'PROCESSING_VIDEO',
  REVIEW_SCRIPT: 'REVIEW_SCRIPT',
  GENERATING_AUDIO: 'GENERATING_AUDIO',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR'
};

function VoiceClone({ token }) {
  const [videoFile, setVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [targetLang, setTargetLang] = useState('th-TH');
  const [selectedVoice, setSelectedVoice] = useState('Kore');
  const [appState, setAppState] = useState(AppState.IDLE);
  const [showInstructions, setShowInstructions] = useState(true);
  
  const [segments, setSegments] = useState([]);
  const [flaggedWords, setFlaggedWords] = useState([]);
  const [detectedLang, setDetectedLang] = useState(null);
  
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [audioBase64, setAudioBase64] = useState(null);
  const [subtitleTimings, setSubtitleTimings] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);

  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const activeLang = useMemo(() => SUPPORTED_LANGUAGES.find(l => l.code === targetLang), [targetLang]);
  
  const filteredVoices = useMemo(() => 
    VOICES_METADATA.filter(v => v.languages.includes(targetLang)),
    [targetLang]
  );

  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some(v => v.name === selectedVoice)) {
      setSelectedVoice(filteredVoices[0].name);
    }
  }, [filteredVoices, selectedVoice]);

  const handleVideoSelect = useCallback((file) => {
    setVideoFile(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      setVideoDuration(video.duration);
      window.URL.revokeObjectURL(video.src);
    };
    video.src = URL.createObjectURL(file);
    resetAnalysis();
  }, []);

  const resetAnalysis = () => {
    setSegments([]);
    setFlaggedWords([]);
    setAudioBuffer(null);
    setAudioBase64(null);
    setSubtitleTimings([]);
    setAppState(AppState.IDLE);
    setErrorMessage(null);
    setDetectedLang(null);
  };

  const handleReset = useCallback(() => {
    setVideoFile(null);
    setVideoDuration(0);
    resetAnalysis();
    setShowInstructions(true);
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file) => {
    if (!file.type.startsWith('video/')) {
      alert("请上传视频文件。");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      alert("文件过大，请上传小于 100MB 的视频。");
      return;
    }
    handleVideoSelect(file);
  };

  const analyzeVideo = async () => {
    if (!videoFile) return;
    setErrorMessage(null);
    setAppState(AppState.PROCESSING_VIDEO);
    
    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('target_lang', targetLang);
      formData.append('video_duration', videoDuration.toString());

      const response = await fetch('/api/v1/voice-clone/analyze-video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '视频分析失败');
      }

      const data = await response.json();
      setSegments(data.segments || []);
      setFlaggedWords(data.flaggedWords || []);
      setDetectedLang(data.detectedSourceLanguage || null);
      setAppState(AppState.REVIEW_SCRIPT);
      setShowInstructions(false);
    } catch (error) {
      setAppState(AppState.ERROR);
      setErrorMessage(error.message || "视频分析失败。");
    }
  };

  const startSynthesis = async () => {
    if (segments.length === 0) return;
    setErrorMessage(null);
    setAppState(AppState.GENERATING_AUDIO);
    
    try {
      const response = await fetch('/api/v1/voice-clone/synthesize-speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          segments: segments,
          voice_name: selectedVoice,
          target_lang: targetLang
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || '语音合成失败');
      }

      const data = await response.json();
      const { audio_base64, segment_durations } = data;
      
      if (!audio_base64 || audio_base64.length === 0) {
        throw new Error('服务器返回空音频数据，请检查TTS模型配置');
      }
      
      setAudioBase64(audio_base64);
      
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      const buffer = await decodeAudioData(audio_base64, audioCtx, 24000);
      setAudioBuffer(buffer);

      let currentTime = 0;
      const timings = segments.map((seg, index) => {
        const duration = segment_durations[index] || 0;
        const start = currentTime;
        const end = start + duration;
        currentTime = end;
        return { start, end, targetContent: seg.targetContent, chinese: seg.chinese };
      });
      setSubtitleTimings(timings);
      setAppState(AppState.COMPLETED);
    } catch (error) {
      setAppState(AppState.ERROR);
      setErrorMessage(error.message || "语音合成失败。");
    }
  };

  const base64ToBytes = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const decodeAudioData = async (data, ctx, sampleRate = 24000) => {
    if (!data || data.length === 0) {
      throw new Error('音频数据为空');
    }
    
    let bytes = typeof data === 'string' ? base64ToBytes(data) : data;
    
    if (bytes.length === 0) {
      throw new Error('解码后音频数据为空');
    }
    
    if (bytes.length % 2 !== 0) {
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    
    const numSamples = Math.floor(bytes.byteLength / 2);
    if (numSamples === 0) {
      throw new Error('音频采样数为0，TTS模型可能未正确配置');
    }
    
    const dataInt16 = new Int16Array(bytes.buffer, bytes.byteOffset, numSamples);
    const buffer = ctx.createBuffer(1, numSamples, sampleRate);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  };

  const handleTextChange = (id, field, value) => {
    const newSegments = segments.map(seg => 
      seg.id === id ? { ...seg, [field]: value } : seg
    );
    setSegments(newSegments);
  };

  const isLoading = appState === AppState.PROCESSING_VIDEO || appState === AppState.GENERATING_AUDIO;
  const showScriptEditor = appState !== AppState.IDLE && appState !== AppState.ERROR;

  return (
    <div className="voice-clone-container">
      <header className="voice-clone-header">
        <div className="voice-clone-header-content">
          <div className="voice-clone-brand">
            <div className="voice-clone-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
              </svg>
            </div>
            <h1 className="voice-clone-title">多语种视频配音 & 合规</h1>
          </div>
          
          <div className="voice-clone-header-actions">
            {videoFile && (
              <button onClick={handleReset} className="voice-clone-reset-btn">
                重新上传
              </button>
            )}
            <button onClick={() => setShowInstructions(!showInstructions)} className="voice-clone-help-btn">
              {showInstructions ? "收起说明" : "使用说明"}
            </button>
          </div>
        </div>
      </header>

      <main className="voice-clone-main">
        <div className={`voice-clone-instructions ${showInstructions ? 'visible' : ''}`}>
          <div className="voice-clone-instructions-card">
            <div className="voice-clone-instructions-grid">
              <div className="voice-clone-instruction-item">
                <span className="voice-clone-step-number step-1">1</span>
                <p>上传视频并选择目标语种（西班牙语、泰语等）。</p>
              </div>
              <div className="voice-clone-instruction-item">
                <span className="voice-clone-step-number step-2">2</span>
                <p>AI 自动检测视频语言并生成脱敏后的译文脚本。</p>
              </div>
              <div className="voice-clone-instruction-item">
                <span className="voice-clone-step-number step-3">3</span>
                <p>选择声线合成高质量音频及匹配字幕。</p>
              </div>
            </div>
          </div>
        </div>

        <div className="voice-clone-content">
          <div className="voice-clone-left-panel">
            <section className="voice-clone-card">
              <h2 className="voice-clone-section-title">
                <span className="section-indicator indicator-blue"></span>
                1. 上传与语种选择
              </h2>
              
              <div className="voice-clone-lang-selector">
                <label className="voice-clone-field-label">选择目标生成语种</label>
                <div className="voice-clone-lang-grid">
                  {SUPPORTED_LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setTargetLang(lang.code)}
                      disabled={isLoading || appState !== AppState.IDLE}
                      className={`voice-clone-lang-btn ${targetLang === lang.code ? 'active' : ''} ${isLoading ? 'disabled' : ''}`}
                    >
                      <span className="lang-flag">{lang.flag}</span>
                      <span className="lang-name">{lang.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={`voice-clone-uploader ${dragActive ? 'drag-active' : ''} ${isLoading || (appState !== AppState.IDLE && appState !== AppState.ERROR) ? 'disabled' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={!(isLoading || (appState !== AppState.IDLE && appState !== AppState.ERROR)) ? handleDrop : undefined}
                onClick={() => !(isLoading || (appState !== AppState.IDLE && appState !== AppState.ERROR)) && inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  className="voice-clone-file-input"
                  accept="video/*"
                  onChange={handleFileChange}
                  disabled={isLoading || (appState !== AppState.IDLE && appState !== AppState.ERROR)}
                />
                {videoFile ? (
                  <div className="voice-clone-video-preview">
                    <video 
                      src={URL.createObjectURL(videoFile)} 
                      controls 
                      className="voice-clone-video-player"
                    />
                    <div className="voice-clone-video-name">{videoFile.name}</div>
                  </div>
                ) : (
                  <div className="voice-clone-upload-placeholder">
                    <div className="voice-clone-upload-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="32" height="32">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    </div>
                    <p className="voice-clone-upload-text">拖拽视频到这里或点击上传</p>
                    <p className="voice-clone-upload-hint">支持 MP4, WebM, MOV (最大 100MB)</p>
                  </div>
                )}
              </div>
              
              {videoFile && (appState === AppState.IDLE || appState === AppState.ERROR) && (
                <button onClick={analyzeVideo} className="voice-clone-analyze-btn">
                  开始分析 (生成{activeLang?.name})
                </button>
              )}
            </section>

            {detectedLang && (
              <div className="voice-clone-detected-lang">
                <div className="voice-clone-detected-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <p>AI 检测视频原语种: <span className="detected-lang-name">{detectedLang}</span></p>
              </div>
            )}

            {appState === AppState.ERROR && (
              <div className="voice-clone-error">
                <p className="voice-clone-error-title">发生错误</p>
                <p className="voice-clone-error-msg">{errorMessage}</p>
              </div>
            )}

            {(appState === AppState.REVIEW_SCRIPT || appState === AppState.COMPLETED || appState === AppState.GENERATING_AUDIO) && (
              <section className="voice-clone-card">
                <h2 className="voice-clone-section-title">
                  <span className="section-indicator indicator-purple"></span>
                  2. 语音合成
                </h2>
                
                <div className="voice-clone-voice-selector">
                  <div className="voice-clone-voice-header">
                    <h3>选择配音声线</h3>
                    <span className="voice-clone-voice-count">支持该语言的声线: {filteredVoices.length}</span>
                  </div>
                  
                  <div className="voice-clone-voice-list">
                    {filteredVoices.map((voice) => (
                      <div 
                        key={voice.name}
                        onClick={() => !isLoading && appState !== AppState.COMPLETED && setSelectedVoice(voice.name)}
                        className={`voice-clone-voice-item ${selectedVoice === voice.name ? 'active' : ''} ${isLoading || appState === AppState.COMPLETED ? 'disabled' : ''}`}
                      >
                        <div className="voice-clone-voice-info">
                          <div className={`voice-clone-voice-gender ${voice.gender === 'Male' ? 'male' : 'female'}`}>
                            {voice.gender === 'Male' ? 'M' : 'F'}
                          </div>
                          <div className="voice-clone-voice-details">
                            <span className="voice-clone-voice-name">{voice.name} ({voice.label})</span>
                            <span className="voice-clone-voice-langs">适配 {voice.languages.length} 种语言</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {appState === AppState.REVIEW_SCRIPT && (
                  <button onClick={startSynthesis} className="voice-clone-synthesize-btn">
                    生成{activeLang?.name}配音
                  </button>
                )}
              </section>
            )}
          </div>

          <div className="voice-clone-right-panel">
            {showScriptEditor && (
              <section className="voice-clone-script-editor">
                <div className="voice-clone-script-header">
                  <h2 className="voice-clone-section-title">
                    <span className="section-indicator indicator-pink"></span>
                    3. 脚本与合规
                  </h2>
                  <div className="voice-clone-script-lang">
                    <span className="lang-flag">{activeLang?.flag}</span>
                    <span className="lang-label">{activeLang?.name}版</span>
                  </div>
                </div>
                
                <div className="voice-clone-script-content">
                  {isLoading && (
                    <div className="voice-clone-loading-overlay">
                      <div className="voice-clone-spinner"></div>
                      <h3>{appState === AppState.PROCESSING_VIDEO ? `AI 正在创作${activeLang?.name}脚本...` : "语音合成中..."}</h3>
                    </div>
                  )}
                  
                  <div className="voice-clone-segments">
                    {segments.map((segment) => (
                      <div key={segment.id} className="voice-clone-segment">
                        <div className="voice-clone-segment-header">
                          <span className="voice-clone-segment-time">{segment.timeRange}</span>
                        </div>
                        <div className="voice-clone-segment-body">
                          <div className="voice-clone-segment-field">
                            <label className="voice-clone-field-label primary">{activeLang?.name}脚本</label>
                            <textarea
                              value={segment.targetContent}
                              onChange={(e) => handleTextChange(segment.id, 'targetContent', e.target.value)}
                              disabled={isLoading || appState === AppState.COMPLETED}
                              className="voice-clone-textarea primary"
                              rows={2}
                            />
                          </div>
                          <div className="voice-clone-segment-field">
                            <label className="voice-clone-field-label secondary">中文对照</label>
                            <textarea
                              value={segment.chinese}
                              onChange={(e) => handleTextChange(segment.id, 'chinese', e.target.value)}
                              disabled={isLoading || appState === AppState.COMPLETED}
                              className="voice-clone-textarea secondary"
                              rows={2}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {appState === AppState.COMPLETED && audioBuffer && (
              <section className="voice-clone-audio-player">
                <h2 className="voice-clone-section-title">
                  <span className="section-indicator indicator-green"></span>
                  4. 最终配音预览
                </h2>
                <AudioPlayerComponent 
                  buffer={audioBuffer} 
                  subtitleTimings={subtitleTimings}
                  audioBase64={audioBase64}
                />
                <div className="voice-clone-player-footer">
                  <button 
                    onClick={() => { setAppState(AppState.REVIEW_SCRIPT); setAudioBuffer(null); setAudioBase64(null); }} 
                    className="voice-clone-back-btn"
                  >
                    返回修改脚本
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function AudioPlayerComponent({ buffer, subtitleTimings, audioBase64 }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentSubtitle, setCurrentSubtitle] = useState(null);
  
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const startTimeRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    return () => {
      stopPlayback();
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!subtitleTimings) return;
    const subtitle = subtitleTimings.find(s => currentTime >= s.start && currentTime < s.end);
    setCurrentSubtitle(subtitle || null);
  }, [currentTime, subtitleTimings]);

  const updateProgress = () => {
    if (!audioContextRef.current || !startTimeRef.current) return;
    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
    if (elapsed >= buffer.duration) {
      stopPlayback();
      setCurrentTime(buffer.duration);
    } else {
      setCurrentTime(elapsed);
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const stopPlayback = () => {
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch(e) {}
      sourceRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsPlaying(false);
  };

  const handlePlay = async () => {
    if (!audioContextRef.current || !buffer) return;
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    if (isPlaying) {
      stopPlayback();
    } else {
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start();
      sourceRef.current = source;
      startTimeRef.current = audioContextRef.current.currentTime;
      setIsPlaying(true);
      setCurrentTime(0);
      rafRef.current = requestAnimationFrame(updateProgress);
      source.onended = () => { setIsPlaying(false); setCurrentTime(0); };
    }
  };

  const handleDownload = () => {
    if (!buffer) return;
    const blob = audioBufferToWav(buffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceover-${new Date().getTime()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const audioBufferToWav = (buffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let sample;
    let offset = 0;
    let pos = 0;

    const writeString = (view, offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * numOfChan * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * numOfChan * 2, true);

    for (let i = 0; i < buffer.numberOfChannels; i++)
      channels.push(buffer.getChannelData(i));

    offset = 44;
    while (pos < buffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][pos]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(offset, sample, true);
        offset += 2;
      }
      pos++;
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  return (
    <div className="voice-clone-player">
      <div className="voice-clone-player-controls">
        <button
          onClick={handlePlay}
          className={`voice-clone-play-btn ${isPlaying ? 'playing' : ''}`}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>
          )}
        </button>

        <div className="voice-clone-player-progress">
          <div className="voice-clone-player-info">
            <span className="voice-clone-player-duration">音频时长: {buffer.duration.toFixed(1)}s</span>
          </div>
          <div className="voice-clone-progress-bar">
            <div className="voice-clone-progress-fill" style={{ width: `${(currentTime / buffer.duration) * 100}%` }} />
          </div>
        </div>

        <button onClick={handleDownload} className="voice-clone-download-btn">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
            <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </button>
      </div>

      <div className="voice-clone-subtitle-display">
        {currentSubtitle ? (
          <div>
            <p className="voice-clone-subtitle-target">{currentSubtitle.targetContent}</p>
            <p className="voice-clone-subtitle-chinese">{currentSubtitle.chinese}</p>
          </div>
        ) : (
          <p className="voice-clone-subtitle-placeholder">播放以预览字幕...</p>
        )}
      </div>
    </div>
  );
}

export default VoiceClone;
