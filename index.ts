import cors from 'cors';
import { Server, Socket } from 'socket.io';
import Express from 'express';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import prompts from 'prompts';
import * as clipboardy from 'clipboardy';
import { DateTime } from 'luxon';

interface Offer {
  sdp: string,
  senderId: string,
  receiverId: string,
}

interface Answer {
  sdp: string,
  senderId: string,
  receiverId: string,
}

interface RTCIceAndroidCandidate {
  sdp?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
}

interface Candidate {
  candidate: RTCIceAndroidCandidate | RTCIceCandidateInit,
  senderId: string,
  receiverId: string,
}

interface ThermalZone {
  name: string,
  value: number,
}

interface DeviceStatistic {
  timestamp: number,
  currentBatteryStatus: number,
  currentDeviceTemperature?: ThermalZone[] | string,
}

class DeviceStatisticImpl {
  constructor(
    public timestamp: number,
    public currentBatteryStatus: number,
    public currentDeviceTemperature?: ThermalZone[],
  ) {
  }

  // noinspection JSUnusedGlobalSymbols
  toJSON(): DeviceStatistic {
    return {
      timestamp: this.timestamp,
      currentBatteryStatus: this.currentBatteryStatus,
      currentDeviceTemperature: this.currentDeviceTemperature ?? 'N/A',
    }
  }
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
const deviceStatisticObject: { [key: string]: DeviceStatisticImpl[] } = {};

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

  socket.on('report-statistics', (deviceStatistic: DeviceStatisticImpl) => {
    const array = deviceStatisticObject[socket.id] ?? Array.of();
    array.push(deviceStatistic);
    deviceStatisticObject[socket.id] = array;

    const dateString = DateTime.fromMillis(deviceStatistic.timestamp).toLocaleString({
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
      second: 'numeric',
    });

    console.log(`(${dateString}) ${socket.id} > currentBatteryStatus: ${deviceStatistic.currentBatteryStatus}%`);
    if (deviceStatistic.currentDeviceTemperature == null) {
      console.log(`(${dateString}) ${socket.id} > currentDeviceTemperature: N/A`);
    } else {
      deviceStatistic.currentDeviceTemperature.forEach(value => {
        console.log(`(${dateString}) ${socket.id} > currentDeviceTemperature: ${value.value}'C for ${value.name}`);
      });
    }

    console.log('report collected! socket id was ' + socket.id);
  });

  console.log('connection established!');
});

httpServer.listen(3000);

listenPrompts();

function listenPrompts() {
  prompts({
    type: 'select',
    name: 'command',
    message: '',
    choices: [
      { title: 'Show reports', value: 'showReport' },
      { title: 'Export reports as json', value: 'exportReport' },
      { title: 'Help', value: 'help' },
    ],
  }).then(value => {
    console.log(value);

    if (value.command === 'showReport') {
      showReports();
    } else if (value.command === 'exportReport') {
      exportReports();
    } else if (value.command === 'help') {
      showHelpDescription();
    }

    listenPrompts();
  })
}

function checkReportVisibility() {
  return (Object.keys(deviceStatisticObject).length ?? 0) === 0;
}

function showReports() {
  if (checkReportVisibility()) {
    console.log('No report data is collected!');
    return;
  }

  console.log('------------------------------ Reports start here -----------------------------');
  Object.entries(deviceStatisticObject).forEach(value => {
    value[1].forEach(value1 => {
      const dateString = DateTime.fromMillis(value1.timestamp).toLocaleString({
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        hour12: false,
        minute: 'numeric',
        second: 'numeric',
      });
      console.log(`(${dateString}) ${value[0]} > currentBatteryStatus: ${value1.currentBatteryStatus}%`);
      if (value1.currentDeviceTemperature == null) {
        console.log(`(${dateString}) ${value[0]} > currentDeviceTemperature: N/A`);
      } else {
        value1.currentDeviceTemperature.forEach(value2 => {
          console.log(`(${dateString}) ${value[0]} > currentDeviceTemperature: ${value2.value}'C for ${value2.name}`);
        });
      }
    });
  });
  console.log('------------------------------ Reports end here -----------------------------');
}

function exportReports() {
  if (checkReportVisibility()) {
    console.log('No report data is collected!');
    return;
  }

  clipboardy.writeSync(JSON.stringify(deviceStatisticObject));
  console.log('Finished! Just spam Ctrl + V!');
}

function showHelpDescription() {
  console.log('\x1b[36m', 'Show reports:', '\x1b[32m', 'Show device reports');
  console.log('\x1b[36m', 'Export reports as json:', '\x1b[32m', 'Export device report data as json into your clipboard. Just spam Ctrl + V!');
}

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