const { execSync } = require('child_process');
const path = require('path');

function getDbPath() {
  if (process.env.OPENCODE_DB_PATH) {
    return process.env.OPENCODE_DB_PATH;
  }
  
  const home = process.env.HOME || process.env.USERPROFILE;
  
  if (!home) {
    throw new Error('Could not determine home directory. Set OPENCODE_DB_PATH environment variable.');
  }
  
  const dataDir = path.join(home, '.local', 'share', 'opencode');
  return path.join(dataDir, 'opencode.db');
}

const DB_PATH = getDbPath();

const cache = new Map();
const CACHE_TTL = 30000;

function query(sql) {
  const cacheKey = sql;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }
  
  const escapedSql = sql.replace(/'/g, "'\"'\"'");
  const result = execSync(
    `sqlite3 "${DB_PATH}" -json '${escapedSql}'`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 60000 }
  );
  
  let data;
  try {
    data = JSON.parse(result || '[]');
  } catch {
    data = [];
  }
  
  cache.set(cacheKey, { data, time: Date.now() });
  return data;
}

function normalizeModelName(modelId) {
  if (!modelId) return 'unknown';
  return modelId;
}

function getShortModelName(modelId) {
  if (!modelId) return 'unknown';
  return modelId
    .replace(/^zai-org\//, '')
    .replace(/-maas$/, '')
    .replace(/-free$/, '')
    .replace(/-flashx$/, '-flash');
}

function isFreeModel(modelId) {
  if (!modelId) return false;
  return modelId.includes('-free') || 
         modelId === 'big-pickle' ||
         modelId.includes('nemotron');
}

function getOverview(days = null) {
  const timeFilter = (days !== null && days > 0) ? `AND time_created >= ${Date.now() - (days * 24 * 60 * 60 * 1000)}` : '';
  
  const rows = query(`
    SELECT 
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as totalInput,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as totalOutput,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as totalCacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as totalCacheWrite,
      MIN(time_created) as firstMessage,
      MAX(time_created) as lastMessage
    FROM message
    WHERE data LIKE '%"tokens":%' ${timeFilter}
  `);
  
  const row = rows[0] || {};
  return {
    messageCount: row.messageCount || 0,
    totalInput: row.totalInput || 0,
    totalOutput: row.totalOutput || 0,
    totalCacheRead: row.totalCacheRead || 0,
    totalCacheWrite: row.totalCacheWrite || 0,
    firstMessage: row.firstMessage,
    lastMessage: row.lastMessage
  };
}

function getModelsStats() {
  const rows = query(`
    SELECT 
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"modelID"%' AND data LIKE '%"tokens":%'
    GROUP BY json_extract(data, '$.modelID')
    ORDER BY inputTokens DESC
  `);
  
  return rows.map(row => ({
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getDailyStats(days = 30) {
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      date(time_created / 1000, 'unixepoch') as date,
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"tokens":%' AND time_created >= ${startTime}
    GROUP BY date, json_extract(data, '$.modelID')
    ORDER BY date
  `);
  
  return rows.map(row => ({
    date: row.date,
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getWeeklyStats(weeks = 12) {
  const startTime = Date.now() - (weeks * 7 * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      strftime('%Y-%W', time_created / 1000, 'unixepoch') as week,
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"tokens":%' AND time_created >= ${startTime}
    GROUP BY week, json_extract(data, '$.modelID')
    ORDER BY week
  `);
  
  return rows.map(row => ({
    week: row.week,
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getMonthlyStats(months = 12) {
  const startTime = Date.now() - (months * 30 * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      strftime('%Y-%m', time_created / 1000, 'unixepoch') as month,
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"tokens":%' AND time_created >= ${startTime}
    GROUP BY month, json_extract(data, '$.modelID')
    ORDER BY month
  `);
  
  return rows.map(row => ({
    month: row.month,
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getHourlyStats() {
  const rows = query(`
    SELECT 
      CAST(strftime('%H', time_created / 1000, 'unixepoch') AS INTEGER) as hour,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"tokens":%'
    GROUP BY hour
    ORDER BY hour
  `);
  
  return rows.map(row => ({
    hour: row.hour,
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getDailyStatsRange(startTs, endTs) {
  const rows = query(`
    SELECT 
      date(time_created / 1000, 'unixepoch') as date,
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"tokens":%' AND time_created >= ${startTs} AND time_created <= ${endTs}
    GROUP BY date, json_extract(data, '$.modelID')
    ORDER BY date
  `);
  
  return rows.map(row => ({
    date: row.date,
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getModelsStatsByDays(days) {
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.read') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) ELSE 0 END) as cacheRead,
      SUM(CASE WHEN json_extract(data, '$.tokens.cache.write') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.cache.write') AS INTEGER) ELSE 0 END) as cacheWrite
    FROM message
    WHERE data LIKE '%"modelID"%' AND data LIKE '%"tokens":%' AND time_created >= ${startTime}
    GROUP BY json_extract(data, '$.modelID')
    ORDER BY inputTokens DESC
  `);
  
  return rows.map(row => ({
    modelId: row.modelId,
    baseModel: normalizeModelName(row.modelId),
    isFree: isFreeModel(row.modelId),
    messageCount: row.messageCount || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheRead: row.cacheRead || 0,
    cacheWrite: row.cacheWrite || 0
  }));
}

function getDailyTPSByModel(days = 30, modelFilter = null) {
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      date(time_created / 1000, 'unixepoch') as date,
      json_extract(data, '$.modelID') as modelId,
      json_extract(data, '$.tokens.output') as outputTokens,
      json_extract(data, '$.tokens.input') as inputTokens,
      json_extract(data, '$.time.created') as timeCreated,
      json_extract(data, '$.time.completed') as timeCompleted
    FROM message
    WHERE data LIKE '%"tokens":%' 
      AND data LIKE '%"time":%'
      AND time_created >= ${startTime}
  `);

  const modelDailyStats = {};

  for (const row of rows) {
    if (!row.modelId) continue;
    
    const timeCreated = row.timeCreated || row.time_created;
    const timeCompleted = row.timeCompleted;
    const durationSeconds = (timeCompleted && timeCreated && timeCompleted > timeCreated) 
      ? (timeCompleted - timeCreated) / 1000 
      : 0;
    
    if (durationSeconds <= 0) continue;
    
    const tps = (row.outputTokens || 0) / durationSeconds;
    if (!isFinite(tps)) continue;
    
    const modelKey = normalizeModelName(row.modelId);
    const dateKey = row.date;
    
    if (!modelDailyStats[modelKey]) {
      modelDailyStats[modelKey] = {};
    }
    if (!modelDailyStats[modelKey][dateKey]) {
      modelDailyStats[modelKey][dateKey] = { tpsSum: 0, count: 0, inputTokens: 0, outputTokens: 0 };
    }
    
    modelDailyStats[modelKey][dateKey].tpsSum += tps;
    modelDailyStats[modelKey][dateKey].count += 1;
    modelDailyStats[modelKey][dateKey].inputTokens += row.inputTokens || 0;
    modelDailyStats[modelKey][dateKey].outputTokens += row.outputTokens || 0;
  }

  const result = [];
  const allDates = new Set();
  for (const model of Object.values(modelDailyStats)) {
    for (const date of Object.keys(model)) {
      allDates.add(date);
    }
  }
  const sortedDates = Array.from(allDates).sort();

  for (const [model, dates] of Object.entries(modelDailyStats)) {
    if (modelFilter && !modelFilter.includes(model)) continue;
    
    const data = sortedDates.map(date => {
      const dayStats = dates[date];
      return dayStats && dayStats.count > 0 
        ? { 
            tps: dayStats.tpsSum / dayStats.count,
            inputTokens: dayStats.inputTokens,
            outputTokens: dayStats.outputTokens
          }
        : null;
    });
    
    result.push({
      baseModel: model,
      data: data
    });
  }

  result.sort((a, b) => {
    const totalA = a.data.reduce((s, v) => s + (v?.tps || 0), 0);
    const totalB = b.data.reduce((s, v) => s + (v?.tps || 0), 0);
    return totalB - totalA;
  });

  return {
    dates: sortedDates,
    models: result
  };
}

function getModelsTPSStats(days = 30) {
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      json_extract(data, '$.modelID') as modelId,
      COUNT(*) as messageCount,
      MIN(time_created) as firstMessage,
      MAX(time_created) as lastMessage,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      SUM(CASE WHEN json_extract(data, '$.tokens.input') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.input') AS INTEGER) ELSE 0 END) as inputTokens
    FROM message
    WHERE data LIKE '%"modelID"%' AND data LIKE '%"tokens":%' AND time_created >= ${startTime}
    GROUP BY json_extract(data, '$.modelID')
    ORDER BY outputTokens DESC
  `);
  
  return rows.map(row => {
    const firstMsg = row.firstMessage || 0;
    const lastMsg = row.lastMessage || 0;
    const durationSeconds = lastMsg > firstMsg ? (lastMsg - firstMsg) / 1000 : 1;
    const outputTPS = (row.outputTokens || 0) / durationSeconds;
    const inputTPS = (row.inputTokens || 0) / durationSeconds;
    
    return {
      modelId: row.modelId,
      baseModel: normalizeModelName(row.modelId),
      isFree: isFreeModel(row.modelId),
      messageCount: row.messageCount || 0,
      outputTokens: row.outputTokens || 0,
      inputTokens: row.inputTokens || 0,
      outputTPS: outputTPS,
      inputTPS: inputTPS,
      durationSeconds: durationSeconds
    };
  });
}

function getHourlyTPSStats() {
  const now = Date.now();
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  const rows = query(`
    SELECT 
      CAST(strftime('%H', time_created / 1000, 'unixepoch') AS INTEGER) as hour,
      COUNT(*) as messageCount,
      SUM(CASE WHEN json_extract(data, '$.tokens.output') IS NOT NULL 
          THEN CAST(json_extract(data, '$.tokens.output') AS INTEGER) ELSE 0 END) as outputTokens,
      MIN(time_created) as minTime,
      MAX(time_created) as maxTime
    FROM message
    WHERE data LIKE '%"tokens":%' AND time_created >= ${oneDayAgo}
    GROUP BY hour
    ORDER BY hour
  `);
  
  const nowHour = new Date().getHours();
  const result = [];
  
  for (let i = 0; i < 24; i++) {
    const found = rows.find(r => r.hour === i);
    const hourDiff = Math.abs(nowHour - i);
    const isToday = hourDiff <= 12;
    
    if (found && found.maxTime && found.minTime) {
      const durationSeconds = (found.maxTime - found.minTime) / 1000;
      const outputTPS = durationSeconds > 0 ? found.outputTokens / durationSeconds : 0;
      result.push({
        hour: i,
        messageCount: found.messageCount || 0,
        outputTokens: found.outputTokens || 0,
        outputTPS: outputTPS,
        isToday: isToday
      });
    } else {
      result.push({
        hour: i,
        messageCount: 0,
        outputTokens: 0,
        outputTPS: 0,
        isToday: isToday
      });
    }
  }
  
  return result;
}

function getModelsList() {
  const rows = query(`
    SELECT DISTINCT json_extract(data, '$.modelID') as modelId
    FROM message
    WHERE data LIKE '%"modelID"%'
  `);
  
  return rows
    .map(row => normalizeModelName(row.modelId))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
}

module.exports = {
  normalizeModelName,
  getShortModelName,
  isFreeModel,
  getOverview,
  getModelsStats,
  getModelsStatsByDays,
  getDailyStats,
  getDailyStatsRange,
  getWeeklyStats,
  getMonthlyStats,
  getHourlyStats,
  getModelsTPSStats,
  getHourlyTPSStats,
  getDailyTPSByModel,
  getModelsList
};
