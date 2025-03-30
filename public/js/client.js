let localStream;
let socket;
let roomId;
let isScreenSharing = false;
let screenStream = null;
let peers = {}; // Store all peer connections

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// Initialize the connection
async function init() {
    socket = io();
    roomId = new URLSearchParams(window.location.search).get('room') || 
             Math.random().toString(36).substring(7);
    
    // Update URL with room ID if not already there
    if (!window.location.search.includes('room')) {
        window.history.pushState(null, null, `?room=${roomId}`);
    }
    
    document.getElementById('room-info').textContent = `Room: ${roomId}`;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }, 
            audio: true 
        });
        // Display local video
        const localVideoElement = document.getElementById('localVideo');
        localVideoElement.srcObject = localStream;
        localVideoElement.play().catch(e => console.error("Local video play error:", e));
    } catch (err) {
        console.error('Error accessing media devices:', err);
        alert('Cannot access camera or microphone. Please check permissions.');
    }

    // Join the room
    socket.emit('join', roomId);

    // Socket event handlers for multi-user connections
    socket.on('existingUsers', (existingUsers) => {
        console.log('Existing users in room:', existingUsers);
        existingUsers.forEach(userId => createPeerConnection(userId, true));
    });

    socket.on('userJoined', (userId) => {
        console.log('New user joined:', userId);
        // Don't create offer for new users, let them initiate
        createPeerConnection(userId, false);
    });

    socket.on('offer', async ({ senderId, sdp }) => {
        console.log('Received offer from:', senderId);
        await handleOffer(senderId, sdp);
    });

    socket.on('answer', ({ senderId, sdp }) => {
        console.log('Received answer from:', senderId);
        handleAnswer(senderId, sdp);
    });

    socket.on('ice-candidate', ({ senderId, candidate }) => {
        handleIceCandidate(senderId, candidate);
    });

    socket.on('userLeft', (userId) => {
        console.log('User left:', userId);
        handleUserDisconnected(userId);
        updateVideoLayout();
    });

    // UI event handlers
    document.getElementById('toggleMic').onclick = toggleMic;
    document.getElementById('toggleVideo').onclick = toggleVideo;
    document.getElementById('toggleScreen').onclick = toggleScreen;
    document.getElementById('endCall').onclick = endCall;
}

// Helper function to add a remote video element
function addRemoteVideo(userId, stream) {
    // Check if video element already exists
    let videoElement = document.querySelector(`video[data-peer="${userId}"]`);
    
    if (!videoElement) {
        // Create new video container
        const videoGrid = document.querySelector('.video-grid');
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        videoWrapper.setAttribute('data-peer-wrapper', userId);
        
        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;  // Corrected property name
        videoElement.setAttribute('data-peer', userId);
        
        const nameTag = document.createElement('div');
        nameTag.className = 'participant-name';
        nameTag.textContent = `User ${userId.substring(0, 5)}`;
        
        // Add network quality indicator
        const qualityIndicator = document.createElement('div');
        qualityIndicator.className = 'network-quality';
        qualityIndicator.textContent = 'Connecting...';
        
        videoWrapper.appendChild(videoElement);
        videoWrapper.appendChild(nameTag);
        videoWrapper.appendChild(qualityIndicator);
        videoGrid.appendChild(videoWrapper);
        
        // Update layout after adding a new video
        updateVideoLayout();
    }
    
    // Set the stream as the source for this video element if it's different
    if (videoElement.srcObject !== stream) {
        videoElement.srcObject = stream;
        videoElement.play().catch(e => console.error(`Remote video play error for ${userId}:`, e));
    }
    
    return videoElement;
}

