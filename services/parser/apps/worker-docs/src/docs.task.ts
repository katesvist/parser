import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as xlsx from 'xlsx';
import * as JSZip from 'jszip';
import * as iconv from 'iconv-lite';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../../../libs/db/src';
import { HttpService } from '../../../libs/http/src';
import { PoolClient } from 'pg';

interface AttachmentRow {
  id: number;
  object_number: string;
  file_name: string | null;
  url: string;
  doc_kind_code: string | null;
  file_size: number | null;
  placingway_name: string | null;
  maxprice: number | null;
}

interface AnalyticsJobRow {
  id: number;
  object_number: string;
  status: string;
}

interface SummaryRecord {
  object_number: string;
  attachment_id: number;
  doc_kind_code: string | null;
  summary: string | null;
  key_terms: Record<string, any>;
  estimated_complexity: number | null;
  risk_flags: string[];
  key_requirements: string[];
  llm_model: string | null;
  llm_used_tokens: number | null;
}

interface ArchiveEntry {
  relativePath: string;
  filename: string;
  buffer: Buffer;
  size: number;
}

type ArchiveDocStatus = 'done' | 'failed' | 'skipped';

@Injectable()
export class DocsTask {
  private readonly logger = new Logger(DocsTask.name);
  private running = false;
  private readonly execFileAsync = promisify(execFile);

  constructor(private readonly db: DbService, private readonly http: HttpService) {}

  @Cron(process.env.DOCS_CRON || '*/20 * * * *')
  async handleCron() {
    await this.run();
  }

