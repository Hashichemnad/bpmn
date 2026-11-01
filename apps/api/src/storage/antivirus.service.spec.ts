import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { AntivirusService, clamdScan } from './antivirus.service';
import type { AppConfig } from '../config/config';

/** A tiny clamd stand-in: reads INSTREAM chunks and flags the EICAR test string. */
function fakeClamd(behaviour: 'scan' | 'silent' = 'scan'): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (c: Buffer) => {
        if (behaviour === 'silent') return;
        buf = Buffer.concat([buf, c]);
        const cmd = 'zINSTREAM\0';
        if (buf.length < cmd.length) return;
        let p = cmd.length;
        const parts: Buffer[] = [];
        while (p + 4 <= buf.length) {
          const len = buf.readUInt32BE(p);
          if (len === 0) {
            const body = Buffer.concat(parts).toString('latin1');
            socket.end(
              body.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
                ? 'stream: Eicar-Test-Signature FOUND\0'
                : 'stream: OK\0',
            );
            return;
          }
          if (p + 4 + len > buf.length) return;
          parts.push(buf.subarray(p + 4, p + 4 + len));
          p += 4 + len;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('Antivirus (clamd INSTREAM, D-184)', () => {
  it('reports clean files and the EICAR test signature', async () => {
    const server = await fakeClamd();
    const { port } = server.address() as AddressInfo;
    expect(await clamdScan('127.0.0.1', port, Buffer.alloc(200_000, 65), 5000)).toEqual({
      clean: true,
    });
    expect(await clamdScan('127.0.0.1', port, Buffer.from(EICAR), 5000)).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
    server.close();
  });

  it('refuses infected files and, when the scanner is down, fails closed unless configured', async () => {
    const server = await fakeClamd();
    const { port } = server.address() as AddressInfo;
    const config = {
      ANTIVIRUS: 'clamav',
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: port,
      ANTIVIRUS_TIMEOUT_MS: 1000,
      ANTIVIRUS_MAX_BYTES: 1024 * 1024,
      ANTIVIRUS_FAIL_OPEN: false,
    } as unknown as AppConfig;
    const av = new AntivirusService(config);
    await expect(av.assertClean(Buffer.from('hello'), 'a.txt')).resolves.toBeUndefined();
    await expect(av.assertClean(Buffer.from(EICAR), 'eicar.txt')).rejects.toMatchObject({
      code: 'FILE_INFECTED',
    });
    server.close();
    const silent = await fakeClamd('silent');
    const down = new AntivirusService({
      ...config,
      CLAMAV_PORT: (silent.address() as AddressInfo).port,
    } as AppConfig);
    await expect(down.assertClean(Buffer.from('x'), 'x.txt')).rejects.toMatchObject({
      code: 'ANTIVIRUS_UNAVAILABLE',
    });
    const open = new AntivirusService({
      ...config,
      CLAMAV_PORT: (silent.address() as AddressInfo).port,
      ANTIVIRUS_FAIL_OPEN: true,
    } as AppConfig);
    await expect(open.assertClean(Buffer.from('x'), 'x.txt')).resolves.toBeUndefined();
    silent.close();
    const off = new AntivirusService({ ...config, ANTIVIRUS: 'off' } as AppConfig);
    await expect(off.assertClean(Buffer.from(EICAR), 'e.txt')).resolves.toBeUndefined();
  });
});