// Create a peer connection for a specific user
async function createPeerConnection(targetUserId, createOffer = false) {
    if (peers[targetUserId]) {
        console.log(`Peer connection to ${targetUserId} already exists`);
        return peers[targetUserId];
    }

    console.log('Creating peer connection for:', targetUserId);
    const peer = new RTCPeerConnection(configuration);
    peers[targetUserId] = peer;

    // Add local tracks to the peer connection
    localStream.getTracks().forEach(track => {
        console.log(`Adding ${track.kind} track to peer connection for ${targetUserId}`);
        peer.addTrack(track, localStream);
    });

    // Handle remote tracks
    peer.ontrack = (event) => {
        console.log('Received remote track from:', targetUserId, event.track.kind);
        
        // Use the first stream from the event
        if (event.streams && event.streams[0]) {
            addRemoteVideo(targetUserId, event.streams[0]);
        }
    };

    // Handle ICE candidates
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Sending ICE candidate to ${targetUserId}`);
            socket.emit('ice-candidate', {
                targetUserId: targetUserId,
                candidate: event.candidate
            });
        }
    };

    // Ice connection state change monitoring
    peer.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${targetUserId}: ${peer.iceConnectionState}`);
        
        // Update UI based on connection state
        const qualityIndicator = document.querySelector(`[data-peer-wrapper="${targetUserId}"] .network-quality`);
        if (qualityIndicator) {
            if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
                qualityIndicator.className = 'network-quality good';
                qualityIndicator.textContent = 'Good Connection';
            } else if (peer.iceConnectionState === 'checking') {
                qualityIndicator.className = 'network-quality checking';
                qualityIndicator.textContent = 'Connecting...';
            } else if (peer.iceConnectionState === 'disconnected') {
                qualityIndicator.className = 'network-quality poor';
                qualityIndicator.textContent = 'Connection Issues';
            } else if (peer.iceConnectionState === 'failed') {
                qualityIndicator.className = 'network-quality failed';
                qualityIndicator.textContent = 'Connection Failed';
                
                // Try to restart ICE
                peer.restartIce();
            }
        }
    };

    // Connection state monitoring
    peer.onconnectionstatechange = () => {
        console.log(`Connection state with ${targetUserId}: ${peer.connectionState}`);
        if (peer.connectionState === 'failed') {
            console.log(`Connection with ${targetUserId} failed, attempting to reconnect`);
            // Close and recreate the peer connection
            handleUserDisconnected(targetUserId);
            setTimeout(() => createPeerConnection(targetUserId, true), 2000);
        }
    };

    // Create offer if we initiated the connection
    if (createOffer) {
        try {
            const offer = await peer.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peer.setLocalDescription(offer);
            console.log(`Sending offer to ${targetUserId}`);
            socket.emit('offer', {
                targetUserId: targetUserId,
                sdp: peer.localDescription
            });
        } catch (err) {
            console.error('Error creating offer:', err);
        }
    }
    
    return peer;
}

// Update video layout based on number of participants
function updateVideoLayout() {
    const videoWrappers = document.querySelectorAll('.video-wrapper');
    const count = videoWrappers.length;
    
    if (count === 1) {
        // Just local video - full screen
        videoWrappers.forEach(wrapper => {
            wrapper.style.width = '100%';
            wrapper.style.height = '100%';
        });
    } else if (count === 2) {
        // Local + one remote - split screen
        videoWrappers.forEach(wrapper => {
            wrapper.style.width = '50%';
            wrapper.style.height = '100%';
        });
    } else if (count <= 4) {
        // 3-4 participants - 2x2 grid
        videoWrappers.forEach(wrapper => {
            wrapper.style.width = '50%';
            wrapper.style.height = '50%';
        });
    } else {
        // 5+ participants - responsive grid
        videoWrappers.forEach(wrapper => {
            wrapper.style.width = '33.33%';
            wrapper.style.height = '33.33%';
        });
    }
}

