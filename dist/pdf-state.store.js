import mongoose, { Schema } from 'mongoose';
import { connectMongo } from './db.js';
const PdfStateSchema = new Schema({
    _id: { type: String, required: true }, // pdfId
    v: { type: Number, required: true, default: 1 },
    savedAt: { type: Number, required: true },
    state: { type: Schema.Types.Mixed, required: true },
}, { versionKey: false });
const PdfStateModel = mongoose.models.PdfState ||
    mongoose.model('PdfState', PdfStateSchema, 'pdf_states');
export async function getPdfState(pdfId) {
    await connectMongo();
    const doc = await PdfStateModel.findById(pdfId).lean().exec();
    if (!doc)
        return null;
    return { v: 1, savedAt: doc.savedAt, state: doc.state };
}
export async function putPdfState(pdfId, state) {
    await connectMongo();
    const rec = { v: 1, savedAt: Date.now(), state };
    await PdfStateModel.updateOne({ _id: pdfId }, { $set: rec }, { upsert: true }).exec();
    return rec;
}
export async function deletePdfState(pdfId) {
    await connectMongo();
    await PdfStateModel.deleteOne({ _id: pdfId }).exec();
}
