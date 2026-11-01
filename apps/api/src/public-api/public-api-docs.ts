import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_SCOPES } from '@processhub/shared';
import { PublicApiModule } from './public-api.module';

/**
 * OpenAPI document of the public API only, at /api/public/docs (UI) and /api/public/docs-json
 * (D-173). Enabled with ENABLE_PUBLIC_API_DOCS independently of the internal API docs.
 */
export function setupPublicApiDocs(app: INestApplication): void {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ProcessHub public API')
      .setDescription(
        'Read-only REST API for published process content, KPIs, risk & compliance, enterprise ' +
          'architecture and workflow statistics. Send the API key in the `X-API-Key` header ' +
          '(or `Authorization: Bearer <key>`). Each endpoint needs one scope of the key: ' +
          API_SCOPES.map((s) => `\`${s}\``).join(', ') +
          '. Lists: `page`, `pageSize` (≤ 200), `updatedSince`, `q`. Responses carry `ETag` and ' +
          '`Last-Modified`; send `If-None-Match` / `If-Modified-Since` to get 304 when nothing ' +
          'changed. Rate limit per key: see the `X-RateLimit-*` headers.',
      )
      .setVersion('1')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'apiKey')
      .build(),
    { include: [PublicApiModule] },
  );
  // Swagger UI needs inline scripts/styles; relax CSP only for the docs route.
  app.use(
    '/api/public/docs',
    (_req: unknown, res: { removeHeader: (h: string) => void }, next: () => void) => {
      res.removeHeader('Content-Security-Policy');
      next();
    },
  );
  SwaggerModule.setup('api/public/docs', app, doc, { useGlobalPrefix: false });
}