  async run() {
    if (this.running) return;
    this.running = true;

    try {
      await this.db.withAdvisoryLock('worker-docs', async (client) => {
        await this.runWithClient(client);
      });
    } catch (err) {
      this.logger.error(`Run failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async runWithClient(client: PoolClient) {
    const limit = Number(process.env.DOCS_LIMIT || 20);
    const delayMs = Number(process.env.DOCS_DELAY_MS || 20000);

    const job = await this.takeNextJob(client);
    if (!job) {
      this.logger.log('No analytics jobs to process.');
      return;
    }
    this.logger.log(`Picked job ${job.object_number} (#${job.id})`);

    const attachments = await this.selectAttachments(client, job.object_number, limit);
    this.logger.log(`Selected ${attachments.length} attachments for ${job.object_number}`);
    if (!attachments.length) {
      await this.finishJobIfDone(client, job.object_number);
      return;
    }

    for (const attachment of attachments) {
      try {
        this.logger.log(`Processing attachment ${attachment.id} for ${attachment.object_number}`);
        await this.processAttachment(client, attachment);
      } catch (err) {
        this.logger.error(`Attachment ${attachment.id} failed: ${String(err)}`);
      }

      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
    }

    await this.finishJobIfDone(client, job.object_number);
  }

  private async selectAttachments(client: PoolClient, objectNumber: string, limit: number): Promise<AttachmentRow[]> {
    const res = await this.db.query<AttachmentRow>(
      `SELECT 
        ta.id, 
        ta.object_number, 
        ta.file_name, 
        ta.url, 
        ta.doc_kind_code, 
        ta.file_size,
        tg.placingway_name,
        tg.maxprice
      FROM tender_attachments ta
      LEFT JOIN tender_attachments_summary tas ON ta.id = tas.attachment_id
      LEFT JOIN tenders_gov tg ON ta.object_number = tg.object_number
      WHERE ta.object_number = $2
        AND tas.id IS NULL
        AND (
          ta.file_name IS NULL OR ta.file_name NOT ILIKE '%.docx.pdf'
        )
      ORDER BY 
        ta.created_at DESC
      LIMIT $1;`,
      [limit, objectNumber],
      client,
    );

    return res.rows;
  }

  private async processAttachment(client: PoolClient, attachment: AttachmentRow) {
    const userAgent =
      process.env.DOCS_DOWNLOAD_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
    const referer = process.env.DOCS_DOWNLOAD_REFERER || 'https://zakupki.gov.ru/';

    const buffer = await this.http.getBuffer(attachment.url, {
      timeoutMs: Number(process.env.DOCS_DOWNLOAD_TIMEOUT_MS || 120000),
      headers: {
        'User-Agent': userAgent,
        Referer: referer,
        Accept: '*/*',
      },
    });

    const filename = attachment.file_name || `attachment-${attachment.id}`;
    if (this.isArchiveFile(filename, attachment.url)) {
      const archiveRecord = await this.processArchiveAttachment(client, attachment, buffer, filename);
      await this.insertSummary(client, archiveRecord);
      return;
    }

    const record = await this.buildSummaryRecord(client, attachment, buffer, filename, {
      sourcePath: filename,
      sourceName: filename,
    });
    await this.insertSummary(client, record);
  }

  private async processArchiveAttachment(
    client: PoolClient,
    attachment: AttachmentRow,
    buffer: Buffer,
    filename: string,
  ): Promise<SummaryRecord> {
    const archiveEnabled = (process.env.DOCS_ARCHIVE_ENABLED || 'true').toLowerCase() === 'true';
    if (!archiveEnabled) {
      return this.buildPlaceholderRecord(attachment, 'Архив пропущен настройками воркера.');
    }

    let entries: ArchiveEntry[] = [];
    try {
      entries = await this.extractArchiveEntries(buffer, filename);
    } catch (err) {
      this.logger.warn(`Archive extract failed for attachment ${attachment.id}: ${String(err)}`);
      return this.buildPlaceholderRecord(attachment, 'Не удалось распаковать архив.');
    }

    if (!entries.length) {
      return this.buildPlaceholderRecord(attachment, 'Архив пуст или не содержит поддерживаемых файлов.');
    }

    const maxFiles = Number(process.env.DOCS_ARCHIVE_MAX_FILES || 25);
    const filesForProcessing = entries.slice(0, Math.max(1, maxFiles));
    const skippedByLimit = Math.max(0, entries.length - filesForProcessing.length);
    const docs: Array<Record<string, any>> = [];
    const archiveNameSet = new Set(filesForProcessing.map((entry) => entry.relativePath.toLowerCase()));
    const processedByName = new Map<string, ArchiveDocStatus>();
    const orderedEntries = [...filesForProcessing].sort((a, b) => {
      return this.archiveEntryPriority(a.relativePath) - this.archiveEntryPriority(b.relativePath);
    });

    for (const entry of orderedEntries) {
      const lowerName = (entry.relativePath || '').toLowerCase();
      const skipReason = this.getArchiveSkipReason(entry.relativePath, archiveNameSet, processedByName);
      if (skipReason) {
        docs.push({
          file_name: entry.relativePath,
          file_size: entry.size,
          status: 'skipped',
          summary: skipReason,
          key_terms: {},
          estimated_complexity: null,
          risk_flags: [],
          key_requirements: [],
          llm_model: null,
          llm_used_tokens: null,
        });
        processedByName.set(lowerName, 'skipped');
        continue;
      }

      try {
        const nestedAttachment: AttachmentRow = {
          ...attachment,
          file_name: entry.filename,
        };

        const nestedRecord = await this.buildSummaryRecord(
          client,
          nestedAttachment,
          entry.buffer,
          entry.filename,
          {
            sourcePath: entry.relativePath,
            sourceName: entry.filename,
          },
        );

        const failed =
          !nestedRecord.summary || nestedRecord.summary === 'Не удалось извлечь текст из документа.';

        docs.push({
          file_name: entry.relativePath,
          file_size: entry.size,
          status: failed ? 'failed' : 'done',
          summary: nestedRecord.summary,
          key_terms: nestedRecord.key_terms ?? {},
          estimated_complexity: nestedRecord.estimated_complexity,
          risk_flags: nestedRecord.risk_flags ?? [],
          key_requirements: nestedRecord.key_requirements ?? [],
          llm_model: nestedRecord.llm_model,
          llm_used_tokens: nestedRecord.llm_used_tokens,
        });
        processedByName.set(lowerName, failed ? 'failed' : 'done');
      } catch (err) {
        this.logger.warn(
          `Archive inner file failed for attachment ${attachment.id} (${entry.relativePath}): ${String(err)}`,
        );
        docs.push({
          file_name: entry.relativePath,
          file_size: entry.size,
          status: 'failed',
          summary: 'Не удалось извлечь текст из документа.',
          key_terms: {},
          estimated_complexity: null,
          risk_flags: [],
          key_requirements: [],
          llm_model: null,
          llm_used_tokens: null,
        });
        processedByName.set(lowerName, 'failed');
      }
    }

    const successfulDocs = docs.filter((doc) => doc.status === 'done');
    const failedDocs = docs.filter((doc) => doc.status === 'failed').length;
    const skippedDocs = docs.filter((doc) => doc.status === 'skipped').length + skippedByLimit;
    const totalErrors = failedDocs;

    const allRisks = Array.from(
      new Set(
        successfulDocs
          .flatMap((doc) => (Array.isArray(doc.risk_flags) ? doc.risk_flags : []))
          .map((x) => String(x).trim())
          .filter(Boolean),
      ),
    );
    const allRequirements = Array.from(
      new Set(
        successfulDocs
          .flatMap((doc) => (Array.isArray(doc.key_requirements) ? doc.key_requirements : []))
          .map((x) => String(x).trim())
          .filter(Boolean),
      ),
    );
    const complexities = successfulDocs
      .map((doc) => this.toNumber(doc.estimated_complexity))
      .filter((value): value is number => value !== null);
    const tokenSum = successfulDocs.reduce((sum, doc) => {
      const value = this.toNumber(doc.llm_used_tokens);
      return sum + (value ?? 0);
    }, 0);
    const models = Array.from(
      new Set(
        successfulDocs
          .map((doc) => (typeof doc.llm_model === 'string' ? doc.llm_model.trim() : ''))
          .filter((x) => x.length > 0),
      ),
    );

    const summaryParts = [`Архив распакован: обработано ${successfulDocs.length} из ${entries.length} файлов.`];
    if (totalErrors > 0) summaryParts.push(`Ошибок: ${totalErrors}.`);
    if (skippedDocs > 0) summaryParts.push(`Пропущено: ${skippedDocs}.`);
    const summaryText = summaryParts.join(' ');

    return {
      object_number: attachment.object_number,
      attachment_id: attachment.id,
      doc_kind_code: attachment.doc_kind_code,
      summary: summaryText,
      key_terms: {
        archive_documents: docs,
        archive_total_files: entries.length,
        archive_processed_files: successfulDocs.length,
        archive_failed_files: totalErrors,
        archive_skipped_files: skippedDocs,
        archive_skipped_by_limit: skippedByLimit,
      },
      estimated_complexity: complexities.length ? Math.max(...complexities) : null,
      risk_flags: allRisks,
      key_requirements: allRequirements,
      llm_model: models.length === 1 ? models[0] : models.length > 1 ? 'multiple' : null,
      llm_used_tokens: tokenSum > 0 ? tokenSum : null,
    };
  }

  private async buildSummaryRecord(
    client: PoolClient,
    attachment: AttachmentRow,
    buffer: Buffer,
    filename: string,
    ragSource?: { sourcePath?: string; sourceName?: string },
  ): Promise<SummaryRecord> {
    let workingBuffer = buffer;
    let workingFilename = filename;

    let extractedText = await this.extractSpreadsheetText(workingBuffer, workingFilename);

    if (!extractedText && this.shouldConvertXls(workingFilename)) {
      const converted = await this.maybeConvertXls(workingBuffer, workingFilename);
      workingBuffer = converted.buffer;
      workingFilename = converted.filename;
      extractedText = await this.extractSpreadsheetText(workingBuffer, workingFilename);
    }

    if (!extractedText) {
      extractedText = await this.extractDocxText(workingBuffer, workingFilename);
    }

    if (!extractedText) {
      if (this.shouldConvertDoc(workingFilename)) {
        const converted = await this.maybeConvertDoc(workingBuffer, workingFilename);
        workingBuffer = converted.buffer;
        workingFilename = converted.filename;
        extractedText = await this.extractDocxText(workingBuffer, workingFilename);
      }
    }

    if (!extractedText) {
      try {
        extractedText = await this.convertWithDocling(workingBuffer, workingFilename);
      } catch (err) {
        this.logger.warn(`Docling failed for attachment ${attachment.id}, file ${workingFilename}: ${String(err)}`);
        return this.buildPlaceholderRecord(attachment, 'Не удалось извлечь текст из документа.');
      }
    }

    const textLimit = Number(process.env.DOCS_TEXT_LIMIT || 50000);
    const minTextLength = Number(process.env.DOCS_MIN_TEXT_LENGTH || 50);
    const trimmedText = extractedText.slice(0, textLimit);

    if (!trimmedText.trim() || trimmedText.trim().length < minTextLength) {
      this.logger.warn(
        `Attachment ${attachment.id} has insufficient text (${trimmedText.trim().length} chars). Saving placeholder summary.`,
      );
      return this.buildPlaceholderRecord(attachment, 'Не удалось извлечь текст из документа.');
    }

    try {
      await this.maybeIndexTenderRagChunks(client, {
        objectNumber: attachment.object_number,
        attachmentId: attachment.id,
        sourcePath: (ragSource?.sourcePath || filename || `attachment-${attachment.id}`).trim(),
        sourceName: (ragSource?.sourceName || filename || '').trim() || null,
        extractedText,
      });
    } catch (err) {
      // Indexing must not break document analytics; assistant will be unavailable if index can't be built.
      this.logger.warn(
        `RAG indexing failed for attachment ${attachment.id} (${ragSource?.sourcePath || filename}): ${String(err)}`,
      );
    }

    const llmResult = await this.callLlm(trimmedText);
    const parsed = this.parseLlmJson(llmResult.content, trimmedText);

    return {
      object_number: attachment.object_number,
      attachment_id: attachment.id,
      doc_kind_code: attachment.doc_kind_code,
      summary: parsed.summary ?? null,
      key_terms: parsed.key_terms ?? {},
      estimated_complexity: this.toNumber(parsed.complexity_score),
      risk_flags: this.toStringArray(parsed.risk_flags),
      key_requirements: this.toStringArray(parsed.key_requirements),
      llm_model: llmResult.model ?? null,
      llm_used_tokens: llmResult.totalTokens ?? null,
    };
  }

  private async extractDocxText(buffer: Buffer, filename: string): Promise<string> {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext !== '.docx') return '';
    if (!this.isZipArchive(buffer, filename)) return '';

    try {
      const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
      const documentXml = zip.file('word/document.xml');
      if (!documentXml) return '';

      const xml = await documentXml.async('text');
      if (!xml.trim()) return '';

      const text = this.decodeXmlEntities(
        xml
          .replace(/<w:p\b[^>]*>/gi, '\n')
          .replace(/<\/w:p>/gi, '\n')
          .replace(/<w:tab\b[^>]*\/>/gi, '\t')
          .replace(/<w:br\b[^>]*\/>/gi, '\n')
          .replace(/<[^>]+>/g, ''),
      )
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return text;
    } catch (err) {
      this.logger.warn(`DOCX xml parse failed (${filename}): ${String(err)}`);
      return '';
    }
  }

  private decodeXmlEntities(text: string): string {
    return (text || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  private buildPlaceholderRecord(
    attachment: AttachmentRow,
    summary: string,
    keyTerms: Record<string, any> = {},
  ): SummaryRecord {
    return {
      object_number: attachment.object_number,
      attachment_id: attachment.id,
      doc_kind_code: attachment.doc_kind_code,
      summary,
      key_terms: keyTerms,
      estimated_complexity: null,
      risk_flags: [],
      key_requirements: [],
      llm_model: null,
      llm_used_tokens: null,
    };
  }

  private isArchiveFile(filename: string | null | undefined, url?: string | null): boolean {
    const source = `${filename || ''} ${url || ''}`.toLowerCase();
    return /\.(zip|rar|7z)(\b|$)/i.test(source);
  }

  private archiveEntryPriority(fileName: string): number {
    const lower = (fileName || '').toLowerCase();
    if (!lower) return 3;
    if (
      lower.endsWith('.sig') ||
      lower.endsWith('.p7s') ||
      lower.endsWith('.p7m') ||
      lower.endsWith('.p7b') ||
      lower.endsWith('.sgn') ||
      lower.endsWith('.sign')
    ) {
      return 3;
    }
    const pdfCopy = this.getPdfCopySource(lower);
    if (!pdfCopy) return 1;
    if (pdfCopy.kind === 'pdf_of_pdf') return 4;
    return 2;
  }

  private getPdfCopySource(lowerFileName: string): { sourceLower: string; kind: 'pdf_of_source' | 'pdf_of_pdf' } | null {
    if (!lowerFileName || !lowerFileName.endsWith('.pdf')) return null;
    if (lowerFileName.endsWith('.pdf.pdf')) {
      return { sourceLower: lowerFileName.slice(0, -4), kind: 'pdf_of_pdf' };
    }

    const baseExts = ['.docx', '.doc', '.docm', '.rtf', '.odt', '.xlsx', '.xls', '.ods'];
    for (const ext of baseExts) {
      const suffix = `${ext}.pdf`;
      if (lowerFileName.endsWith(suffix)) {
        return { sourceLower: lowerFileName.slice(0, -4), kind: 'pdf_of_source' };
      }
    }

    return null;
  }

  private getArchiveSkipReason(
    fileName: string,
    allNamesLower: Set<string>,
    processedByName: Map<string, ArchiveDocStatus>,
  ): string | null {
    const lower = (fileName || '').toLowerCase();
    if (!lower) return 'Файл пропущен.';
    if (
      lower.endsWith('.sig') ||
      lower.endsWith('.p7s') ||
      lower.endsWith('.p7m') ||
      lower.endsWith('.p7b') ||
      lower.endsWith('.sgn') ||
      lower.endsWith('.sign')
    ) {
      return 'Технический файл электронной подписи пропущен.';
    }

    const pdfCopy = this.getPdfCopySource(lower);
    if (!pdfCopy) return null;
    if (!allNamesLower.has(pdfCopy.sourceLower)) return null;

    if (pdfCopy.kind === 'pdf_of_pdf') {
      return 'Технический файл: дублирующая PDF-копия пропущена.';
    }

    const sourceStatus = processedByName.get(pdfCopy.sourceLower);
    // If the source file failed, keep PDF as a fallback candidate.
    if (sourceStatus === 'failed') {
      return null;
    }
    if (!sourceStatus || sourceStatus === 'done' || sourceStatus === 'skipped') {
      return 'Технический файл: PDF-копия исходного документа пропущена.';
    }
    return null;
  }

  private async extractArchiveEntries(buffer: Buffer, filename: string): Promise<ArchiveEntry[]> {
    // ZIP from EIS often contains non-UTF8 names. Parse ZIP in-memory to avoid FS path encoding issues.
    if (this.isZipArchive(buffer, filename)) {
      const zipEntries = await this.extractZipEntries(buffer);
      if (zipEntries.length) {
        return zipEntries;
      }
    }

    const extractTimeoutMs = Number(process.env.DOCS_ARCHIVE_EXTRACT_TIMEOUT_MS || 120000);
    const maxFileSizeMb = Number(process.env.DOCS_ARCHIVE_MAX_FILE_SIZE_MB || 25);
    const maxFileBytes = Math.max(1, maxFileSizeMb) * 1024 * 1024;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-archive-'));
    const safeName = path.basename(filename || 'archive').replace(/[^\w.\-]+/g, '_');
    const archivePath = path.join(tmpDir, safeName || 'archive.zip');
    const outDir = path.join(tmpDir, 'out');
    await fs.mkdir(outDir, { recursive: true });

    try {
      await fs.writeFile(archivePath, buffer);
      let extracted = false;
      let primaryError: unknown = null;

      try {
        await this.execFileAsync('7z', ['x', '-y', `-o${outDir}`, archivePath], { timeout: extractTimeoutMs });
        extracted = true;
      } catch (err) {
        primaryError = err;
      }

      if (!extracted) {
        try {
          await fs.rm(outDir, { recursive: true, force: true });
          await fs.mkdir(outDir, { recursive: true });
          await this.execFileAsync('bsdtar', ['-xf', archivePath, '-C', outDir], { timeout: extractTimeoutMs });
          extracted = true;
        } catch (tarErr) {
          throw new Error(
            `Archive extraction failed (7z: ${String(primaryError)}; bsdtar: ${String(tarErr)})`,
          );
        }
      }

      if (!extracted) return [];
      return this.collectArchiveEntriesFromDir(outDir, maxFileBytes);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async collectArchiveEntriesFromDir(outDir: string, maxFileBytes: number): Promise<ArchiveEntry[]> {
    const paths = (await this.listFilesRecursive(outDir)).sort((a, b) => a.localeCompare(b, 'ru'));
    const entries: ArchiveEntry[] = [];

    for (const fullPath of paths) {
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        if (stat.size <= 0 || stat.size > maxFileBytes) continue;

        const rel = this.normalizeArchiveEntryName(path.relative(outDir, fullPath).replace(/\\/g, '/'));
        if (!rel || rel.startsWith('..')) continue;
        if (this.isArchiveFile(rel, null)) continue;

        const fileBuffer = await fs.readFile(fullPath);
        entries.push({
          relativePath: rel,
          filename: path.basename(rel),
          buffer: fileBuffer,
          size: stat.size,
        });
      } catch (err) {
        this.logger.warn(`Skip broken archive entry "${fullPath}": ${String(err)}`);
        continue;
      }
    }

    return entries;
  }

  private isZipArchive(buffer: Buffer, filename: string): boolean {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext === '.zip') return true;
    if (!buffer || buffer.length < 4) return false;
    // PK\x03\x04 / PK\x05\x06 / PK\x07\x08
    return buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  }

  private async extractZipEntries(buffer: Buffer): Promise<ArchiveEntry[]> {
    const maxFileSizeMb = Number(process.env.DOCS_ARCHIVE_MAX_FILE_SIZE_MB || 25);
    const maxFileBytes = Math.max(1, maxFileSizeMb) * 1024 * 1024;

    try {
      const zip = await JSZip.loadAsync(buffer, {
        checkCRC32: false,
        decodeFileName: (bytes: Uint8Array) => this.decodeZipFileName(bytes),
      });
      const out: ArchiveEntry[] = [];

      const files = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      for (const file of files) {
        if (file.dir) continue;

        const name = this.normalizeArchiveEntryName(file.name || '');
        if (!name) continue;
        if (this.isArchiveFile(name, null)) continue;

        const fileBuffer = await file.async('nodebuffer');
        if (!fileBuffer || fileBuffer.length <= 0 || fileBuffer.length > maxFileBytes) continue;

        out.push({
          relativePath: name,
          filename: path.basename(name),
          buffer: fileBuffer,
          size: fileBuffer.length,
        });
      }

      return out;
    } catch (err) {
      this.logger.warn(`In-memory ZIP parse failed, fallback to 7z: ${String(err)}`);
      return [];
    }
  }

  private decodeZipFileName(bytes: Uint8Array): string {
    const buf = Buffer.from(bytes);
    const candidates = [
      buf.toString('utf8'),
      iconv.decode(buf, 'cp866'),
      iconv.decode(buf, 'win1251'),
      iconv.decode(buf, 'cp437'),
    ];

    let best = '';
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const raw of candidates) {
      const normalized = this.normalizeArchiveEntryName(raw);
      const score = this.scoreArchiveFileName(normalized);
      if (score > bestScore) {
        bestScore = score;
        best = normalized;
      }
    }

    return best || this.normalizeArchiveEntryName(buf.toString('utf8'));
  }

  private normalizeArchiveEntryName(name: string): string {
    return (name || '')
      .replace(/\u0000/g, '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '')
      .trim();
  }

  private scoreArchiveFileName(name: string): number {
    if (!name) return -9999;
    const len = name.length;
    const cyr = (name.match(/[А-Яа-яЁё]/g) || []).length;
    const latin = (name.match(/[A-Za-z]/g) || []).length;
    const digits = (name.match(/\d/g) || []).length;
    const bad = (name.match(/[�□■▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪]/g) || []).length;
    const control = (name.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    const hasExt = /\.[A-Za-z0-9]{1,8}$/.test(name) ? 1 : 0;
    return cyr * 4 + latin * 2 + digits - bad * 6 - control * 10 + hasExt * 10 - Math.max(0, len - 180);
  }

  private async listFilesRecursive(dirPath: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (current: string) => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          out.push(fullPath);
        }
      }
    };

    await walk(dirPath);
    return out;
  }

  private async convertWithDocling(buffer: Buffer, filename: string): Promise<string> {
    const baseUrl = (process.env.DOCLING_URL || 'http://docling:5001').replace(/\/$/, '');
    const apiVersion = process.env.DOCLING_API_VERSION || 'auto';
    const endpoints = apiVersion === 'auto'
      ? [`${baseUrl}/v1/convert/file`, `${baseUrl}/v1alpha/convert/file`]
      : [`${baseUrl}/${apiVersion}/convert/file`];

    const ocrIfNoText = (process.env.DOCLING_OCR_IF_NO_TEXT || 'true').toLowerCase() === 'true';
    const forceOcr = (process.env.DOCLING_FORCE_OCR || 'false').toLowerCase() === 'true';
    const ocrLang = (process.env.DOCLING_OCR_LANG || 'ru,en').split(',').map((v) => v.trim()).filter(Boolean);

    for (const endpoint of endpoints) {
      try {
        const text = await this.requestDocling(endpoint, buffer, filename, false, forceOcr, ocrLang);
        if (text) return text;

        if (ocrIfNoText) {
          const ocrText = await this.requestDocling(endpoint, buffer, filename, true, forceOcr, ocrLang);
          if (ocrText) return ocrText;
        }
        throw new Error('Docling returned empty text');
      } catch (err) {
        this.logger.warn(`Docling endpoint failed (${endpoint}): ${String(err)}`);
      }
    }

    throw new Error('Docling conversion failed for all endpoints');
  }

  private extractTextFromDocling(payload: any): string {
    if (!payload) return '';

    if (typeof payload === 'string') return payload;

    const candidates: any[] = [];
    if (payload.documents && Array.isArray(payload.documents) && payload.documents[0]) {
      candidates.push(payload.documents[0]);
    }
    if (payload.results && Array.isArray(payload.results) && payload.results[0]) {
      candidates.push(payload.results[0]);
    }
    candidates.push(payload);

    for (const obj of candidates) {
      const text =
        obj.text ||
        obj.text_content ||
        obj.textContent ||
        obj.plain_text ||
        obj?.document?.text ||
        obj?.document?.text_content ||
        obj?.outputs?.text ||
        obj?.outputs?.text_content ||
        obj?.converted?.text ||
        obj?.converted?.text_content;

      if (typeof text === 'string' && text.trim()) {
        return text;
      }
    }

    return '';
  }

  private async requestDocling(
    endpoint: string,
    buffer: Buffer,
    filename: string,
    doOcr: boolean,
    forceOcr: boolean,
    ocrLang: string[],
  ): Promise<string> {
    const resultRetries = Number(process.env.DOCLING_RESULT_RETRIES || 5);
    const resultDelayMs = Number(process.env.DOCLING_RESULT_DELAY_MS || 2000);
    const useAsync = (process.env.DOCLING_USE_ASYNC || 'false').toLowerCase() === 'true';

    const form = this.buildDoclingForm(buffer, filename, doOcr, forceOcr, ocrLang);

    if (useAsync) {
      return this.requestDoclingAsync(endpoint, buffer, filename, doOcr, forceOcr, ocrLang, resultRetries, resultDelayMs);
    }

    let attempt = 0;
    while (attempt <= resultRetries) {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form as any,
      });

      if (res.ok) {
        const json = await res.json();
        return this.extractTextFromDocling(json);
      }

      const text = await res.text();
      const isPending =
        res.status === 404 &&
        text.toLowerCase().includes('task result not found');

      if (isPending) {
        return this.requestDoclingAsync(endpoint, buffer, filename, doOcr, forceOcr, ocrLang, resultRetries, resultDelayMs);
      }

      throw new Error(`Docling HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }

    return '';
  }

  private async requestDoclingAsync(
    endpoint: string,
    buffer: Buffer,
    filename: string,
    doOcr: boolean,
    forceOcr: boolean,
    ocrLang: string[],
    resultRetries: number,
    resultDelayMs: number,
  ): Promise<string> {
    const asyncEndpoint = endpoint.replace(/\/convert\/file$/, '/convert/file/async');
    const form = this.buildDoclingForm(buffer, filename, doOcr, forceOcr, ocrLang);

    const res = await fetch(asyncEndpoint, {
      method: 'POST',
      body: form as any,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Docling async HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }

    const startPayload = await res.json();
    const taskId = startPayload?.task_id || startPayload?.taskId;
    if (!taskId) {
      throw new Error(`Docling async missing task_id: ${JSON.stringify(startPayload)}`);
    }

    const endpointUrl = new URL(endpoint);
    const apiMatch = endpointUrl.pathname.match(/\/(v1alpha|v1)\//);
    const apiPrefix = apiMatch ? `/${apiMatch[1]}` : '/v1';
    const baseOrigin = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const waitSeconds = Math.max(1, Math.floor(resultDelayMs / 1000));

    for (let attempt = 0; attempt <= resultRetries; attempt += 1) {
      const statusRes = await fetch(`${baseOrigin}${apiPrefix}/status/poll/${taskId}?wait=${waitSeconds}`);
      const statusText = await statusRes.text();
      if (!statusRes.ok) {
        if (attempt < resultRetries) {
          await this.sleep(resultDelayMs);
          continue;
        }
        throw new Error(`Docling status HTTP ${statusRes.status} ${statusRes.statusText}: ${statusText}`);
      }

      const statusPayload = statusText ? JSON.parse(statusText) : {};
      const status = statusPayload?.task_status || statusPayload?.status;
      if (status === 'success') {
        const resultRes = await fetch(`${baseOrigin}${apiPrefix}/result/${taskId}`);
        if (!resultRes.ok) {
          const text = await resultRes.text();
          throw new Error(`Docling result HTTP ${resultRes.status} ${resultRes.statusText}${text ? `: ${text}` : ''}`);
        }
        const json = await resultRes.json();
        return this.extractTextFromDocling(json);
      }
      if (status === 'failure' || status === 'error') {
        throw new Error(`Docling task failed: ${JSON.stringify(statusPayload)}`);
      }

      await this.sleep(resultDelayMs);
    }

    throw new Error(`Docling async timeout waiting for task ${taskId}`);
  }

  private buildDoclingForm(
    buffer: Buffer,
    filename: string,
    doOcr: boolean,
    forceOcr: boolean,
    ocrLang: string[],
  ) {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(buffer)]), filename);
    form.append('to_formats', 'text');
    form.append('do_ocr', String(doOcr));
    form.append('force_ocr', String(forceOcr));
    for (const lang of ocrLang) {
      form.append('ocr_lang', lang);
    }
    return form;
  }

  private async maybeConvertXls(buffer: Buffer, filename: string) {
    const convertEnabled = (process.env.DOCS_XLS_CONVERT || 'true').toLowerCase() === 'true';
    const ext = path.extname(filename || '').toLowerCase();
    if (!convertEnabled || ext !== '.xls') {
      return { buffer, filename };
    }

    const timeoutMs = Number(process.env.DOCS_XLS_TIMEOUT_MS || 120000);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docling-xls-'));
    const safeBase = path.basename(filename).replace(/\s+/g, '_');
    const inputPath = path.join(tmpDir, safeBase);
    const outputPath = inputPath.replace(/\.xls$/i, '.xlsx');

    try {
      await fs.writeFile(inputPath, buffer);
      await this.execFileAsync(
        'soffice',
        ['--headless', '--convert-to', 'xlsx', '--outdir', tmpDir, inputPath],
        { timeout: timeoutMs },
      );
      const converted = await fs.readFile(outputPath);
      return { buffer: converted, filename: filename.replace(/\.xls$/i, '.xlsx') };
    } catch (err) {
      this.logger.warn(`XLS convert failed, using original file: ${String(err)}`);
      return { buffer, filename };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private async maybeConvertDoc(buffer: Buffer, filename: string) {
    const convertEnabled = (process.env.DOCS_DOC_CONVERT || 'true').toLowerCase() === 'true';
    const ext = path.extname(filename || '').toLowerCase();
    if (!convertEnabled || ext !== '.doc') {
      return { buffer, filename };
    }

    const timeoutMs = Number(process.env.DOCS_DOC_TIMEOUT_MS || 120000);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docling-doc-'));
    const safeBase = path.basename(filename).replace(/\s+/g, '_');
    const inputPath = path.join(tmpDir, safeBase);
    const outputPath = inputPath.replace(/\.doc$/i, '.docx');

    try {
      await fs.writeFile(inputPath, buffer);
      await this.execFileAsync(
        'soffice',
        ['--headless', '--convert-to', 'docx', '--outdir', tmpDir, inputPath],
        { timeout: timeoutMs },
      );
      const converted = await fs.readFile(outputPath);
      return { buffer: converted, filename: filename.replace(/\.doc$/i, '.docx') };
    } catch (err) {
      this.logger.warn(`DOC convert failed, using original file: ${String(err)}`);
      return { buffer, filename };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  private shouldConvertXls(filename: string) {
    const ext = path.extname(filename || '').toLowerCase();
    return ext === '.xls' && (process.env.DOCS_XLS_CONVERT || 'true').toLowerCase() === 'true';
  }

  private shouldConvertDoc(filename: string) {
    const ext = path.extname(filename || '').toLowerCase();
    return ext === '.doc' && (process.env.DOCS_DOC_CONVERT || 'true').toLowerCase() === 'true';
  }

  private async extractSpreadsheetText(buffer: Buffer, filename: string): Promise<string> {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext !== '.xls' && ext !== '.xlsx') return '';

    try {
      const workbook = xlsx.read(buffer, { type: 'buffer', cellText: true, cellDates: true, cellNF: true });
      const lines: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        lines.push(`### ${sheetName}`);
        const csv = xlsx.utils.sheet_to_csv(sheet, {
          FS: '\t',
          RS: '\n',
          strip: true,
          blankrows: false,
        });
        if (csv.trim()) {
          lines.push(csv.trim());
          continue;
        }
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<Array<any>>;
        for (const row of rows) {
          const rowText = row.map((cell) => String(cell).trim()).join('\t').trim();
          if (rowText) lines.push(rowText);
        }
      }

      const text = lines.join('\n').trim();
      return text;
    } catch (err) {
      this.logger.warn(`Spreadsheet parse failed (${filename}): ${String(err)}`);
      return '';
    }
  }

