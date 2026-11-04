import https from 'https';
import fs from 'fs';
import path from 'path';

let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.warn('[Firestore] Failed to read firebase-applet-config.json:', e);
}

export function getFirestoreConfig() {
  return firebaseConfig;
}

export function toFirestoreFields(obj: any): { fields: Record<string, any> } {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    } else if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) => {
            if (typeof item === 'object' && item !== null) {
              return { stringValue: JSON.stringify(item) };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof v === 'object') {
      fields[k] = { stringValue: JSON.stringify(v) };
    }
  }
  return { fields };
}

export function fromFirestoreDoc(doc: any): any {
  if (!doc || !doc.fields) return null;
  const obj: Record<string, any> = {};
  for (const [k, v] of Object.entries<any>(doc.fields)) {
    if ('stringValue' in v) {
      const s = v.stringValue;
      // Auto-parse serialized objects/arrays
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try {
          obj[k] = JSON.parse(s);
          continue;
        } catch {}
      }
      obj[k] = s;
    } else if ('integerValue' in v) {
      obj[k] = parseInt(v.integerValue, 10);
    } else if ('doubleValue' in v) {
      obj[k] = v.doubleValue;
    } else if ('booleanValue' in v) {
      obj[k] = v.booleanValue;
    } else if ('nullValue' in v) {
      obj[k] = null;
    } else if ('arrayValue' in v) {
      obj[k] = (v.arrayValue.values || []).map((val: any) => {
        const itemStr = val.stringValue || val;
        try {
          return JSON.parse(itemStr);
        } catch {
          return itemStr;
        }
      });
    }
  }
  const parts = (doc.name || '').split('/');
  obj._id = parts[parts.length - 1];
  return obj;
}

export async function firestoreRequest(urlPath: string, method: string = 'GET', body: any = null): Promise<{ status: number; data: any }> {
  if (!firebaseConfig || !firebaseConfig.projectId || !firebaseConfig.apiKey) {
    throw new Error('Firestore configuration missing in firebase-applet-config.json');
  }

  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const fullPath = `/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents${urlPath}?key=${firebaseConfig.apiKey}`;
  const data = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'firestore.googleapis.com',
        path: fullPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        },
        timeout: 8000
      },
      (res) => {
        let resBody = '';
        res.on('data', (d) => (resBody += d));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(resBody);
            resolve({ status: res.statusCode || 200, data: parsed });
          } catch {
            resolve({ status: res.statusCode || 200, data: resBody });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Firestore request timed out'));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Higher-level document operations
export async function firestoreSaveDoc(collection: string, docId: string, data: any): Promise<boolean> {
  try {
    const payload = toFirestoreFields(data);
    const res = await firestoreRequest(`/${collection}/${encodeURIComponent(docId)}`, 'PATCH', payload);
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    console.warn(`[Firestore] Failed to save ${collection}/${docId}:`, err);
    return false;
  }
}

export async function firestoreGetDoc(collection: string, docId: string): Promise<any | null> {
  try {
    const res = await firestoreRequest(`/${collection}/${encodeURIComponent(docId)}`, 'GET');
    if (res.status === 200) {
      return fromFirestoreDoc(res.data);
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function firestoreQueryCollection(collection: string, field?: string, op: string = 'EQUAL', value?: any): Promise<any[]> {
  try {
    const query: any = {
      structuredQuery: {
        from: [{ collectionId: collection }]
      }
    };

    if (field && value !== undefined) {
      const valObj = typeof value === 'number'
        ? (Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value })
        : typeof value === 'boolean'
        ? { booleanValue: value }
        : { stringValue: String(value) };

      query.structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: field },
          op,
          value: valObj
        }
      };
    }

    const res = await firestoreRequest(':runQuery', 'POST', query);
    if (res.status === 200 && Array.isArray(res.data)) {
      return res.data
        .filter((d: any) => d.document)
        .map((d: any) => fromFirestoreDoc(d.document));
    }
    return [];
  } catch (err) {
    console.warn(`[Firestore] Query on ${collection} failed:`, err);
    return [];
  }
}

export async function firestoreDeleteDoc(collection: string, docId: string): Promise<boolean> {
  try {
    const res = await firestoreRequest(`/${collection}/${encodeURIComponent(docId)}`, 'DELETE');
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    return false;
  }
}
