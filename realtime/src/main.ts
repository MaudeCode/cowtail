import { loadRealtimeConfig } from "./config";
import { RealtimeConnectionRegistry } from "./connectionRegistry";
import { ConvexCowtailRealtimeApi } from "./cowtailApi";
import { CowtailHttpPushBridge } from "./pushBridge";
import { OpenClawSessionController } from "./sessionController";

type SocketData = { connectionId: string };

const config = loadRealtimeConfig(Bun.env);
const registry = new RealtimeConnectionRegistry();
const api = ConvexCowtailRealtimeApi.fromUrl(config.convexUrl);
const pushBridge = new CowtailHttpPushBridge({
  httpBaseUrl: config.httpBaseUrl,
  bearerToken: config.pushBearerToken,
  ownerUserId: config.ownerUserId,
});
const controller = new OpenClawSessionController({
  bridgeToken: config.bridgeToken,
  ownerUserId: config.ownerUserId,
  api,
  registry,
  pushBridge,
});

const server = Bun.serve<SocketData>({
  port: config.port,
  fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    if (url.pathname !== "/openclaw/realtime") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const upgraded = server.upgrade(request, {
      data: { connectionId: crypto.randomUUID() },
    });
    if (!upgraded) {
      return new Response("Upgrade required", { status: 426 });
    }

    return undefined;
  },
  websocket: {
    open(socket) {
      controller.attach(socket.data.connectionId, socket);
    },
    async message(socket, message) {
      try {
        const rawMessage =
          typeof message === "string" ? message : new TextDecoder().decode(message);
        await controller.handleRawMessage(socket.data.connectionId, rawMessage);
      } catch (error) {
        console.error("Cowtail realtime message handler failed", error);
        controller.detach(socket.data.connectionId);
        socket.close(1011, "internal_error");
      }
    },
    close(socket) {
      controller.detach(socket.data.connectionId);
    },
  },
});

console.log(`Cowtail realtime service listening on :${server.port}`);
