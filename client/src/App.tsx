import { useEffect, useRef } from "react";
import "./App.css";
import * as mediasoup from "mediasoup-client";

let device: mediasoup.Device;
let transportConnectCallback;
let transportProduceCallback;
let consumerTransportConnectCallback;
let remoteStream: MediaStream;
let consumerTransport;

function App() {
    const socket = useRef<WebSocket>();
    const localVideoRef = useRef<HTMLVideoElement>();
    const remoteVideoRef = useRef<HTMLVideoElement>();
    const streamKind = useRef<"webcam" | "screen">("webcam");

    const loadDevice = async (routerRtpCapabilities: any) => {
        try {
            device = new mediasoup.Device();
        } catch (error) {
            if (error.name === "UnsupportedError") {
                console.log("browser not supported!");
            }
        }
        await device.load({ routerRtpCapabilities });
        console.log("🧭 Mediasoup device loaded");
    };

    const getUserMedia = async (
        kind: "webcam" | "screen"
    ): Promise<MediaStream> => {
        if (!device.canProduce("video")) {
            console.error("cannot produce video");
            return;
        }
        let stream: MediaStream;
        try {
            stream =
                kind === "webcam"
                    ? await navigator.mediaDevices.getUserMedia({
                          video: true,
                          audio: true,
                      })
                    : await navigator.mediaDevices.getDisplayMedia({
                          video: true,
                      });
        } catch (error) {
            console.error(error);
            throw error;
        }
        return stream;
    };

    const onRouterCapabilities = (response: any) => {
        loadDevice(response.data);
    };

    const onProducerTransportCreated = async (response: any) => {
        const transport = device.createSendTransport(response.data);
        let stream: MediaStream;

        transport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                const message = {
                    type: "connectProducerTransport",
                    dtlsParameters,
                };
                console.log("🚧 tranport connect event called");
                const payload = JSON.stringify(message);
                socket.current.send(payload);
                transportConnectCallback = callback;
                errback;
            }
        );

        // begin transport producer
        transport.on(
            "produce",
            async ({ kind, rtpParameters }, callback, errback) => {
                console.log("🚧 tranport produce event called");
                transportProduceCallback = callback;
                errback;

                const message = {
                    type: "produce",
                    transportId: transport.id,
                    kind,
                    rtpParameters,
                };
                const payload = JSON.stringify(message);
                socket.current.send(payload);
            }
        );
        // end transport producer

        // connection state changed begin
        transport.on("connectionstatechange", (state) => {
            switch (state) {
                case "connecting":
                    console.log("🟨 Producer tranport connecting");
                    break;
                case "connected":
                    console.log("🟩 Producer transport connected");
                    if (localVideoRef.current) {
                        localVideoRef.current.srcObject = stream;
                    }
                    break;
                case "disconnected":
                    console.log("💤 Producer transport disconnected");
                    break;
                case "failed":
                    transport.close();
                    console.log("🟥 Producer transport failed");
            }
        });

        // connection state changed end

        try {
            stream = await getUserMedia(streamKind.current);
            const track = stream.getVideoTracks()[0];
            const params = { track };
            await transport.produce(params);
        } catch (error) {
            console.error(error);
        }
    };

    const onSubTransportCreated = async (response: any) => {
        const transport = device.createRecvTransport(response.data);
        consumerTransport = transport;

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
            const payload = JSON.stringify({
                type: "connectConsumerTransport",
                transportId: transport.id,
                dtlsParameters,
            });
            consumerTransportConnectCallback = callback;
            socket.current.send(payload);
            errback;
        });

        transport.on("connectionstatechange", async (state) => {
            switch (state) {
                case "connecting":
                    console.log("🟨 Consumer tranport connecting");
                    break;
                case "connected": {
                    console.log("🟩 Consumer transport connected");
                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = remoteStream;
                    }
                    const payload = JSON.stringify({
                        type: "resume",
                    });
                    socket.current.send(payload);
                    break;
                }
                case "disconnected":
                    console.log("💤 Consumer transport disconnected");
                    break;
                case "failed":
                    transport.close();
                    console.log("🟥 Consumer transport failed");
            }
        });

        consume();
    };

    const onSubscribed = async (response: any) => {
        const { producerId, id, kind, rtpParameters } = response.data;
        const codecOptions = {};
        const consumer = await consumerTransport.consume({
            id,
            producerId,
            kind,
            rtpParameters,
            codecOptions,
        });
        const stream = new MediaStream();
        stream.addTrack(consumer.track);
        remoteStream = stream;
    };

    const consume = async () => {
        const { rtpCapabilities } = device;
        const payload = JSON.stringify({
            type: "consume",
            rtpCapabilities,
        });
        socket.current.send(payload);
    };

    const publish = (kind: "webcam" | "screen") => {
        streamKind.current = kind;
        const message = {
            type: "createProducerTransport",
            forceTcp: false,
            rtpCapabilities: device.rtpCapabilities,
        };

        console.log("🚧 publish");

        const payload = JSON.stringify(message);
        socket.current.send(payload);
    };

    const subscribe = () => {
        const payload = JSON.stringify({
            type: "createConsumerTransport",
            forceTcp: false,
        });

        socket.current.send(payload);
    };

    useEffect(() => {
        const so = new WebSocket(import.meta.env.VITE_SERVER_WS_URL);
        socket.current = so;
        so.onopen = () => {
            console.log("🧬 connected to server");
            const msg = {
                type: "getRouterRtpCapabilities",
            };
            const request = JSON.stringify(msg);
            socket.current.send(request);
        };

        so.onmessage = (event) => {
            let response;
            try {
                response = JSON.parse(event.data);
            } catch (error) {
                // TODO: handle error
                console.log("JSON validation failed");
                return;
            }

            console.log("🚧", response.type);

            switch (response.type) {
                case "routerCapabilities":
                    onRouterCapabilities(response);
                    break;
                case "producerTransportCreated":
                    onProducerTransportCreated(response);
                    break;
                case "producerConnected":
                    if (transportConnectCallback) {
                        transportConnectCallback();
                        console.log("🧭 Producer connected");
                    } else {
                        console.error(
                            "Shouldn't have received producerConnected from server"
                        );
                    }
                    break;
                case "produced":
                    transportProduceCallback(response.data.id);
                    break;
                case "subTransportCreated":
                    onSubTransportCreated(response);
                    break;
                case "consumerConnected":
                    if (consumerTransportConnectCallback)
                        consumerTransportConnectCallback();
                    break;
                case "resumed":
                    break;
                case "subscribed":
                    onSubscribed(response);
                    break;
                case "error":
                    console.error(response);
                    break;
            }
        };
        return () => {
            so.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div>
            <div className="space-x-2 p-2">
                <button
                    className="bg-blue-500 hover:bg-blue-600 transition text-white rounded px-5 py-3"
                    onClick={() => publish("webcam")}>
                    <svg
                        width="32px"
                        height="32px"
                        viewBox="0 0 512 512"
                        className="inline mr-2 fill-white">
                        <g
                            stroke="none"
                            strokeWidth="1"
                            fill="none"
                            fillRule="evenodd">
                            <g
                                className="fill-white"
                                transform="translate(42.666667, 106.666667)">
                                <path d="M298.666667,2.84217094e-14 C369.359115,2.84217094e-14 426.666667,57.307552 426.666667,128 C426.666667,198.692448 369.359115,256 298.666667,256 L128,256 C57.307552,256 7.10542736e-15,198.692448 7.10542736e-15,128 C7.10542736e-15,57.307552 57.307552,2.84217094e-14 128,2.84217094e-14 L298.666667,2.84217094e-14 Z M298.666667,42.6666667 L128,42.6666667 C80.8717013,42.6666667 42.6666667,80.8717013 42.6666667,128 C42.6666667,173.700168 78.5913274,211.009683 123.741006,213.2289 L128,213.333333 L298.666667,213.333333 C345.794965,213.333333 384,175.128299 384,128 C384,82.2998316 348.075339,44.9903173 302.925661,42.7710999 L298.666667,42.6666667 Z M213.333333,64 C248.679557,64 277.333333,92.653776 277.333333,128 C277.333333,163.346224 248.679557,192 213.333333,192 C177.987109,192 149.333333,163.346224 149.333333,128 C149.333333,92.653776 177.987109,64 213.333333,64 Z M213.333333,106.666667 C201.551259,106.666667 192,116.217925 192,128 C192,139.782075 201.551259,149.333333 213.333333,149.333333 C225.115408,149.333333 234.666667,139.782075 234.666667,128 C234.666667,116.217925 225.115408,106.666667 213.333333,106.666667 Z M341.333333,277.333333 L341.333333,320 L85.3333333,320 L85.3333333,277.333333 L341.333333,277.333333 Z"></path>
                            </g>
                        </g>
                    </svg>
                    Camera
                </button>
                <button
                    className="bg-blue-500 hover:bg-blue-600 transition text-white rounded px-5 py-3"
                    onClick={() => publish("screen")}>
                    <svg
                        width="32px"
                        height="32px"
                        viewBox="0 0 24 24"
                        className="inline mr-2">
                        <path
                            d="M15.0303 7.46967C14.7374 7.17678 14.2626 7.17678 13.9697 7.46967L11.4697 9.96967C11.1768 10.2626 11.1768 10.7374 11.4697 11.0303C11.7626 11.3232 12.2374 11.3232 12.5303 11.0303L13.75 9.81066V16C13.75 16.4142 14.0858 16.75 14.5 16.75C14.9142 16.75 15.25 16.4142 15.25 16V9.81066L16.4697 11.0303C16.7626 11.3232 17.2374 11.3232 17.5303 11.0303C17.8232 10.7374 17.8232 10.2626 17.5303 9.96967L15.0303 7.46967Z"
                            fill="#fff"
                        />
                        <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M13.9451 1.25H15.0549C16.4225 1.24998 17.5248 1.24996 18.3918 1.36652C19.2919 1.48754 20.0497 1.74643 20.6517 2.34835C21.2536 2.95027 21.5125 3.70814 21.6335 4.60825C21.75 5.47522 21.75 6.57754 21.75 7.94513V16.0549C21.75 17.4225 21.75 18.5248 21.6335 19.3918C21.5125 20.2919 21.2536 21.0497 20.6517 21.6517C20.0497 22.2536 19.2919 22.5125 18.3918 22.6335C17.5248 22.75 16.4225 22.75 15.0549 22.75H13.9451C12.5775 22.75 11.4752 22.75 10.6083 22.6335C9.70814 22.5125 8.95027 22.2536 8.34835 21.6517C7.94855 21.2518 7.70008 20.7832 7.54283 20.2498C6.59156 20.2486 5.79901 20.2381 5.15689 20.1518C4.39294 20.0491 3.7306 19.8268 3.20191 19.2981C2.67321 18.7694 2.45093 18.1071 2.34822 17.3431C2.24996 16.6123 2.24998 15.6865 2.25 14.5537V9.44631C2.24998 8.31349 2.24996 7.38774 2.34822 6.65689C2.45093 5.89294 2.67321 5.2306 3.20191 4.7019C3.7306 4.17321 4.39294 3.95093 5.15689 3.84822C5.79901 3.76189 6.59156 3.75142 7.54283 3.75017C7.70008 3.21677 7.94855 2.74816 8.34835 2.34835C8.95027 1.74643 9.70814 1.48754 10.6083 1.36652C11.4752 1.24996 12.5775 1.24998 13.9451 1.25ZM7.25 16.0549C7.24999 17.1048 7.24997 17.9983 7.30271 18.7491C6.46829 18.7459 5.84797 18.7312 5.35676 18.6652C4.75914 18.5848 4.46611 18.441 4.26257 18.2374C4.05903 18.0339 3.91519 17.7409 3.83484 17.1432C3.7516 16.5241 3.75 15.6997 3.75 14.5V9.5C3.75 8.30029 3.7516 7.47595 3.83484 6.85676C3.91519 6.25914 4.05903 5.9661 4.26257 5.76256C4.46611 5.55902 4.75914 5.41519 5.35676 5.33484C5.84797 5.2688 6.46829 5.25415 7.30271 5.25091C7.24997 6.00167 7.24999 6.89522 7.25 7.94512V16.0549ZM10.8081 2.85315C10.0743 2.9518 9.68578 3.13225 9.40901 3.40901C9.13225 3.68577 8.9518 4.07435 8.85315 4.80812C8.7516 5.56347 8.75 6.56459 8.75 8V16C8.75 17.4354 8.7516 18.4365 8.85315 19.1919C8.9518 19.9257 9.13225 20.3142 9.40901 20.591C9.68578 20.8678 10.0743 21.0482 10.8081 21.1469C11.5635 21.2484 12.5646 21.25 14 21.25H15C16.4354 21.25 17.4365 21.2484 18.1919 21.1469C18.9257 21.0482 19.3142 20.8678 19.591 20.591C19.8678 20.3142 20.0482 19.9257 20.1469 19.1919C20.2484 18.4365 20.25 17.4354 20.25 16V8C20.25 6.56459 20.2484 5.56347 20.1469 4.80812C20.0482 4.07435 19.8678 3.68577 19.591 3.40901C19.3142 3.13225 18.9257 2.9518 18.1919 2.85315C17.4365 2.75159 16.4354 2.75 15 2.75H14C12.5646 2.75 11.5635 2.75159 10.8081 2.85315Z"
                            fill="#fff"
                        />
                    </svg>
                    Screen
                </button>
                <button
                    onClick={subscribe}
                    className="bg-blue-500 hover:bg-blue-600 transition text-white rounded px-5 py-3">
                    Subscribe
                </button>
            </div>
            <div className="flex flex-wrap gap-2">
                <video
                    autoPlay
                    ref={localVideoRef}
                    className="rounded flex-1"></video>
                <video
                    autoPlay
                    ref={remoteVideoRef}
                    className="rounded flex-1"></video>
            </div>
        </div>
    );
}

export default App;
