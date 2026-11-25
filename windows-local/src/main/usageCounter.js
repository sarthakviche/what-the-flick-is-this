'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Counts Gemini requests per day so the panel can show "gemini calls today". Google resets free tier
 * daily quotas at midnight Pacific time, so the day is counted in that time zone too.
 * Stored as a tiny JSON file in the app's user data folder.
 */
function pacificDateKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

class UsageCounter {
  constructor({ storageFolder, onChange = () => {} }) {
    this.storageFilePath = path.join(storageFolder, 'gemini-usage.json');
    this.onChange = onChange;
    this.usage = this.readStoredUsage();
  }

  readStoredUsage() {
    try {
      const storedUsage = JSON.parse(fs.readFileSync(this.storageFilePath, 'utf8'));
      if (storedUsage.dateKey === pacificDateKey()) return storedUsage;
    } catch (error) {
      // No file yet or unreadable: start counting from zero.
    }
    return { dateKey: pacificDateKey(), requestCountByModel: {} };
  }

  recordRequest(modelName) {
    if (this.usage.dateKey !== pacificDateKey()) this.usage = { dateKey: pacificDateKey(), requestCountByModel: {} };
    this.usage.requestCountByModel[modelName] = (this.usage.requestCountByModel[modelName] || 0) + 1;
    try {
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.usage));
    } catch (error) {
      // Counting is a convenience; never let it break an answer.
    }
    this.onChange(this.summary());
  }

  summary() {
    if (this.usage.dateKey !== pacificDateKey()) return { totalRequestsToday: 0, requestCountByModel: {} };
    const totalRequestsToday = Object.values(this.usage.requestCountByModel).reduce((runningTotal, count) => runningTotal + count, 0);
    return { totalRequestsToday, requestCountByModel: { ...this.usage.requestCountByModel } };
  }
}

module.exports = { UsageCounter, pacificDateKey };
