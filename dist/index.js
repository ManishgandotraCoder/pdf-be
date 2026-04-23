import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createPdf, deletePdf, getPdf, listPdfs, readPdfBytes, replacePdfFile, updatePdf, } from './pdfs.store.js';
import { deletePdfState, getPdfState, putPdfState } from './pdf-state.store.js';
import { convertSourceFileToMonograph } from './monograph-converter.js';
import { deletePdfMonograph, getPdfMonograph, putPdfMonograph } from './pdf-monograph.store.js';
import { connectMongo } from './db.js';
const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const CORS_ORIGINS_RAW = process.env.CORS_ORIGINS ||
    process.env.CORS_ORIGIN ||
    'http://localhost:4200,http://localhost:5173,https://pdf-eight-omega.vercel.app';
const ALLOWED_ORIGINS = new Set(CORS_ORIGINS_RAW.split(',')
    .map((s) => s.trim())
    .filter(Boolean));
const app = express();
const corsOptions = {
    origin(origin, cb) {
        // Non-browser clients (curl/server-to-server) often send no Origin.
        if (!origin)
            return cb(null, true);
        return cb(null, ALLOWED_ORIGINS.has(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
const upload = multer({
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
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
    if (!pdf)
        return res.status(404).json({ error: 'not_found' });
    res.json({ pdf });
});
app.post('/pdfs', upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f)
        return res.status(400).json({ error: 'file_required' });
    const filename = f.originalname || 'upload.pdf';
    if (!filename.toLowerCase().endsWith('.pdf'))
        return res.status(400).json({ error: 'pdf_only' });
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const pdf = await createPdf({ title, filename, bytes: f.buffer });
    res.status(201).json({ pdf });
});
app.put('/pdfs/:id', async (req, res) => {
    const id = String(req.params.id || '');
    const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
    const pdf = await updatePdf(id, { title });
    if (!pdf)
        return res.status(404).json({ error: 'not_found' });
    res.json({ pdf });
});
app.put('/pdfs/:id/file', upload.single('file'), async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const f = req.file;
    if (!f)
        return res.status(400).json({ error: 'file_required' });
    const filename = (f.originalname || meta.filename || 'edited.pdf').trim();
    if (!filename.toLowerCase().endsWith('.pdf'))
        return res.status(400).json({ error: 'pdf_only' });
    const pdf = await replacePdfFile(id, { filename, bytes: f.buffer });
    if (!pdf)
        return res.status(404).json({ error: 'not_found' });
    // Legacy overlay state no longer matches once the actual PDF bytes change.
    await deletePdfState(id);
    await deletePdfMonograph(id);
    res.json({ pdf });
});
app.delete('/pdfs/:id', async (req, res) => {
    const id = String(req.params.id || '');
    const ok = await deletePdf(id);
    if (!ok)
        return res.status(404).json({ error: 'not_found' });
    await deletePdfState(id);
    await deletePdfMonograph(id);
    res.status(204).send();
});
app.get('/pdfs/:id/monograph', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const monograph = await getPdfMonograph(id);
    res.json({ monograph });
});
app.post('/pdfs/:id/monograph/convert', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const force = String(req.query.force || '') === '1';
    if (!force) {
        const existing = await getPdfMonograph(id);
        if (existing?.html?.trim())
            return res.json({ monograph: existing, reused: true });
    }
    try {
        const bytes = await readPdfBytes(id);
        if (!bytes)
            return res.status(404).json({ error: 'file_not_found' });
        const converted = await convertSourceFileToMonograph({
            filename: meta.filename || 'document.pdf',
            mimeType: 'application/pdf',
            bytes: new Uint8Array(bytes),
        });
        const monograph = await putPdfMonograph(id, {
            html: converted.html,
            logicCheck: converted.logicCheck,
            sourceFilename: meta.filename || null,
        });
        await updatePdf(id, { title: undefined });
        res.json({ monograph, reused: false });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ error: 'conversion_failed', message });
    }
});
app.put('/pdfs/:id/monograph', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    if (!html.trim())
        return res.status(400).json({ error: 'html_required' });
    const monograph = await putPdfMonograph(id, {
        html,
        logicCheck: req.body?.logicCheck ?? null,
        sourceFilename: meta.filename || null,
    });
    await updatePdf(id, { title: undefined });
    res.json({ monograph });
});
// Persist editor state per PDF (so re-opening shows edits)
app.get('/pdfs/:id/state', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const st = await getPdfState(id);
    res.json({ state: st });
});
app.put('/pdfs/:id/state', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const state = req.body?.state;
    if (state == null)
        return res.status(400).json({ error: 'state_required' });
    const saved = await putPdfState(id, state);
    // touch updatedAt so list updates
    await updatePdf(id, { title: undefined });
    res.json({ savedAt: saved.savedAt });
});
// View/download PDF bytes
app.get('/pdfs/:id/file', async (req, res) => {
    const id = String(req.params.id || '');
    const meta = await getPdf(id);
    if (!meta)
        return res.status(404).json({ error: 'not_found' });
    const bytes = await readPdfBytes(id);
    if (!bytes)
        return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${meta.filename.replaceAll('"', '')}"`);
    res.send(bytes);
});
async function main() {
    await connectMongo();
    app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`PDF API listening on http://localhost:${PORT} (CORS origins: ${Array.from(ALLOWED_ORIGINS).join(', ')})`);
    });
}
try {
    await main();
}
catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err);
    process.exitCode = 1;
}
