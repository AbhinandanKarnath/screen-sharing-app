const express = require('express');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');

// Room management
const rooms = new Map();

const app = express();

// Load SSL certificates
const options = {
    key: fs.readFileSync('ssl/key.pem'),  // Path to your private key
    cert: fs.readFileSync('ssl/cert.pem') // Path to your certificate
};

// Create HTTPS server
const server = https.createServer(options, app);
const io = new Server(server);

// Serve static files
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the meeting room page
app.get('/meeting', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'meeting.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle room joining
    socket.on('join', (roomId) => {
        console.log('User', socket.id, 'joining room:', roomId);
        
        // Join the socket.io room
        socket.join(roomId);
        
        // Create the room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }
        
        const room = rooms.get(roomId);
        
        // Send list of existing users to the new participant
        const existingUsers = Array.from(room).filter(id => id !== socket.id);
        if (existingUsers.length > 0) {
            console.log('Sending existing users to', socket.id, ':', existingUsers);
            socket.emit('existingUsers', existingUsers);
        }
        
        // Notify all participants in the room about the new user
        socket.to(roomId).emit('userJoined', socket.id);
        
        // Add user to the room
        room.add(socket.id);
        
        // Store room ID in the socket for disconnect handling
        socket.roomId = roomId;
        
        console.log(`Room ${roomId} now has ${room.size} participants`);
    });

    // Handle direct signaling between peers
    socket.on('offer', ({ targetUserId, sdp }) => {
        console.log('Relaying offer from', socket.id, 'to', targetUserId);
        io.to(targetUserId).emit('offer', { senderId: socket.id, sdp });
    });

    socket.on('answer', ({ targetUserId, sdp }) => {
        console.log('Relaying answer from', socket.id, 'to', targetUserId);
        io.to(targetUserId).emit('answer', { senderId: socket.id, sdp });
    });

    socket.on('ice-candidate', ({ targetUserId, candidate }) => {
        io.to(targetUserId).emit('ice-candidate', { senderId: socket.id, candidate });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            
            if (room) {
                // Remove user from the room
                room.delete(socket.id);
                
                // Notify all participants about the user leaving
                io.to(socket.roomId).emit('userLeft', socket.id);
                
                console.log(`Room ${socket.roomId} now has ${room.size} participants`);
                
                // Clean up empty rooms
                if (room.size === 0) {
                    console.log(`Removing empty room: ${socket.roomId}`);
                    rooms.delete(socket.roomId);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 443;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Secure server running at https://0.0.0.0:${PORT}/`);
});