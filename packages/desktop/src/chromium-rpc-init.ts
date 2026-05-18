import { registerPlatform } from "@jxsuite/studio/platform.js";
import { createWebSocketPlatform } from "./platforms/websocket";

registerPlatform(createWebSocketPlatform());
