import amqp from 'amqplib';

export function getBrokerUrl(): string {
  const brokerUrl = process.env.BROKER_URL;

  if (!brokerUrl) {
    throw new Error('BROKER_URL is required');
  }

  return brokerUrl;
}

export async function connectToBroker() {
  return amqp.connect(getBrokerUrl());
}
