import mqtt, { MqttClient } from 'mqtt';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { BroadcastPublisherPort } from './broadcast-publisher.port';

/**
 * Publishes HQ broadcasts by connecting to the broker as an ordinary MQTT
 * client -- the same way this would work against AWS IoT Core in production
 * (command-api calls the broker over the network, it doesn't share
 * mqtt-ingestion's in-process broker instance). Connects lazily on first use.
 */
@Injectable()
export class MqttBroadcastPublisher implements BroadcastPublisherPort, OnModuleDestroy {
  private client: MqttClient | null = null;

  private async getClient(): Promise<MqttClient> {
    if (this.client) return this.client;
    const url = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
    this.client = await new Promise<MqttClient>((resolve, reject) => {
      const c = mqtt.connect(url, {
        username: process.env.MQTT_SERVICE_USERNAME ?? 'command-api',
        password: process.env.MQTT_SERVICE_PASSWORD ?? '',
      });
      c.once('connect', () => resolve(c));
      c.once('error', reject);
    });
    return this.client;
  }

  async publish(topic: string, payload: Buffer): Promise<void> {
    const client = await this.getClient();
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: 1, retain: true }, (err) => (err ? reject(err) : resolve()));
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }
}
