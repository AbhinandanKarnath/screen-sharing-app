let localStream;
let remoteStream;
let peerConnection;
let socket;
let roomId;
let isScreenSharing = false;
let screenStream = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize the connection
async function init() {
    socket = io();
    roomId = new URLSearchParams(window.location.search).get('room') || 
             Math.random().toString(36).substring(7);
    document.getElementById('room-info').textContent = `Room: ${roomId}`;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        document.getElementById('localVideo').srcObject = localStream;
    } catch (err) {
        console.error('Error accessing media devices:', err);
    }

    socket.emit('join', roomId);

    // Socket event handlers
    socket.on('created', () => console.log('Room created'));
    socket.on('joined', () => console.log('Joined room'));
    socket.on('ready', () => createPeerConnection());
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('user-disconnected', handleUserDisconnected);

    // UI event handlers
    document.getElementById('toggleMic').onclick = toggleMic;
    document.getElementById('toggleVideo').onclick = toggleVideo;
    document.getElementById('toggleScreen').onclick = toggleScreen;
    document.getElementById('endCall').onclick = endCall;
}

async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    // Add local stream
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle incoming streams
    peerConnection.ontrack = event => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
        remoteStream = event.streams[0];
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                roomId,
                candidate: event.candidate
            });
        }
    };

    // Create and send offer
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', {
            roomId,
            sdp: offer
        });
    } catch (err) {
        console.error('Error creating offer:', err);
    }
}

async function handleOffer(offer) {
    if (!peerConnection) {
        createPeerConnection();
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', {
            roomId,
            sdp: answer
        });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
}

async function handleAnswer(answer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
        console.error('Error handling answer:', err);
    }
}

async function handleIceCandidate(data) {
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error handling ICE candidate:', err);
    }
}

function handleUserDisconnected() {
    document.getElementById('remoteVideo').srcObject = null;
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
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
            
            // Replace the video track in the peer connection
            const sender = peerConnection
                .getSenders()
                .find(s => s.track.kind === 'video');
                
            await sender.replaceTrack(videoTrack);
            
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
        
        // Restore camera video track
        const videoTrack = localStream.getVideoTracks()[0];
        const sender = peerConnection
            .getSenders()
            .find(s => s.track.kind === 'video');
            
        await sender.replaceTrack(videoTrack);
        
        // Update local video display
        document.getElementById('localVideo').srcObject = localStream;
        document.getElementById('toggleScreen').classList.remove('active');
        isScreenSharing = false;
    }
}

async function endCall() {
    // Stop all media tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Disconnect socket
    if (socket) {
        socket.disconnect();
    }
    
    // Redirect to home page
    window.location.href = '/';
}

// Handle page unload
window.onbeforeunload = function() {
    endCall();
};

// Initialize when the page loads
init();