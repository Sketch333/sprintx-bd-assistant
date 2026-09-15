import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const axios = require('axios');
const cheerio = require('cheerio');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');

import { chunkText } from './chunker';
import { generateEmbedding } from './embeddings';
import { VectorStore } from './vector-store';
import { KnowledgeChunk, SourceRecord, SourceType } from '../types';

const supportedExtensions = new Set(['.txt', '.md', '.csv', '.pdf', '.docx', '.xlsx', '.xls']);

export async function ingestDriveFolder(rootDirectory: string, vectorStore: VectorStore): Promise<{ discovered: number; chunks: number; sources: number }> {
  const files = await discoverDriveFiles(rootDirectory);
  const sources = new Map<string, SourceRecord>();
  let chunkCount = 0;

  for (const file of files) {
    const text = await extractTextFromFile(file);
    const source = buildSourceRecord(file, text);
    sources.set(source.id, source);
    await vectorStore.addSource(source);

    const chunks = chunkText(text);
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
      chunkCount += 1;
    }
  }

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
        id: `site-${randomUUID()}`,
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
        chunkCount += 1;
      }
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

function buildSourceRecord(filePath: string, content: string): SourceRecord {
  const fileName = path.basename(filePath);
  const directoryName = path.basename(path.dirname(filePath));
  const sourceType: SourceType = directoryName.toLowerCase() === 'sheets' ? 'sheet' : 'document';
  const status = filePath.toLowerCase().includes('archive') ? 'archived' : 'active';

  return {
    id: `source-${randomUUID()}`,
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
