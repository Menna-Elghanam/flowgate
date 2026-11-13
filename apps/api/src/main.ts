import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './core/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON logs in production are easy to search in a log service; readable lines locally.
    logger: new ConsoleLogger({ json: config.NODE_ENV === 'production' }),
  });
  configureApp(app, config);
  await app.listen(config.PORT);
}

void bootstrap();