// Handle received offer
async function handleOffer(senderId, sdp) {
    try {
        // Get or create peer connection
        let peer = peers[senderId];
        if (!peer) {
            peer = await createPeerConnection(senderId, false);
        }
        
        // Set remote description (the offer)
        console.log(`Setting remote description for offer from ${senderId}`);
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        
        // Create and send answer
        console.log(`Creating answer for ${senderId}`);
        const answer = await peer.createAnswer();
        console.log(`Setting local description (answer) for ${senderId}`);
        await peer.setLocalDescription(answer);
        
        console.log(`Sending answer to ${senderId}`);
        socket.emit('answer', {
            targetUserId: senderId,
            sdp: peer.localDescription
        });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
}

// Handle received answer
async function handleAnswer(senderId, sdp) {
    const peer = peers[senderId];
    if (peer) {
        try {
            console.log(`Setting remote description (answer) from ${senderId}`);
            await peer.setRemoteDescription(new RTCSessionDescription(sdp));
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    } else {
        console.warn(`Received answer from ${senderId} but no peer connection exists`);
    }
}

// Handle received ICE candidate
async function handleIceCandidate(senderId, candidate) {
    const peer = peers[senderId];
    if (peer) {
        try {
            // Save candidates if remote description is not set yet
            if (!peer.remoteDescription) {
                console.warn(`Received ICE candidate from ${senderId} but remote description not set yet, queueing`);
                if (!peer._pendingCandidates) peer._pendingCandidates = [];
                peer._pendingCandidates.push(candidate);
                return;
            }
            
            console.log(`Adding ICE candidate from ${senderId}`);
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('Error handling ICE candidate:', err);
        }
    } else {
        console.warn(`Received ICE candidate from ${senderId} but no peer connection exists`);
    }
}

// Handle user disconnection
function handleUserDisconnected(userId) {
    // Close the peer connection
    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }
    
    // Remove the video element
    const videoWrapper = document.querySelector(`[data-peer-wrapper="${userId}"]`);
    if (videoWrapper) {
        videoWrapper.remove();
    }
}

// UI Controls
function toggleMic() {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById('toggleMic').classList.toggle('active');
    }
}

function toggleVideo() {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        document.getElementById('toggleVideo').classList.toggle('active');
    }
}

async function toggleScreen() {
    try {
        if (!isScreenSharing) {
            // Start screen sharing
            screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true 
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track in all peer connections
            Object.values(peers).forEach(peer => {
                const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    console.log('Replacing video track with screen share track');
                    sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local video display
            document.getElementById('localVideo').srcObject = screenStream;
            
            // Handle screen sharing stop
            videoTrack.onended = async () => {
                await stopScreenSharing();
            };
            
            document.getElementById('toggleScreen').classList.add('active');
            isScreenSharing = true;
            
        } else {
            await stopScreenSharing();
        }
    } catch (err) {
        console.error('Error during screen sharing:', err);
    }
}

async function stopScreenSharing() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        
        // Restore camera video track in all peer connections
        const videoTrack = localStream.getVideoTracks()[0];
        Object.values(peers).forEach(peer => {
            const sender = peer.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                console.log('Replacing screen share track with camera track');
                sender.replaceTrack(videoTrack);
            }
        });
        
        // Update local video display
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('toggleScreen').classList.remove('active');
        isScreenSharing = false;
    }
}

function endCall() {
    // Close all peer connections
    Object.values(peers).forEach(peer => peer.close());
    peers = {};
    
    // Stop all media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    // Disconnect socket
    if (socket) {
        socket.disconnect();
    }
    
    // Redirect to home page
    window.location.href = '/';
}

// Handle page unload
window.addEventListener('beforeunload', function() {
    endCall();
});

