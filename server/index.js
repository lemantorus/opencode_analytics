const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const PRICING_FILE = path.join(__dirname, 'pricing.json');
const USER_PRICES_FILE = path.join(__dirname, 'user-prices.json');
const MODELS_DEV_URL = 'https://models.dev/api.json';

let pricing = loadPricing();
let userPrices = loadUserPrices();
let modelsDevData = null;

function loadUserPrices() {
  try {
    return JSON.parse(fs.readFileSync(USER_PRICES_FILE, 'utf8'));
  } catch {
    return { lastUpdated: null, prices: {} };
  }
}

function saveUserPrices() {
  fs.writeFileSync(USER_PRICES_FILE, JSON.stringify(userPrices, null, 2));
}

function loadPricing() {
  try {
    return JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
  } catch {
    return { models: {}, overrides: {} };
  }
}

function savePricing() {
  fs.writeFileSync(PRICING_FILE, JSON.stringify(pricing, null, 2));
}

function parseModelId(modelId) {
  if (!modelId) return null;
  
  const isFree = modelId.includes('-free') || 
                 modelId === 'big-pickle' ||
                 modelId.includes('nemotron');
  
  let baseName = modelId;
  
  baseName = baseName
    .replace(/^(zai-org\/|z-ai\/)/, '')
    .replace(/^(minimax\/)/, 'minimax-')
    .replace(/^(MiniMax-)/i, 'minimax-')
    .replace(/^(x-ai\/)/, 'grok-')
    .replace(/^(moonshotai\/)/, 'kimi-')
    .replace(/^(nvidia\/)/, 'nemotron-')
    .replace(/^thudm\//i, '')
    .replace(/-maas$/, '')
    .replace(/-flashx$/, '-flash')
    .replace(/_free$/, '-free')
    .toLowerCase();
  
  if (isFree && !baseName.endsWith('-free')) {
    baseName = baseName + '-free';
  }
  
  return { original: modelId, baseName, isFree };
}

function buildModelIndex(apiData) {
  const index = {
    byProvider: {},
    byFamily: {},
    all: []
  };
  
  for (const [provider, providerData] of Object.entries(apiData)) {
    if (!providerData?.models) continue;
    
    index.byProvider[provider] = {};
    
    for (const [modelKey, model] of Object.entries(providerData.models)) {
      if (!model) continue;
      
      const entry = { provider, key: modelKey, model, isFree: false };
      index.all.push(entry);
      index.byProvider[provider][modelKey] = entry;
      
      const family = model.family?.toLowerCase();
      if (family) {
        if (!index.byFamily[family]) index.byFamily[family] = [];
        index.byFamily[family].push(entry);
      }
      
      const idLower = model.id?.toLowerCase();
      if (idLower) {
        if (!index.byFamily[idLower]) index.byFamily[idLower] = [];
        index.byFamily[idLower].push(entry);
      }
    }
  }
  
  return index;
}

function findModelInApi(parsed, modelIndex) {
  if (!parsed) return null;
  
  const { original, baseName, isFree } = parsed;
  const searchTerms = [
    baseName,
    baseName.replace(/-flash$/, ''),
    baseName.replace(/-turbo$/, ''),
    baseName.replace(/-air$/, ''),
    baseName.split('-').slice(0, 2).join('-'),
    baseName.split('-')[0],
    original.replace(/^(zai-org\/|z-ai\/)/, '').replace(/-maas$/, '').replace(/-free$/, '').toLowerCase(),
    original.toLowerCase(),
  ].filter((v, i, a) => a.indexOf(v) === i);
  
  const seen = new Set();
  
  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    
    if (modelIndex.byFamily[term]) {
      for (const entry of modelIndex.byFamily[term]) {
        const key = `${entry.provider}/${entry.key}`;
        if (!seen.has(key)) {
          seen.add(key);
          return entry.model;
        }
      }
    }
    
    for (const entry of modelIndex.all) {
      const fullKey = `${entry.provider}/${entry.key}`.toLowerCase();
      if (fullKey.includes(term) || entry.key.toLowerCase().includes(term)) {
        const key = `${entry.provider}/${entry.key}`;
        if (!seen.has(key)) {
          seen.add(key);
          return entry.model;
        }
      }
    }
  }
  
  return null;
}

