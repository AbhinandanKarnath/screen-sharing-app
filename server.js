const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const peers = new Map(); 

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    peers.set(socket.id, socket);

    // Broadcast offer to all other peers
    socket.on('offer', (data) => {
        console.log('Broadcasting offer from:', socket.id);
        for (const [id, peer] of peers.entries()) {
            if (id !== socket.id) {
                peer.emit('offer', { sdp: data.sdp, from: socket.id });
            }
        }
    });

    // Handle answer and send to the original offerer
    socket.on('answer', (data) => {
        console.log('Sending answer to:', data.to);
        peers.get(data.to)?.emit('answer', { sdp: data.sdp, from: socket.id });
    });

    // Relay ICE candidates to all other peers
    socket.on('candidate', (data) => {
        console.log('Relaying candidate:', data.candidate);
        for (const [id, peer] of peers.entries()) {
            if (id !== socket.id) {
                peer.emit('candidate', { candidate: data.candidate, from: socket.id });
            }
        }
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        peers.delete(socket.id);
    });
});


const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