// Initialize when the page loads
window.addEventListener('load', function() {
    init();
    
    // Copy room link functionality
    document.getElementById('copyLink')?.addEventListener('click', function() {
        const roomLink = window.location.href;
        navigator.clipboard.writeText(roomLink).then(() => {
            alert('Room link copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy room link:', err);
            // Fallback
            const linkElement = document.createElement('textarea');
            linkElement.value = roomLink;
            document.body.appendChild(linkElement);
            linkElement.select();
            document.execCommand('copy');
            document.body.removeChild(linkElement);
            alert('Room link copied to clipboard!');
        });
    });
    
    // Chat functionality
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const chatToggle = document.getElementById('chatToggle');
    const chatPanel = document.getElementById('chatPanel');
    
    if (chatForm && chatInput && chatMessages) {
        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (message) {
                // Send message to server
                socket.emit('chat-message', {
                    room: roomId,
                    message: message
                });
                
                // Display message locally
                appendChatMessage('You', message);
                
                // Clear input
                chatInput.value = '';
            }
        });
        
        // Handle incoming chat messages
        socket.on('chat-message', function(data) {
            appendChatMessage(`User ${data.senderId.substring(0, 5)}`, data.message);
        });
        
        // Toggle chat panel
        if (chatToggle && chatPanel) {
            chatToggle.addEventListener('click', function() {
                chatPanel.classList.toggle('hidden');
                chatToggle.classList.toggle('active');
            });
        }
    }
    
    // Connection status indicator
    const connectionStatus = document.getElementById('connectionStatus');
    if (connectionStatus) {
        socket.on('connect', function() {
            connectionStatus.textContent = 'Connected';
            connectionStatus.className = 'status-connected';
        });
        
        socket.on('disconnect', function() {
            connectionStatus.textContent = 'Disconnected';
            connectionStatus.className = 'status-disconnected';
        });
        
        socket.on('reconnecting', function() {
            connectionStatus.textContent = 'Reconnecting...';
            connectionStatus.className = 'status-reconnecting';
        });
    }
    
    // Device selection
    const audioSelect = document.getElementById('audioSource');
    const videoSelect = document.getElementById('videoSource');
    
    if (audioSelect && videoSelect) {
        // Populate device options
        navigator.mediaDevices.enumerateDevices()
            .then(devices => {
                devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    
                    if (device.kind === 'audioinput') {
                        option.text = device.label || `Microphone ${audioSelect.length + 1}`;
                        audioSelect.appendChild(option);
                    } else if (device.kind === 'videoinput') {
                        option.text = device.label || `Camera ${videoSelect.length + 1}`;
                        videoSelect.appendChild(option);
                    }
                });
            })
            .catch(err => {
                console.error('Error enumerating devices:', err);
            });
        
        // Handle device selection changes
        audioSelect.addEventListener('change', switchDevice);
        videoSelect.addEventListener('change', switchDevice);
    }
    
    // Handle window resize for responsive layout
    window.addEventListener('resize', function() {
        updateVideoLayout();
    });
    
    // Network quality monitoring
    setInterval(checkNetworkQuality, 5000);
});

// Append a chat message to the chat panel
function appendChatMessage(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const senderElement = document.createElement('span');
    senderElement.className = 'chat-sender';
    senderElement.textContent = sender + ': ';
    
    const textElement = document.createElement('span');
    textElement.className = 'chat-text';
    textElement.textContent = message;
    
    messageElement.appendChild(senderElement);
    messageElement.appendChild(textElement);
    chatMessages.appendChild(messageElement);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Switch audio/video device
async function switchDevice() {
    const audioSelect = document.getElementById('audioSource');
    const videoSelect = document.getElementById('videoSource');
    
    if (!audioSelect || !videoSelect) return;
    
    const audioSource = (audioSelect.value) ? {deviceId: {exact: audioSelect.value}} : true;
    const videoSource = (videoSelect.value) ? {deviceId: {exact: videoSelect.value}} : true;
    
    try {
        // Stop current tracks
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Get new stream with selected devices
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioSource,
            video: videoSource
        });
        
        // Update local video
        document.getElementById('localVideo').srcObject = localStream;
        
        // Replace tracks in all peer connections
        Object.values(peers).forEach(peer => {
            const senders = peer.getSenders();
            
            localStream.getTracks().forEach(track => {
                const sender = senders.find(s => s.track && s.track.kind === track.kind);
                if (sender) {
                    sender.replaceTrack(track);
                }
            });
        });
        
    } catch (err) {
        console.error('Error switching device:', err);
        alert('Error switching device. Please try again.');
    }
}

