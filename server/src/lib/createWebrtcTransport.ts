import { Router } from "mediasoup/node/lib/types";
import { config } from "../config";
import { DtlsParameters } from "mediasoup/node/lib/fbs/web-rtc-transport";

const createWebRtcTransport = async (mediasoupRouter: Router) => {
    const {
        listenIps,
        maxIncomingBitrate,
        initialAvailableOutgoingBitrate
    } = config.webRtcTransport;

    const transport = await mediasoupRouter.createWebRtcTransport({
        listenIps,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate
    })

    if (maxIncomingBitrate) {
        try {
            await transport.setMaxIncomingBitrate(maxIncomingBitrate);
        } catch (error) {
            console.log(error);
        }
    }

    return {
        transport,
        params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        }
    }
}

export { createWebRtcTransport }