import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type FetchFn = (input: string, init?: Record<string, unknown>) => Promise<any>;

type PdfJsTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type PdfJsTextContent = {
  items: PdfJsTextItem[];
};

type PdfJsPage = {
  getTextContent(): Promise<PdfJsTextContent>;
};

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
};

type PdfJsLib = {
  getDocument(input: Record<string, unknown>): { promise: Promise<PdfJsDocument> };
};

type LocalTextRow = {
  pageNum: number;
  text: string;
  y: number;
  avgFontSize: number;
};

let cachedPdfJs: PdfJsLib | null = null;

function getFetch(): FetchFn {
  const fetchFn = (globalThis as { fetch?: FetchFn }).fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime.');
  }
  return fetchFn;
}

function getFormDataCtor(): new () => { append(name: string, value: unknown, filename?: string): void } {
  const Ctor = (globalThis as { FormData?: new () => { append(name: string, value: unknown, filename?: string): void } })
    .FormData;
  if (typeof Ctor !== 'function') {
    throw new Error('Global FormData is unavailable in this Node runtime.');
  }
  return Ctor;
}

function getBlobCtor(): new (parts?: unknown[], options?: { type?: string }) => unknown {
  const Ctor = (globalThis as { Blob?: new (parts?: unknown[], options?: { type?: string }) => unknown }).Blob;
  if (typeof Ctor !== 'function') {
    throw new Error('Global Blob is unavailable in this Node runtime.');
  }
  return Ctor;
}