// Check network quality
function checkNetworkQuality() {
    Object.entries(peers).forEach(([userId, peer]) => {
        if (peer.connectionState === 'connected') {
            peer.getStats().then(stats => {
                let packetLossRate = 0;
                let jitter = 0;
                let hasVideoStat = false;
                
                stats.forEach(report => {
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        hasVideoStat = true;
                        if (report.packetsReceived > 0) {
                            packetLossRate = report.packetsLost / (report.packetsReceived + report.packetsLost);
                        }
                        jitter = report.jitter;
                        
                        // Debug log
                        console.log(`Connection stats for ${userId}:`, {
                            packetsReceived: report.packetsReceived,
                            packetsLost: report.packetsLost,
                            jitter: jitter,
                            frameWidth: report.frameWidth,
                            frameHeight: report.frameHeight,
                            framesPerSecond: report.framesPerSecond
                        });
                    }
                });
                
                // Update UI with network quality info if we have video stats
                if (hasVideoStat) {
                    const qualityIndicator = document.querySelector(`[data-peer-wrapper="${userId}"] .network-quality`);
                    if (qualityIndicator) {
                        if (packetLossRate > 0.1 || jitter > 50) {
                            qualityIndicator.className = 'network-quality poor';
                            qualityIndicator.textContent = 'Poor Connection';
                        } else if (packetLossRate > 0.05 || jitter > 30) {
                            qualityIndicator.className = 'network-quality fair';
                            qualityIndicator.textContent = 'Fair Connection';
                        } else {
                            qualityIndicator.className = 'network-quality good';
                            qualityIndicator.textContent = 'Good Connection';
                        }
                    }
                }
            }).catch(err => {
                console.error('Error getting stats:', err);
            });
        }
    });
}

// Add recording feature
let mediaRecorder;
let recordedChunks = [];

function toggleRecording() {
    const recordButton = document.getElementById('recordMeeting');
    if (!recordButton) return;
    
    if (!mediaRecorder) {
        // Start recording
        try {
            // Create a stream that includes all participant videos
            const videoElements = document.querySelectorAll('video');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set canvas size
            canvas.width = 1280;
            canvas.height = 720;
            
            // Create a stream from the canvas
            const canvasStream = canvas.captureStream(30);
            
            // Add audio track from local stream
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                canvasStream.addTrack(audioTrack);
            }
            
            // Start recording
            mediaRecorder = new MediaRecorder(canvasStream, {
                mimeType: 'video/webm;codecs=vp9'
            });
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                // Create a blob from the recorded chunks
                const blob = new Blob(recordedChunks, {
                    type: 'video/webm'
                });
                
                // Create a download link
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = `meeting-${roomId}-${new Date().toISOString()}.webm`;
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                setTimeout(() => {
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                }, 100);
                
                recordedChunks = [];
                mediaRecorder = null;
                recordButton.textContent = 'Start Recording';
                recordButton.classList.remove('active');
            };
            
            // Start recording and canvas rendering
            mediaRecorder.start(1000);
            recordButton.textContent = 'Stop Recording';
            recordButton.classList.add('active');
            
            // Draw all videos on canvas
            function drawVideosOnCanvas() {
                if (!mediaRecorder) return;
                
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                const videoCount = videoElements.length;
                let cols, rows;
                
                if (videoCount <= 1) {
                    cols = 1; rows = 1;
                } else if (videoCount <= 4) {
                    cols = 2; rows = 2;
                } else {
                    cols = 3; rows = Math.ceil(videoCount / 3);
                }
                
                const width = canvas.width / cols;
                const height = canvas.height / rows;
                
                videoElements.forEach((video, index) => {
                    const x = (index % cols) * width;
                    const y = Math.floor(index / cols) * height;
                    ctx.drawImage(video, x, y, width, height);
                });
                
                requestAnimationFrame(drawVideosOnCanvas);
            }
            
            drawVideosOnCanvas();
        } catch (err) {
            console.error('Error starting recording:', err);
            alert('Failed to start recording. Please try again.');
        }
    } else {
        // Stop recording
        mediaRecorder.stop();
    }
}

// Add recording button event listener
document.getElementById('recordMeeting')?.addEventListener('click', toggleRecording);