  private async takeNextJob(client: PoolClient): Promise<AnalyticsJobRow | null> {
    const res = await this.db.query<AnalyticsJobRow>(
      `SELECT id, object_number, status
       FROM public.analytics_jobs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1;`,
      [],
      client,
    );

    const job = res.rows[0];
    if (!job) return null;

    await this.db.query(
      `UPDATE public.analytics_jobs
       SET status = 'in_progress', started_at = now(), updated_at = now()
       WHERE id = $1;`,
      [job.id],
      client,
    );

    try {
      await this.upsertRagIndexStatus(client, job.object_number, 'in_progress', null);
    } catch (err) {
      this.logger.warn(`Failed to update RAG index status for ${job.object_number}: ${String(err)}`);
    }

    return job;
  }

  private async finishJobIfDone(client: PoolClient, objectNumber: string) {
    const res = await this.db.query<{ remaining: number; total: number }>(
      `SELECT 
         count(*)::int AS total,
         count(*) FILTER (WHERE tas.id IS NULL)::int AS remaining
       FROM public.tender_attachments ta
       LEFT JOIN public.tender_attachments_summary tas ON tas.attachment_id = ta.id
      WHERE ta.object_number = $1
        AND (
          ta.file_name IS NULL OR ta.file_name NOT ILIKE '%.docx.pdf'
         );`,
      [objectNumber],
      client,
    );
    const remaining = res.rows[0]?.remaining ?? 0;
    const total = res.rows[0]?.total ?? 0;

    if ((total === 0 && remaining === 0) || (total > 0 && remaining === 0)) {
      await this.db.query(
        `UPDATE public.analytics_jobs
         SET status = 'done',
             finished_at = now(),
             updated_at = now(),
             error = CASE
               WHEN $2::int = 0 THEN 'No eligible documents to process'
               ELSE error
             END
         WHERE object_number = $1 AND status IN ('pending','in_progress');`,
        [objectNumber, total],
        client,
      );

      try {
        await this.refreshRagIndexStatus(client, objectNumber);
      } catch (err) {
        this.logger.warn(`Failed to refresh RAG index status for ${objectNumber}: ${String(err)}`);
      }
    } else {
      await this.db.query(
        `UPDATE public.analytics_jobs
         SET status = 'pending', updated_at = now()
         WHERE object_number = $1 AND status = 'in_progress';`,
        [objectNumber],
        client,
      );

      try {
        await this.upsertRagIndexStatus(client, objectNumber, 'in_progress', null);
      } catch (err) {
        this.logger.warn(`Failed to update RAG index status for ${objectNumber}: ${String(err)}`);
      }
    }
  }

