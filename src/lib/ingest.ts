import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

const axios = require('axios');
const cheerio = require('cheerio');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

import { chunkText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from './chunker';
import { embeddingProfile, generateEmbedding } from './embeddings';
import { VectorStore } from './vector-store';
import { KnowledgeChunk, SourceRecord, SourceType } from '../types';

const supportedExtensions = new Set(['.txt', '.md', '.csv', '.pdf', '.docx', '.xlsx', '.xls']);

export async function ingestDriveFolder(rootDirectory: string, vectorStore: VectorStore): Promise<{ discovered: number; chunks: number; sources: number }> {
  const ingestionRoot = path.resolve(rootDirectory);
  if (!fs.existsSync(ingestionRoot) || !fs.statSync(ingestionRoot).isDirectory()) {
    throw new Error('Local ingestion directory does not exist');
  }
  const files = await discoverDriveFiles(rootDirectory);
  const sources = new Map<string, SourceRecord>();
  let chunkCount = 0;
  for (const file of files) {
    const text = await extractTextFromFile(file);
    const source = buildSourceRecord(file, text);
    source.metadata = { ...source.metadata, ingestionRoot };
    sources.set(source.id, source);
    await vectorStore.addSource(source);

    const chunks = chunkText(text);
    const activeChunkIds = new Set<string>();
    for (const [index, chunk] of chunks.entries()) {
      const chunkRecord: KnowledgeChunk = {
        id: `${source.id}-chunk-${index}`,
        content: chunk,
        sourceId: source.id,
        sourcePath: source.sourcePath,
        sourceType: source.sourceType,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl,
        chunkIndex: index,
        metadata: {
          fileName: path.basename(file),
          path: file,
        },
      };

      await vectorStore.addChunk(chunkRecord);
      activeChunkIds.add(chunkRecord.id);
      chunkCount += 1;
    }
    await vectorStore.removeChunksExcept(source.id, activeChunkIds);
  }

  await vectorStore.removeSourcesExcept('source-', new Set(sources.keys()), ingestionRoot);
  const stats = await vectorStore.getStats();

  return {
    discovered: files.length,
    chunks: chunkCount,
    sources: stats.sourceCount,
  };
}

export async function crawlSiteUrls(urls: string[], vectorStore: VectorStore): Promise<{ crawled: number; chunks: number; sources: number }> {
  let crawledCount = 0;
  let chunkCount = 0;

  for (const url of urls) {
    try {
      const response = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'SprintX-BD-Assistant/0.1' } });
      const text = extractReadableTextFromHtml(response.data);

      if (!text) {
        continue;
      }

      const hostname = new URL(url).hostname;
      const source: SourceRecord = {
        id: createSiteSourceId(url),
        sourceType: 'site',
        sourceTitle: hostname,
        sourcePath: url,
        sourceUrl: url,
        status: 'active',
        updatedAt: new Date().toISOString(),
        metadata: {
          hostname,
          source: 'crawl',
        },
      };

      await vectorStore.addSource(source);
      crawledCount += 1;

      const chunks = chunkText(text);
      const activeChunkIds = new Set<string>();
      for (const [index, chunk] of chunks.entries()) {
        const chunkRecord: KnowledgeChunk = {
          id: `${source.id}-chunk-${index}`,
          content: chunk,
          sourceId: source.id,
          sourcePath: source.sourcePath,
          sourceType: source.sourceType,
          sourceTitle: source.sourceTitle,
          sourceUrl: source.sourceUrl,
          chunkIndex: index,
          metadata: {
            url,
            hostname,
          },
        };

        await vectorStore.addChunk(chunkRecord);
        activeChunkIds.add(chunkRecord.id);
        chunkCount += 1;
      }
      await vectorStore.removeChunksExcept(source.id, activeChunkIds);
    } catch (error) {
      console.warn(`Failed to crawl ${url}:`, error);
    }
  }

  const stats = await vectorStore.getStats();

  return {
    crawled: crawledCount,
    chunks: chunkCount,
    sources: stats.sourceCount,
  };
}

