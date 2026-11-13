import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from './app.module';
import { loadConfig } from './core/config';

/** Standalone worker: sends emails and runs the deadline sweep. Scale it separately from the API. */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger: new ConsoleLogger({ json: config.NODE_ENV === 'production' }),
  });
  app.enableShutdownHooks();
}

void bootstrap();