  private ragTenderIndexEnabled(): boolean {
    return (process.env.RAG_TENDER_INDEX_ENABLED || 'true').toLowerCase() === 'true';
  }

  private getEmbeddingsConfig() {
    const apiKey = process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
    const baseUrl = (process.env.EMBEDDINGS_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
      .replace(/\/$/, '');
    const model = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
    const dim = Number(process.env.EMBEDDINGS_DIM || 1536);
    return { apiKey, baseUrl, model, dim };
  }

  private async upsertRagIndexStatus(client: PoolClient, objectNumber: string, status: string, error: string | null) {
    if (!objectNumber) return;
    if (!this.ragTenderIndexEnabled()) {
      await this.db.query(
        `INSERT INTO public.rag_tender_index_status (object_number, status, updated_at)
         VALUES ($1, 'disabled', now())
         ON CONFLICT (object_number)
         DO UPDATE SET status = 'disabled', updated_at = now();`,
        [objectNumber],
        client,
      );
      return;
    }

    const { model } = this.getEmbeddingsConfig();
    const chunkMaxChars = Number(process.env.RAG_CHUNK_MAX_CHARS || 2000);
    const chunkOverlapChars = Number(process.env.RAG_CHUNK_OVERLAP_CHARS || 200);

    await this.db.query(
      `INSERT INTO public.rag_tender_index_status (object_number, status, embedding_model, chunking_config, error, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, now())
       ON CONFLICT (object_number)
       DO UPDATE SET status = EXCLUDED.status,
                     embedding_model = EXCLUDED.embedding_model,
                     chunking_config = EXCLUDED.chunking_config,
                     error = EXCLUDED.error,
                     updated_at = now();`,
      [
        objectNumber,
        status,
        model,
        JSON.stringify({ chunkMaxChars, chunkOverlapChars }),
        error,
      ],
      client,
    );
  }

  private async refreshRagIndexStatus(client: PoolClient, objectNumber: string) {
    if (!objectNumber) return;
    if (!this.ragTenderIndexEnabled()) {
      await this.upsertRagIndexStatus(client, objectNumber, 'disabled', null);
      return;
    }

    const res = await this.db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt
       FROM public.rag_tender_chunks
       WHERE object_number = $1;`,
      [objectNumber],
      client,
    );
    const cnt = res.rows[0]?.cnt ?? 0;
    await this.db.query(
      `UPDATE public.rag_tender_index_status
       SET status = CASE WHEN $2::int > 0 THEN 'ready' ELSE 'failed' END,
           chunk_count = $2::int,
           updated_at = now(),
           error = CASE WHEN $2::int > 0 THEN NULL ELSE COALESCE(error, 'No chunks indexed') END
       WHERE object_number = $1;`,
      [objectNumber, cnt],
      client,
    );
  }

  private normalizeTextForChunking(text: string) {
    return (text || '')
      .replace(/\u0000/g, '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  private chunkText(text: string, maxChars: number, overlapChars: number, maxChunks: number): string[] {
    const normalized = this.normalizeTextForChunking(text);
    if (!normalized) return [];

    const parts = normalized.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const part of parts) {
      const next = current ? `${current}\n\n${part}` : part;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }

      if (current) {
        chunks.push(current);
      } else {
        // Single paragraph too large: hard split.
        for (let i = 0; i < part.length; i += maxChars) {
          chunks.push(part.slice(i, i + maxChars));
          if (chunks.length >= maxChunks) return chunks;
        }
        current = '';
        continue;
      }

      // Start new chunk with overlap from previous, if requested.
      const overlap = overlapChars > 0 ? current.slice(Math.max(0, current.length - overlapChars)) : '';
      current = overlap ? `${overlap}\n\n${part}` : part;

      if (chunks.length >= maxChunks) return chunks;
    }

    if (current && chunks.length < maxChunks) {
      chunks.push(current);
    }

    return chunks.slice(0, maxChunks);
  }

  private formatVector(values: number[], expectedDim: number) {
    if (!Array.isArray(values) || values.length !== expectedDim) {
      throw new Error(`Embedding dimension mismatch: got ${values?.length}, expected ${expectedDim}`);
    }
    // Keep string reasonably sized but deterministic.
    return `[${values.map((v) => (Number.isFinite(v) ? Number(v).toFixed(8) : '0')).join(',')}]`;
  }

  private sha256(text: string) {
    return createHash('sha256').update(text || '').digest('hex');
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    const { apiKey, baseUrl, model, dim } = this.getEmbeddingsConfig();
    if (!apiKey) {
      throw new Error('Missing EMBEDDINGS_API_KEY/OPENAI_API_KEY/OPENROUTER_API_KEY');
    }
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: texts, dimensions: dim }),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new Error(`Embeddings HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    if (json?.error) {
      throw new Error(`Embeddings provider error: ${JSON.stringify(json.error)}`);
    }
    const data = Array.isArray(json?.data) ? json.data : [];
    const embeddings = data.map((row: any) => row?.embedding).filter((x: any) => Array.isArray(x));
    if (embeddings.length !== texts.length) {
      throw new Error(`Embeddings result mismatch: got ${embeddings.length} for ${texts.length} inputs`);
    }
    return embeddings as number[][];
  }

  private async maybeIndexTenderRagChunks(
    client: PoolClient,
    payload: {
      objectNumber: string;
      attachmentId: number;
      sourcePath: string;
      sourceName: string | null;
      extractedText: string;
    },
  ) {
    if (!this.ragTenderIndexEnabled()) return;

    const maxTextChars = Number(process.env.RAG_TEXT_LIMIT || 200000);
    const chunkMaxChars = Number(process.env.RAG_CHUNK_MAX_CHARS || 2000);
    const chunkOverlapChars = Number(process.env.RAG_CHUNK_OVERLAP_CHARS || 200);
    const maxChunks = Number(process.env.RAG_MAX_CHUNKS_PER_DOC || 120);
    const batchSize = Number(process.env.RAG_EMBED_BATCH_SIZE || 24);
    const minChunkChars = Number(process.env.RAG_MIN_CHUNK_CHARS || 200);
    const { dim } = this.getEmbeddingsConfig();

    const text = (payload.extractedText || '').slice(0, maxTextChars);
    const chunks = this.chunkText(text, chunkMaxChars, chunkOverlapChars, maxChunks)
      .map((c) => c.trim())
      .filter((c) => c.length >= minChunkChars);

    if (!chunks.length) return;

    await this.db.query(
      `DELETE FROM public.rag_tender_chunks
       WHERE object_number = $1 AND attachment_id = $2 AND source_path = $3;`,
      [payload.objectNumber, payload.attachmentId, payload.sourcePath],
      client,
    );

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      let embeddings: number[][] | null = null;
      const mode = (process.env.RAG_SEARCH_MODE || 'auto').toLowerCase();
      if (mode !== 'fts') {
        try {
          embeddings = await this.embedTexts(batch);
        } catch (err) {
          // FTS fallback: store chunks without embeddings.
          this.logger.warn(`Embeddings unavailable, indexing via FTS only: ${String(err)}`);
          embeddings = null;
        }
      }
      for (let j = 0; j < batch.length; j += 1) {
        const content = batch[j];
        const hash = this.sha256(content);
        const vector = embeddings ? this.formatVector(embeddings[j], dim) : null;
        await this.db.query(
          `INSERT INTO public.rag_tender_chunks
            (object_number, attachment_id, source_path, source_name, chunk_index, content, content_hash, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
           ON CONFLICT (object_number, attachment_id, source_path, content_hash) DO NOTHING;`,
          [
            payload.objectNumber,
            payload.attachmentId,
            payload.sourcePath,
            payload.sourceName,
            i + j,
            content,
            hash,
            vector,
          ],
          client,
        );
      }
    }

    // Keep tender-level status fresh for UI gating.
    await this.db.query(
      `UPDATE public.rag_tender_index_status
       SET chunk_count = (
            SELECT count(*)::int FROM public.rag_tender_chunks WHERE object_number = $1
          ),
           updated_at = now()
       WHERE object_number = $1;`,
      [payload.objectNumber],
      client,
    );
  }


