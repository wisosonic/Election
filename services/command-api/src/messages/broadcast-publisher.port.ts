export interface BroadcastPublisherPort {
  publish(topic: string, payload: Buffer): Promise<void>;
}

export const BROADCAST_PUBLISHER = Symbol('BROADCAST_PUBLISHER');