async function discoverDriveFiles(directory: string): Promise<string[]> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const allFiles: string[] = [];

  const walk = (current: string): void => {
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'archive') {
          continue;
        }

        if (entry.name.toLowerCase() === 'docs' || entry.name.toLowerCase() === 'sheets') {
          walk(fullPath);
          continue;
        }

        if (!path.basename(current).toLowerCase().includes('archive')) {
          walk(fullPath);
        }
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (supportedExtensions.has(extension)) {
        allFiles.push(fullPath);
      }
    }
  };

  walk(directory);
  return allFiles;
}

async function extractTextFromFile(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.txt' || extension === '.md' || extension === '.csv') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (extension === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.readFile(filePath);
    const texts: string[] = [];

    workbook.SheetNames.forEach((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, blankrows: false, defval: '' });
      rows.forEach((row: any) => {
        texts.push(Object.values(row).filter((value: unknown) => value !== null && value !== undefined && String(value).trim() !== '').join(' '));
      });
    });

    return texts.join(' ');
  }

  return '';
}

export type GoogleDriveSyncOptions = {
  folderId: string;
  serviceAccountJson: string;
  maxNewChunks?: number;
};

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const googleExportMimeTypes: Record<string, { mimeType: string; sourceType: SourceType }> = {
  'application/vnd.google-apps.document': { mimeType: 'text/plain', sourceType: 'document' },
  'application/vnd.google-apps.spreadsheet': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sourceType: 'sheet' },
};

