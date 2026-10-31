import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mock Salesforce REST API for the e2e suite: serves the recorded fixtures of the API tests
 * (apps/api/test/fixtures/salesforce — invented data only) over plain http. The API reaches it
 * because its host is in OUTBOUND_ALLOWED_HOSTS (CI: host.docker.internal). Tests change
 * `records` to simulate updates in Salesforce.
 */
const FIXTURES = join(__dirname, '..', '..', 'api', 'test', 'fixtures', 'salesforce');
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Record<string, unknown>;

export class SalesforceMock {
  private server?: Server;
  records: Record<string, Record<string, unknown>> = {
    Org_Kpi_Goal__c: fixture('Org_Kpi_Goal__c'),
    Org_Kpi_Process__c: fixture('Org_Kpi_Process__c'),
    page2: fixture('Org_Kpi_Process__c.page2'),
  };

  /** Base URL the API uses (host as seen from the API: localhost locally, the Docker host in CI). */
  constructor(
    readonly port: number,
    readonly host: string,
  ) {}

  get url() {
    return `http://${this.host}:${this.port}`;
  }

  start() {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://mock');
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && url.pathname === '/services/oauth2/token')
        return send(200, { ...fixture('token'), instance_url: this.url });
      if (req.method !== 'GET') return send(405, [{ message: 'read-only mock' }]);
      if (url.pathname.endsWith('/query')) {
        const object = /FROM\s+(\w+)/i.exec(url.searchParams.get('q') ?? '')?.[1] ?? '';
        if (object === 'Organization') return send(200, { records: [{ Id: '00DFAKE0000000000' }] });
        return this.records[object]
          ? send(200, this.records[object])
          : send(400, [{ message: 'unknown object' }]);
      }
      if (/\/query\/01gFAKE/.test(url.pathname)) return send(200, this.records.page2);
      if (url.pathname.endsWith('/describe'))
        return send(
          200,
          url.pathname.includes('Org_Kpi_Goal__c')
            ? fixture('Org_Kpi_Goal__c.describe')
            : { fields: [] },
        );
      if (url.pathname.endsWith('/chatter/users/me'))
        return send(200, { username: 'kpi.integration@example.test' });
      return send(404, [{ message: 'not found' }]);
    });
    return new Promise<void>((resolve) => this.server!.listen(this.port, '0.0.0.0', resolve));
  }

  stop() {
    return new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
