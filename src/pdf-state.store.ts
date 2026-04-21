import mongoose, { Schema } from 'mongoose';
import { connectMongo } from './db.js';

export type PdfEditorState = {
  v: 1;
  savedAt: number;
  state: unknown;
};

type PdfStateDoc = PdfEditorState & { _id: string };

const PdfStateSchema = new Schema<PdfStateDoc>(
  {
    _id: { type: String, required: true }, // pdfId
    v: { type: Number, required: true, default: 1 },
    savedAt: { type: Number, required: true },
    state: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false }
);

const PdfStateModel =
  (mongoose.models.PdfState as mongoose.Model<PdfStateDoc>) ||
  mongoose.model<PdfStateDoc>('PdfState', PdfStateSchema, 'pdf_states');

export async function getPdfState(pdfId: string): Promise<PdfEditorState | null> {
  await connectMongo();
  const doc = await PdfStateModel.findById(pdfId).lean<PdfStateDoc>().exec();
  if (!doc) return null;
  return { v: 1, savedAt: doc.savedAt, state: doc.state };
}

export async function putPdfState(pdfId: string, state: unknown): Promise<PdfEditorState> {
  await connectMongo();
  const rec: PdfEditorState = { v: 1, savedAt: Date.now(), state };
  await PdfStateModel.updateOne({ _id: pdfId }, { $set: rec }, { upsert: true }).exec();
  return rec;
}

export async function deletePdfState(pdfId: string): Promise<void> {
  await connectMongo();
  await PdfStateModel.deleteOne({ _id: pdfId }).exec();
}

