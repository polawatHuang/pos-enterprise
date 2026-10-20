'use strict';

const env = require('../config/env');

/** Today's business date (YYYY-MM-DD) in APP_TZ_OFFSET, e.g. Bangkok time for a UTC server. */
function offsetMs() {
  const [, sign, hh, mm] = env.APP_TZ_OFFSET.match(/^([+-])(\d{2}):(\d{2})$/);
  return (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
}

function localDate(at = new Date()) {
  return new Date(at.getTime() + offsetMs()).toISOString().slice(0, 10);
}

/** Local wall-clock time "HH:MM" in APP_TZ_OFFSET (for shop-hour rules such as alcohol sale windows). */
function localTime(at = new Date()) {
  return new Date(at.getTime() + offsetMs()).toISOString().slice(11, 16);
}

module.exports = { localDate, localTime };
