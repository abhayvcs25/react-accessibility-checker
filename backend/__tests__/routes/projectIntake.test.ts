import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import projectIntakeRouter from '../../src/routes/projectIntake.js';
import { PROJECT_INTAKE_LIMITS } from '../../src/services/projectIntakeLimits.js';

describe('POST /api/project-intake', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(projectIntakeRouter);
    app.use(errorHandler);

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('preserves nested directories in relative paths through normalization', async () => {
    const form = new FormData();
    form.append('files', new Blob(['export const Button = () => <button>Click</button>;']), 'src/components/ui/Button.tsx');
    form.append('files', new Blob(['<!DOCTYPE html><html><body><h1>Test</h1></body></html>']), 'public/index.html');

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completeness).toBe('complete');
    expect(body.counts.selected).toBe(2);
    expect(body.counts.accepted).toBe(2);
    expect(body.files).toHaveLength(2);
    expect(body.files[0].relativePath).toBe('src/components/ui/Button.tsx');
    expect(body.files[0].status).toBe('accepted');
    expect(body.files[1].relativePath).toBe('public/index.html');
    expect(body.files[1].status).toBe('accepted');
    expect(typeof body.snapshotId).toBe('string');
    expect(body.snapshotId).toHaveLength(64);
  });

  it('collapses backslashes and slashes to one path and marks duplicate paths as rejected without double-counting bytes', async () => {
    const form = new FormData();
    const content = 'export const Button = () => null;';
    form.append('files', new Blob([content]), 'src\\Button.tsx');
    form.append('files', new Blob([content]), 'src/Button.tsx');

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.selected).toBe(2);
    expect(body.counts.accepted).toBe(1);
    expect(body.counts.rejected).toBe(1);

    const first = body.files.find((f: { relativePath: string; status: string }) => f.status === 'accepted');
    const second = body.files.find((f: { relativePath: string; status: string }) => f.status === 'rejected');
    expect(first.relativePath).toBe('src/Button.tsx');
    expect(second.relativePath).toBe('src/Button.tsx');
    expect(second.reason).toBe('duplicate-path');
  });

  it('returns 400 invalid-path for absolute paths, ../, and foo/../../secret.txt without echoing contents', async () => {
    const hostilePaths = ['/etc/passwd', 'C:\\secret.txt', '../secret.txt', 'foo/../../secret.txt'];

    for (const hostilePath of hostilePaths) {
      const form = new FormData();
      const secretContent = 'SUPER_SECRET_TOKEN_DO_NOT_LEAK';
      form.append('files', new Blob([secretContent]), hostilePath);

      const res = await fetch(`${baseUrl}/api/project-intake`, {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain(secretContent);
      const body = JSON.parse(text);
      expect(body.code).toBe('invalid-path');
    }
  });

  it('ignores .env, .env.local, src/.env.production, id_rsa, and certs/app.pem with a secret reason and never echoes body', async () => {
    const secretFiles = [
      '.env',
      '.env.local',
      'src/.env.production',
      'id_rsa',
      'certs/app.pem',
    ];

    const form = new FormData();
    for (const filename of secretFiles) {
      form.append('files', new Blob(['dummy']), filename);
    }
    form.append('files', new Blob(['export const App = () => <div>Hello</div>;']), 'src/App.tsx');

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('dummy');

    const body = JSON.parse(text);
    for (const filename of secretFiles) {
      const fileEntry = body.files.find((f: { relativePath: string }) => f.relativePath === filename);
      expect(fileEntry).toBeDefined();
      expect(fileEntry.status).toBe('ignored');
      expect(fileEntry.reason).toMatch(/secret/);
    }
    const appEntry = body.files.find((f: { relativePath: string }) => f.relativePath === 'src/App.tsx');
    expect(appEntry.status).toBe('accepted');
  });

  it('ignores node_modules, dist, and coverage even if the extension would otherwise be allowed', async () => {
    const form = new FormData();
    form.append('files', new Blob(['module.exports = {};']), 'node_modules/react/index.js');
    form.append('files', new Blob(['var bundle = {};']), 'dist/main.js');
    form.append('files', new Blob(['TN:']), 'coverage/lcov.info');

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.accepted).toBe(0);
    expect(body.counts.ignored).toBe(3);
    for (const f of body.files) {
      expect(f.status).toBe('ignored');
      expect(f.reason).toBe('secret-or-dependency-path');
    }
  });

  it('accepts .tsx and .html while marking .png and .md as unsupported', async () => {
    const form = new FormData();
    form.append('files', new Blob(['export const Home = () => <h1>Home</h1>;']), 'src/Home.tsx');
    form.append('files', new Blob(['<!DOCTYPE html><html><body></body></html>']), 'index.html');
    form.append('files', new Blob(['PNG_DATA']), 'public/logo.png');
    form.append('files', new Blob(['# Readme']), 'README.md');

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.accepted).toBe(2);
    expect(body.counts.ignored).toBe(2);

    const tsx = body.files.find((f: { relativePath: string }) => f.relativePath === 'src/Home.tsx');
    const html = body.files.find((f: { relativePath: string }) => f.relativePath === 'index.html');
    const png = body.files.find((f: { relativePath: string }) => f.relativePath === 'public/logo.png');
    const md = body.files.find((f: { relativePath: string }) => f.relativePath === 'README.md');

    expect(tsx.status).toBe('accepted');
    expect(html.status).toBe('accepted');
    expect(png.status).toBe('ignored');
    expect(png.reason).toBe('unsupported-extension');
    expect(md.status).toBe('ignored');
    expect(md.reason).toBe('unsupported-extension');
  });

  it('omits the 201st accepted candidate, marks completeness partial, and computes snapshotId only for accepted files', async () => {
    const form = new FormData();
    for (let i = 1; i <= PROJECT_INTAKE_LIMITS.maxAcceptedFiles + 1; i++) {
      form.append('files', new Blob([`export const Comp${i} = () => null;`]), `src/Comp${i}.tsx`);
    }

    const res = await fetch(`${baseUrl}/api/project-intake`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.completeness).toBe('partial');
    expect(body.counts.selected).toBe(201);
    expect(body.counts.accepted).toBe(200);
    expect(body.counts.omitted).toBe(1);
    expect(body.omissionReasons).toContain('accepted-file-cap');
    expect(body.snapshotId).not.toBeNull();
  });
});
