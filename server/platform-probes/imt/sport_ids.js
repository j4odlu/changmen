"use strict";

const catalog = require("./sport_ids.json");

function getSportRecord(sportId) {
  return catalog.sports[String(sportId)] || null;
}

function getSportName(sportId) {
  const rec = getSportRecord(sportId);
  if (rec?.name) return rec.name;
  return `Sport ${sportId}`;
}

function getSportCode(sportId) {
  return getSportRecord(sportId)?.code || "unknown";
}

function getDefaultSportIds() {
  return (catalog.defaultSportIds || []).map(String);
}

module.exports = {
  catalog,
  getSportRecord,
  getSportName,
  getSportCode,
  getDefaultSportIds,
};
