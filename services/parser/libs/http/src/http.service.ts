import { Injectable, Logger } from '@nestjs/common';

export type HttpResponseType = 'text' | 'json' | 'buffer';

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  responseType?: HttpResponseType;
  retries?: number;
  retryDelayMs?: number;
  throttleKey?: string;
  minDelayMs?: number;
}

@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly lastRequestAt = new Map<string, number>();

  async request<T = any>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      headers,
      body,
      timeoutMs = 60000,
      responseType = 'text',
      retries = 2,
      retryDelayMs = 2000,
      throttleKey,
      minDelayMs = 0,
    } = options;

    if (throttleKey && minDelayMs > 0) {
      await this.applyThrottle(throttleKey, minDelayMs);
    }

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        if (responseType === 'json') {
          return (await response.json()) as T;
        }

        if (responseType === 'buffer') {
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer) as unknown as T;
        }

        return (await response.text()) as unknown as T;
      } catch (err) {
        lastError = err;
        attempt += 1;
        if (attempt > retries) break;
        this.logger.warn(`Request failed (attempt ${attempt}/${retries}). ${String(err)}`);
        await this.sleep(retryDelayMs * attempt);
      }
    }

    throw lastError;
  }

  async getText(url: string, options: HttpRequestOptions = {}): Promise<string> {
    return this.request<string>(url, { ...options, responseType: 'text' });
  }

  async getJson<T = any>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    return this.request<T>(url, { ...options, responseType: 'json' });
  }

  async getBuffer(url: string, options: HttpRequestOptions = {}): Promise<Buffer> {
    return this.request<Buffer>(url, { ...options, responseType: 'buffer' });
  }

  private async applyThrottle(key: string, minDelayMs: number) {
    const last = this.lastRequestAt.get(key) || 0;
    const now = Date.now();
    const waitMs = Math.max(0, minDelayMs - (now - last));
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    this.lastRequestAt.set(key, Date.now());
  }

  private async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
