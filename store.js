// 선택적 영구 저장소 (Upstash Redis REST API).
// 환경변수(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)가 있으면 사용하고,
// 없으면 enabled=false가 되어 서버가 메모리/파일로 자동 폴백한다.
//
// 여러 버전(v1/v2/v3)이 하나의 Upstash DB를 함께 써도 섞이지 않도록,
// 모든 키에 INSTANCE_NAME을 접두어로 붙여 버전별로 분리한다.
const BASE_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PREFIX = (process.env.INSTANCE_NAME || 'default').replace(/\s+/g, '_') + ':';
const enabled = !!(BASE_URL && TOKEN);

async function cmd(args) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error('Upstash HTTP ' + res.status);
  const data = await res.json();
  if (data && data.error) throw new Error('Upstash: ' + data.error);
  return data ? data.result : null;
}

// JSON 값 하나를 읽는다. 실패하면 fallback을 돌려주고 서버는 계속 동작한다.
async function getJSON(key, fallback) {
  try {
    const v = await cmd(['GET', PREFIX + key]);
    if (v == null) return fallback;
    return JSON.parse(v);
  } catch (e) {
    console.error('[store] GET ' + key + ' 실패:', e.message);
    return fallback;
  }
}

async function setJSON(key, value) {
  try {
    await cmd(['SET', PREFIX + key, JSON.stringify(value)]);
    return true;
  } catch (e) {
    console.error('[store] SET ' + key + ' 실패:', e.message);
    return false;
  }
}

// 접속 기록 리스트에 한 건 추가하고, 최대 cap개까지만 유지한다.
async function pushLog(entry, cap) {
  try {
    await cmd(['LPUSH', PREFIX + 'connlog', JSON.stringify(entry)]);
    await cmd(['LTRIM', PREFIX + 'connlog', 0, (cap || 500) - 1]);
    return true;
  } catch (e) {
    console.error('[store] pushLog 실패:', e.message);
    return false;
  }
}

async function getLog(limit) {
  try {
    const arr = await cmd(['LRANGE', PREFIX + 'connlog', 0, (limit || 200) - 1]);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    console.error('[store] getLog 실패:', e.message);
    return [];
  }
}

module.exports = { enabled, getJSON, setJSON, pushLog, getLog };
