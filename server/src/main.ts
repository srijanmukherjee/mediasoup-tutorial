import express from "express";
import * as http from "http";
import * as ws from "ws";
import { WebsocketConnection } from "./lib/ws";

const main = async () => {
    const app = express();
    const server = http.createServer(app);
    const websocket = new ws.Server({ server, path: "/ws" });

    WebsocketConnection(websocket);

    const port = 8000;

    server.listen(port, "0.0.0.0", () => {
        console.log(`🧬 Server started on ::${port}`);
    });
};

export { main };
