import mongoose, { Schema } from 'mongoose';
import { connectMongo } from './db.js';

export type PdfMonographRecord = {
  v: 1;
  updatedAt: number;
  html: string;
  logicCheck: unknown | null;
  sourceFilename: string | null;
};

type PdfMonographDoc = PdfMonographRecord & { _id: string };

const PdfMonographSchema = new Schema<PdfMonographDoc>(
  {
    _id: { type: String, required: true }, // pdfId
    v: { type: Number, required: true, default: 1 },
    updatedAt: { type: Number, required: true },
    html: { type: String, required: true },
    logicCheck: { type: Schema.Types.Mixed, default: null },
    sourceFilename: { type: String, default: null },
  },
  { versionKey: false },
);

const PdfMonographModel =
  (mongoose.models.PdfMonograph as mongoose.Model<PdfMonographDoc>) ||
  mongoose.model<PdfMonographDoc>('PdfMonograph', PdfMonographSchema, 'pdf_monographs');

export async function getPdfMonograph(pdfId: string): Promise<PdfMonographRecord | null> {
  await connectMongo();
  const doc = await PdfMonographModel.findById(pdfId).lean<PdfMonographDoc>().exec();
  if (!doc) return null;
  return {
    v: 1,
    updatedAt: doc.updatedAt,
    html: doc.html,
    logicCheck: doc.logicCheck ?? null,
    sourceFilename: doc.sourceFilename ?? null,
  };
}

export async function putPdfMonograph(
  pdfId: string,
  input: { html: string; logicCheck?: unknown | null; sourceFilename?: string | null },
): Promise<PdfMonographRecord> {
  await connectMongo();
  const rec: PdfMonographRecord = {
    v: 1,
    updatedAt: Date.now(),
    html: input.html,
    logicCheck: input.logicCheck ?? null,
    sourceFilename: input.sourceFilename ?? null,
  };
  await PdfMonographModel.updateOne({ _id: pdfId }, { $set: rec }, { upsert: true }).exec();
  return rec;
}

export async function deletePdfMonograph(pdfId: string): Promise<void> {
  await connectMongo();
  await PdfMonographModel.deleteOne({ _id: pdfId }).exec();
}
