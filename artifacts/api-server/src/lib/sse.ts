/**
 * SSE (Server-Sent Events) broadcast utility
 * Maintains a registry of connected clients and broadcasts events to all.
 */
import type { Response } from "express";

interface SseClient {
  id: string;
  res: Response;
  userId?: string;
}

const clients = new Map<string, SseClient>();

let clientIdCounter = 0;

/** Register a new SSE client. Returns the assigned client ID. */
export function addSseClient(res: Response, userId?: string): string {
  const id = `sse_${++clientIdCounter}_${Date.now()}`;
  clients.set(id, { id, res, userId });
  return id;
}

/** Remove an SSE client by ID. */
export function removeSseClient(id: string): void {
  clients.delete(id);
}

/** Send a named event + JSON payload to all connected clients. */
export function broadcastSseEvent(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients) {
    try {
      client.res.write(message);
    } catch {
      clients.delete(id);
    }
  }
}

/** Send a named event to a specific user's clients only. */
export function sendSseToUser(userId: string, event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients) {
    if (client.userId === userId) {
      try {
        client.res.write(message);
      } catch {
        clients.delete(id);
      }
    }
  }
}

/** Return the count of active SSE connections. */
export function getSseClientCount(): number {
  return clients.size;
}
