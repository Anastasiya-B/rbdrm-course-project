import Redis from 'ioredis';

export function getQueueRedis(): Redis {
  const url = process.env.REDIS_QUEUE_URL;

  if (!url) {
    throw new Error('REDIS_QUEUE_URL is required');
  }

  return new Redis(url, {
    maxRetriesPerRequest: 2,
  });
}

export function getQueueWorkerRedis(): Redis {
  const url = process.env.REDIS_QUEUE_URL;

  if (!url) {
    throw new Error('REDIS_QUEUE_URL is required');
  }

  return new Redis(url, {
    maxRetriesPerRequest: null,
  });
}