async function fetchModelsDevPricing() {
  try {
    const res = await fetch(MODELS_DEV_URL);
    const apiData = await res.json();
    modelsDevData = apiData;
    
    const modelIndex = buildModelIndex(apiData);
    const usedModels = db.getModelsStats();
    const newModels = {};
    
    for (const model of usedModels) {
      const parsed = parseModelId(model.modelId);
      if (!parsed) continue;
      
      const apiModel = findModelInApi(parsed, modelIndex);
      if (!apiModel) continue;
      
      const cost = apiModel.cost || {};
      
      newModels[parsed.baseName] = {
        input: (cost.input || 0) / 1000000,
        output: (cost.output || 0) / 1000000,
        cacheRead: (cost.cache_read || cost.input || 0) / 1000000,
        cacheWrite: (cost.cache_write || 0) / 1000000,
        isFree: parsed.isFree
      };
    }
    
    pricing.models = { ...newModels, ...pricing.overrides };
    pricing.lastUpdated = new Date().toISOString();
    pricing.source = 'models.dev';
    savePricing();
    
    console.log('Pricing updated from models.dev:', pricing.lastUpdated, `(${Object.keys(newModels).length} models)`);
    return true;
  } catch (err) {
    console.error('Failed to fetch models.dev pricing:', err.message);
    return false;
  }
}

function getPricingForModel(baseModel, checkAsFree = true) {
  const isFreeModel = baseModel.endsWith('-free') || baseModel === 'big-pickle';
  const paidName = isFreeModel ? baseModel.replace(/-free$/, '') : baseModel;
  
  // 1. Check user prices first (highest priority)
  if (userPrices.prices && userPrices.prices[baseModel]) {
    return userPrices.prices[baseModel];
  }
  
  const shortName = db.getShortModelName(baseModel);
  if (userPrices.prices && userPrices.prices[shortName]) {
    return userPrices.prices[shortName];
  }
  
  // 2. Check server prices (pricing.json)
  if (pricing.overrides && pricing.overrides[baseModel]) {
    return pricing.overrides[baseModel];
  }
  
  if (!checkAsFree && isFreeModel && pricing.models && pricing.models[paidName]) {
    return pricing.models[paidName];
  }
  
  if (pricing.models && pricing.models[baseModel]) {
    const p = pricing.models[baseModel];
    if (checkAsFree && p.isFree) {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, isFree: true };
    }
    return p;
  }
  
  if (pricing.overrides && pricing.overrides[shortName]) {
    return pricing.overrides[shortName];
  }
  
  if (!checkAsFree && isFreeModel && pricing.models && pricing.models[shortName] && !pricing.models[shortName].isFree) {
    return pricing.models[shortName];
  }
  
  if (pricing.models && pricing.models[shortName]) {
    const p = pricing.models[shortName];
    if (checkAsFree && p.isFree) {
      return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, isFree: true };
    }
    return p;
  }
  
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function calculateCost(stats, checkAsFree = true) {
  const baseModel = stats.baseModel || db.normalizeModelName(stats.modelId);
  const modelPricing = getPricingForModel(baseModel, checkAsFree);
  
  const inputCost = (stats.inputTokens || 0) * (modelPricing.input || 0);
  const outputCost = (stats.outputTokens || 0) * (modelPricing.output || 0);
  const cacheReadCost = (stats.cacheRead || 0) * (modelPricing.cacheRead || modelPricing.input || 0);
  const cacheWriteCost = (stats.cacheWrite || 0) * (modelPricing.input || 0);
  
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function aggregateByTimeFrame(stats, timeKey, checkAsFree = true) {
  const aggregated = {};
  
  for (const row of stats) {
    const key = row[timeKey];
    if (!aggregated[key]) {
      aggregated[key] = {
        time: key,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        messageCount: 0
      };
    }
    
    aggregated[key].inputTokens += row.inputTokens || 0;
    aggregated[key].outputTokens += row.outputTokens || 0;
    aggregated[key].cacheRead += row.cacheRead || 0;
    aggregated[key].cacheWrite += row.cacheWrite || 0;
    aggregated[key].messageCount += row.messageCount || 0;
    aggregated[key].cost += calculateCost(row, checkAsFree);
  }
  
  return Object.values(aggregated).sort((a, b) => a.time.localeCompare(b.time));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/stats/overview', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const overview = db.getOverview();
  const modelsStats = db.getModelsStats();
  
  let totalCost = 0;
  for (const model of modelsStats) {
    totalCost += calculateCost(model, checkAsFree);
  }
  
  res.json({
    ...overview,
    totalCost,
    modelCount: modelsStats.length
  });
});

app.get('/api/stats/models', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const days = req.query.days ? parseInt(req.query.days) : null;
  
  const modelsStats = days ? db.getModelsStatsByDays(days) : db.getModelsStats();
  
  const result = modelsStats.map(model => ({
    ...model,
    cost: calculateCost(model, checkAsFree)
  }));
  
  res.json(result);
});

app.get('/api/stats/daily', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const days = parseInt(req.query.days) || 30;
  const stats = db.getDailyStats(days);
  res.json(aggregateByTimeFrame(stats, 'date', checkAsFree));
});

app.get('/api/stats/daily/range', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const { start, end } = req.query;
  
  if (!start || !end) {
    return res.status(400).json({ error: 'Start and end dates required (YYYY-MM-DD format)' });
  }
  
  const startTs = new Date(start).getTime();
  const endTs = new Date(end).getTime() + (24 * 60 * 60 * 1000 - 1);
  
  const stats = db.getDailyStatsRange(startTs, endTs);
  res.json(aggregateByTimeFrame(stats, 'date', checkAsFree));
});

