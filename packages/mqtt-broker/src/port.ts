/** Identity resolved from a connecting device's credential (its MQTT username/password) --
 * see identity-service, which is what actually issues these claims. */
export interface DeviceIdentity {
  deviceId: string;
  delegateId: string;
  tenantId: string;
  roomIds: string[];
  qadaId: string | null;
}

export type AuthenticateFn = (
  clientId: string,
  username: string | undefined,
  password: Buffer | undefined,
) => Promise<DeviceIdentity | null>;

export type AuthorizeFn = (identity: DeviceIdentity, topic: string) => boolean | Promise<boolean>;

export type PublishHandler = (topic: string, payload: Buffer, identity: DeviceIdentity) => void | Promise<void>;

export type DisconnectHandler = (identity: DeviceIdentity | null) => void | Promise<void>;
export type ConnectHandler = (identity: DeviceIdentity) => void | Promise<void>;

/**
 * Port every mqtt-ingestion consumer codes against. AedesBrokerAdapter is the
 * in-process implementation used in dev/test (no Docker needed); in production
 * this seam would instead be an adapter that connects to AWS IoT Core as an
 * MQTT client and relies on IoT policies for the ACL portion -- not implemented
 * here since there's no AWS account available in this environment.
 */
export interface MqttBrokerPort {
  setAuthenticate(fn: AuthenticateFn): void;
  setAuthorizePublish(fn: AuthorizeFn): void;
  setAuthorizeSubscribe(fn: AuthorizeFn): void;
  onPublish(handler: PublishHandler): void;
  onClientConnect(handler: ConnectHandler): void;
  onClientDisconnect(handler: DisconnectHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Broker-initiated publish, e.g. command-api pushing an HQ broadcast down to a topic. */
  publish(topic: string, payload: Buffer): Promise<void>;
}
