'use strict';

const env = require('../config/env');

/** Today's business date (YYYY-MM-DD) in APP_TZ_OFFSET, e.g. Bangkok time for a UTC server. */
function localDate(at = new Date()) {
  const [, sign, hh, mm] = env.APP_TZ_OFFSET.match(/^([+-])(\d{2}):(\d{2})$/);
  const offsetMs = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60_000;
  return new Date(at.getTime() + offsetMs).toISOString().slice(0, 10);
}

module.exports = { localDate };
