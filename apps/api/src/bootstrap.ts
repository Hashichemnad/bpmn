import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { CSRF_HEADER } from '@processhub/shared';
import { getConfig } from './config/config';

/** Applies security middleware and global settings. Shared by main.ts and e2e tests. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = getConfig();
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  // The process handbook carries diagram images (PNG, base64) rendered in the browser (D-087);
  // 10 MB stays below the reverse proxies' request limit (nginx 11 MB, Caddy 12 MB).
  app.use('/api/v1/reports/handbook', json({ limit: '10mb' }));
  app.use(json({ limit: config.BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: '100kb' }));
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER],
    maxAge: 600,
  });
  if (config.ENABLE_SWAGGER) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ProcessHub API')
        .setVersion('1')
        .addCookieAuth('ph_access')
        .build(),
    );
    // Swagger UI needs inline scripts/styles; relax CSP only for the docs route.
    app.use(
      '/api/docs',
      (_req: unknown, res: { removeHeader: (h: string) => void }, next: () => void) => {
        res.removeHeader('Content-Security-Policy');
        next();
      },
    );
    SwaggerModule.setup('api/docs', app, doc);
  }
  return app;
}
