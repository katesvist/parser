import type { Tender } from '../types/tender';
import { apiRequest } from './api';

async function fetchTenderByObjectNumber(objectNumber: string): Promise<Tender | null> {
  try {
    return await apiRequest<Tender>(`tenders/${encodeURIComponent(objectNumber)}`);
  } catch {
    return null;
  }
}

export async function loadTenderDetailsMap(
  objectNumbers: string[],
  batchSize = 8,
): Promise<Record<string, Tender>> {
  const unique = Array.from(
    new Set(
      objectNumbers
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  const result: Record<string, Tender> = {};

  for (let i = 0; i < unique.length; i += batchSize) {
    const chunk = unique.slice(i, i + batchSize);
    const loaded = await Promise.all(
      chunk.map(async (objectNumber) => {
        const tender = await fetchTenderByObjectNumber(objectNumber);
        return { objectNumber, tender };
      }),
    );
    for (const item of loaded) {
      if (item.tender) {
        result[item.objectNumber] = item.tender;
      }
    }
  }

  return result;
}
