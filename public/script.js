const socket = io();
let localStream;
let peerConnection = null;

// Share screen and send offer
document.getElementById('shareScreen').addEventListener('click', async () => {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    document.getElementById('localVideo').srcObject = localStream;

    peerConnection = new RTCPeerConnection();
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', { candidate: event.candidate, to: null }); // Broadcast to all
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { sdp: offer });
});

// Handle incoming offer
socket.on('offer', async (data) => {
    console.log('Received offer:', data);

    if (!peerConnection) {
        peerConnection = new RTCPeerConnection();
        peerConnection.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('candidate', { candidate: event.candidate, to: data.from });
            }
        };
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', { sdp: answer, to: data.from });
});

// Handle incoming answer
socket.on('answer', async (data) => {
    console.log('Received answer:', data);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
});

// Handle incoming ICE candidates
socket.on('candidate', async (data) => {
    console.log('Received ICE candidate:', data);
    if (data.candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});
