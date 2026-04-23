import mongoose, { Schema } from 'mongoose';
import { connectMongo } from './db.js';
const PdfMonographSchema = new Schema({
    _id: { type: String, required: true }, // pdfId
    v: { type: Number, required: true, default: 1 },
    updatedAt: { type: Number, required: true },
    html: { type: String, required: true },
    logicCheck: { type: Schema.Types.Mixed, default: null },
    sourceFilename: { type: String, default: null },
}, { versionKey: false });
const PdfMonographModel = mongoose.models.PdfMonograph ||
    mongoose.model('PdfMonograph', PdfMonographSchema, 'pdf_monographs');
export async function getPdfMonograph(pdfId) {
    await connectMongo();
    const doc = await PdfMonographModel.findById(pdfId).lean().exec();
    if (!doc)
        return null;
    return {
        v: 1,
        updatedAt: doc.updatedAt,
        html: doc.html,
        logicCheck: doc.logicCheck ?? null,
        sourceFilename: doc.sourceFilename ?? null,
    };
}
export async function putPdfMonograph(pdfId, input) {
    await connectMongo();
    const rec = {
        v: 1,
        updatedAt: Date.now(),
        html: input.html,
        logicCheck: input.logicCheck ?? null,
        sourceFilename: input.sourceFilename ?? null,
    };
    await PdfMonographModel.updateOne({ _id: pdfId }, { $set: rec }, { upsert: true }).exec();
    return rec;
}
export async function deletePdfMonograph(pdfId) {
    await connectMongo();
    await PdfMonographModel.deleteOne({ _id: pdfId }).exec();
}
