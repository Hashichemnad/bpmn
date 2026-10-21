import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { getConfig } from './config/config';

async function main() {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.isProduction ? ['error', 'warn', 'log'] : undefined,
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
  console.log(`ProcessHub API listening on port ${config.PORT}`);
}

void main();
