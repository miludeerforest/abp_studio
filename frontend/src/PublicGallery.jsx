import React, { useState, useEffect, useRef } from 'react';
import './PublicGallery.css';

const PublicGallery = ({ onLoginClick, siteConfig }) => {
    const [videos, setVideos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [videoError, setVideoError] = useState(false);
    const loadedIdsRef = useRef(new Set());
    const offsetRef = useRef(0);
    const LIMIT = 12; // Reduced for better lazy loading performance

    useEffect(() => {
        fetchVideos();
    }, []);

    const fetchVideos = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/public/videos?limit=${LIMIT}&offset=${offsetRef.current}`);
            if (res.ok) {
                const data = await res.json();
                if (data.items.length < LIMIT) {
                    setHasMore(false);
                }
                // Deduplicate videos using ref
                const newVideos = data.items.filter(vid => !loadedIdsRef.current.has(vid.id));
                if (newVideos.length > 0) {
                    newVideos.forEach(vid => loadedIdsRef.current.add(vid.id));
                    setVideos(prev => [...prev, ...newVideos]);
                    offsetRef.current += data.items.length;
                }
            }
        } catch (err) {
            console.error("Failed to fetch public videos", err);
        } finally {
            setLoading(false);
        }
    };

    // Use window scroll event for infinite loading
    useEffect(() => {
        const handleScroll = () => {
            // Check if near bottom of page
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const scrollHeight = document.documentElement.scrollHeight;
            const clientHeight = window.innerHeight;

            if (scrollHeight - scrollTop <= clientHeight * 1.5 && !loading && hasMore) {
                fetchVideos();
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [loading, hasMore]);

    return (
        <div className="public-gallery">
            {/* Header */}
            <header className="public-header">
                <div className="public-logo">
                    <span className="logo-icon">🍌</span>
                    <span className="logo-text">{siteConfig?.site_title || 'BNP Studio'}</span>
                </div>
                <button className="login-btn" onClick={onLoginClick}>
                    Log in
                </button>
            </header>

            {/* Video Grid - Masonry Layout */}
            <div className="masonry-grid">
                {videos.map((vid, index) => (
                    <VideoCard
                        key={vid.id}
                        video={vid}
                        onClick={() => { setVideoError(false); setSelectedVideo(vid); }}
                    />
                ))}
            </div>

            {loading && (
                <div className="loading-indicator">
                    <div className="spinner"></div>
                </div>
            )}

            {/* Video Lightbox */}
            {selectedVideo && (
                <div className="public-lightbox" onClick={() => setSelectedVideo(null)}>
                    <div className="lightbox-content" onClick={e => e.stopPropagation()}>
                        {videoError ? (
                            <div className="video-expired-placeholder">
                                <div className="expired-icon">⏰</div>
                                <div className="expired-title">视频链接已过期</div>
                                <div className="expired-desc">外部视频资源已失效</div>
                            </div>
                        ) : (
                            <video
                                src={selectedVideo.result_url}
                                controls
                                autoPlay
                                className="lightbox-video"
                                onError={() => setVideoError(true)}
                            />
                        )}
                        <div className="lightbox-info">
                            <span className="creator-badge">👤 {selectedVideo.username}</span>
                            <p className="video-prompt">{selectedVideo.prompt}</p>
                        </div>
                        <button className="close-btn" onClick={() => setSelectedVideo(null)}>✕</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Video Card Component with hover play and lazy loading
const VideoCard = ({ video, onClick }) => {
    const videoRef = useRef(null);
    const cardRef = useRef(null);
    const [isHovered, setIsHovered] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [posterLoaded, setPosterLoaded] = useState(false);

    // Intersection Observer for lazy loading
    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect(); // Stop observing once visible
                }
            },
            {
                rootMargin: '100px', // Start loading 100px before entering viewport
                threshold: 0.01
            }
        );

        if (cardRef.current) {
            observer.observe(cardRef.current);
        }

        return () => observer.disconnect();
    }, []);

    const handleMouseEnter = () => {
        setIsHovered(true);
        if (videoRef.current && isVisible) {
            videoRef.current.play().catch(() => { });
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    };

    return (
        <div
            ref={cardRef}
            className="video-card"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={onClick}
        >
            {(video.is_merged || video.prompt?.includes('Story Chain') || video.prompt?.includes('Story Fission') || video.filename?.includes('story_chain') || video.filename?.includes('story_fission')) && (
                <span className="merged-badge">✨ 合成</span>
            )}
            {isVisible ? (
                <>
                    {/* Show poster image first for faster perceived load */}
                    {!posterLoaded && video.preview_url && (
                        <img
                            src={video.preview_url}
                            alt=""
                            className="card-video"
                            loading="lazy"
                        />
                    )}
                    <video
                        ref={videoRef}
                        src={video.result_url}
                        poster={video.preview_url || undefined}
                        muted
                        loop
                        playsInline
                        preload="none"
                        className="card-video"
                        style={!posterLoaded && video.preview_url ? { position: 'absolute', opacity: 0 } : {}}
                        onLoadedData={() => setPosterLoaded(true)}
                    />
                </>
            ) : (
                // Placeholder before visible - use poster image with lazy loading
                <img
                    src={video.preview_url || '/placeholder-video.png'}
                    alt=""
                    className="card-video"
                    loading="lazy"
                />
            )}
            <div className="card-overlay">
                <div className="creator-tag">
                    {video.avatar ? (
                        <img src={video.avatar} alt="" className="creator-avatar" />
                    ) : (
                        <span className="creator-icon">👤</span>
                    )}
                    <span className="creator-name">{video.username}</span>
                </div>
            </div>
            {!isHovered && (
                <div className="play-icon">▶</div>
            )}
        </div>
    );
};

export default PublicGallery;
