import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { apiRequest } from '../lib/api';
import { cn } from './ui/utils';

type Citation =
  | {
      id: string;
      type: 'tender';
      title: string;
      attachment_id?: number;
      snippet?: string; // short quote/excerpt
    }
  | {
      id: string;
      type: 'law';
      title: string;
      source_url?: string | null;
      as_of_date?: string | null;
      snippet?: string; // short quote/excerpt
    };

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
};

interface TenderAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectNumber: string;
}

type ParsedBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

function normalizeAssistantInline(text: string): string {
  return String(text || '')
    .replace(/\\([*_[\]()`])/g, '$1')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const input = normalizeAssistantInline(text);
  const out: ReactNode[] = [];
  const boldRe = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  let idx = 0;
  let match: RegExpExecArray | null = null;
  while ((match = boldRe.exec(input)) !== null) {
    if (match.index > last) {
      out.push(
        <span key={`${keyPrefix}-t-${idx++}`}>{input.slice(last, match.index)}</span>
      );
    }
    out.push(<strong key={`${keyPrefix}-b-${idx++}`}>{match[2]}</strong>);
    last = boldRe.lastIndex;
  }
  if (last < input.length) {
    out.push(<span key={`${keyPrefix}-t-${idx++}`}>{input.slice(last)}</span>);
  }
  return out;
}

function renderTextWithCitationChips(text: string, keyPrefix: string): ReactNode[] {
  const input = normalizeAssistantInline(text);
  const out: ReactNode[] = [];
  const re = /\[([TL]\d+)\]/g;
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > last) {
      out.push(
        ...renderInlineMarkdown(input.slice(last, match.index), `${keyPrefix}-seg-${i++}`)
      );
    }
    out.push(
      <span
        key={`${keyPrefix}-ref-${i++}`}
        className="mx-0.5 inline-flex -translate-y-[0.08em] items-center rounded-full border border-[#1f3c88]/20 bg-[#1f3c88]/10 px-1.5 py-[1px] align-[0.1em] text-[9px] font-semibold leading-none tracking-[0.02em] text-[#1f3c88]/85"
      >
        {match[1]}
      </span>
    );
    last = re.lastIndex;
  }
  if (last < input.length) {
    out.push(...renderInlineMarkdown(input.slice(last), `${keyPrefix}-seg-${i++}`));
  }
  return out;
}

function parseAssistantBlocks(content: string): ParsedBlock[] {
  const lines = String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const blocks: ParsedBlock[] = [];
  let paragraph: string[] = [];
  let ulItems: string[] = [];
  let olItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: 'paragraph', text });
      paragraph = [];
    }
  };
  const flushUl = () => {
    if (ulItems.length > 0) {
      blocks.push({ type: 'ul', items: ulItems });
      ulItems = [];
    }
  };
  const flushOl = () => {
    if (olItems.length > 0) {
      blocks.push({ type: 'ol', items: olItems });
      olItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = normalizeAssistantInline(rawLine);
    if (!line) {
      flushParagraph();
      flushUl();
      flushOl();
      continue;
    }

    const olMatch = line.match(/^\d+[.)]\s*(.*)$/);
    if (olMatch) {
      flushParagraph();
      flushUl();
      olItems.push(olMatch[1].trim());
      continue;
    }

    const ulMatch = line.match(/^[-*•]\s*(.*)$/);
    if (ulMatch) {
      flushParagraph();
      flushOl();
      ulItems.push(ulMatch[1].trim());
      continue;
    }

    flushUl();
    flushOl();
    paragraph.push(line);
  }

  flushParagraph();
  flushUl();
  flushOl();

  if (blocks.length === 0) {
    const fallback = String(content || '').trim();
    return fallback ? [{ type: 'paragraph', text: fallback }] : [];
  }
  return blocks;
}

function compactCitationSnippet(text: string, maxLen = 220): string {
  const normalized = normalizeAssistantInline(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;

  const window = normalized.slice(0, maxLen + 1);
  const boundary = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('; '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  if (boundary > 90) return window.slice(0, boundary + 1).trim();
  return `${window.slice(0, maxLen).trim()}…`;
}

export function TenderAssistantDialog({ open, onOpenChange, objectNumber }: TenderAssistantDialogProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Start fresh per tender open for now.
    setThreadId(null);
    setMessages([
      {
        role: 'assistant',
        content:
          'Задайте вопрос по тендеру. Я отвечаю только по фактам из документов и (при необходимости) по 44‑ФЗ/223‑ФЗ с цитированием.',
      },
    ]);
  }, [open, objectNumber]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages.length, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setError(null);
    setSending(true);

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    try {
      const resp = await apiRequest<{
        thread_id: string | number;
        answer: string;
        citations?: Citation[];
      }>('assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_number: objectNumber,
          thread_id: threadId,
          message: text,
        }),
      });

      const nextThread = resp?.thread_id !== undefined ? String(resp.thread_id) : null;
      if (nextThread) setThreadId(nextThread);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: resp?.answer || 'Не удалось получить ответ.', citations: resp?.citations || [] },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отправки.');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Не удалось получить ответ. Попробуйте ещё раз.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl rounded-[24px] border border-border bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
        <DialogHeader className="gap-1">
          <DialogTitle className="text-lg">Ассистент по тендеру</DialogTitle>
          <DialogDescription>
            Тендер: <span className="font-medium text-foreground">{objectNumber}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[60vh] flex-col gap-3">
          <div className="flex-1 overflow-y-auto overflow-x-hidden rounded-[18px] border border-border/70 bg-muted/20 p-4">
            <div className="space-y-3">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'min-w-0 w-fit max-w-[92%] overflow-hidden rounded-[18px] border px-4 py-3 text-sm leading-relaxed break-words [overflow-wrap:anywhere]',
                    m.role === 'user'
                      ? 'ml-auto border-[#1f3c88]/20 bg-[#1f3c88] text-white'
                      : 'mr-auto border-border/70 bg-white text-foreground',
                  )}
                >
                  <div className="min-w-0 space-y-2 break-words [overflow-wrap:anywhere]">
                    {m.role === 'assistant' ? (
                      parseAssistantBlocks(m.content).map((block, blockIdx) => {
                        if (block.type === 'paragraph') {
                          return (
                            <p
                              key={blockIdx}
                              className="text-sm leading-relaxed text-current break-words [overflow-wrap:anywhere]"
                            >
                              {renderTextWithCitationChips(
                                block.text,
                                `msg-${idx}-p-${blockIdx}`
                              )}
                            </p>
                          );
                        }
                        if (block.type === 'ul') {
                          return (
                            <ul
                              key={blockIdx}
                              className="list-disc space-y-1 pl-5 text-sm leading-relaxed break-words [overflow-wrap:anywhere]"
                            >
                              {block.items.map((item, itemIdx) => (
                                <li key={itemIdx}>
                                  {renderTextWithCitationChips(
                                    item,
                                    `msg-${idx}-ul-${blockIdx}-${itemIdx}`
                                  )}
                                </li>
                              ))}
                            </ul>
                          );
                        }
                        return (
                          <ol
                            key={blockIdx}
                            className="list-decimal space-y-1 pl-5 text-sm leading-relaxed break-words [overflow-wrap:anywhere]"
                          >
                            {block.items.map((item, itemIdx) => (
                              <li key={itemIdx}>
                                {renderTextWithCitationChips(
                                  item,
                                  `msg-${idx}-ol-${blockIdx}-${itemIdx}`
                                )}
                              </li>
                            ))}
                          </ol>
                        );
                      })
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    )}
                  </div>
                  {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[11px] font-medium text-muted-foreground">Источники</div>
                      <div className="space-y-2">
                        {m.citations.map((c) => (
                          <div key={c.id} className="min-w-0 rounded-[14px] border border-border/70 bg-muted/20 px-3 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 text-[11px] font-semibold text-foreground break-words [overflow-wrap:anywhere]">
                                {c.id}: {c.title}
                              </div>
                              <div className="shrink-0 whitespace-nowrap text-right text-[10px] leading-none text-muted-foreground">
                                {c.type === 'law' ? 'закон' : 'документ'}
                              </div>
                            </div>
                            {c.snippet ? (
                              <div className="mt-1 text-[12px] leading-5 text-foreground/85 break-words [overflow-wrap:anywhere]">
                                «{compactCitationSnippet(c.snippet)}»
                              </div>
                            ) : null}
                            {'source_url' in c && c.source_url ? (
                              <div className="mt-1 text-[10px] text-muted-foreground break-all">
                                {c.source_url}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="mr-auto max-w-[80%] rounded-[18px] border border-border/70 bg-white px-4 py-3 text-sm text-muted-foreground">
                  Печатает...
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Например: какие сроки исполнения указаны в документах?"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={sending}
            />
            <Button onClick={() => void send()} disabled={!canSend}>
              Отправить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
