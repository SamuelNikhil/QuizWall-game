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
                    <h2 className="waiting-title" style={{ color: '#f87171', fontFamily: '"Courier New", monospace' }}>[ ACCESS_DENIED ]</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontFamily: '"Courier New", monospace' }}>ERR: {joinError}</p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: '2rem',
                            padding: '0.75rem 1.5rem',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid #ef4444',
                            borderRadius: '0',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontFamily: '"Courier New", monospace',
                            fontWeight: 'bold',
                            textTransform: 'uppercase'
                        }}
                    >
                        Re-Authenticate
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
            <div className="controller-container" style={{ background: 'radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '2rem' }}>
                <div style={{ maxWidth: '300px', border: '1px solid var(--accent-primary)', padding: '2rem', background: 'rgba(0,0,0,0.4)', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '-10px', left: '10px', background: '#0a0a0f', padding: '0 10px', color: var(--accent-primary), fontSize: '0.7rem', fontFamily: '"Courier New", monospace' }}>SENSORS_OFFLINE</div>
                    <div style={{ width: '80px', height: '80px', margin: '0 auto 1.5rem', background: 'rgba(0, 210, 255, 0.1)', border: '2px solid var(--accent-primary)', borderRadius: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem' }}>📡</div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '1rem', color: '#fff', fontFamily: '"Courier New", monospace', textTransform: 'uppercase' }}>Initialize Gyroscope</h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.4, fontSize: '0.9rem' }}>Required for precision aiming. Link hardware sensors now.</p>
                    <button onClick={requestGyroPermission} style={{ width: '100%', padding: '1rem', fontSize: '1rem', fontWeight: 'bold', background: 'var(--accent-primary)', border: 'none', borderRadius: '0', color: '#000', cursor: 'pointer', textTransform: 'uppercase', fontFamily: '"Courier New", monospace' }}>[ INITIALIZE ]</button>
                    <button onClick={() => { setNeedsGyroPermission(false); setGyroEnabled(false); }} style={{ marginTop: '1rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', fontFamily: '"Courier New", monospace' }}>Bypass (Touch Only)</button>
                </div>
            </div>
        );
    }

    return (
        <div className="controller-container" onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd} onTouchMove={handleMove} onTouchEnd={handleEnd}>
            <header className="controller-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', width: '100%', borderBottom: '2px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <p className={`controller-status ${joined ? 'connected' : ''}`} style={{ margin: 0, fontFamily: '"Courier New", monospace', fontSize: '0.9rem' }}>{joined ? 'SYS_LINK: ACTIVE' : 'SYS_LINK: PENDING'}</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', margin: 0, fontFamily: '"Courier New", monospace', opacity: 0.8 }}>ID: {roomId} // GYRO: {gyroEnabled ? 'ENABLED' : 'OFF'}</p>
                </div>

                <button
                    onClick={handleExit}
                    style={{
                        background: 'transparent',
                        border: '1px solid #ef4444',
                        borderRadius: '0',
                        padding: '0.4rem 0.8rem',
                        color: '#ef4444',
                        fontWeight: 'bold',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        fontFamily: '"Courier New", monospace',
                        textTransform: 'uppercase'
                    }}
                >
                    Terminate
                </button>
            </header>


            {lastResult && (
                <div style={{ position: 'absolute', top: '22%', left: '50%', transform: 'translateX(-50%)', fontSize: '2rem', fontWeight: 800, color: lastResult.correct ? '#10b981' : '#ef4444', fontFamily: '"Courier New", monospace', textShadow: lastResult.correct ? '0 0 15px #10b981' : '0 0 15px #ef4444', zIndex: 100, background: 'rgba(0,0,0,0.6)', padding: '0.5rem 1rem', border: `1px solid ${lastResult.correct ? '#10b981' : '#ef4444'}` }}>
                    {lastResult.correct ? '[ DATA_ACQUIRED ]' : '[ SIGNAL_LOST ]'}
                </div>
            )}

            {isDragging && (
                <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', width: '100%' }}>
                    {gyroEnabled ? (
                        <div style={{ width: '70px', height: '70px', border: '1px solid var(--accent-primary)', position: 'relative', margin: '0 auto', boxShadow: 'inset 0 0 15px rgba(0, 210, 255, 0.2)' }}>
                            <div style={{ position: 'absolute', top: '50%', left: '0', width: '100%', height: '1px', background: 'rgba(0, 210, 255, 0.3)' }} />
                            <div style={{ position: 'absolute', left: '50%', top: '0', height: '100%', width: '1px', background: 'rgba(0, 210, 255, 0.3)' }} />
                            <div style={{ width: '10px', height: '10px', background: '#ef4444', position: 'absolute', left: `${aimPosition.x}%`, top: `${aimPosition.y}%`, transform: 'translate(-50%, -50%)', boxShadow: '0 0 10px #ef4444' }} />
                        </div>
                    ) : (
                        <div style={{ width: '120px', height: '60px', background: targetedOrb ? 'rgba(0, 210, 255, 0.15)' : 'rgba(255,255,255,0.05)', border: `2px solid ${targetedOrb ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', transition: 'all 0.1s ease' }}>
                            <span style={{ fontSize: '2rem', fontWeight: 900, color: '#fff', fontFamily: '"Courier New", monospace' }}>{targetedOrb || '??'}</span>
                        </div>
                    )}
                    <p style={{ color: 'var(--accent-primary)', fontSize: '0.8rem', marginTop: '1rem', fontWeight: 'bold', fontFamily: '"Courier New", monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>
                        {gyroEnabled ? 'Target Locked: Auto-Aim' : (targetedOrb ? `Targeting Sector ${targetedOrb}` : 'Calculating Trajectory...')}
                    </p>
                </div>
            )}

            <div className="slingshot-area" ref={slingshotRef}>
                <div className="slingshot-base" style={{ border: '2px solid rgba(255,255,255,0.05)', borderRadius: '0', width: '220px', height: '220px' }}>
                    <div style={{ position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.2)', fontSize: '0.6rem', fontFamily: '"Courier New", monospace' }}>LAUNCH_STATION_01</div>
                    {isDragging && power > 5 && (
                        <div className="aim-line" style={{ height: '2px', background: 'var(--accent-primary)', width: power * 2, transform: `rotate(${Math.atan2(-pullBack.y, -pullBack.x) * (180 / Math.PI)}deg)`, left: '50%', top: '50%', opacity: 0.6 }} />
                    )}
                    <div ref={ballRef} className="slingshot-ball" style={{
                        borderRadius: '0',
                        width: '60px',
                        height: '60px',
                        background: '#1a1a2e',
                        border: '2px solid var(--accent-primary)',
                        transform: `translate(${pullBack.x}px, ${pullBack.y}px)`,
                        transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        boxShadow: isDragging ? '0 0 30px var(--accent-primary)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <div style={{ width: '40%', height: '40%', border: '1px solid var(--accent-primary)', opacity: 0.5 }} />
                    </div>
                </div>
            </div>

            <div className="power-indicator" style={{ borderRadius: '0', height: '20px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.5)' }}>
                <div className="power-fill" style={{ width: `${power}%`, borderRadius: '0', transition: 'width 0.05s ease' }} />
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '0.6rem', color: '#fff', mixBlendMode: 'difference', fontFamily: '"Courier New", monospace' }}>CHARGE: {Math.round(power)}%</div>
            </div>
            <p style={{ marginTop: '1.5rem', color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', textAlign: 'center', fontFamily: '"Courier New", monospace', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {isDragging ? '>> RELAYING COMMAND <<' : '>> READY FOR INPUT <<'}
            </p>
        </div>
    );
}
