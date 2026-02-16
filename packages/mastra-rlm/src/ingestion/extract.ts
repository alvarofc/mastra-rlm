import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

import { extension } from '../path-utils';

type TextExtractionInput = {
  filePath: string;
  content: string | Buffer;
};

export async function extractText({ filePath, content }: TextExtractionInput): Promise<string> {
  const ext = extension(filePath);

  if (ext === '.txt' || ext === '.md') {
    return toUtf8String(content).trim();
  }

  const buffer = toBuffer(content);

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return (result.text ?? '').trim();
    } finally {
      await parser.destroy();
    }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  throw new Error(`Unsupported file type for extraction: ${ext || '(no extension)'} at ${filePath}`);
}

export function isSupportedForExtraction(path: string): boolean {
  const ext = extension(path);
  return ext === '.txt' || ext === '.md' || ext === '.pdf' || ext === '.docx';
}

function toUtf8String(content: string | Buffer): string {
  return typeof content === 'string' ? content : content.toString('utf8');
}

function toBuffer(content: string | Buffer): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}
