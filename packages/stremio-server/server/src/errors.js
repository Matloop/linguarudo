// Erro HTTP com código estável (a UI traduz pelo código; `message` é só para log/dev).
export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
