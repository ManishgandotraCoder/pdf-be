import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import {
  createPdf,
  deletePdf,
  getPdf,
  listPdfs,
  readPdfBytes,
  updatePdf,
} from './pdfs.store.js';
import { deletePdfState, getPdfState, putPdfState } from './pdf-state.store.js';
import { connectMongo } from './db.js';

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:4200';

const app = express();
app.use(cors({ origin: ORIGIN, credentials: false }));
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// CRUD: PDFs
app.get('/pdfs', async (_req, res) => {
  const pdfs = await listPdfs();
  res.json({ pdfs });
});

app.get('/pdfs/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const pdf = await getPdf(id);
  if (!pdf) return res.status(404).json({ error: 'not_found' });
  res.json({ pdf });
});

app.post('/pdfs', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'file_required' });
  const filename = f.originalname || 'upload.pdf';
  if (!filename.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'pdf_only' });
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  const pdf = await createPdf({ title, filename, bytes: f.buffer });
  res.status(201).json({ pdf });
});

app.put('/pdfs/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  const pdf = await updatePdf(id, { title });
  if (!pdf) return res.status(404).json({ error: 'not_found' });
  res.json({ pdf });
});

app.delete('/pdfs/:id', async (req, res) => {
  const id = String(req.params.id || '');
  const ok = await deletePdf(id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  await deletePdfState(id);
  res.status(204).send();
});

// Persist editor state per PDF (so re-opening shows edits)
app.get('/pdfs/:id/state', async (req, res) => {
  const id = String(req.params.id || '');
  const meta = await getPdf(id);
  if (!meta) return res.status(404).json({ error: 'not_found' });
  const st = await getPdfState(id);
  res.json({ state: st });
});

app.put('/pdfs/:id/state', async (req, res) => {
  const id = String(req.params.id || '');
  const meta = await getPdf(id);
  if (!meta) return res.status(404).json({ error: 'not_found' });
  const state = req.body?.state as unknown;
  if (state == null) return res.status(400).json({ error: 'state_required' });
  const saved = await putPdfState(id, state);
  // touch updatedAt so list updates
  await updatePdf(id, { title: undefined });
  res.json({ savedAt: saved.savedAt });
});

// View/download PDF bytes
app.get('/pdfs/:id/file', async (req, res) => {
  const id = String(req.params.id || '');
  const meta = await getPdf(id);
  if (!meta) return res.status(404).json({ error: 'not_found' });
  const bytes = await readPdfBytes(id);
  if (!bytes) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${meta.filename.replaceAll('"', '')}"`);
  res.send(bytes);
});

async function main(): Promise<void> {
  await connectMongo();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`PDF API listening on http://localhost:${PORT} (CORS origin ${ORIGIN})`);
  });
}

try {
  await main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exitCode = 1;
}