export async function ingestGoogleDriveFolder(vectorStore: VectorStore, options: GoogleDriveSyncOptions): Promise<{ discovered: number; chunks: number; sources: number; removed: number; failedFiles: string[]; skippedFiles: number; complete: boolean; newEmbeddings: number }> {
  const deadline = Date.now() + 120000;
  const maxNewChunks = Math.max(1, Math.min(10, options.maxNewChunks ?? 10));
  const credentials = JSON.parse(options.serviceAccountJson) as { client_email?: string; private_key?: string };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }

  const accessToken = await createGoogleAccessToken(credentials.client_email, credentials.private_key);
  const files = await listGoogleDriveFilesRecursively(options.folderId, accessToken, deadline);
  let chunkCount = 0;
  const activeSourceIds = new Set<string>();
  const failedFiles: string[] = [];
  let skippedFiles = 0;
  let newEmbeddings = 0;
  const paused = async () => {
    const stats = await vectorStore.getStats();
    console.info(JSON.stringify({ event: 'drive_sync_batch', complete: false, newEmbeddings, skippedFiles }));
    return { discovered: files.length, chunks: chunkCount, sources: stats.sourceCount, removed: 0, failedFiles, skippedFiles, newEmbeddings, complete: false };
  };
  const pipelineVersion = `${embeddingProfile()}:drive-text-v1:${DEFAULT_CHUNK_SIZE}:${DEFAULT_CHUNK_OVERLAP}`;
  const ingestionRoot = `google-drive:${options.folderId}`;

  for (const file of files) {
    if (Date.now() >= deadline || newEmbeddings >= maxNewChunks) return paused();
    const sourceId = `gdrive-${file.id}`;
    const previous = await vectorStore.getSource(sourceId);
    const metadata = { source: 'google-drive', driveFileId: file.id, mimeType: file.mimeType, ingestionRoot, modifiedTime: file.modifiedTime ?? null, pipelineVersion };
    if (file.modifiedTime && previous?.metadata?.syncComplete === true
      && previous.metadata.modifiedTime === file.modifiedTime
      && previous.metadata.pipelineVersion === pipelineVersion
      && previous.metadata.mimeType === file.mimeType) {
      const renamed = { ...previous, sourceTitle: file.name, sourcePath: `Google Drive/${file.name}`, sourceUrl: file.webViewLink,
        metadata: { ...previous.metadata, ...metadata } };
      await vectorStore.refreshSourceChunks(renamed);
      await vectorStore.addSource(renamed);
      activeSourceIds.add(sourceId);
      skippedFiles++;
      continue;
    }
    let text: string;
    try {
      text = await downloadGoogleDriveText(file, accessToken);
    } catch (error) {
      failedFiles.push(file.name);
      console.warn(JSON.stringify({ event: 'drive_file_failed', fileId: file.id, reason: 'download_or_parse_failed' }));
      continue;
    }
    if (!text.trim()) {
      failedFiles.push(file.name);
      continue;
    }

    activeSourceIds.add(sourceId);
    const source: SourceRecord = {
      id: sourceId,
      sourceType: googleExportMimeTypes[file.mimeType]?.sourceType ?? 'document',
      sourceTitle: file.name,
      sourcePath: `Google Drive/${file.name}`,
      sourceUrl: file.webViewLink,
      status: 'active',
      updatedAt: file.modifiedTime ?? new Date().toISOString(),
      metadata: { ...metadata, syncComplete: false },
    };
    await vectorStore.addSource(source);

    const activeChunkIds = new Set<string>();
    for (const [index, chunk] of chunkText(text).entries()) {
      if (Date.now() >= deadline || newEmbeddings >= maxNewChunks) return paused();
      const chunkId = `${sourceId}-chunk-${index}`;
      const embedded = await vectorStore.addChunk({
        id: chunkId,
        content: chunk,
        sourceId,
        sourcePath: source.sourcePath,
        sourceType: source.sourceType,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl,
        chunkIndex: index,
        metadata: { driveFileId: file.id, modifiedTime: file.modifiedTime ?? null },
      });
      if (embedded) newEmbeddings++;
      activeChunkIds.add(chunkId);
      chunkCount += 1;
    }
    await vectorStore.removeChunksExcept(sourceId, activeChunkIds);
    // Mark a file complete only after every chunk is saved and reconciled.
    // Interrupted runs reuse saved compatible chunks on the next explicit sync.
    await vectorStore.addSource({ ...source, metadata: { ...metadata, syncComplete: true } });
  }

  const removed = failedFiles.length === 0
    ? await vectorStore.removeSourcesExcept('gdrive-', activeSourceIds, ingestionRoot)
    : 0;
  const stats = await vectorStore.getStats();
  console.info(JSON.stringify({ event: 'drive_sync_batch', complete: true, newEmbeddings, skippedFiles, failedFileCount: failedFiles.length }));
  return { discovered: files.length, chunks: chunkCount, sources: stats.sourceCount, removed, failedFiles, skippedFiles, newEmbeddings, complete: true };
}

async function createGoogleAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const { SignJWT, importPKCS8 } = await import('jose');
  const key = await importPKCS8(privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/drive.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const response = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  return String(response.data.access_token);
}

async function listGoogleDriveFiles(folderId: string, accessToken: string): Promise<GoogleDriveFile[]> {
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: 1000,
        pageToken,
        fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
      },
      timeout: 20000,
    });
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function listGoogleDriveFilesRecursively(folderId: string, accessToken: string, deadline = Infinity): Promise<GoogleDriveFile[]> {
  const files: GoogleDriveFile[] = [];
  const folders = [folderId];
  const visitedFolders = new Set<string>();

  while (folders.length) {
    const currentFolderId = folders.shift() as string;
    if (visitedFolders.has(currentFolderId)) continue;
    visitedFolders.add(currentFolderId);

    let pageToken: string | undefined;
    do {
      if (Date.now() >= deadline) throw new Error('Drive listing exceeded the safe batch time budget; no deletion cleanup was performed. Narrow the configured folder or use a background ingestion worker.');
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { Authorization: ['Bearer', accessToken].join(' ') },
        params: {
          q: `'${currentFolderId}' in parents and trashed = false`,
          pageSize: 1000,
          pageToken,
          fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
        },
        timeout: 20000,
      });

      for (const file of response.data.files ?? []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          if (file.name.trim().toLowerCase() !== 'archive') folders.push(file.id);
        } else {
          files.push(file);
        }
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
  }

  return files;
}

