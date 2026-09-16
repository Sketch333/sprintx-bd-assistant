import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadGoogleDriveText, listGoogleDriveFilesRecursively } from '../src/lib/ingest';
const axios = require('axios');
const XLSX = require('xlsx');

test('Drive blobs request file media rather than metadata', async () => {
  const original = axios.get;
  axios.get = async (_url: string, options: any) => {
    assert.equal(options.params.alt, 'media');
    return { data: Buffer.from('Actual document content') };
  };
  try {
    assert.equal(await downloadGoogleDriveText({ id: 'fixture', name: 'brief.txt', mimeType: 'text/plain' }, 'fixture-token'), 'Actual document content');
  } finally { axios.get = original; }
});

test('Google Sheets imports every worksheet', async () => {
  const original = axios.get;
  const workbook = XLSX.utils.book_new();
  for (const name of ['First', 'Second']) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Heading'], [`${name} knowledge`]]), name);
  axios.get = async (_url: string, options: any) => {
    assert.equal(options.params.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return { data: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) };
  };
  try {
    const text = await downloadGoogleDriveText({ id: 'fixture', name: 'Workbook', mimeType: 'application/vnd.google-apps.spreadsheet' }, 'fixture-token');
    assert.match(text, /First knowledge/);
    assert.match(text, /Second knowledge/);
  } finally { axios.get = original; }
});

test('Drive recursion excludes Archive folders', async () => {
  const original = axios.get;
  axios.get = async (_url: string, options: any) => {
    assert.match(options.params.q, /'root'/);
    return { data: { files: [{ id: 'archive', name: 'ARCHIVE', mimeType: 'application/vnd.google-apps.folder' }, { id: 'doc', name: 'brief.txt', mimeType: 'text/plain' }] } };
  };
  try { assert.deepEqual((await listGoogleDriveFilesRecursively('root', 'fixture-token')).map((file) => file.id), ['doc']); }
  finally { axios.get = original; }
});
