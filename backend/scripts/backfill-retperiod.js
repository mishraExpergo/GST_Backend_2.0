/* eslint-disable no-console */
require('dotenv').config();
const { MongoClient } = require('mongodb');

function retperiodFrom(doc) {
  const month = Number(doc.month);
  const year = Number(doc.year);
  if (!Number.isInteger(month) || !Number.isInteger(year) || month < 1 || month > 12) {
    return null;
  }
  return `${String(month).padStart(2, '0')}${year}`;
}

async function backfill(collection) {
  const filter = {
    $or: [{ retperiod: null }, { retperiod: { $exists: false } }, { retperiod: '' }],
  };
  const missing = await collection.countDocuments(filter);
  console.log(`${collection.collectionName}: missing retperiod before = ${missing}`);

  const cursor = collection.find(filter);
  let modified = 0;
  let skipped = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const retperiod = retperiodFrom(doc);
    if (!retperiod) {
      skipped += 1;
      continue;
    }
    await collection.updateOne({ _id: doc._id }, { $set: { retperiod } });
    modified += 1;
  }

  const still = await collection.countDocuments(filter);
  console.log(
    `${collection.collectionName}: modified=${modified} skipped=${skipped} stillMissing=${still}`,
  );
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  await backfill(db.collection('gst_3b_compliance_data'));
  await backfill(db.collection('gst_2b_compliance_data'));
  await client.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
