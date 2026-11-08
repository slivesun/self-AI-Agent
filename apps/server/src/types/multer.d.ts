/**
 * multer 2.x 未内置类型声明，仓库也没装 @types/multer。
 * 这里只在类型检查层面声明为任意类型；真正用到的 file/files
 * 字段在 express.d.ts 里补充到 Express.Request 上。
 */
declare module 'multer';
