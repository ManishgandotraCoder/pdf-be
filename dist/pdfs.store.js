import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import mongoose, { Schema } from 'mongoose';
import { ObjectId } from 'mongodb';
import { connectMongo, getPdfBucket } from './db.js';
const PdfSchema = new Schema({
    _id: { type: String, required: true },
    title: { type: String, required: true },
    filename: { type: String, required: true },
    byteSize: { type: Number, required: true },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
}, { versionKey: false });
const PdfModel = mongoose.models.Pdf || mongoose.model('Pdf', PdfSchema, 'pdfs');
function toRecord(doc) {
    return {
        id: doc._id,
        title: doc.title,
        filename: doc.filename,
        byteSize: doc.byteSize,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}
async function uploadPdfToGridFs(pdfId, bytes) {
    const bucket = getPdfBucket();
    const upload = bucket.openUploadStream(`${pdfId}.pdf`, {
        metadata: { pdfId, contentType: 'application/pdf' },
    });
    await new Promise((resolve, reject) => {
        Readable.from(bytes)
            .pipe(upload)
            .on('error', reject)
            .on('finish', () => resolve());
    });
    const id = upload.id;
    if (!(id instanceof ObjectId))
        throw new Error('Unexpected GridFS id type.');
    return id;
}
async function deleteGridFsFile(fileId) {
    const bucket = getPdfBucket();
    try {
        await bucket.delete(fileId);
    }
    catch {
        // ignore
    }
}
export async function listPdfs() {
    await connectMongo();
    const docs = await PdfModel.find({}).sort({ updatedAt: -1 }).lean().exec();
    return docs.map((d) => toRecord(d));
}
export async function getPdf(id) {
    await connectMongo();
    const doc = await PdfModel.findById(id).lean().exec();
    return doc ? toRecord(doc) : null;
}
export async function createPdf(input) {
    await connectMongo();
    const now = Date.now();
    const id = randomUUID();
    const fileId = await uploadPdfToGridFs(id, input.bytes);
    const doc = {
        _id: id,
        title: (input.title?.trim() || input.filename || 'Untitled').slice(0, 120),
        filename: input.filename,
        byteSize: input.bytes.byteLength,
        createdAt: now,
        updatedAt: now,
        fileId,
    };
    await PdfModel.create(doc);
    return toRecord(doc);
}
export async function updatePdf(id, patch) {
    await connectMongo();
    const doc = await PdfModel.findById(id).exec();
    if (!doc)
        return null;
    if (patch.title != null)
        doc.title = patch.title.trim().slice(0, 120);
    doc.updatedAt = Date.now();
    await doc.save();
    return toRecord(doc.toObject());
}
export async function deletePdf(id) {
    await connectMongo();
    const doc = await PdfModel.findById(id).lean().exec();
    if (!doc)
        return false;
    await PdfModel.deleteOne({ _id: id }).exec();
    await deleteGridFsFile(doc.fileId);
    return true;
}
export async function readPdfBytes(id) {
    await connectMongo();
    const doc = await PdfModel.findById(id).lean().exec();
    if (!doc)
        return null;
    const bucket = getPdfBucket();
    const chunks = [];
    return await new Promise((resolve) => {
        const dl = bucket.openDownloadStream(doc.fileId);
        dl.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        dl.on('error', () => resolve(null));
        dl.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
export async function replacePdfFile(id, input) {
    await connectMongo();
    const doc = await PdfModel.findById(id).exec();
    if (!doc)
        return null;
    const nextFileId = await uploadPdfToGridFs(id, input.bytes);
    const prevFileId = doc.fileId;
    try {
        if (input.filename?.trim())
            doc.filename = input.filename.trim().slice(0, 240);
        doc.fileId = nextFileId;
        doc.byteSize = input.bytes.byteLength;
        doc.updatedAt = Date.now();
        await doc.save();
    }
    catch (error) {
        await deleteGridFsFile(nextFileId);
        throw error;
    }
    await deleteGridFsFile(prevFileId);
    return toRecord(doc.toObject());
}
