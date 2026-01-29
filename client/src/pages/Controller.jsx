import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import geckos from '@geckos.io/client';
import { getServerConfig } from '../config/network';

export default function Controller() {
    const { roomId, token } = useParams();
    const [joinError, setJoinError] = useState(null);
    const [channel, setChannel] = useState(null);
    const [connected, setConnected] = useState(false);
    const [joined, setJoined] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [pullBack, setPullBack] = useState({ x: 0, y: 0 });
    const [power, setPower] = useState(0);
    const [lastResult, setLastResult] = useState(null);
    const [gyroEnabled, setGyroEnabled] = useState(false);
    const [needsGyroPermission, setNeedsGyroPermission] = useState(false);
    const [aimPosition, setAimPosition] = useState({ x: 50, y: 50 });
    const [targetedOrb, setTargetedOrb] = useState(null); // 'A', 'B', 'C', or 'D'

    const slingshotRef = useRef(null);
    const ballRef = useRef(null);
    const channelRef = useRef(null);
    const connectedRef = useRef(false);
    const gyroListenerRef = useRef(null);

    useEffect(() => {
        const { geckosUrl, geckosPort, geckosPath } = getServerConfig();

        // Set timeout to detect hanging handshakes
        const handshakeTimeout = setTimeout(() => {
            if (!connectedRef.current) {
                console.error('[CONTROLLER] Handshake timeout - possible issues:');
                console.error('  - WebRTC data channel never opened (check for "🎮 data channel open")');
                console.error('  - ICE negotiation failed (network blocking WebRTC)');
                console.error('  - Server not responding to joinRoom event');
                console.error('  - CORS or mixed-content issues');
                console.error('  - STUN/TURN servers unreachable');
            }
        }, 15000); // 15 second timeout

        // Connect using configured mode (direct or proxy)
        const io = geckos({
            url: geckosUrl,
            port: geckosPort,
            ...(geckosPath && { path: geckosPath }),
            iceServers: [
                { urls: 'stun:stun.metered.ca:80' },
                {
                    urls: 'turn:global.relay.metered.ca:443',
                    username: 'admin',
                    credential: 'admin'
                }
            ]
        });
        channelRef.current = io;

        io.onConnect((error) => {
            if (error) {
                console.error('Connection error:', error);
                clearTimeout(handshakeTimeout);
                return;
            }
            console.log('Connected to server');
            connectedRef.current = true;
            setConnected(true); // Fix: Update React state
            setChannel(io);
            if (roomId && token) {
                io.emit('joinRoom', { roomId, token });
            }
        });

        io.on('open', () => {
            console.log('🎮 data channel open');
            clearTimeout(handshakeTimeout);
        });

        io.on('joinedRoom', (data) => {
            if (data.success) {
                setJoined(true);
                setJoinError(null);
                console.log('Joined room:', data.roomId);
            } else {
                console.error('Failed to join room:', data.error);
                setJoinError(data.error);
            }
        });

        io.on('hitResult', (data) => {
            setLastResult(data);
            if (navigator.vibrate) {
                navigator.vibrate(data.correct ? [50, 50, 50] : [200]);
            }
            setTimeout(() => setLastResult(null), 2000);
        });

        return () => {
            clearTimeout(handshakeTimeout);
            if (connectedRef.current && channelRef.current) {
                try {
                    channelRef.current.close();
                } catch (e) { }
            }
            connectedRef.current = false;
        };
    }, [roomId]);

    useEffect(() => {
        if (typeof DeviceOrientationEvent !== 'undefined') {
            setNeedsGyroPermission(true);
        }
    }, []);

    const requestGyroPermission = async () => {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission !== 'granted') {
                    alert('Motion permission denied. Please enable in Settings > Safari > Motion & Orientation Access');
                    return;
                }
            } catch (e) {
                console.log('Gyro permission error:', e);
            }
        }

        let gyroWorking = false;
        const testHandler = (e) => {
            if (e.gamma !== null || e.beta !== null) {
                gyroWorking = true;
            }
        };

        window.addEventListener('deviceorientation', testHandler);
        await new Promise(resolve => setTimeout(resolve, 500));
        window.removeEventListener('deviceorientation', testHandler);

        if (gyroWorking) {
            setGyroEnabled(true);
            setNeedsGyroPermission(false);
            if (navigator.vibrate) navigator.vibrate(50);
        } else {
            const isHTTP = window.location.protocol === 'http:';
            if (isHTTP) {
                alert('Gyro requires HTTPS. On your phone browser:\\n\\n1. Go to chrome://flags\\n2. Search "Insecure origins treated as secure"\\n3. Add: http://' + window.location.host + '\\n4. Restart browser');
            } else {
                alert('Gyroscope not available on this device. Using touch-only mode.');
            }
            needsGyroPermission && setNeedsGyroPermission(false);
            setGyroEnabled(false);
        }
    };

    // Gyro handler with calibration and smoothing
    useEffect(() => {
        if (!isDragging || !gyroEnabled) {
            if (gyroListenerRef.current) {
                window.removeEventListener('deviceorientation', gyroListenerRef.current);
                gyroListenerRef.current = null;
            }
            return;
        }

        const orbPositions = [
            { id: 'A', x: 15, y: 55 },
            { id: 'B', x: 40, y: 70 },
            { id: 'C', x: 60, y: 55 },
            { id: 'D', x: 80, y: 70 },
        ];

        let lastOrb = null;

        // Calibration: capture initial orientation when aiming starts
        let initialBeta = null;
        let initialGamma = null;
        let smoothX = 50;
        let smoothY = 50;
        const smoothingFactor = 0.3; // Lower = smoother but more lag, Higher = responsive but jittery

        // Sensitivity: how many degrees of tilt = full range (0-100%)
        const gammaRange = 30; // ±30 degrees for full horizontal range
        const betaRange = 25;  // ±25 degrees for full vertical range

        const handleOrientation = (event) => {
            const { beta, gamma } = event;
            if (beta === null || gamma === null) return;

            // Calibrate on first reading - this becomes "center"
            if (initialBeta === null) {
                initialBeta = beta;
                initialGamma = gamma;
                return;
            }

            // Calculate relative movement from initial position
            const deltaGamma = gamma - initialGamma;
            const deltaBeta = beta - initialBeta;

            // Map relative movement to 0-100 range
            // Tilt right (positive gamma) = crosshair right (higher x)
            // Tilt forward/down (higher beta) = crosshair up (lower y for screen coords)
            const rawX = 50 + (deltaGamma / gammaRange) * 50;
            const rawY = 50 - (deltaBeta / betaRange) * 50;

            // Apply smoothing to reduce jitter
            smoothX = smoothX + (rawX - smoothX) * smoothingFactor;
            smoothY = smoothY + (rawY - smoothY) * smoothingFactor;

            // Clamp to valid range
            const x = Math.max(0, Math.min(100, smoothX));
            const y = Math.max(0, Math.min(100, smoothY));

            setAimPosition({ x, y });

            let currentOrb = null;
            for (const orb of orbPositions) {
                const dist = Math.sqrt(Math.pow(x - orb.x, 2) + Math.pow(y - orb.y, 2));
                if (dist < 12) {
                    currentOrb = orb.id;
                    break;
                }
            }

            if (currentOrb !== lastOrb) {
                lastOrb = currentOrb;
                if (channelRef.current) {
                    channelRef.current.emit('targeting', { orbId: currentOrb });
                }
            }

            if (channelRef.current) {
                channelRef.current.emit('crosshair', { x, y }, { reliable: false });
            }
        };

        gyroListenerRef.current = handleOrientation;
        window.addEventListener('deviceorientation', handleOrientation);

        if (channelRef.current) {
            channelRef.current.emit('startAiming', { gyroEnabled: true });
        }

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation);
            if (channelRef.current) {
                channelRef.current.emit('cancelAiming', {});
            }
        };
    }, [isDragging, gyroEnabled]);

    const handleStart = (e) => {
        e.preventDefault();
        setIsDragging(true);
        setAimPosition({ x: 50, y: 50 });
        if (navigator.vibrate) navigator.vibrate(30);
    };

    const handleMove = (e) => {
        if (!isDragging || !slingshotRef.current) return;

        const rect = slingshotRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let clientX, clientY;
        if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        let dx = centerX - clientX;
        let dy = centerY - clientY;

        // 180-degree restriction: Only allow pulling DOWN (aiming up)
        if (dy > 0) dy = 0;

        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = 100;
        const clampedDistance = Math.min(distance, maxDistance);
        const angle = Math.atan2(dy, dx);

        const pullX = -Math.cos(angle) * clampedDistance;
        const pullY = -Math.sin(angle) * clampedDistance;

        setPullBack({ x: pullX, y: pullY });
        setPower((clampedDistance / maxDistance) * 100);

        if (!gyroEnabled && clampedDistance > 20) {
            const shootAngle = Math.atan2(-pullY, -pullX);
            let degrees = (shootAngle * 180 / Math.PI + 360) % 360;

            const orbLabels = ['A', 'B', 'C', 'D'];
            let orbIndex;
            // Precise 4-segment mapping (180° - 360°)
            // Segment 1: 180-225 (A), 2: 225-270 (B), 3: 270-315 (C), 4: 315-360/0-45 (D)
            if (degrees >= 180 && degrees < 225) {
                orbIndex = 0;
            } else if (degrees >= 225 && degrees < 270) {
                orbIndex = 1;
            } else if (degrees >= 270 && degrees < 315) {
                orbIndex = 2;
            } else {
                orbIndex = 3;
            }

            const newTarget = orbLabels[orbIndex];
            if (newTarget !== targetedOrb) {
                setTargetedOrb(newTarget);
                if (channelRef.current) {
                    channelRef.current.emit('targeting', { orbId: newTarget });
                }
            }
        }
    };

    const handleEnd = () => {
        if (!isDragging) return;
        setIsDragging(false);

        if (power > 10 && channelRef.current) {
            let targetXPercent, targetYPercent;

            if (gyroEnabled) {
                // Use gyro position (already in percentages)
                targetXPercent = aimPosition.x;
                targetYPercent = aimPosition.y;
            } else {
                // Use slingshot direction to target specific orb
                const orbPositions = [
                    { x: 15, y: 55 }, // A
                    { x: 40, y: 70 }, // B
                    { x: 60, y: 55 }, // C
                    { x: 80, y: 70 }, // D
                ];

                const shootAngle = Math.atan2(-pullBack.y, -pullBack.x);
                let degrees = (shootAngle * 180 / Math.PI + 360) % 360;

                let orbIndex;
                if (degrees >= 180 && degrees < 225) {
                    orbIndex = 0;
                } else if (degrees >= 225 && degrees < 270) {
                    orbIndex = 1;
                } else if (degrees >= 270 && degrees < 315) {
                    orbIndex = 2;
                } else {
                    orbIndex = 3;
                }

                targetXPercent = orbPositions[orbIndex].x;
                targetYPercent = orbPositions[orbIndex].y;
            }

            channelRef.current.emit('shoot', {
                targetXPercent,
                targetYPercent,
                power: power / 100,
                isTargetedShot: !gyroEnabled
            });
            if (navigator.vibrate) navigator.vibrate(50);
        } else {
            if (channelRef.current) channelRef.current.emit('cancelAiming', {});
        }

        setPullBack({ x: 0, y: 0 });
        setPower(0);
        setTargetedOrb(null);
    };

    const handleExit = () => {
        if (window.confirm('Are you sure you want to exit?')) {
            if (channelRef.current) channelRef.current.close();
            window.location.href = window.location.origin;
        }
    };

    if (!connected) {
        return <div className="controller-container"><div className="waiting-screen"><div className="pulse-ring" /><h2 className="waiting-title">Connecting...</h2></div></div>;
    }

    if (joinError) {
        return (
            <div className="controller-container">
                <div className="waiting-screen">
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                    <h2 className="waiting-title" style={{ color: '#f87171' }}>Access Denied</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{joinError}</p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{ marginTop: '2rem', padding: '0.75rem 1.5rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', color: 'white', cursor: 'pointer' }}
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (!joined) {
        return <div className="controller-container"><div className="waiting-screen"><div className="pulse-ring" /><h2 className="waiting-title">Joining Room {roomId}...</h2></div></div>;
    }

    if (needsGyroPermission && !gyroEnabled) {
        return (
            <div className="controller-container" style={{ background: 'linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 100%)', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '2rem' }}>
                <div style={{ maxWidth: '300px' }}>
                    <div style={{ width: '80px', height: '80px', margin: '0 auto 1.5rem', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem' }}>📱</div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>Enable Motion Control</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>Allows gyroscope aiming. Tap to enable.</p>
                    <button onClick={requestGyroPermission} style={{ width: '100%', padding: '1rem 2rem', fontSize: '1.125rem', fontWeight: 600, background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', border: 'none', borderRadius: '12px', color: 'white', cursor: 'pointer', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)' }}>🎯 Enable & Play</button>
                    <button onClick={() => { setNeedsGyroPermission(false); setGyroEnabled(false); }} style={{ marginTop: '1rem', background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>Skip (Touch Only)</button>
                </div>
            </div>
        );
    }

    return (
        <div className="controller-container" onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd} onTouchMove={handleMove} onTouchEnd={handleEnd}>
            <header className="controller-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <p className={`controller-status ${joined ? 'connected' : ''}`} style={{ margin: 0 }}>{joined ? '● Connected' : 'Connecting...'}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>Room: {roomId} {gyroEnabled ? '📱 Gyro ON' : ''}</p>
                </div>

                <button
                    onClick={handleExit}
                    style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        padding: '0.5rem 1rem',
                        color: '#f87171',
                        fontWeight: '600',
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                        backdropFilter: 'blur(5px)'
                    }}
                >
                    Exit
                </button>
            </header>


            {lastResult && (
                <div style={{ position: 'absolute', top: '25%', left: '50%', transform: 'translateX(-50%)', fontSize: '2.5rem', fontWeight: 700, color: lastResult.correct ? 'var(--accent-success)' : 'var(--accent-error)', textShadow: lastResult.correct ? '0 0 20px var(--accent-success)' : '0 0 20px var(--accent-error)', animation: 'pulse 0.5s ease-out', zIndex: 100 }}>
                    {lastResult.correct ? '✓ +100' : '✗ Miss!'}
                </div>
            )}

            {isDragging && (
                <div style={{ position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
                    {gyroEnabled ? (
                        <div style={{ width: '80px', height: '80px', border: '3px solid var(--accent-primary)', borderRadius: '50%', position: 'relative', margin: '0 auto', boxShadow: '0 0 20px var(--accent-primary)' }}>
                            <div style={{ width: '14px', height: '14px', background: '#ef4444', borderRadius: '50%', position: 'absolute', left: `${aimPosition.x}%`, top: `${aimPosition.y}%`, transform: 'translate(-50%, -50%)', boxShadow: '0 0 15px #ef4444' }} />
                        </div>
                    ) : (
                        <div style={{ width: '100px', height: '100px', background: targetedOrb ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'rgba(255,255,255,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', boxShadow: targetedOrb ? '0 0 30px var(--accent-primary)' : 'none', transition: 'all 0.1s ease' }}>
                            <span style={{ fontSize: '3rem', fontWeight: 700, color: 'white' }}>{targetedOrb || '?'}</span>
                        </div>
                    )}
                    <p style={{ color: 'var(--accent-primary)', fontSize: '1rem', marginTop: '0.75rem', fontWeight: 600 }}>{gyroEnabled ? 'Tilt to aim!' : (targetedOrb ? `Targeting: ${targetedOrb}` : 'Pull further...')}</p>
                </div>
            )}

            <div className="slingshot-area" ref={slingshotRef}>
                <div className="slingshot-base">
                    {isDragging && power > 5 && (
                        <div className="aim-line" style={{ width: power * 2, transform: `rotate(${Math.atan2(-pullBack.y, -pullBack.x) * (180 / Math.PI)}deg)`, left: '50%', top: '50%' }} />
                    )}
                    <div ref={ballRef} className="slingshot-ball" style={{ transform: `translate(${pullBack.x}px, ${pullBack.y}px)`, transition: isDragging ? 'none' : 'transform 0.3s ease-out', boxShadow: isDragging ? '0 0 40px var(--accent-primary), 0 0 60px var(--accent-primary)' : '0 0 30px var(--accent-primary)' }} onMouseDown={handleStart} onTouchStart={handleStart} />
                </div>
            </div>

            <div className="power-indicator"><div className="power-fill" style={{ width: `${power}%` }} /></div>
            <p style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', textAlign: 'center' }}>{isDragging ? (gyroEnabled ? '🎯 Tilt phone to aim!' : '🎯 Target highlighted on wall!') : (gyroEnabled ? 'Pull + Tilt' : 'Pull to Target')}</p>
        </div>
    );
}
