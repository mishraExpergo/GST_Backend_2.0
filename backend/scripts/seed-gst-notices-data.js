require('dotenv').config();
const mongoose = require('mongoose');
const { Client } = require('pg');

const NOTICE_DATE = '25/08/2026';
const COLLECTION = 'gst_notices_data';

function noticesResponse(notices) {
  return {
    data: {
      notices,
    },
  };
}

function listDoc({ loanId, customerId, gstin, notices, username }) {
  return {
    recordType: 'LIST',
    associatedLoanId: loanId,
    customerId,
    gstin: gstin.trim().toUpperCase(),
    username: username || 'seed-user',
    noticeDate: NOTICE_DATE,
    dataSource: 'seed',
    response: noticesResponse(notices),
    systemMetadata: {
      fetchedAt: new Date().toISOString(),
      fetchMode: 'seed-gst-notices-data',
      dataSource: 'seed',
    },
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

async function loadUploadUnits() {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl:
      process.env.POSTGRES_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    const table =
      process.env.GST_AGGREGATION_SOURCE_TABLE || 'gst_uploaded_file_data';
    const result = await client.query(
      `SELECT TRIM(associated_loan_id) AS loan_id,
              TRIM(customer_id) AS customer_id,
              TRIM(primary_pan) AS pan,
              UPPER(TRIM(primary_gst_no)) AS gstin
         FROM "${table}"
        WHERE COALESCE(TRIM(primary_gst_no), '') <> ''
        LIMIT 3`,
    );
    return result.rows
      .filter((row) => row.loan_id && row.customer_id && row.gstin)
      .map((row) => ({
        loanId: row.loan_id,
        customerId: row.customer_id,
        pan: row.pan,
        gstin: row.gstin,
      }));
  } catch (err) {
    console.warn(
      `Could not read upload GSTINs from Postgres (${err.message}). Using fallback GSTINs.`,
    );
    return [];
  } finally {
    await client.end().catch(() => undefined);
  }
}

function fallbackUnits() {
  return [
    {
      loanId: 'SEED-LOAN-001',
      customerId: 'SEED-CUST-001',
      pan: 'AAACN0255D',
      gstin: '27AAACN0255D1ZM',
    },
    {
      loanId: 'SEED-LOAN-001',
      customerId: 'SEED-CUST-001',
      pan: 'AAACN0255D',
      gstin: '29AAACN0255D2ZN',
    },
    {
      loanId: 'SEED-LOAN-001',
      customerId: 'SEED-CUST-001',
      pan: 'AAACN0255D',
      gstin: '07AAACN0255D3ZO',
    },
  ];
}

function noticesForIndex(index) {
  if (index === 2) {
    return [];
  }

  if (index === 1) {
    return [
      {
        formCd: 'ASMT-10',
        ntcDesc: 'Scrutiny of returns',
        dtIssue: '12/05/2026',
        dtReply: '30/05/2026',
        refId: 'SEED-MED-1',
        currentStatus: 'Open',
        status: 'Pending',
      },
      {
        formCd: 'RFD-01',
        ntcDesc: 'Refund acknowledgement',
        dtIssue: '18/06/2026',
        dtReply: '25/06/2026',
        refId: 'SEED-LOW-1',
        currentStatus: 'Closed',
        status: 'Replied',
      },
    ];
  }

  return [
    {
      formCd: 'DRC-01',
      ntcDesc: 'Show cause notice / demand',
      dtIssue: '10/05/2026',
      dtReply: '25/05/2026',
      refId: 'SEED-HIGH-1',
      currentStatus: 'Open',
      status: 'Pending',
    },
    {
      formCd: 'DRC-07',
      ntcDesc: 'Demand order',
      dtIssue: '01/08/2026',
      dtReply: '20/08/2026',
      refId: 'SEED-HIGH-2',
      currentStatus: 'Open',
      status: 'Pending',
    },
    {
      formCd: 'ASMT-10',
      ntcDesc: 'Scrutiny of returns',
      dtIssue: '15/07/2026',
      dtReply: '01/08/2026',
      refId: 'SEED-MED-2',
      currentStatus: 'Open',
      status: 'Pending',
    },
    {
      formCd: 'DRC-01',
      ntcDesc: 'Show cause notice / demand',
      dtIssue: '20/11/2025',
      dtReply: '05/12/2025',
      refId: 'SEED-PREV-HIGH',
      currentStatus: 'Closed',
      status: 'Replied',
    },
  ];
}

(async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in .env');
  }

  const uploadUnits = await loadUploadUnits();
  const units = uploadUnits.length > 0 ? uploadUnits : fallbackUnits();
  const source = uploadUnits.length > 0 ? 'upload-table' : 'fallback';

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection(COLLECTION);

  const inserted = [];
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const doc = listDoc({
      ...unit,
      notices: noticesForIndex(i),
    });
    await collection.updateOne(
      {
        recordType: 'LIST',
        associatedLoanId: doc.associatedLoanId,
        customerId: doc.customerId,
        gstin: doc.gstin,
        noticeDate: NOTICE_DATE,
      },
      { $set: doc },
      { upsert: true },
    );
    inserted.push({
      gstin: doc.gstin,
      loanId: doc.associatedLoanId,
      customerId: doc.customerId,
      pan: unit.pan,
      noticeCount: noticesForIndex(i).length,
    });
  }

  const count = await collection.countDocuments({ dataSource: 'seed' });
  console.log(
    JSON.stringify(
      {
        collection: COLLECTION,
        source,
        upserted: inserted,
        seedDocsInCollection: count,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
