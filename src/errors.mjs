export class Fault extends Error {
  constructor(code, message) { super(message); this.name = 'Fault'; this.code = code; }
}
export function safeError(error) {
  return error instanceof Fault ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: '操作失败；请运行 zwd doctor 检查本地环境。' };
}
export function ensure(condition, code, message) { if (!condition) throw new Fault(code, message); }