app.get('/api/stats/weekly', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const weeks = parseInt(req.query.weeks) || 12;
  const stats = db.getWeeklyStats(weeks);
  res.json(aggregateByTimeFrame(stats, 'week', checkAsFree));
});

app.get('/api/stats/monthly', (req, res) => {
  const checkAsFree = req.query.checkAsFree !== 'false';
  const months = parseInt(req.query.months) || 12;
  const stats = db.getMonthlyStats(months);
  res.json(aggregateByTimeFrame(stats, 'month', checkAsFree));
});

app.get('/api/stats/hourly', (req, res) => {
  const stats = db.getHourlyStats();
  const result = [];
  
  for (let i = 0; i < 24; i++) {
    const found = stats.find(s => s.hour === i);
    result.push({
      hour: i,
      messageCount: found?.messageCount || 0,
      inputTokens: found?.inputTokens || 0,
      outputTokens: found?.outputTokens || 0,
      cacheRead: found?.cacheRead || 0,
      cacheWrite: found?.cacheWrite || 0
    });
  }
  
  res.json(result);
});

app.get('/api/stats/hourly-tps', (req, res) => {
  const stats = db.getHourlyTPSStats();
  res.json(stats);
});

app.get('/api/stats/models-tps', (req, res) => {
  const days = req.query.days ? parseInt(req.query.days) : 30;
  const stats = db.getModelsTPSStats(days);
  res.json(stats);
});

app.get('/api/stats/daily-tps-by-model', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const modelsParam = req.query.models;
  const modelFilter = modelsParam ? modelsParam.split(',').filter(Boolean) : null;
  const data = db.getDailyTPSByModel(days, modelFilter);
  res.json(data);
});

app.get('/api/models-list', (req, res) => {
  const models = db.getModelsList();
  res.json(models);
});

app.get('/api/pricing', (req, res) => {
  res.json(pricing);
});

app.get('/api/pricing/models', (req, res) => {
  const modelsStats = db.getModelsStats();
  const allModels = { ...pricing.models };
  
  const modelsWithUsage = modelsStats.map(m => {
    const shortName = db.getShortModelName(m.baseModel);
    
    let modelPricing = userPrices.prices && userPrices.prices[m.baseModel] 
      ? userPrices.prices[m.baseModel]
      : (userPrices.prices && userPrices.prices[shortName]
        ? userPrices.prices[shortName]
        : (allModels[m.baseModel] || allModels[shortName] || { input: 0, output: 0, cacheRead: 0 }));
    
    return {
      name: m.baseModel,
      messageCount: m.messageCount,
      inputTokens: m.inputTokens,
      pricing: modelPricing,
      hasUserPrice: !!(userPrices.prices && (userPrices.prices[m.baseModel] || userPrices.prices[shortName])),
      serverPricing: allModels[m.baseModel] || allModels[shortName] || null
    };
  });
  
  modelsWithUsage.sort((a, b) => b.messageCount - a.messageCount);
  
  res.json(modelsWithUsage);
});

app.put('/api/pricing', (req, res) => {
  const { model, input, output, cacheRead } = req.body;
  
  if (!model) {
    return res.status(400).json({ error: 'Model name required' });
  }
  
  if (!userPrices.prices) userPrices.prices = {};
  
  userPrices.prices[model] = {
    input: (parseFloat(input) || 0) / 1000000,
    output: (parseFloat(output) || 0) / 1000000,
    cacheRead: (parseFloat(cacheRead) || 0) / 1000000
  };
  
  userPrices.lastUpdated = new Date().toISOString();
  saveUserPrices();
  
  res.json({ success: true, pricing: userPrices.prices[model] });
});

app.post('/api/pricing/refresh', async (req, res) => {
  const success = await fetchModelsDevPricing();
  if (success) {
    res.json({ success: true, pricing });
  } else {
    res.status(500).json({ error: 'Failed to fetch pricing from models.dev' });
  }
});

app.post('/api/pricing/reset', async (req, res) => {
  userPrices = { lastUpdated: null, prices: {} };
  saveUserPrices();
  
  const success = await fetchModelsDevPricing();
  if (success) {
    res.json({ success: true, pricing, message: 'User prices cleared, server prices updated' });
  } else {
    res.json({ success: true, pricing, message: 'User prices cleared (failed to update server prices)' });
  }
});

app.delete('/api/pricing/:model', (req, res) => {
  const model = req.params.model;
  
  if (pricing.overrides && pricing.overrides[model]) {
    delete pricing.overrides[model];
    savePricing();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Override not found' });
  }
});

const PORT = process.env.PORT || 3456;

app.listen(PORT, async () => {
  console.log(`OpenCode Analytics running at http://localhost:${PORT}`);
  await fetchModelsDevPricing();
});