export async function downloadGoogleDriveText(file: GoogleDriveFile, accessToken: string): Promise<string> {
  const exportDetails = googleExportMimeTypes[file.mimeType];
  const url = exportDetails
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: exportDetails ? { mimeType: exportDetails.mimeType } : { alt: 'media' },
    responseType: 'arraybuffer',
    timeout: 30000,
  });
  if (exportDetails?.sourceType === 'sheet') return extractTextFromBuffer(Buffer.from(response.data), `${file.name}.xlsx`);
  if (exportDetails || file.mimeType.startsWith('text/')) return Buffer.from(response.data).toString('utf8');
  return extractTextFromBuffer(Buffer.from(response.data), file.name);
}

async function extractTextFromBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.txt' || extension === '.md' || extension === '.csv') return buffer.toString('utf8');
  if (extension === '.pdf') return (await pdfParse(buffer)).text;
  if (extension === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  if (extension === '.xlsx' || extension === '.xls') {
    const workbook = XLSX.read(buffer);
    return workbook.SheetNames.flatMap((sheetName: string) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, blankrows: false, defval: '' });
      return rows.map((row: unknown) => Object.values(row as Record<string, unknown>).filter(Boolean).join(' '));
    }).join(' ');
  }
  return '';
}

function buildSourceRecord(filePath: string, content: string): SourceRecord {
  const fileName = path.basename(filePath);
  const directoryName = path.basename(path.dirname(filePath));
  const sourceType: SourceType = directoryName.toLowerCase() === 'sheets' ? 'sheet' : 'document';
  const status = filePath.toLowerCase().includes('archive') ? 'archived' : 'active';

  return {
    id: createLocalSourceId(filePath),
    sourceType,
    sourceTitle: fileName,
    sourcePath: filePath,
    status,
    updatedAt: new Date().toISOString(),
    metadata: {
      fileName,
      contentLength: content.length,
    },
  };
}

export function createLocalSourceId(filePath: string): string {
  const normalizedPath = path.normalize(path.resolve(filePath)).toLowerCase();
  return `source-${createHash('sha256').update(normalizedPath).digest('hex').slice(0, 24)}`;
}

export function createSiteSourceId(url: string): string {
  return `site-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

export async function runFullIngest(vectorStore: VectorStore, options?: { driveRoot?: string; siteUrls?: string[] }): Promise<{ drive: { discovered: number; chunks: number; sources: number }; sites: { crawled: number; chunks: number; sources: number } }> {
  const driveRoot = options?.driveRoot ?? './data/drive';
  const driveResults = await ingestDriveFolder(driveRoot, vectorStore);
  const siteResults = await crawlSiteUrls(options?.siteUrls ?? [], vectorStore);

  return {
    drive: driveResults,
    sites: siteResults,
  };
}

export async function generateSearchableText(text: string): Promise<{ embedding: number[]; chunks: string[] }> {
  const chunks = chunkText(text);
  const embedding = await generateEmbedding(chunks.join(' '));
  return { embedding, chunks };
}

export function extractReadableTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  $('script, style, noscript, svg, iframe, img').remove();

  const texts: string[] = [];
  $('body p, body h1, body h2, body h3, body h4, body li, body a, body span, body div').each((_index: number, element: any) => {
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length < 3 || looksLikeJsonNoise(text)) {
      return;
    }

    texts.push(text);
  });

  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

function looksLikeJsonNoise(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  if (normalized.length > 220 && /[\{\[\]"\:]/.test(normalized)) {
    return true;
  }

  return /^(?:\{|\[).*?(?:\}|\])$/.test(normalized) || /[A-Za-z0-9_]+\s*:\s*["\[{]/.test(normalized);
}
