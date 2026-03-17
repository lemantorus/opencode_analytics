const Aggregator = (function() {
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

  function filterByRange(messages, startTs, endTs) {
    if (!startTs && !endTs) return messages;
    return messages.filter(m => {
      if (!m.ts) return false;
      if (startTs && m.ts < startTs) return false;
      if (endTs && m.ts > endTs) return false;
      return true;
    });
  }

  function filterByDays(messages, days) {
    if (!days || days === 'all') return messages;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return messages.filter(m => m.ts && m.ts >= cutoff);
  }

  function getPricing(modelId, pricing, checkAsFree) {
    const base = normalizeModelName(modelId);
    const short = getShortModelName(modelId);
    const isFree = isFreeModel(modelId);
    
    if (checkAsFree && isFree) {
      return { input: 0, output: 0, cacheRead: 0, isFree: true };
    }
    
    if (pricing[base]) return pricing[base];
    if (pricing[short]) return pricing[short];
    
    return { input: 0, output: 0, cacheRead: 0, isFree };
  }

  function calcCost(msg, pricing, checkAsFree) {
    const p = getPricing(msg.modelId, pricing, checkAsFree);
    const inputCost = (msg.in || 0) * (p.input || 0);
    const outputCost = ((msg.out || 0) + (msg.rs || 0)) * (p.output || 0);
    const cacheCost = (msg.cr || 0) * (p.cacheRead || p.input || 0);
    const cacheWriteCost = (msg.cw || 0) * (p.input || 0);
    return inputCost + outputCost + cacheCost + cacheWriteCost;
  }

  function aggregateByPeriod(messages, period, pricing, checkAsFree) {
    const groups = {};
    
    for (const msg of messages) {
      if (!msg.ts) continue;
      
      const d = new Date(msg.ts);
      let key;
      
      if (period === 'day') {
        key = d.toISOString().split('T')[0];
      } else if (period === 'week') {
        const year = d.getFullYear();
        const weekNum = getWeekNumber(d);
        key = `${year}-${weekNum.toString().padStart(2, '0')}`;
      } else if (period === 'month') {
        key = d.toISOString().slice(0, 7);
      } else {
        key = d.toISOString().split('T')[0];
      }
      
      if (!groups[key]) {
        groups[key] = { time: key, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messageCount: 0 };
      }
      
      groups[key].inputTokens += msg.in || 0;
      groups[key].outputTokens += (msg.out || 0) + (msg.rs || 0);
      groups[key].cacheRead += msg.cr || 0;
      groups[key].cacheWrite += msg.cw || 0;
      groups[key].cost += calcCost(msg, pricing, checkAsFree);
      groups[key].messageCount += 1;
    }
    
    return Object.values(groups).sort((a, b) => a.time.localeCompare(b.time));
  }

  function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  }

  function aggregateByHour(messages) {
    const groups = {};
    
    for (const msg of messages) {
      if (!msg.ts) continue;
      const hour = new Date(msg.ts).getHours();
      
      if (!groups[hour]) {
        groups[hour] = { hour, messageCount: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
      }
      
      groups[hour].messageCount += 1;
      groups[hour].inputTokens += msg.in || 0;
      groups[hour].outputTokens += (msg.out || 0) + (msg.rs || 0);
      groups[hour].cacheRead += msg.cr || 0;
      groups[hour].cacheWrite += msg.cw || 0;
    }
    
    const result = [];
    for (let i = 0; i < 24; i++) {
      result.push(groups[i] || { hour: i, messageCount: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 });
    }
    return result;
  }

  function aggregateByModel(messages, pricing, checkAsFree) {
    const groups = {};
    
    for (const msg of messages) {
      const modelId = msg.modelId || 'unknown';
      const base = normalizeModelName(modelId);
      
      if (!groups[base]) {
        groups[base] = {
          modelId,
          baseModel: base,
          isFree: isFreeModel(modelId),
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0
        };
      }
      
      groups[base].messageCount += 1;
      groups[base].inputTokens += msg.in || 0;
      groups[base].outputTokens += (msg.out || 0) + (msg.rs || 0);
      groups[base].cacheRead += msg.cr || 0;
      groups[base].cacheWrite += msg.cw || 0;
      groups[base].cost += calcCost(msg, pricing, checkAsFree);
    }
    
    return Object.values(groups).sort((a, b) => b.inputTokens - a.inputTokens);
  }

  function getOverview(messages, pricing, checkAsFree) {
    let messageCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let firstMessage = null;
    let lastMessage = null;
    
    for (const msg of messages) {
      messageCount += 1;
      totalInput += msg.in || 0;
      totalOutput += (msg.out || 0) + (msg.rs || 0);
      totalCacheRead += msg.cr || 0;
      totalCacheWrite += msg.cw || 0;
      totalCost += calcCost(msg, pricing, checkAsFree);
      
      if (msg.ts) {
        if (!firstMessage || msg.ts < firstMessage) firstMessage = msg.ts;
        if (!lastMessage || msg.ts > lastMessage) lastMessage = msg.ts;
      }
    }
    
    return {
      messageCount,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      firstMessage,
      lastMessage
    };
  }

  function getHourlyTPS(messages) {
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const recentMessages = messages.filter(m => m.ts && m.ts >= oneDayAgo);
    
    const groups = {};
    for (const msg of recentMessages) {
      const hour = new Date(msg.ts).getHours();
      if (!groups[hour]) {
        groups[hour] = { messages: [], minTs: msg.ts, maxTs: msg.ts };
      }
      groups[hour].messages.push(msg);
      if (msg.ts < groups[hour].minTs) groups[hour].minTs = msg.ts;
      if (msg.ts > groups[hour].maxTs) groups[hour].maxTs = msg.ts;
    }
    
    const result = [];
    const currentHour = new Date().getHours();
    
    for (let i = 0; i < 24; i++) {
      const group = groups[i];
      const isToday = Math.abs(currentHour - i) <= 12;
      
      if (group && group.messages.length > 0) {
        let totalOutput = 0;
        for (const msg of group.messages) {
          totalOutput += (msg.out || 0) + (msg.rs || 0);
        }
        const duration = (group.maxTs - group.minTs) / 1000;
        const tps = duration > 0 ? totalOutput / duration : 0;
        
        result.push({
          hour: i,
          messageCount: group.messages.length,
          outputTokens: totalOutput,
          outputTPS: tps,
          isToday
        });
      } else {
        result.push({ hour: i, messageCount: 0, outputTokens: 0, outputTPS: 0, isToday });
      }
    }
    
    return result;
  }

  function getDailyTPSByModel(messages, days, modelFilter, pricing) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recent = messages.filter(m => m.ts && m.ts >= cutoff);
    
    const modelData = {};
    const allDates = new Set();
    
    for (const msg of recent) {
      if (!msg.modelId) continue;
      
      const base = normalizeModelName(msg.modelId);
      const date = new Date(msg.ts).toISOString().split('T')[0];
      allDates.add(date);
      
      const tStart = msg.tStart || msg.ts;
      const tEnd = msg.tEnd;
      const duration = (tEnd && tStart && tEnd > tStart) ? (tEnd - tStart) / 1000 : 0;
      
      if (duration <= 0) continue;
      
      const tps = ((msg.out || 0) + (msg.rs || 0)) / duration;
      if (!isFinite(tps)) continue;
      
      if (!modelData[base]) modelData[base] = {};
      if (!modelData[base][date]) {
        modelData[base][date] = { tpsSum: 0, count: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheRead: 0, cacheWrite: 0 };
      }
      
      modelData[base][date].tpsSum += tps;
      modelData[base][date].count += 1;
      modelData[base][date].inputTokens += msg.in || 0;
      modelData[base][date].outputTokens += msg.out || 0;
      modelData[base][date].reasoningTokens += msg.rs || 0;
      modelData[base][date].cacheRead += msg.cr || 0;
      modelData[base][date].cacheWrite += msg.cw || 0;
    }
    
    const sortedDates = Array.from(allDates).sort();
    const models = [];
    
    for (const [model, dates] of Object.entries(modelData)) {
      if (modelFilter && !modelFilter.includes(model)) continue;
      
      const data = sortedDates.map(date => {
        const d = dates[date];
        return d && d.count > 0 
          ? { tps: d.tpsSum / d.count, inputTokens: d.inputTokens, outputTokens: d.outputTokens, reasoningTokens: d.reasoningTokens, cacheRead: d.cacheRead, cacheWrite: d.cacheWrite }
          : null;
      });
      
      models.push({ baseModel: model, data });
    }
    
    models.sort((a, b) => {
      const totalA = a.data.reduce((s, v) => s + (v?.tps || 0), 0);
      const totalB = b.data.reduce((s, v) => s + (v?.tps || 0), 0);
      return totalB - totalA;
    });
    
    return { dates: sortedDates, models };
  }

  function getModelsTPS(messages, days) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recent = messages.filter(m => m.ts && m.ts >= cutoff);
    
    const modelData = {};
    
    for (const msg of recent) {
      const base = normalizeModelName(msg.modelId);
      
      if (!modelData[base]) {
        modelData[base] = { 
          modelId: msg.modelId, 
          baseModel: base, 
          isFree: isFreeModel(msg.modelId),
          messageCount: 0, 
          inputTokens: 0, 
          outputTokens: 0, 
          minTs: msg.ts, 
          maxTs: msg.ts 
        };
      }
      
      const md = modelData[base];
      md.messageCount += 1;
      md.inputTokens += msg.in || 0;
      md.outputTokens += (msg.out || 0) + (msg.rs || 0);
      if (msg.ts < md.minTs) md.minTs = msg.ts;
      if (msg.ts > md.maxTs) md.maxTs = msg.ts;
    }
    
    return Object.values(modelData).map(md => {
      const duration = md.maxTs > md.minTs ? (md.maxTs - md.minTs) / 1000 : 1;
      return {
        modelId: md.modelId,
        baseModel: md.baseModel,
        isFree: md.isFree,
        messageCount: md.messageCount,
        outputTokens: md.outputTokens,
        inputTokens: md.inputTokens,
        outputTPS: md.outputTokens / duration,
        inputTPS: md.inputTokens / duration,
        durationSeconds: duration
      };
    }).sort((a, b) => b.outputTokens - a.outputTokens);
  }

  function getModelsList(messages) {
    const models = new Set();
    for (const msg of messages) {
      if (msg.modelId) models.add(normalizeModelName(msg.modelId));
    }
    return Array.from(models).sort();
  }

  return {
    normalizeModelName,
    getShortModelName,
    isFreeModel,
    filterByRange,
    filterByDays,
    getPricing,
    calcCost,
    aggregateByPeriod,
    aggregateByHour,
    aggregateByModel,
    getOverview,
    getHourlyTPS,
    getDailyTPSByModel,
    getModelsTPS,
    getModelsList
  };
})();
