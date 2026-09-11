/**
 * The REST app under test. Kept apart from fixtures.ts on purpose: importing
 * the router loads the whole tRPC app router, which imports queues/setup, which
 * opens Redis and starts BullMQ workers. Only test files that have mocked the
 * queue modules may import this.
 */
import express from 'express';
import { createRestV1Router } from '../../src/rest/v1';

export function restApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createRestV1Router());
  return app;
}
