import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import './FloatingGallery.css';

// Product categories
const CATEGORIES = [
    { value: 'all', label: '全部', icon: '🏷️' },
    { value: 'security', label: '安防监控', icon: '📹' },
    { value: 'daily', label: '日用百货', icon: '🧴' },
    { value: 'beauty', label: '美妆护肤', icon: '💄' },
    { value: 'digital', label: '数码3C', icon: '🎧' },
    { value: 'other', label: '其他品类', icon: '📦' },
];

// Format timestamp from backend (already in Beijing time UTC+8)
const formatBeijingTime = (timestamp) => {
    if (!timestamp) return '未知';
    let dateStr = timestamp;
    if (!timestamp.includes('+') && !timestamp.includes('Z')) {
        dateStr = timestamp + '+08:00';
    }
    return new Date(dateStr).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
};


// ─── Memoized Sub-Components (prevent re-renders during video playback) ───

/** Shared context menu hook for cards */
function useCardContextMenu() {
    const [ctxMenu, setCtxMenu] = useState(null);
    useEffect(() => {
        if (!ctxMenu) return;
        const dismiss = () => setCtxMenu(null);
        const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
        document.addEventListener('click', dismiss);
        document.addEventListener('contextmenu', dismiss);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('click', dismiss);
            document.removeEventListener('contextmenu', dismiss);
            document.removeEventListener('keydown', onKey);
        };
    }, [ctxMenu]);
    const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 260);
        setCtxMenu({ x, y });
    };
    return [ctxMenu, open, () => setCtxMenu(null)];
}

