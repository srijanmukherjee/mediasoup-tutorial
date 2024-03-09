import * as ws from "ws";
import { createWorker } from "./worker";
import { Consumer, Producer, Router, RtpCapabilities, Transport } from "mediasoup/node/lib/types";
import { createWebRtcTransport } from "./createWebrtcTransport";

let mediasoupRouter: Router;
let producerTransport: Transport;
let producer: Producer;
let consumer: Consumer;
let consumerTransport: Transport;

interface WebSocket extends ws.WebSocket {
    server?: ws.WebSocketServer
}

const WebsocketConnection = async (websocket: ws.Server) => {
    try {
        mediasoupRouter = await createWorker();
    } catch (error) {
        throw error;
    }

    websocket.on("connection", (_socket) => {
        const socket: WebSocket = _socket;
        socket.server = websocket;

        socket.on("message", (message: string) => {
            let event;
            try {
                event = JSON.parse(message);
            } catch (error) {
                return
            }

            switch (event.type) {
                case "getRouterRtpCapabilities":
                    onRouterRtpCapabilities(event, socket);
                    break
                case "createProducerTransport":
                    onCreateProducerTransport(event, socket);
                    break;
                case "connectProducerTransport":
                    onConnectProducerTransport(event, socket);
                    break;
                case "produce":
                    onProduce(event, socket);
                    break;
                case "createConsumerTransport":
                    onCreateConsumerTransport(event, socket);
                    break;
                case "connectConsumerTransport":
                    onConnectConsumerTransport(event, socket);
                    break;
                case "resume":
                    onResume(event, socket);
                    break;
                case "consume":
                    onConsume(event, socket);
                    break;
            }

        })
    });
}

function send(socket: WebSocket, type: string, msg: any) {
    const payload = { type, data: msg }
    socket.send(JSON.stringify(payload));
}

function broadcast(socket: WebSocket, type: string, msg: any) {
    const payload = JSON.stringify({ type, data: msg });
    socket.server?.clients.forEach((client) => {
        client.send(payload);
    })
}

function onRouterRtpCapabilities(event: any, socket: WebSocket) {
    send(socket, "routerCapabilities", mediasoupRouter.rtpCapabilities);
}

async function onCreateProducerTransport(event: any, socket: WebSocket) {
    try {
        const { transport, params } = await createWebRtcTransport(mediasoupRouter);
        producerTransport = transport;
        send(socket, "producerTransportCreated", params);
    } catch (error) {
        console.error(error);
        send(socket, "error", error);
    }
}

async function onConnectProducerTransport(event: any, socket: WebSocket) {
    await producerTransport.connect({
        dtlsParameters: event.dtlsParameters
    });
    send(socket, "producerConnected", "producer is connected");
}

async function onProduce(event: any, socket: WebSocket) {
    const { kind, rtpParameters } = event;
    producer = await producerTransport.produce({ kind, rtpParameters });
    const payload = {
        id: producer.id
    };
    send(socket, 'produced', payload);
    broadcast(socket, 'newProducer', "new user");
}

async function onCreateConsumerTransport(event: any, socket: WebSocket) {
    try {
        const { transport, params } = await createWebRtcTransport(mediasoupRouter);
        consumerTransport = transport;
        send(socket, "subTransportCreated", params);
    } catch (error) {
        console.error(error);
        send(socket, "error", error);
    }
}

async function onConnectConsumerTransport(event: any, socket: WebSocket) {
    await consumerTransport.connect({
        dtlsParameters: event.dtlsParameters
    });
    send(socket, "consumerConnected", "consumer transport is connected");
}

async function onResume(event: any, socket: WebSocket) {
    await consumer.resume();
    send(socket, "resumed", "resumed");
}

async function onConsume(event: any, socket: WebSocket) {
    const { rtpCapabilities } = event;
    try {
        const res = await createConsumer(producer, rtpCapabilities);
        send(socket, "subscribed", res);
    } catch (err) {
        send(socket, "error", err);
    }
}

async function createConsumer(producer: Producer, rtpCapabilities: RtpCapabilities) {
    if (!mediasoupRouter.canConsume({ producerId: producer.id, rtpCapabilities })) {
        console.error("cannot consume");
        throw "cannot consume";
    }

    try {
        consumer = await consumerTransport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: producer.kind === 'video'
        });
    } catch (error) {
        console.error(error);
        throw error;
    }

    return {
        producerId: producer.id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused
    }
}

export { WebsocketConnection }