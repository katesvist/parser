const asArray = <T>(v: T | T[] | null | undefined): T[] => {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
};

const getText = (value: any): string => {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return getText(value[0]);
  if (typeof value === 'object') {
    if ('text' in value) return getText((value as any).text);
    if ('_text' in value) return getText((value as any)._text);
  }
  return String(value).trim();
};

const stripNs = (obj: any): any => {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripNs);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.replace(/^ns\d+:/, '').replace(/^[a-zA-Z0-9]+:/, '')] = stripNs(v);
  }
  return out;
};

export function parseDescriptionToKV(html: string): Record<string, string> {
  const norm = String(html || '').replace(/<br\s*\/?>/gi, '<br>');
  const chunks = norm.split(/<strong>/i).slice(1);

  const kv: Record<string, string> = {};
  for (const chunk of chunks) {
    const [labelRaw, restRaw = ''] = chunk.split(/<\/strong>/i);
    const label = (labelRaw || '').replace(/[:：]\s*$/, '').trim();
    const value = String((restRaw.split(/<strong>|<br\s*\/?>/i)[0] || ''))
      .replace(/<\/?[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
    if (label && value) {
      kv[label] = value;
    }
  }
  return kv;
}

function flattenToStrings(obj: any, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj === null || obj === undefined) return out;

  for (const [k, vRaw] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const v = vRaw as any;

    if (v === null || v === undefined) {
      out[key] = '';
      continue;
    }

    if (Array.isArray(v)) {
      if (v.length === 1) {
        flattenToStrings(v[0], key, out);
      } else {
        out[key] = v
          .map((x) => {
            if (x === null || x === undefined) return '';
            if (typeof x === 'object') {
              if ('text' in x || '_text' in x) return getText(x);
              return JSON.stringify(x);
            }
            return String(x);
          })
          .join('; ');
      }
      continue;
    }

    if (typeof v === 'object') {
      if ('text' in v || '_text' in v) {
        out[key] = getText(v);
      } else {
        flattenToStrings(v, key, out);
      }
      continue;
    }

    out[key] = String(v);
  }

  return out;
}

export interface RssItemFlat {
  [key: string]: string;
}

export function parseRssItems(rssJson: any): RssItemFlat[] {
  const root = rssJson;
  const channel = root?.rss?.channel ?? root?.channel ?? {};
  let list = channel?.item;
  if (!list) return [];
  if (!Array.isArray(list)) list = [list];

  return list.map((it: any) => {
    const title = getText(it.title);
    const linkRaw = getText(it.link);
    const link = linkRaw && /^https?:\/\//i.test(linkRaw) ? linkRaw : linkRaw ? `https://zakupki.gov.ru${linkRaw}` : '';
    const author = getText(it.author);
    const pubDate = getText(it.pubDate);
    const descHtml = getText(it.description);
    const description_kv = parseDescriptionToKV(descHtml);
    const lawHint = `${description_kv['Размещение выполняется по'] || ''} ${descHtml}`;
    const law = /notice223/i.test(link) ||
      /\/223\//i.test(link) ||
      /223\s*[-–]?\s*фз/i.test(lawHint)
      ? '223'
      : '44';

    const base = {
      title,
      link,
      author,
      pubDate,
      law,
      regNumber:
        link.match(/regNumber=(\d+)/)?.[1] ||
        title.match(/№\s*(\d{8,})/)?.[1] ||
        title.match(/(\d{8,})/)?.[1] ||
        '',
      description_kv,
    };

    const flatBase = flattenToStrings(base);
    for (const [k, v] of Object.entries(description_kv)) {
      flatBase[`description_kv.${k}`] = String(v);
    }
    delete flatBase['description_kv'];

    return flatBase;
  });
}

export function applyRssUpdatedAt(item: Record<string, any>): Record<string, any> {
  const updatedRaw = item['description_kv.Обновлено'];
  if (updatedRaw) {
    const [day, month, year] = String(updatedRaw).split('.');
    item.rss_updated_at = `${year}-${month}-${day}T00:00:00+03:00`;
  } else {
    item.rss_updated_at = null;
  }
  return item;
}

export function normalize44(parsedXml: any): any {
  const root =
    parsedXml['ns7:epNotificationEOK2020'] ||
    parsedXml['ns7:epNotificationEF2020'] ||
    parsedXml['ns7:epNotificationEZK2020'] ||
    parsedXml['ns7:epNotificationEZT2020'];

  if (!root) {
    return { ...parsedXml, _error: 'Unsupported 44-FZ root' };
  }

  const commonInfo = root.commonInfo || {};
  return {
    ...parsedXml,
    _root: root,
    object_number: commonInfo.purchaseNumber || null,
    zakon: '44fz',
  };
}

export function normalize223(parsedXml: any): any {
  const rootKey = [
    'ns2:purchaseNoticeZKESMBO',
    'ns2:purchaseNoticeKESMBO',
    'ns2:purchaseNoticeZPESMBO',
    'ns2:purchaseNoticeAESMBO',
    'ns2:purchaseNoticeEP',
    'ns2:purchaseNoticeAE',
    'ns2:purchaseNotice',
    'ns2:purchaseNoticeZK',
    'ns2:protocol',
  ].find((k) => parsedXml[k]);

  if (!rootKey) {
    return { ...parsedXml, _error: 'Unsupported 223-FZ root' };
  }

  const root = parsedXml[rootKey];
  const body = root['ns2:body'];
  const itemNode = body && body['ns2:item'] ? body['ns2:item'] : null;

  let regNumber: string | null = null;
  if (itemNode) {
    const dynamicDataKey = Object.keys(itemNode).find((k) => k.endsWith('Data'));
    if (dynamicDataKey) {
      itemNode['_unifiedData'] = itemNode[dynamicDataKey];
      regNumber = itemNode[dynamicDataKey]['ns2:registrationNumber'];
    } else {
      itemNode['_unifiedData'] = itemNode;
    }
  }

  return {
    ...parsedXml,
    _root: root,
    object_number: regNumber || null,
    zakon: '223fz',
  };
}

export function extract44Items(parsedItems: any[]): any[] {
  const out: any[] = [];

  for (const item of parsedItems) {
    const json = item;
    const rootRaw =
      json['ns7:epNotificationEOK2020'] ||
      json['ns7:epNotificationEF2020'] ||
      json['ns7:epNotificationEZK2020'] ||
      json['ns7:epNotificationEZT2020'];

    if (!rootRaw) continue;

    const root = stripNs(rootRaw);
    const regNumber = getText(root.commonInfo && root.commonInfo.purchaseNumber);

    const purchaseObjectsInfo = root.notificationInfo?.purchaseObjectsInfo || {};
    const notDrugPositions = asArray(
      purchaseObjectsInfo?.notDrugPurchaseObjectsInfo?.purchaseObject,
    );
    const directPositions = asArray(purchaseObjectsInfo?.purchaseObject);
    const drugPositions = asArray(
      purchaseObjectsInfo?.drugPurchaseObjectsInfo?.drugPurchaseObjectInfo,
    );
    const positions = [...notDrugPositions, ...directPositions];

    if (!positions.length && !drugPositions.length) {
      out.push({ object_number: regNumber, note: 'no purchaseObject in XML' });
      continue;
    }

    positions.forEach((po: any, index: number) => {
      const ktru = po.KTRU || {};
      const okei = po.OKEI || {};
      const qty = po.quantity || {};
      const restrictions = po.restrictionsInfo || {};

      out.push({
        object_number: regNumber,
        positionIndex: index,
        item_name: getText(ktru.name) || getText(po.name),
        price_for_one: getText(po.price) || getText(po.pricePerUnit),
        total_sum: getText(po.sum) || getText(po.positionPrice),
        item_type: getText(po.type),
        volume_specifying_method: getText(po.volumeSpecifyingMethod),
        okei_code: getText(okei.code),
        okei_name: getText(okei.name),
        okei_national_code: getText(okei.nationalCode),
        quantity_value: getText(qty.value) || getText(qty),
        okpd2_code: getText((ktru.OKPD2 && ktru.OKPD2.OKPDCode) || (po.OKPD2 && po.OKPD2.OKPDCode)),
        okpd2_name: getText((ktru.OKPD2 && ktru.OKPD2.OKPDName) || (po.OKPD2 && po.OKPD2.OKPDName)),
        characteristics_detailed_json: ktru.characteristics || null,
        is_prohibition_foreign: getText(restrictions.isProhibitionForeignPurchaseObjects) === 'true',
        is_impossibility_prohibition: getText(restrictions.isImposibilityProhibition) === 'true',
        impossibility_reason: getText(restrictions.reasonImposibilityProhibition) || null,
        restriction_reasons_json: restrictions || null,
      });
    });

    const pickDrugInfo = (drugNode: any) => {
      const direct = drugNode?.objectInfoUsingReferenceInfo?.drugsInfo?.drugInfo;
      if (direct) return direct;

      const interchangeManual =
        drugNode?.objectInfoUsingReferenceInfo?.drugsInfo?.drugInterchangeInfo?.drugInterchangeManualInfo;
      const manualDrug = interchangeManual?.drugInfo;
      if (manualDrug?.drugInfoUsingReferenceInfo) return manualDrug.drugInfoUsingReferenceInfo;
      if (manualDrug) return manualDrug;

      const interchange = drugNode?.objectInfoUsingReferenceInfo?.drugsInfo?.drugInterchangeInfo;
      const interchangeDrug =
        interchange?.drugInterchangeInfo?.drugInfo || interchange?.drugInfo;
      if (interchangeDrug?.drugInfoUsingReferenceInfo) return interchangeDrug.drugInfoUsingReferenceInfo;
      return interchangeDrug || null;
    };

    drugPositions.forEach((po: any, idx: number) => {
      const drugInfo = pickDrugInfo(po) || {};
      const mnn = getText(drugInfo?.MNNInfo?.MNNName);
      const medForm = getText(drugInfo?.medicamentalFormInfo?.medicamentalFormName);
      const dose = getText(drugInfo?.dosageInfo?.dosageGRLSValue);
      const defaultName = [mnn, medForm, dose].filter(Boolean).join(', ');

      out.push({
        object_number: regNumber,
        positionIndex: positions.length + idx,
        item_name: getText(po?.name) || defaultName,
        price_for_one:
          getText(po?.pricePerUnit) ||
          getText(drugInfo?.limPriceValuePerUnit) ||
          getText(drugInfo?.averagePriceValue) ||
          null,
        total_sum:
          getText(po?.positionPrice) ||
          getText(po?.totalPrice) ||
          getText(drugInfo?.totalPrice) ||
          getText(drugInfo?.totalPriceWithVAT) ||
          null,
        item_type: getText(po?.type),
        volume_specifying_method: null,
        okei_code:
          getText(drugInfo?.manualUserOKEI?.code) ||
          getText(drugInfo?.dosageInfo?.dosageUserOKEI?.code) ||
          null,
        okei_name:
          getText(drugInfo?.manualUserOKEI?.name) ||
          getText(drugInfo?.dosageInfo?.dosageUserOKEI?.name) ||
          getText(drugInfo?.dosageInfo?.dosageUserName) ||
          null,
        okei_national_code:
          getText(drugInfo?.manualUserOKEI?.nationalCode) ||
          getText(drugInfo?.dosageInfo?.dosageUserOKEI?.nationalCode) ||
          null,
        quantity_value:
          getText(drugInfo?.drugQuantity) ||
          getText(po?.drugQuantityCustomersInfo?.drugQuantityCustomer?.drugQuantity) ||
          null,
        okpd2_code: getText(drugInfo?.OKPD2?.OKPDCode) || null,
        okpd2_name: getText(drugInfo?.OKPD2?.OKPDName) || null,
        characteristics_detailed_json: drugInfo?.characteristics || null,
        is_prohibition_foreign: false,
        is_impossibility_prohibition: false,
        impossibility_reason: null,
        restriction_reasons_json: po?.restrictionsInfo || null,
      });
    });
  }

  return out;
}

export function extract44Attachments(parsedItems: any[]): any[] {
  const out: any[] = [];

  for (const src of parsedItems) {
    const j = src;
    const root =
      j['ns7:epNotificationEOK2020'] ||
      j['ns7:epNotificationEF2020'] ||
      j['ns7:epNotificationEZK2020'] ||
      j['ns7:epNotificationEZT2020'];

    if (!root) continue;

    const regNumber = getText(root?.commonInfo?.purchaseNumber);

    const attachments = asArray(root?.attachmentsInfo?.['ns3:attachmentInfo'] || []);

    attachments.forEach((a: any, idx: number) => {
      const publishedContentId = getText(a['ns3:publishedContentId']);
      const fileName = getText(a['ns3:fileName']);
      const fileSize = getText(a['ns3:fileSize']);
      const docDescription = getText(a['ns3:docDescription']);
      const docDate = getText(a['ns3:docDate']);
      const url = getText(a['ns3:url']);

      const kindRaw = a['ns3:docKindInfo'] ?? {};
      const kind = stripNs(kindRaw);
      const docKindCode = getText(kind.code);
      const docKindName = getText(kind.name);

      out.push({
        object_number: regNumber,
        doc_index: idx,
        published_content_id: publishedContentId,
        file_name: fileName,
        file_size: fileSize,
        doc_description: docDescription,
        doc_date: docDate,
        url,
        doc_kind_code: docKindCode,
        doc_kind_name: docKindName,
      });
    });
  }

  return out;
}

export function extract223Attachments(normalizedItems: any[]): any[] {
  const out: any[] = [];

  for (const item of normalizedItems) {
    const json = item;
    const itemNode = json._root?.['ns2:body']?.['ns2:item'];
    const unifiedDataRaw = itemNode?.['_unifiedData'];
    if (!unifiedDataRaw) continue;

    const data = stripNs(unifiedDataRaw);
    const regNumber = json.object_number || getText(data.registrationNumber);
    const docs = asArray(data.attachments && data.attachments.document);

    if (!docs.length) {
      out.push({ object_number: regNumber, note: 'no attachments in 223-FZ XML' });
      continue;
    }

    docs.forEach((doc: any, idx: number) => {
      out.push({
        object_number: regNumber,
        doc_index: idx,
        published_content_id: getText(doc.guid),
        file_name: getText(doc.fileName),
        file_size: null,
        doc_description: getText(doc.description) || getText(doc.name),
        doc_date: getText(doc.createDateTime) || getText(data.createDateTime),
        url: getText(doc.url),
        doc_kind_code: null,
        doc_kind_name: null,
      });
    });
  }

  return out;
}

export function extract223Items(normalizedItems: any[]): any[] {
  const out: any[] = [];

  for (const item of normalizedItems) {
    const json = item;
    const itemNode = json._root?.['ns2:body']?.['ns2:item'];
    const unifiedDataRaw = itemNode?.['_unifiedData'];
    if (!unifiedDataRaw) continue;

    const data = stripNs(unifiedDataRaw);
    const regNumber = json.object_number || getText(data.registrationNumber);

    const lots = asArray(
      (data.lots && data.lots.lot) ||
      (data.lots && data.lots.lotData) ||
      data.lot ||
      data.lotData,
    );
    if (!lots.length) {
      out.push({ object_number: regNumber, note: 'no lots in 223-FZ XML' });
      continue;
    }

    let globalItemIndex = 0;
    lots.forEach((lot: any, lotIdx: number) => {
      const lotSource = lot.lotData || lot;
      const lotItems = asArray(lotSource.lotItems && lotSource.lotItems.lotItem);
      const itemsToProcess = lotItems.length ? lotItems : [lotSource];

      itemsToProcess.forEach((pos: any) => {
        const okei = pos.okei || lotSource.okei || {};
        const qtyRaw = getText(pos.qty) || getText(pos.quantity) || getText(lotSource.qty) || getText(lotSource.quantity);
        const qtyNum = Number(String(qtyRaw).replace(',', '.'));
        const initialSumRaw = getText(lotSource.initialSum);
        const initialSumNum = Number(String(initialSumRaw).replace(',', '.'));
        const priceDerived =
          Number.isFinite(initialSumNum) && Number.isFinite(qtyNum) && qtyNum > 0
            ? String(initialSumNum / qtyNum)
            : '';
        const okpd2 = pos.okpd2 || lotSource.okpd2 || {};

        out.push({
          object_number: regNumber,
          positionIndex: globalItemIndex++,
          lot_index: lotIdx + 1,
          item_name: getText(pos.name) || getText(pos.subject) || getText(lotSource.subject),
          price_for_one:
            getText(pos.price) ||
            getText(pos.unitPrice) ||
            getText(pos.initialPrice) ||
            priceDerived ||
            null,
          total_sum: getText(pos.sum) || getText(pos.amount) || getText(lotSource.initialSum),
          okei_code: getText(okei.code),
          okei_name: getText(okei.name),
          okei_national_code: getText(okei.nationalCode),
          quantity_value: qtyRaw || null,
          okpd2_code: getText(okpd2.code),
          okpd2_name: getText(okpd2.name),
          characteristics_detailed_json: null,
        });
      });
    });
  }

  return out;
}

export function find223PrintFormUrl(html: string): { url: string | null; value: string | null } {
  const match = html.match(/https:\/\/zakupki\.gov\.ru\/223\/purchase\/public\/print-form\/show\.html\?pfid=\d+/i);
  const valueMatch = html.match(/<div[^>]*class=["']common-text__value["'][^>]*>([\s\S]*?)<\/div>/i);
  const value = valueMatch ? valueMatch[1].trim() : null;

  return {
    url: match ? match[0] : null,
    value,
  };
}

export function extract223XmlFromHtml(html: string): string {
  const m = html.match(/<div[^>]*id=["']tabs-2["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!m) {
    throw new Error('div#tabs-2 not found');
  }

  let s = m[1];
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '');

  const decodeEntities = (t: string) =>
    t
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;|&#34;|&#x22;/g, '"')
      .replace(/&apos;|&#39;|&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');

  s = decodeEntities(s).trim();
  s = s.replace(/^\uFEFF/, '');
  const p = s.indexOf('<?xml');
  if (p > 0) s = s.slice(p);

  return s;
}

export function getTextValue(value: any): string {
  return getText(value);
}

export function stripNamespaces(obj: any): any {
  return stripNs(obj);
}
