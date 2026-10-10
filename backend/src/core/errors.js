'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
const unauthorized = (msg = 'กรุณาเข้าสู่ระบบ') => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (msg = 'ไม่พบข้อมูล') => new AppError(404, 'NOT_FOUND', msg);
const conflict = (msg) => new AppError(409, 'CONFLICT', msg);
const notImplemented = (msg, details) => new AppError(501, 'NOT_IMPLEMENTED', msg, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, notImplemented };
