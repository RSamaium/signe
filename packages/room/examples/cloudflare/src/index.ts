import { createCloudflareRoomWorker, SigneRoomDurableObject } from "@signe/room/cloudflare";
import { CounterServer } from "./room";

export { SigneRoomDurableObject };

interface Env extends Record<string, unknown> {
  ROOMS: DurableObjectNamespace;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const roomWorker = createCloudflareRoomWorker(CounterServer, {
  binding: "ROOMS",
  partiesPath: "/parties/main",
});

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/parties/main/")) {
      return roomWorker.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
