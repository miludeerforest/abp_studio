import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * WebSocket Hook for real-time updates
 * 
 * Provides:
 * - Automatic connection management
 * - Reconnection on disconnect
 * - Message handling
 * - Ping/pong keepalive
 */
export function useWebSocket(token, options = {}) {
    const {
        onMessage,
        onConnect,
        onDisconnect,
        onError,
        reconnectInterval = 5000,
        pingInterval = 30000
    } = options;

    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState(null);
    const wsRef = useRef(null);
    const pingIntervalRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);

    // Use refs for callbacks to avoid recreating connect function
    const callbacksRef = useRef({ onMessage, onConnect, onDisconnect, onError });
    callbacksRef.current = { onMessage, onConnect, onDisconnect, onError };

    const connect = useCallback(() => {
        if (!token) return;

        // Don't reconnect if already connecting/connected
        if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
            return;
        }

        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${token}`;

        try {
            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
                callbacksRef.current.onConnect?.();

                // Start ping interval
                pingIntervalRef.current = setInterval(() => {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send('ping');
                    }
                }, pingInterval);
            };

            wsRef.current.onmessage = (event) => {
                // Ignore pong responses
                if (event.data === 'pong') return;

                try {
                    const data = JSON.parse(event.data);
                    setLastMessage(data);
                    callbacksRef.current.onMessage?.(data);
                } catch (e) {
                    console.warn('Invalid WebSocket message:', event.data);
                }
            };

            wsRef.current.onclose = (event) => {
                console.log('WebSocket disconnected:', event.code, event.reason);
                setIsConnected(false);
                callbacksRef.current.onDisconnect?.(event);

                // Clear ping interval
                if (pingIntervalRef.current) {
                    clearInterval(pingIntervalRef.current);
                    pingIntervalRef.current = null;
                }

                // Attempt reconnection (unless explicitly closed or auth failed)
                if (event.code !== 1000 && event.code !== 4001 && event.code !== 1005) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        console.log('Attempting WebSocket reconnection...');
                        connect();
                    }, reconnectInterval);
                }
            };

            wsRef.current.onerror = (error) => {
                console.error('WebSocket error:', error);
                callbacksRef.current.onError?.(error);
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            callbacksRef.current.onError?.(error);
        }
    }, [token, reconnectInterval, pingInterval]); // Only depend on stable values

    // Connect on mount / token change
    useEffect(() => {
        if (!token) return;

        connect();

        return () => {
            // Cleanup on unmount
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (pingIntervalRef.current) {
                clearInterval(pingIntervalRef.current);
                pingIntervalRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close(1000, 'Component unmounted');
                wsRef.current = null;
            }
        };
    }, [token]); // Only reconnect when token changes, not when connect changes

    // Send a message
    const send = useCallback((message) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            const data = typeof message === 'string' ? message : JSON.stringify(message);
            wsRef.current.send(data);
        } else {
            console.warn('WebSocket not connected, cannot send message');
        }
    }, []);

    // Update activity status (for admin monitoring)
    const updateActivity = useCallback((activity) => {
        send(`activity:${activity}`);
    }, [send]);

    // Manual disconnect
    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        if (wsRef.current) {
            wsRef.current.close(1000, 'Manual disconnect');
        }
    }, []);

    return {
        isConnected,
        lastMessage,
        send,
        updateActivity,
        disconnect,
        reconnect: connect
    };
}

/**
 * Hook for subscribing to specific message types
 */
export function useWebSocketEvent(lastMessage, eventType, callback) {
    useEffect(() => {
        if (lastMessage?.type === eventType) {
            callback(lastMessage.data);
        }
    }, [lastMessage, eventType, callback]);
}

export default useWebSocket;
