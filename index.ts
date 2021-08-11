import cors from 'cors';
import { Server, Socket } from 'socket.io';
import Express from 'express';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import * as https from 'https';
import * as http from 'http';

interface Offer {
  sdp: RTCSessionDescription,
  senderId: string,
  receiverId: string,
}

interface Answer {
  sdp: RTCSessionDescription,
  senderId: string,
  receiverId: string,
}

interface Candidate {
  candidate: RTCIceCandidateInit,
  senderId: string,
  receiverId: string,
}

const express = Express();
express.use(helmet());
express.use(cors());

const directory = path.join('key');
const caDirectory = [directory, 'chain1.pem'].join('/');
const certDirectory = [directory, 'fullchain1.pem'].join('/');
const privateKeyDirectory = [directory, 'privkey1.pem'].join('/');
const CAExists = fs.existsSync(caDirectory);
const certExists = fs.existsSync(certDirectory);
const privateKeyExists = fs.existsSync(privateKeyDirectory);

const httpServer = (() => {
    if (CAExists && certExists && privateKeyExists) {
      return https.createServer({
          ca: fs.readFileSync(caDirectory),
          cert: fs.readFileSync(certDirectory),
          key: fs.readFileSync(privateKeyDirectory),
        }, express);
      }

    return http.createServer(express);
})();

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

let incrementValue = 0;
const roomMap = new Map<number, string[]>();

io.on('connection', socket => {
  socket.on('create-room', async () => {
    socket.emit('on-create', await createRoom(socket));

    console.log('room created! socket id was ' + socket.id);
  });

  socket.on('join-room', async (roomId: number) => {
    const users = await joinRoom(socket, roomId);
    socket.emit('on-join', users);

    if (users == null) {
      console.log(`user tried joining in ${roomId}! but no room named ${roomId} was available. socket id was ${socket.id}`);
    } else {
      console.log(`user is joined in ${roomId}! socket id was ${socket.id}`);
    }

  });

  socket.on('disconnect', () => {
    disconnect(socket);

    console.log('connection closed! socket id was ' + socket.id);
  });

  socket.on('transfer-offer', (offer: Offer) => {
    transferOffer(socket, offer);

    console.log('offer issued! socket id was ' + socket.id);
  });

  socket.on('transfer-answer', (answer: Answer) => {
    transferAnswer(socket, answer);

    console.log('answer issued! socket id was ' + socket.id);
  });

  socket.on('transfer-candidate', (candidate: Candidate) => {
    transferCandidate(socket, candidate);

    console.log('candidate issued! socket id was ' + socket.id);
  });

  socket.on('remove-connection', (receiverId: string) => {
    removeConnection(socket, receiverId, socket.id);

    console.log('RTC connection removed! socket id was ' + socket.id);
  });

  console.log('connection established!');
});

httpServer.listen(3000);

async function createRoom(socket: Socket) {
  const roomId = incrementValue++;

  await socket.join('room:' + roomId);
  console.log(socket.rooms);

  roomMap.set(roomId, [socket.id]);
  return roomId;
}

async function joinRoom(socket: Socket, roomId: number) {
  const roomData = roomMap.get(roomId);

  if (roomData == null) {
    return undefined;
  }

  await socket.join('room:' + roomId);
  console.log(socket.rooms);

  roomMap.set(roomId, [...roomData, socket.id]);
  return roomData;
}

function disconnect(socket: Socket) {
  const index = Array.from(roomMap.values()).findIndex(value => value.indexOf(socket.id) > -1);
  if (index === -1) { return; }

  const key = Array.from(roomMap.keys())[index];
  if (key == null) { return; }

  const value = roomMap.get(key);
  if (value == null) { return; }

  roomMap.set(key, value.filter(value => value !== socket.id));
  socket.to('room:' + key).emit('on-user-disconnect', socket.id);

  const changed = roomMap.get(key);

  if (changed != null && changed.length === 0) {
    roomMap.delete(key);
  }
}

function transferOffer(socket: Socket, offer: Offer) {
  socket.to(offer.receiverId).emit('on-received-offer', offer);
}

function transferAnswer(socket: Socket, answer: Answer) {
  socket.to(answer.receiverId).emit('on-received-answer', answer);
}

function transferCandidate(socket: Socket, candidate: Candidate) {
  socket.to(candidate.receiverId).emit('on-received-candidate', candidate);
}

function removeConnection(socket: Socket, senderId: string, receiverId: string) {
  socket.to(receiverId).emit('on-connection-removal', senderId);
}