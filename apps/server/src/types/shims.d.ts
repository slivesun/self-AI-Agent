/**
 * 缺失类型声明的本地兜底：Express 的 Request 上没有 multer 注入的 file/files 字段。
 * multer 本身的模块声明见 multer.d.ts（必须是全局脚本文件）。
 */
export {};

declare global {
  namespace Express {
    interface Request {
      file?: any;
      files?: any;
    }
  }
}
