const dns = require('node:dns');
const mongoose = require('mongoose');
const { Client } = require('pg');

dns.setServers(['8.8.8.8', '1.1.1.1']);

const GSTIN_PATTERN =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function resolvePan(rowPan, gstin) {
  const normalized = String(rowPan ?? '').trim().toUpperCase();
  return normalized || gstin.substring(2, 12);
}

async function main() {
  const pg = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl:
      process.env.POSTGRES_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });

  await pg.connect();
  const { rows: uploadRows } = await pg.query(`
    SELECT customer_id, associated_loan_id, primary_pan, primary_gst_no
      FROM gst_uploaded_file_data
     WHERE primary_gst_no IS NOT NULL
  `);
  await pg.end();

  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('gst_gstR1_complaince_data');

  try {
    await col.dropIndex('loanId_1_gstNo_1');
  } catch {
    // Index may already be removed.
  }

  const templates = await col
    .find({
      $or: [{ pan: { $exists: false } }, { pan: null }, { pan: '' }],
    })
    .toArray();
  const template = templates[0] ?? null;

  let upserts = 0;
  for (const row of uploadRows) {
    const gstin = String(row.primary_gst_no ?? '').trim().toUpperCase();
    const loanId = String(row.associated_loan_id ?? '').trim();
    const customerId = String(row.customer_id ?? '').trim();
    if (!gstin || !loanId || !customerId || !GSTIN_PATTERN.test(gstin)) {
      continue;
    }

    const pan = resolvePan(row.primary_pan, gstin);
    const base = template
      ? {
          returns: template.returns,
          gstrResponse: template.gstrResponse,
          analysis: template.analysis,
          systemMetadata: template.systemMetadata,
          returnType: template.returnType ?? 'GSTR-1',
          modeOfFiling: template.modeOfFiling,
          overallStatus: template.overallStatus,
        }
      : {};

    await col.updateOne(
      { loanId, gstin, financialYear: '2024-25' },
      {
        $set: {
          loanId,
          customerId,
          gstin,
          gstNo: gstin,
          pan,
          entityType: 'PRIMARY',
          financialYear: '2024-25',
          sourceTable: 'gst_uploaded_file_data',
          ...base,
        },
      },
      { upsert: true },
    );
    upserts++;
  }

  if (template?._id) {
    await col.deleteOne({ _id: template._id });
  }

  const sample = await col.findOne(
    {},
    { projection: { loanId: 1, customerId: 1, gstin: 1, pan: 1, entityType: 1 } },
  );

  console.log(
    JSON.stringify(
      {
        upserts,
        removedTemplates: template ? 1 : 0,
        sample,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
