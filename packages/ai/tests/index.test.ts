/**
 * Tests for the @jxsuite/ai barrel (src/index.ts) — asserts the public API surface is re-exported.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, it, expect } from "bun:test";
import * as ai from "../src/index.js";
import { createChatState } from "../src/chat-state.js";
import {
  STREAM_EVENT_TYPES,
  createAnthropicStreamingClient,
  createOpenAIStreamingClient,
  createProxyStreamingClient,
} from "../src/streaming-client.js";
import { createToolDefinition, createToolRegistry } from "../src/tools.js";

describe("@jxsuite/ai barrel", () => {
  it("re-exports the chat-state, tool, and streaming-client public API", () => {
    expect(ai.createChatState).toBe(createChatState);
    expect(ai.createToolRegistry).toBe(createToolRegistry);
    expect(ai.createToolDefinition).toBe(createToolDefinition);
    expect(ai.createOpenAIStreamingClient).toBe(createOpenAIStreamingClient);
    expect(ai.createAnthropicStreamingClient).toBe(createAnthropicStreamingClient);
    expect(ai.createProxyStreamingClient).toBe(createProxyStreamingClient);
    expect(ai.STREAM_EVENT_TYPES).toBe(STREAM_EVENT_TYPES);
  });
});
