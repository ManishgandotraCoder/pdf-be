import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

let connectPromise: Promise<typeof mongoose> | null = null;
let bucket: GridFSBucket | null = null;

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  if (!connectPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('Missing MONGODB_URI (Mongo connection string).');
    }
    connectPromise = mongoose.connect(uri);
  }
  await connectPromise;
}

export function getPdfBucket(): GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo not connected yet.');
  if (!bucket) bucket = new GridFSBucket(db, { bucketName: 'pdfs' });
  return bucket;
}