  private async callLlm(extractedText: string): Promise<{ content: string; model: string | null; totalTokens: number | null }> {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENROUTER_API_KEY (or OPENAI_API_KEY)');
    }

    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const model = process.env.LLM_MODEL || 'google/gemini-2.5-flash';

    const systemMessage =
      'ИНСТРУКЦИЯ:\n' +
      'Ты — старший юрист по госзакупкам (44-ФЗ). Твоя задача — извлечь риски и ключевые условия из текста.\n\n' +
      'верни СТРОГО валидный JSON:\n' +
      '- без markdown,\n' +
      '- без ```,\n' +
      '- двойные кавычки внутри текста экранируй как \\\"\n\n' +
      'Формат JSON:\n' +
      '{\n' +
      '  "summary": "Сжатое резюме сути документа (макс. 300 знаков)",\n' +
      '  "key_requirements": ["Список требуемых лицензий, СРО или специфических требований к участнику"],\n' +
      '  "key_terms": {\n' +
      '    "warranty_months": "Гарантийный срок (число или null)",\n' +
      '    "delivery_days": "Срок исполнения в днях (число или строка, если сложный график)",\n' +
      '    "guarantee_percent": "Обеспечение (%, число или null)",\n' +
      '    "payment_type": "Условия оплаты (кратко, например: \'По факту, отсрочка 7 дней\')",\n' +
      '    "quality_standard": "ГОСТы/ТУ (строка или null)"\n' +
      '  },\n' +
      '  "complexity_score": "Целое число от 1 (просто) до 5 (сложно/рискованно)",\n' +
      '  "risk_flags": ["Массив строк с описанием рисков (штрафы, размытое ТЗ, сжатые сроки)"]\n' +
      '}';

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: `Текст документа:\n${extractedText}` },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM HTTP ${res.status} ${res.statusText}: ${text}`);
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || '';
    const usedTokens =
      json?.usage?.total_tokens ??
      json?.usage?.totalTokens ??
      json?.usage?.completion_tokens ??
      json?.usage?.completionTokens ??
      null;
    const usedModel = json?.model ?? model ?? null;

    return { content, model: usedModel, totalTokens: Number.isFinite(usedTokens) ? Number(usedTokens) : null };
  }

  private parseLlmJson(raw: string, extractedTextFallback = ''): any {
    let clean = (raw || '').trim();

    if (clean.startsWith('```json')) {
      clean = clean.slice(7).trim();
    }
    if (clean.startsWith('```')) {
      clean = clean.slice(3).trim();
    }
    if (clean.endsWith('```')) {
      clean = clean.slice(0, clean.length - 3).trim();
    }

    try {
      return JSON.parse(clean);
    } catch {
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        try {
          return JSON.parse(clean.slice(start, end + 1));
        } catch {
          return this.buildFallbackLlmResult(raw, extractedTextFallback);
        }
      }
      return this.buildFallbackLlmResult(raw, extractedTextFallback);
    }
  }

  private buildFallbackLlmResult(raw: string, extractedTextFallback: string): any {
    const summary =
      this.extractSummaryFromRawLlm(raw) ||
      this.buildFallbackSummaryFromExtractedText(extractedTextFallback) ||
      'Документ обработан, но структурированный JSON-ответ от модели не распознан.';
    return {
      summary,
      key_requirements: [],
      key_terms: {},
      complexity_score: null,
      risk_flags: [],
      error: true,
    };
  }

  private extractSummaryFromRawLlm(raw: string): string {
    const text = (raw || '')
      .replace(/```(?:json)?/gi, ' ')
      .replace(/```/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';

    // Try to recover summary value from malformed JSON-like output.
    const summaryFieldMatch = text.match(/["']summary["']\s*:\s*["']([\s\S]{20,600}?)["']\s*[,}]/i);
    if (summaryFieldMatch?.[1]) {
      const value = summaryFieldMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (value.length >= 20) return value.slice(0, 300);
    }

    // If model answered in plain text, use first clean sentence.
    const firstSentence = text.match(/[^.!?…]{30,320}[.!?…]/);
    if (firstSentence?.[0]) return firstSentence[0].replace(/\s+/g, ' ').trim();

    return '';
  }

  private buildFallbackSummaryFromExtractedText(text: string): string {
    const normalized = (text || '')
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return '';

    const firstSentence = normalized.match(/[^.!?…]{40,320}[.!?…]/);
    if (firstSentence?.[0]) return firstSentence[0].replace(/\s+/g, ' ').trim();

    const short = normalized.slice(0, 300).trim();
    return short ? `${short}${normalized.length > 300 ? '…' : ''}` : '';
  }

  private async insertSummary(client: PoolClient, record: Record<string, any>) {
    await this.db.query(
      `INSERT INTO tender_attachments_summary
        (object_number, attachment_id, doc_kind_code, summary, key_terms, estimated_complexity, risk_flags, key_requirements, llm_model, llm_used_tokens)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::text[], $8::text[], $9, $10);`,
      [
        record.object_number,
        record.attachment_id,
        record.doc_kind_code,
        record.summary,
        JSON.stringify(record.key_terms ?? {}),
        record.estimated_complexity,
        record.risk_flags ?? [],
        record.key_requirements ?? [],
        record.llm_model,
        record.llm_used_tokens,
      ],
      client,
    );
  }

  private toNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const normalized = s.replace(/\s+/g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  private toStringArray(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
    }
    if (typeof value === 'string') {
      return value
        .split(/[;\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