function configuredConverterBaseUrl(): string | null {
  const raw =
    process.env.WINDOWS_SERVER_URL ||
    process.env.MONOGRAPH_CONVERTER_URL ||
    process.env.NEXT_PUBLIC_WINDOWS_SERVER_URL ||
    '';
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function endpointUrl(pathname: string): string {
  const baseUrl = configuredConverterBaseUrl();
  if (!baseUrl) {
    throw new Error(
      'Missing WINDOWS_SERVER_URL (or MONOGRAPH_CONVERTER_URL / NEXT_PUBLIC_WINDOWS_SERVER_URL) for HTML conversion.',
    );
  }
  return new URL(pathname.replace(/^\//, ''), baseUrl).toString();
}

async function parseBody(res: any): Promise<unknown> {
  const contentType = String(res.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

function summarizeRemoteBody(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 240);
  try {
    return JSON.stringify(body).slice(0, 240);
  } catch {
    return String(body).slice(0, 240);
  }
}

function extractHtml(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.html === 'string') return rec.html;
    if (typeof rec.content === 'string') return rec.content;
    if (typeof rec.data === 'string') return rec.data;
    if (rec.result && typeof rec.result === 'object' && rec.result) {
      const nested = rec.result as Record<string, unknown>;
      if (typeof nested.html === 'string') return nested.html;
      if (typeof nested.content === 'string') return nested.content;
    }
  }
  throw new Error('Conversion service returned no HTML payload.');
}

async function bestEffortComplianceCheck(fetchFn: FetchFn, html: string): Promise<unknown | null> {
  try {
    const res = await fetchFn(endpointUrl('/documentCheck'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
    });
    if (!res.ok) return null;
    return await parseBody(res);
  } catch {
    return null;
  }
}

async function tryRemoteConversion(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ html: string; logicCheck: unknown | null } | null> {
  if (!configuredConverterBaseUrl()) return null;

  const fetchFn = getFetch();
  const FormDataCtor = getFormDataCtor();
  const BlobCtor = getBlobCtor();

  const fd = new FormDataCtor();
  fd.append('file', new BlobCtor([input.bytes], { type: input.mimeType }), input.filename);

  const res = await fetchFn(endpointUrl('/filetohtml'), {
    method: 'POST',
    body: fd,
  });

  const body = await parseBody(res);
  if (!res.ok) {
    throw new Error(`HTML conversion failed (${res.status}): ${summarizeRemoteBody(body)}`);
  }

  const html = extractHtml(body).trim();
  if (!html) {
    throw new Error('HTML conversion returned an empty document.');
  }

  const logicCheck = await bestEffortComplianceCheck(fetchFn, html);
  return { html, logicCheck };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugifyFilename(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function resolvePdfJs(): PdfJsLib {
  if (cachedPdfJs) return cachedPdfJs;

  const require = createRequire(import.meta.url);
  const frontEndDir = fileURLToPath(new URL('../../front-end', import.meta.url));
  const pdfJsPath = require.resolve('pdfjs-dist/legacy/build/pdf.js', {
    paths: [frontEndDir, path.join(frontEndDir, 'node_modules')],
  });

  cachedPdfJs = require(pdfJsPath) as PdfJsLib;
  return cachedPdfJs;
}

function estimateFontSize(item: PdfJsTextItem): number {
  const h = typeof item.height === 'number' && Number.isFinite(item.height) ? item.height : 0;
  if (h > 0) return h;
  const t = Array.isArray(item.transform) ? item.transform : [];
  const a = typeof t[0] === 'number' ? t[0] : 0;
  const b = typeof t[1] === 'number' ? t[1] : 0;
  const c = typeof t[2] === 'number' ? t[2] : 0;
  const d = typeof t[3] === 'number' ? t[3] : 0;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d), 12);
}

function itemX(item: PdfJsTextItem): number {
  return Array.isArray(item.transform) && typeof item.transform[4] === 'number' ? item.transform[4] : 0;
}

function itemY(item: PdfJsTextItem): number {
  return Array.isArray(item.transform) && typeof item.transform[5] === 'number' ? item.transform[5] : 0;
}

function median(values: number[]): number {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function tagForRow(row: LocalTextRow, bodyFontSize: number): 'h1' | 'h2' | 'p' {
  const len = row.text.length;
  if (row.avgFontSize >= bodyFontSize * 1.9 && len <= 120) return 'h1';
  if (row.avgFontSize >= bodyFontSize * 1.45 && len <= 180) return 'h2';
  return 'p';
}

function mergeItemsIntoRows(pageNum: number, items: PdfJsTextItem[]): LocalTextRow[] {
  const atoms = items
    .map((item) => ({
      text: normalizedText(String(item.str || '')),
      x: itemX(item),
      y: itemY(item),
      width: typeof item.width === 'number' && Number.isFinite(item.width) ? item.width : 0,
      fontSize: estimateFontSize(item),
      hasEOL: !!item.hasEOL,
    }))
    .filter((item) => item.text);

  atoms.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: Array<{ y: number; items: typeof atoms; fontSum: number; fontCount: number }> = [];
  for (const atom of atoms) {
    const match = rows.find((row) => Math.abs(row.y - atom.y) <= Math.max(2, atom.fontSize * 0.45));
    if (match) {
      match.items.push(atom);
      match.fontSum += atom.fontSize;
      match.fontCount += 1;
      match.y = (match.y + atom.y) / 2;
    } else {
      rows.push({ y: atom.y, items: [atom], fontSum: atom.fontSize, fontCount: 1 });
    }
  }

  return rows
    .map((row) => {
      const sorted = [...row.items].sort((a, b) => a.x - b.x);
      let text = '';
      let prevRight = 0;
      for (let i = 0; i < sorted.length; i++) {
        const atom = sorted[i]!;
        const raw = atom.text;
        const gap = i === 0 ? 0 : atom.x - prevRight;
        const needsSpace =
          i > 0 &&
          gap > Math.max(2, atom.fontSize * 0.18) &&
          !text.endsWith('-') &&
          !raw.startsWith('.') &&
          !raw.startsWith(',') &&
          !raw.startsWith(';') &&
          !raw.startsWith(':') &&
          !raw.startsWith(')');
        text += `${needsSpace ? ' ' : ''}${raw}`;
        prevRight = atom.x + atom.width;
      }
      return {
        pageNum,
        text: normalizedText(text),
        y: row.y,
        avgFontSize: row.fontSum / Math.max(1, row.fontCount),
      };
    })
    .filter((row) => row.text);
}

async function convertLocallyToHtml(input: {
  filename: string;
  bytes: Uint8Array;
}): Promise<{ html: string; logicCheck: unknown | null }> {
  const pdfjs = resolvePdfJs();
  const pdf = await pdfjs.getDocument({
    data: input.bytes,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const allRows: LocalTextRow[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    allRows.push(...mergeItemsIntoRows(pageNum, textContent.items || []));
  }

  const bodyFontSize = median(allRows.map((row) => row.avgFontSize).filter((size) => Number.isFinite(size) && size > 0));
  const title = slugifyFilename(input.filename) || 'Document';

  const pageSections: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const rows = allRows.filter((row) => row.pageNum === pageNum);
    const body = rows.length
      ? rows
          .map((row) => {
            const tag = tagForRow(row, bodyFontSize);
            return `      <${tag}>${escapeHtml(row.text)}</${tag}>`;
          })
          .join('\n')
      : '      <p></p>';

    pageSections.push(
      [
        `    <section class="page" data-page-number="${pageNum}">`,
        `      <div class="page__eyebrow">Page ${pageNum}</div>`,
        body,
        '    </section>',
      ].join('\n'),
    );
  }

  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    `    <title>${escapeHtml(title)}</title>`,
    '    <style>',
    '      html, body { margin: 0; padding: 0; background: #f8fafc; color: #0f172a; }',
    "      body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.65; }",
    '      .document { max-width: 920px; margin: 0 auto; padding: 32px 20px 80px; }',
    '      .document__title { margin: 0 0 18px; font-size: 34px; line-height: 1.08; }',
    '      .document__note { margin: 0 0 28px; color: #475569; font-size: 14px; }',
    '      .page { margin: 0 0 22px; padding: 28px 32px; background: #ffffff; border: 1px solid rgba(15,23,42,0.08); border-radius: 20px; box-shadow: 0 18px 40px rgba(15,23,42,0.08); }',
    '      .page__eyebrow { margin-bottom: 16px; font: 700 11px/1.2 Arial, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; }',
    '      .page h1, .page h2, .page p { margin-top: 0; }',
    '      .page h1 { font-size: 30px; line-height: 1.12; margin-bottom: 16px; }',
    '      .page h2 { font-size: 22px; line-height: 1.2; margin-bottom: 14px; }',
    '      .page p { font-size: 16px; margin-bottom: 12px; }',
    '      @media print { .page { page-break-after: always; box-shadow: none; } }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <main class="document">',
    `      <h1 class="document__title">${escapeHtml(title)}</h1>`,
    '      <p class="document__note">Built-in local conversion was used to create this editable HTML draft from the PDF text content.</p>',
    ...pageSections,
    '    </main>',
    '  </body>',
    '</html>',
  ].join('\n');

  return { html, logicCheck: null };
}

export async function convertSourceFileToMonograph(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ html: string; logicCheck: unknown | null }> {
  try {
    const remote = await tryRemoteConversion(input);
    if (remote) return remote;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Remote PDF->HTML conversion failed, falling back to local extraction: ${message}`);
  }

  return convertLocallyToHtml({
    filename: input.filename,
    bytes: input.bytes,
  });
}
