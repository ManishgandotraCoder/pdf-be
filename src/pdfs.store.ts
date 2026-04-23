import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import mongoose, { Schema } from 'mongoose';
import { ObjectId } from 'mongodb';
import { connectMongo, getPdfBucket } from './db.js';

export type PdfRecord = {
  id: string;
  title: string;
  filename: string;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
};

type PdfDoc = {
  _id: string; // id
  title: string;
  filename: string;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
  fileId: ObjectId;
};

const PdfSchema = new Schema<PdfDoc>(
  {
    _id: { type: String, required: true },
    title: { type: String, required: true },
    filename: { type: String, required: true },
    byteSize: { type: Number, required: true },
    createdAt: { type: Number, required: true },
    updatedAt: { type: Number, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
  },
  { versionKey: false }
);

const PdfModel =
  (mongoose.models.Pdf as mongoose.Model<PdfDoc>) || mongoose.model<PdfDoc>('Pdf', PdfSchema, 'pdfs');

function toRecord(doc: Pick<PdfDoc, '_id' | 'title' | 'filename' | 'byteSize' | 'createdAt' | 'updatedAt'>): PdfRecord {
  return {
    id: doc._id,
    title: doc.title,
    filename: doc.filename,
    byteSize: doc.byteSize,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function uploadPdfToGridFs(pdfId: string, bytes: Buffer): Promise<ObjectId> {
  const bucket = getPdfBucket();
  const upload = bucket.openUploadStream(`${pdfId}.pdf`, {
    metadata: { pdfId, contentType: 'application/pdf' },
  });
  await new Promise<void>((resolve, reject) => {
    Readable.from(bytes)
      .pipe(upload)
      .on('error', reject)
      .on('finish', () => resolve());
  });
  const id = upload.id;
  if (!(id instanceof ObjectId)) throw new Error('Unexpected GridFS id type.');
  return id;
}

async function deleteGridFsFile(fileId: ObjectId): Promise<void> {
  const bucket = getPdfBucket();
  try {
    await bucket.delete(fileId);
  } catch {
    // ignore
  }
}

export async function listPdfs(): Promise<PdfRecord[]> {
  await connectMongo();
  const docs = await PdfModel.find({}).sort({ updatedAt: -1 }).lean<PdfDoc[]>().exec();
  return docs.map((d) => toRecord(d));
}

export async function getPdf(id: string): Promise<PdfRecord | null> {
  await connectMongo();
  const doc = await PdfModel.findById(id).lean<PdfDoc>().exec();
  return doc ? toRecord(doc) : null;
}

export async function createPdf(input: { title?: string; filename: string; bytes: Buffer }): Promise<PdfRecord> {
  await connectMongo();
  const now = Date.now();
  const id = randomUUID();
  const fileId = await uploadPdfToGridFs(id, input.bytes);
  const doc: PdfDoc = {
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

export async function updatePdf(id: string, patch: { title?: string }): Promise<PdfRecord | null> {
  await connectMongo();
  const doc = await PdfModel.findById(id).exec();
  if (!doc) return null;
  if (patch.title != null) doc.title = patch.title.trim().slice(0, 120);
  doc.updatedAt = Date.now();
  await doc.save();
  return toRecord(doc.toObject() as PdfDoc);
}

export async function deletePdf(id: string): Promise<boolean> {
  await connectMongo();
  const doc = await PdfModel.findById(id).lean<PdfDoc>().exec();
  if (!doc) return false;
  await PdfModel.deleteOne({ _id: id }).exec();
  await deleteGridFsFile(doc.fileId);
  return true;
}

export async function readPdfBytes(id: string): Promise<Buffer | null> {
  await connectMongo();
  const doc = await PdfModel.findById(id).lean<PdfDoc>().exec();
  if (!doc) return null;

  const bucket = getPdfBucket();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer | null>((resolve) => {
    const dl = bucket.openDownloadStream(doc.fileId);
    dl.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    dl.on('error', () => resolve(null));
    dl.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function replacePdfFile(
  id: string,
  input: { filename?: string; bytes: Buffer },
): Promise<PdfRecord | null> {
  await connectMongo();
  const doc = await PdfModel.findById(id).exec();
  if (!doc) return null;

  const nextFileId = await uploadPdfToGridFs(id, input.bytes);
  const prevFileId = doc.fileId;

  try {
    if (input.filename?.trim()) doc.filename = input.filename.trim().slice(0, 240);
    doc.fileId = nextFileId;
    doc.byteSize = input.bytes.byteLength;
    doc.updatedAt = Date.now();
    await doc.save();
  } catch (error) {
    await deleteGridFsFile(nextFileId);
    throw error;
  }

  await deleteGridFsFile(prevFileId);
  return toRecord(doc.toObject() as PdfDoc);
}