/** Memoized Image Card — only re-renders when its own props change */
const ImageCard = memo(({ img, selectMode, isSelected, onSelect, onView, onSelectForVideo, onToggleShare, onDelete, userRole, currentUserId, categories, handleSelectForVideoAndClose }) => {
    const [ctxMenu, openCtx, closeCtx] = useCardContextMenu();
    return (
        <div
            className={`fg-card ${selectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => selectMode ? onSelect(img.id) : onView(img)}
            onContextMenu={openCtx}
        >
            {selectMode && (
                <div className={`fg-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && '✓'}
                </div>
            )}
            <a
                href={img.url}
                download
                target="_blank"
                rel="noreferrer"
                className="fg-quick-download"
                onClick={(e) => e.stopPropagation()}
                title="下载"
            >
                ⬇️
            </a>
            <img src={img.url} alt="" className="fg-card-img" loading="lazy" />
            <div className="fg-card-info">
                <span className="fg-card-category">
                    {categories.find(c => c.value === img.category)?.icon || '📦'}
                </span>
                <span className="fg-card-time">
                    {img.created_at ? new Date(img.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                {img.is_shared && <span className="fg-card-shared">🌐</span>}
            </div>
            <div className="fg-card-overlay">
                <div className="fg-card-actions">
                    {handleSelectForVideoAndClose && (
                        <button
                            className="fg-action-btn primary"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSelectForVideoAndClose(img.url, img.prompt, img.category);
                            }}
                            title="转视频"
                        >
                            🎬
                        </button>
                    )}
                    {userRole === 'admin' && (
                        <button
                            className={`fg-action-btn ${img.is_shared ? 'active' : ''}`}
                            onClick={(e) => onToggleShare(e, img, 'image')}
                            title={img.is_shared ? "取消分享" : "分享"}
                        >
                            {img.is_shared ? '🔗' : '🔒'}
                        </button>
                    )}
                    {(userRole === 'admin' || img.user_id === currentUserId) && (
                        <button
                            className="fg-action-btn delete"
                            onClick={(e) => onDelete(e, img, 'image')}
                            title="删除"
                        >
                            🗑️
                        </button>
                    )}
                </div>
                <p className="fg-card-prompt">{img.prompt}</p>
            </div>

            {/* Right-click Context Menu */}
            {ctxMenu && createPortal(
                <div className="fg-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
                    <button className="fg-ctx-item" onClick={() => { closeCtx(); onView(img); }}>
                        <span className="fg-ctx-icon">🔍</span> 预览图片
                    </button>
                    <button className="fg-ctx-item" onClick={() => { closeCtx(); const a = document.createElement('a'); a.href = img.url; a.download = ''; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}>
                        <span className="fg-ctx-icon">⬇️</span> 下载图片
                    </button>
                    {handleSelectForVideoAndClose && (
                        <button className="fg-ctx-item" onClick={() => { closeCtx(); handleSelectForVideoAndClose(img.url, img.prompt, img.category); }}>
                            <span className="fg-ctx-icon">🎬</span> 转为视频
                        </button>
                    )}
                    {userRole === 'admin' && (
                        <button className="fg-ctx-item" onClick={() => { closeCtx(); onToggleShare({ stopPropagation: () => {} }, img, 'image'); }}>
                            <span className="fg-ctx-icon">{img.is_shared ? '🔒' : '🌐'}</span> {img.is_shared ? '取消公开' : '设为公开'}
                        </button>
                    )}
                    {(userRole === 'admin' || img.user_id === currentUserId) && (
                        <>
                            <div className="fg-ctx-divider" />
                            <button className="fg-ctx-item danger" onClick={() => { closeCtx(); onDelete({ stopPropagation: () => {} }, img, 'image'); }}>
                                <span className="fg-ctx-icon">🗑️</span> 删除图片
                            </button>
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
});
ImageCard.displayName = 'ImageCard';

/** Memoized Video Card — only re-renders when its own props change */
const VideoCard = memo(({ vid, selectMode, isSelected, onSelect, onView, onToggleShare, onDelete, userRole, currentUserId, categories }) => {
    const [ctxMenu, openCtx, closeCtx] = useCardContextMenu();
    return (
        <div
            className={`fg-card video ${selectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => selectMode ? onSelect(vid.id) : onView(vid)}
            onContextMenu={openCtx}
        >
            {selectMode && (
                <div className={`fg-checkbox ${isSelected ? 'checked' : ''}`}>
                    {isSelected && '✓'}
                </div>
            )}
            {vid.review_status === 'pending' && (
                <div className="fg-review-badge pending" title="审查中...">⏳</div>
            )}
            {vid.review_status === 'done' && vid.review_score != null && (
                <div
                    className={`fg-review-badge ${vid.review_score >= 8 ? 'good' : vid.review_score >= 5 ? 'warning' : 'bad'}`}
                    title={`综合评分: ${vid.review_score}/10 (越高越好)`}
                >
                    {vid.review_score >= 8 ? '✓' : vid.review_score >= 5 ? '!' : '✗'} {vid.review_score}
                </div>
            )}
            {vid.review_status === 'error' && (
                <div className="fg-review-badge error" title="审查失败">⚠</div>
            )}
            <img
                src={vid.preview_url || "/placeholder-video.png"}
                alt=""
                className="fg-card-img"
                loading="lazy"
            />
            {(vid.is_merged || vid.prompt?.includes('Story Chain') || vid.prompt?.includes('Story Fission') || vid.filename?.includes('story_chain') || vid.filename?.includes('story_fission')) && (
                <div style={{
                    position: 'absolute', top: '8px', left: '8px',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    padding: '2px 6px', borderRadius: '4px', fontSize: '10px',
                    fontWeight: 'bold', color: '#fff',
                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.4)',
                    border: '1px solid rgba(255,255,255,0.2)', zIndex: 10
                }}>
                    ✨ 合成
                </div>
            )}
            <a
                href={vid.result_url}
                download
                target="_blank"
                rel="noreferrer"
                className="fg-quick-download"
                onClick={(e) => e.stopPropagation()}
                title="下载"
            >
                ⬇️
            </a>
            <div className="fg-play-icon">▶</div>
            <div className="fg-card-info">
                <span className="fg-card-category">
                    {categories.find(c => c.value === vid.category)?.icon || '📦'}
                </span>
                <span className="fg-card-time">
                    {vid.created_at ? new Date(vid.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                {vid.is_shared && <span className="fg-card-shared">🌐</span>}
            </div>
            <div className="fg-card-overlay">
                <div className="fg-card-actions">
                    {userRole === 'admin' && (
                        <button
                            className={`fg-action-btn ${vid.is_shared ? 'active' : ''}`}
                            onClick={(e) => onToggleShare(e, vid, 'video')}
                            title={vid.is_shared ? "取消分享" : "分享"}
                        >
                            {vid.is_shared ? '🔗' : '🔒'}
                        </button>
                    )}
                    {(userRole === 'admin' || vid.user_id === currentUserId) && (
                        <button
                            className="fg-action-btn delete"
                            onClick={(e) => onDelete(e, vid, 'video')}
                            title="删除"
                        >
                            🗑️
                        </button>
                    )}
                </div>
                <p className="fg-card-prompt">{vid.prompt}</p>
            </div>

            {/* Right-click Context Menu */}
            {ctxMenu && createPortal(
                <div className="fg-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
                    <button className="fg-ctx-item" onClick={() => { closeCtx(); onView(vid); }}>
                        <span className="fg-ctx-icon">▶️</span> 播放视频
                    </button>
                    <button className="fg-ctx-item" onClick={() => { closeCtx(); const a = document.createElement('a'); a.href = vid.result_url; a.download = ''; document.body.appendChild(a); a.click(); document.body.removeChild(a); }}>
                        <span className="fg-ctx-icon">⬇️</span> 下载视频
                    </button>
                    <button className="fg-ctx-item" onClick={() => { closeCtx(); navigator.clipboard.writeText(vid.result_url).catch(() => {}); }}>
                        <span className="fg-ctx-icon">📋</span> 复制链接
                    </button>
                    {userRole === 'admin' && (
                        <button className="fg-ctx-item" onClick={() => { closeCtx(); onToggleShare({ stopPropagation: () => {} }, vid, 'video'); }}>
                            <span className="fg-ctx-icon">{vid.is_shared ? '🔒' : '🌐'}</span> {vid.is_shared ? '取消公开' : '设为公开'}
                        </button>
                    )}
                    {(userRole === 'admin' || vid.user_id === currentUserId) && (
                        <>
                            <div className="fg-ctx-divider" />
                            <button className="fg-ctx-item danger" onClick={() => { closeCtx(); onDelete({ stopPropagation: () => {} }, vid, 'video'); }}>
                                <span className="fg-ctx-icon">🗑️</span> 删除视频
                            </button>
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
});
VideoCard.displayName = 'VideoCard';

/** Memoized Video Lightbox — fully isolated from gallery state changes */
const VideoLightbox = memo(({ video, onClose, reviewDetails, loadingReview, videoError, onVideoError, onDelete, onToggleShare, userRole, currentUserId }) => {
    const [ctxMenu, setCtxMenu] = useState(null);
    const ctxRef = useRef(null);

    // Close context menu on outside click or Escape
    useEffect(() => {
        if (!ctxMenu) return;
        const handleClick = () => setCtxMenu(null);
        const handleKey = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('click', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [ctxMenu]);

    if (!video) return null;

    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Position menu, clamped to viewport
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 220);
        setCtxMenu({ x, y });
    };

    const handleDownload = () => {
        const a = document.createElement('a');
        a.href = video.result_url;
        a.download = '';
        a.target = '_blank';
        a.rel = 'noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setCtxMenu(null);
    };

    const handleDeleteClick = () => {
        setCtxMenu(null);
        if (window.confirm('确定要删除这个视频吗？')) {
            // Create a synthetic event for stopPropagation compatibility
            const syntheticEvent = { stopPropagation: () => {} };
            onDelete(syntheticEvent, video, 'video');
            onClose();
        }
    };

    const handleShareClick = () => {
        setCtxMenu(null);
        const syntheticEvent = { stopPropagation: () => {} };
        onToggleShare(syntheticEvent, video, 'video');
    };

    const handleCopyUrl = () => {
        navigator.clipboard.writeText(video.result_url).catch(() => {});
        setCtxMenu(null);
    };

    return (
        <div className="fg-lightbox" onClick={onClose}>
            <div className="fg-lightbox-content video" onClick={e => e.stopPropagation()} onContextMenu={handleContextMenu}>
                {videoError ? (
                    <div className="fg-video-expired">
                        <div className="fg-expired-icon">⏰</div>
                        <div className="fg-expired-title">视频链接已过期</div>
                        <div className="fg-expired-desc">
                            外部视频资源已失效，请重新生成视频
                        </div>
                    </div>
                ) : (
                    <video
                        src={video.result_url}
                        controls
                        autoPlay
                        playsInline
                        preload="auto"
                        className="fg-lightbox-video"
                        onError={onVideoError}
                    />
                )}
                <div className="fg-lightbox-info">
                    <p className="fg-lightbox-prompt">{video.prompt || '无提示词'}</p>
                    <div className="fg-lightbox-meta">
                        <span>👤 {video.username || '未知'}</span>
                        <span>🕐 {formatBeijingTime(video.created_at)}</span>
                    </div>

                    {/* Review Details Section */}
                    {video.review_status === 'done' && (
                        <div className="fg-review-section">
                            <div className="fg-review-header">
                                <span className="fg-review-title">🔍 AI质量审查报告</span>
                                <span className={`fg-review-score-badge ${video.review_score >= 8 ? 'good' : video.review_score >= 5 ? 'warning' : 'bad'}`}>
                                    综合评分: {video.review_score}/10
                                </span>
                            </div>
                            {loadingReview ? (
                                <p className="fg-review-loading">加载详情...</p>
                            ) : reviewDetails ? (
                                <div className="fg-review-details">
                                    <div className="fg-review-scores">
                                        <div className="fg-score-item">
                                            <span className="score-label">自然度</span>
                                            <span className={`score-value ${reviewDetails.ai_score >= 8 ? 'good' : reviewDetails.ai_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.ai_score}</span>
                                        </div>
                                        <div className="fg-score-item">
                                            <span className="score-label">一致性</span>
                                            <span className={`score-value ${reviewDetails.consistency_score >= 8 ? 'good' : reviewDetails.consistency_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.consistency_score}</span>
                                        </div>
                                        <div className="fg-score-item">
                                            <span className="score-label">真实性</span>
                                            <span className={`score-value ${reviewDetails.physics_score >= 8 ? 'good' : reviewDetails.physics_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.physics_score}</span>
                                        </div>
                                        <div className="fg-score-item">
                                            <span className="score-label">卖点</span>
                                            <span className={`score-value ${reviewDetails.ecommerce_score >= 8 ? 'good' : reviewDetails.ecommerce_score >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.ecommerce_score}</span>
                                        </div>
                                        <div className="fg-score-item">
                                            <span className="score-label">安全</span>
                                            <span className={`score-value ${reviewDetails.platform_risk >= 8 ? 'good' : reviewDetails.platform_risk >= 5 ? 'warning' : 'bad'}`}>{reviewDetails.platform_risk}</span>
                                        </div>
                                    </div>
                                    {reviewDetails.summary && (
                                        <p className="fg-review-summary">
                                            <strong>总结：</strong>{reviewDetails.summary}
                                        </p>
                                    )}
                                    <div className={`fg-review-recommendation ${reviewDetails.recommendation}`}>
                                        {reviewDetails.recommendation === 'pass' && '✅ 可直接使用'}
                                        {reviewDetails.recommendation === 'warning' && '⚠️ 谨慎使用'}
                                        {reviewDetails.recommendation === 'reject' && '❌ 不建议使用'}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                    {video.review_status === 'pending' && (
                        <div className="fg-review-section pending">
                            <span>⏳ 审查中...</span>
                        </div>
                    )}
                    {video.review_status === 'error' && (
                        <div className="fg-review-section error">
                            <span>⚠️ 审查失败</span>
                        </div>
                    )}

                    <div className="fg-lightbox-actions">
                        <a href={video.result_url} download target="_blank" rel="noreferrer" className="fg-lb-btn primary">
                            ⬇️ 下载视频
                        </a>
                        <button className="fg-lb-btn close" onClick={onClose}>
                            ✕ 关闭
                        </button>
                    </div>
                </div>
            </div>

            {/* Right-click Context Menu */}
            {ctxMenu && createPortal(
                <div
                    ref={ctxRef}
                    className="fg-ctx-menu"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button className="fg-ctx-item" onClick={handleDownload}>
                        <span className="fg-ctx-icon">⬇️</span> 下载视频
                    </button>
                    <button className="fg-ctx-item" onClick={handleCopyUrl}>
                        <span className="fg-ctx-icon">📋</span> 复制链接
                    </button>
                    {userRole === 'admin' && (
                        <button className="fg-ctx-item" onClick={handleShareClick}>
                            <span className="fg-ctx-icon">{video.is_shared ? '🔒' : '🌐'}</span> {video.is_shared ? '取消公开' : '设为公开'}
                        </button>
                    )}
                    <div className="fg-ctx-divider" />
                    {(userRole === 'admin' || video.user_id === currentUserId) && (
                        <button className="fg-ctx-item danger" onClick={handleDeleteClick}>
                            <span className="fg-ctx-icon">🗑️</span> 删除视频
                        </button>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
});
VideoLightbox.displayName = 'VideoLightbox';

const FloatingGallery = ({ isOpen, onClose, onSelectForVideo }) => {
    const [activeTab, setActiveTab] = useState('images');
    const userRole = localStorage.getItem('role') || 'user';
    const currentUserId = parseInt(localStorage.getItem('userId') || '0', 10);

    const [viewMode, setViewMode] = useState('own'); // 所有用户默认查看自己的内容，管理员可切换到 'all' 或 'user'
    const [selectedUserId, setSelectedUserId] = useState(null); // 管理员按用户筛选时选中的用户ID
    const [userList, setUserList] = useState([]); // 用户列表（管理员用）

    // Pagination
    const [imgPage, setImgPage] = useState(1);
    const [vidPage, setVidPage] = useState(1);
    const LIMIT = 6; // 减少每页数量以适应浮动面板

    // Filters
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState('all');
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [searchQuery, setSearchQuery] = useState('');        // 搜索关键词
    const [shareFilter, setShareFilter] = useState('all');     // 分享状态筛选

    // Download Progress Toast
    const [downloadToast, setDownloadToast] = useState(null);  // { current, total, status }


    // Data
    const [images, setImages] = useState([]);
    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(false);

    // Batch Selection
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());

    // Portrait tracking
    const [portraitVideos, setPortraitVideos] = useState(new Set());

    // Lightbox
    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [videoError, setVideoError] = useState(false);
    const [reviewDetails, setReviewDetails] = useState(null);
    const [loadingReview, setLoadingReview] = useState(false);

    // Totals
    const [totalImages, setTotalImages] = useState(0);
    const [totalVideos, setTotalVideos] = useState(0);

    // Fetch when open and filters change
    useEffect(() => {
        if (isOpen) {
            if (activeTab === 'images') fetchImages();
            else fetchVideos();
        }
    }, [isOpen, activeTab, imgPage, vidPage, categoryFilter, viewMode, selectedUserId, dateFilter, customStartDate, customEndDate, searchQuery, shareFilter]);

    // Fetch user list for admin
    useEffect(() => {
        if (isOpen && userRole === 'admin' && userList.length === 0) {
            fetchUserList();
        }
    }, [isOpen, userRole]);

    const fetchUserList = async () => {
        const token = localStorage.getItem('token');
        try {
            const res = await fetch('/api/v1/users', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUserList(data);
            }
        } catch (err) {
            console.error('Failed to fetch user list', err);
        }
    };

    // Reset selection on tab/category change
    useEffect(() => {
        setSelectedIds(new Set());
        setSelectMode(false);
    }, [activeTab, categoryFilter]);

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                if (selectedImage) setSelectedImage(null);
                else if (selectedVideo) setSelectedVideo(null);
                else onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, selectedImage, selectedVideo, onClose]);

    // Fetch review details when a video with review is selected
    useEffect(() => {
        if (selectedVideo && selectedVideo.review_status === 'done') {
            setLoadingReview(true);
            setVideoError(false);
            const token = localStorage.getItem('token');
            fetch(`/api/v1/gallery/videos/${selectedVideo.id}/review`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(res => res.json())
                .then(data => {
                    setReviewDetails(data.details);
                    setLoadingReview(false);
                })
                .catch(() => setLoadingReview(false));
        } else {
            setReviewDetails(null);
            setVideoError(false);
        }
    }, [selectedVideo]);

    const getDateParams = () => {
        const today = new Date();
        let startDate = '';
        let endDate = '';

        const formatLocalDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        switch (dateFilter) {
            case 'today':
                startDate = formatLocalDate(today);
                endDate = startDate;
                break;
            case 'week':
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                startDate = formatLocalDate(weekAgo);
                endDate = formatLocalDate(today);
                break;
            case 'month':
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                startDate = formatLocalDate(monthAgo);
                endDate = formatLocalDate(today);
                break;
            case 'custom':
                startDate = customStartDate;
                endDate = customEndDate;
                break;
            default:
                break;
        }

        let params = '';
        if (startDate) params += `&start_date=${startDate}`;
        if (endDate) params += `&end_date=${endDate}`;
        return params;
    };

    const fetchImages = async () => {
        setLoading(true);
        const token = localStorage.getItem('token');
        const offset = (imgPage - 1) * LIMIT;
        const categoryParam = categoryFilter !== 'all' ? `&category=${categoryFilter}` : '';
        // 管理员视角: own/all/user
        let viewParam = '';
        if (userRole === 'admin') {
            viewParam = `&view_mode=${viewMode}`;
            if (viewMode === 'user' && selectedUserId) {
                viewParam += `&user_id=${selectedUserId}`;
            }
        }
        const dateParams = getDateParams();
        const searchParam = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '';
        const shareParam = shareFilter !== 'all' ? `&is_shared=${shareFilter === 'shared'}` : '';
        try {
            const res = await fetch(`/api/v1/gallery/images?limit=${LIMIT}&offset=${offset}${categoryParam}${viewParam}${dateParams}${searchParam}${shareParam}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setImages(data.items);
                setTotalImages(data.total);
            }
        } catch (err) {
            console.error("Failed to fetch images", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchVideos = async () => {
        setLoading(true);
        const token = localStorage.getItem('token');
        const offset = (vidPage - 1) * LIMIT;
        const categoryParam = categoryFilter !== 'all' ? `&category=${categoryFilter}` : '';
        // 管理员视角: own/all/user
        let viewParam = '';
        if (userRole === 'admin') {
            viewParam = `&view_mode=${viewMode}`;
            if (viewMode === 'user' && selectedUserId) {
                viewParam += `&user_id=${selectedUserId}`;
            }
        }
        const dateParams = getDateParams();
        const searchParam = searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : '';
        const shareParam = shareFilter !== 'all' ? `&is_shared=${shareFilter === 'shared'}` : '';
        try {
            const res = await fetch(`/api/v1/gallery/videos?limit=${LIMIT}&offset=${offset}${categoryParam}${viewParam}${dateParams}${searchParam}${shareParam}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setVideos(data.items);
                setTotalVideos(data.total);
            }
        } catch (err) {
            console.error("Failed to fetch videos", err);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        if (activeTab === 'images') await fetchImages();
        else await fetchVideos();
    };

    const toggleSelect = useCallback((id) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);

    const toggleSelectAll = () => {
        if (activeTab === 'images') {
            if (selectedIds.size === images.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(images.map(img => img.id)));
        } else {
            if (selectedIds.size === videos.length) setSelectedIds(new Set());
            else setSelectedIds(new Set(videos.map(vid => vid.id)));
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;

        const token = localStorage.getItem('token');
        const endpoint = activeTab === 'images'
            ? '/api/v1/gallery/images/batch-delete'
            : '/api/v1/gallery/videos/batch-delete';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });

            if (res.ok) {
                setSelectedIds(new Set());
                setSelectMode(false);
                handleRefresh();
            } else {
                alert("批量删除失败");
            }
        } catch (err) {
            console.error("Batch delete failed", err);
            alert("批量删除失败: " + err.message);
        }
    };

    const handleBatchShare = async (isShared) => {
        if (selectedIds.size === 0) return;

        const token = localStorage.getItem('token');
        const endpoint = activeTab === 'images'
            ? '/api/v1/gallery/images/batch-share'
            : '/api/v1/gallery/videos/batch-share';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ids: Array.from(selectedIds), is_shared: isShared })
            });

            if (res.ok) {
                setSelectedIds(new Set());
                setSelectMode(false);
                handleRefresh();
            } else {
                alert(`批量${isShared ? '分享' : '取消分享'}失败`);
            }
        } catch (err) {
            console.error("Batch share failed", err);
        }
    };

    const handleBatchDownload = async () => {
        if (selectedIds.size === 0) return;

        // 获取当前选中的项目
        const items = activeTab === 'images' ? images : videos;
        const selectedItems = items.filter(item => selectedIds.has(item.id));

        if (selectedItems.length === 0) {
            alert("没有找到选中的文件");
            return;
        }

        const total = selectedItems.length;
        setDownloadToast({ current: 0, total, status: 'downloading' });

        // 批量单文件下载 - 逐个触发下载
        let downloadCount = 0;
        const downloadDelay = 300; // 每个文件之间延迟 300ms，避免浏览器阻止

        for (const item of selectedItems) {
            const downloadUrl = activeTab === 'images' ? item.url : item.result_url;

            if (!downloadUrl) {
                console.warn(`Item ${item.id} has no download URL`);
                continue;
            }

            // 创建隐藏的 a 标签触发下载
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = ''; // 让浏览器使用默认文件名
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            downloadCount++;
            setDownloadToast({ current: downloadCount, total, status: 'downloading' });

            // 延迟触发下一个下载
            if (downloadCount < selectedItems.length) {
                await new Promise(resolve => setTimeout(resolve, downloadDelay));
            }
        }

        // 下载完成提示
        setDownloadToast({ current: downloadCount, total, status: 'done' });
        setTimeout(() => setDownloadToast(null), 2000);
    };


    const handleDelete = async (e, item, type) => {
        e.stopPropagation();
        if (!window.confirm("确定要删除吗？")) return;

        const token = localStorage.getItem('token');
        const url = type === 'image'
            ? `/api/v1/gallery/images/${item.id}`
            : `/api/v1/queue/${item.id}`;

        try {
            const res = await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                if (type === 'image') fetchImages();
                else fetchVideos();
            } else {
                alert("删除失败");
            }
        } catch (err) {
            console.error(err);
            alert("删除请求错误");
        }
    };

    const handleToggleShare = async (e, item, type) => {
        e.stopPropagation();
        const token = localStorage.getItem('token');
        const url = type === 'image'
            ? `/api/v1/gallery/images/${item.id}/share`
            : `/api/v1/gallery/videos/${item.id}/share`;

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                if (type === 'image') fetchImages();
                else fetchVideos();
            } else {
                alert("分享状态切换失败");
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleSelectForVideoAndClose = useCallback((imgUrl, prompt, category) => {
        onSelectForVideo(imgUrl, prompt, category);
        onClose();
    }, [onSelectForVideo, onClose]);

    const totalPagesImg = Math.ceil(totalImages / LIMIT);
    const totalPagesVid = Math.ceil(totalVideos / LIMIT);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="floating-gallery-backdrop" onClick={onClose} />

            {/* Drawer */}
            <div className={`floating-gallery-drawer ${isOpen ? 'open' : ''}`}>
                {/* Header */}
                <div className="fg-header">
                    <div className="fg-title">
                        <span className="fg-title-icon">🖼️</span>
                        <h2>创意画廊</h2>
                    </div>
                    <button className="fg-close-btn" onClick={onClose} title="关闭">
                        ✕
                    </button>
                </div>

                {/* Tabs */}
                <div className="fg-tabs">
                    <button
                        className={`fg-tab ${activeTab === 'images' ? 'active' : ''}`}
                        onClick={() => setActiveTab('images')}
                    >
                        🎨 图片
                    </button>
                    <button
                        className={`fg-tab ${activeTab === 'videos' ? 'active' : ''}`}
                        onClick={() => setActiveTab('videos')}
                    >
                        🎬 视频
                    </button>
                </div>

                {/* Search Bar */}
                <div className="fg-search-bar">
                    <span className="fg-search-icon">🔍</span>
                    <input
                        type="text"
                        placeholder="搜索提示词..."
                        value={searchQuery}
                        onChange={(e) => { setSearchQuery(e.target.value); setImgPage(1); setVidPage(1); }}
                        className="fg-search-input"
                    />
                    {searchQuery && (
                        <button
                            className="fg-search-clear"
                            onClick={() => { setSearchQuery(''); setImgPage(1); setVidPage(1); }}
                        >
                            ✕
                        </button>
                    )}
                </div>

                {/* Filters */}
                <div className="fg-filters">
                    <div className="fg-filter-group">
                        <label className="fg-filter-label">品类</label>
                        <select
                            value={categoryFilter}
                            onChange={(e) => { setCategoryFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                            className="fg-select"
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat.value} value={cat.value}>
                                    {cat.icon} {cat.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {userRole === 'admin' && (
                        <div className="fg-filter-group">
                            <label className="fg-filter-label">视角</label>
                            <select
                                value={viewMode === 'user' ? `user_${selectedUserId}` : viewMode}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === 'own' || val === 'all') {
                                        setViewMode(val);
                                        setSelectedUserId(null);
                                    } else if (val.startsWith('user_')) {
                                        const userId = parseInt(val.replace('user_', ''), 10);
                                        setViewMode('user');
                                        setSelectedUserId(userId);
                                    }
                                    setImgPage(1);
                                    setVidPage(1);
                                }}
                                className="fg-select"
                            >
                                <option value="own">📁 我的</option>
                                <option value="all">🌐 全部</option>
                                <optgroup label="👤 指定用户">
                                    {userList.map(u => (
                                        <option key={u.id} value={`user_${u.id}`}>
                                            {u.username} {u.role === 'admin' ? '👑' : ''}
                                        </option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>
                    )}

                    <div className="fg-filter-group">
                        <label className="fg-filter-label">时间</label>
                        <select
                            value={dateFilter}
                            onChange={(e) => { setDateFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                            className="fg-select"
                        >
                            <option value="all">📅 全部</option>
                            <option value="today">今日</option>
                            <option value="week">近7天</option>
                            <option value="month">近30天</option>
                            <option value="custom">自定义</option>
                        </select>
                    </div>

                    {userRole === 'admin' && (
                        <div className="fg-filter-group">
                            <label className="fg-filter-label">状态</label>
                            <select
                                value={shareFilter}
                                onChange={(e) => { setShareFilter(e.target.value); setImgPage(1); setVidPage(1); }}
                                className="fg-select"
                            >
                                <option value="all">🔗 全部</option>
                                <option value="shared">🌐 已公开</option>
                                <option value="private">🔒 私有</option>
                            </select>
                        </div>
                    )}

                    {/* Custom Date Range */}
                    {dateFilter === 'custom' && (
                        <div className="fg-date-range">
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="fg-date-input"
                            />
                            <span className="fg-date-separator">~</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="fg-date-input"
                            />
                        </div>
                    )}

                    <div className="fg-filter-actions">
                        <button onClick={handleRefresh} className="fg-icon-btn" title="刷新">
                            🔄
                        </button>

                        {userRole === 'admin' && (
                            <button
                                onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}
                                className={`fg-icon-btn ${selectMode ? 'active' : ''}`}
                                title={selectMode ? "退出选择" : "批量管理"}
                            >
                                {selectMode ? '✕' : '☑️'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="fg-stats">
                    <span className="fg-stats-count">
                        共 <strong>{activeTab === 'images' ? totalImages : totalVideos}</strong> 项
                    </span>
                    {selectedIds.size > 0 && (
                        <span className="fg-stats-selected">
                            · 已选 <strong>{selectedIds.size}</strong> 项
                        </span>
                    )}
                </div>


                {/* Batch Actions */}
                {selectMode && userRole === 'admin' && (
                    <div className="fg-batch-actions">
                        <button onClick={toggleSelectAll} className="fg-batch-btn">
                            {selectedIds.size === (activeTab === 'images' ? images.length : videos.length) ? '🚫 取消全选' : '✅ 全选'}
                        </button>
                        <button onClick={handleBatchDownload} className="fg-batch-btn" disabled={selectedIds.size === 0}>
                            📦 下载 ({selectedIds.size})
                        </button>
                        <button
                            onClick={() => handleBatchShare(true)}
                            className="fg-batch-btn share"
                            disabled={selectedIds.size === 0}
                        >
                            🔗 公开 ({selectedIds.size})
                        </button>
                        <button
                            onClick={() => handleBatchShare(false)}
                            className="fg-batch-btn"
                            disabled={selectedIds.size === 0}
                        >
                            🔒 私有
                        </button>
                        <button
                            onClick={handleBatchDelete}
                            className="fg-batch-btn delete"
                            disabled={selectedIds.size === 0}
                        >
                            🗑️ 删除
                        </button>
                    </div>
                )}

                {/* Content */}
                <div className="fg-content">
                    {loading && (
                        <div className="fg-loading">
                            <div className="fg-spinner"></div>
                        </div>
                    )}

                    {/* Images Grid */}
                    {activeTab === 'images' && !loading && (
                        <>
                            {images.length === 0 ? (
                                <div className="fg-empty">
                                    <span className="fg-empty-icon">🖼️</span>
                                    <p>暂无图片</p>
                                </div>
                            ) : (
                                <div className="fg-grid">
                                    {images.map((img) => (
                                        <ImageCard
                                            key={img.id}
                                            img={img}
                                            selectMode={selectMode}
                                            isSelected={selectedIds.has(img.id)}
                                            onSelect={toggleSelect}
                                            onView={setSelectedImage}
                                            onSelectForVideo={onSelectForVideo}
                                            onToggleShare={handleToggleShare}
                                            onDelete={handleDelete}
                                            userRole={userRole}
                                            currentUserId={currentUserId}
                                            categories={CATEGORIES}
                                            handleSelectForVideoAndClose={onSelectForVideo ? handleSelectForVideoAndClose : null}
                                        />
                                    ))}

                                </div>
                            )}
                        </>
                    )}

                    {/* Videos Grid */}
                    {activeTab === 'videos' && !loading && (
                        <>
                            {videos.length === 0 ? (
                                <div className="fg-empty">
                                    <span className="fg-empty-icon">🎬</span>
                                    <p>暂无视频</p>
                                </div>
                            ) : (
                                <div className="fg-grid">
                                    {videos.map((vid) => (
                                        <VideoCard
                                            key={vid.id}
                                            vid={vid}
                                            selectMode={selectMode}
                                            isSelected={selectedIds.has(vid.id)}
                                            onSelect={toggleSelect}
                                            onView={setSelectedVideo}
                                            onToggleShare={handleToggleShare}
                                            onDelete={handleDelete}
                                            userRole={userRole}
                                            currentUserId={currentUserId}
                                            categories={CATEGORIES}
                                        />
                                    ))}

                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Pagination */}
                <div className="fg-pagination">
                    {activeTab === 'images' ? (
                        <>
                            <button
                                onClick={() => setImgPage(p => Math.max(1, p - 1))}
                                disabled={imgPage === 1 || loading}
                                className="fg-page-btn"
                            >
                                ← 上一页
                            </button>
                            <span className="fg-page-info">
                                {imgPage} / {totalPagesImg || 1}
                            </span>
                            <button
                                onClick={() => setImgPage(p => p + 1)}
                                disabled={images.length < LIMIT || imgPage >= totalPagesImg || loading}
                                className="fg-page-btn"
                            >
                                下一页 →
                            </button>
                            {/* 页码跳转 */}
                            <div className="fg-page-jump">
                                <span className="fg-page-jump-label">跳至</span>
                                <input
                                    type="number"
                                    min="1"
                                    max={totalPagesImg || 1}
                                    className="fg-page-jump-input"
                                    placeholder="页码"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const page = parseInt(e.target.value, 10);
                                            if (page >= 1 && page <= (totalPagesImg || 1)) {
                                                setImgPage(page);
                                                e.target.value = '';
                                            }
                                        }
                                    }}
                                />
                                <span className="fg-page-jump-label">页</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setVidPage(p => Math.max(1, p - 1))}
                                disabled={vidPage === 1 || loading}
                                className="fg-page-btn"
                            >
                                ← 上一页
                            </button>
                            <span className="fg-page-info">
                                {vidPage} / {totalPagesVid || 1}
                            </span>
                            <button
                                onClick={() => setVidPage(p => p + 1)}
                                disabled={videos.length < LIMIT || vidPage >= totalPagesVid || loading}
                                className="fg-page-btn"
                            >
                                下一页 →
                            </button>
                            {/* 页码跳转 */}
                            <div className="fg-page-jump">
                                <span className="fg-page-jump-label">跳至</span>
                                <input
                                    type="number"
                                    min="1"
                                    max={totalPagesVid || 1}
                                    className="fg-page-jump-input"
                                    placeholder="页码"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const page = parseInt(e.target.value, 10);
                                            if (page >= 1 && page <= (totalPagesVid || 1)) {
                                                setVidPage(page);
                                                e.target.value = '';
                                            }
                                        }
                                    }}
                                />
                                <span className="fg-page-jump-label">页</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Image Lightbox */}
            {selectedImage && (
                <div className="fg-lightbox" onClick={() => setSelectedImage(null)}>
                    <div className="fg-lightbox-content" onClick={e => e.stopPropagation()}>
                        <img src={selectedImage.url} alt="" className="fg-lightbox-img" />
                        <div className="fg-lightbox-info">
                            <p className="fg-lightbox-prompt">{selectedImage.prompt || '无提示词'}</p>
                            <div className="fg-lightbox-meta">
                                <span>👤 {selectedImage.username || '未知'}</span>
                                <span>🕐 {formatBeijingTime(selectedImage.created_at)}</span>
                            </div>
                            <div className="fg-lightbox-actions">
                                {onSelectForVideo && (
                                    <button
                                        className="fg-lb-btn primary"
                                        onClick={() => handleSelectForVideoAndClose(selectedImage.url, selectedImage.prompt, selectedImage.category)}
                                    >
                                        🎬 转为视频
                                    </button>
                                )}
                                <a href={selectedImage.url} download target="_blank" rel="noreferrer" className="fg-lb-btn">
                                    ⬇️ 下载
                                </a>
                                <button className="fg-lb-btn close" onClick={() => setSelectedImage(null)}>
                                    ✕ 关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Video Lightbox — Memoized, isolated from gallery state */}
            <VideoLightbox
                video={selectedVideo}
                onClose={() => setSelectedVideo(null)}
                reviewDetails={reviewDetails}
                loadingReview={loadingReview}
                videoError={videoError}
                onVideoError={() => setVideoError(true)}
                onDelete={handleDelete}
                onToggleShare={handleToggleShare}
                userRole={userRole}
                currentUserId={currentUserId}
            />

            {/* Download Progress Toast */}
            {downloadToast && (
                <div className={`fg-toast ${downloadToast.status}`}>
                    <div className="fg-toast-content">
                        {downloadToast.status === 'downloading' ? (
                            <>
                                <span className="fg-toast-icon">⬇️</span>
                                <span className="fg-toast-text">
                                    下载中 {downloadToast.current}/{downloadToast.total}
                                </span>
                                <div className="fg-toast-progress">
                                    <div
                                        className="fg-toast-progress-bar"
                                        style={{ width: `${(downloadToast.current / downloadToast.total) * 100}%` }}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <span className="fg-toast-icon">✅</span>
                                <span className="fg-toast-text">
                                    已完成 {downloadToast.total} 个文件下载
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default memo(FloatingGallery);
