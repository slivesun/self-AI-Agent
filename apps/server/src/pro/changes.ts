import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { PRO_BACKUPS_DIR } from './paths.js';
import { getProChange, markProChangeRolledBack } from './db.js';

/**
 * 回滚一次落盘改动：有备份就把备份覆盖回去，新建的文件则删掉。
 * 备份路径必须落在专业版备份目录内（防止被篡改的记录指到别处）。
 */
export async function rollbackChange(changeId: string) {
  const change = getProChange(changeId);
  if (!change) throw new Error('改动记录不存在（可能已被清理）');
  if (change.rolledBackAt) throw new Error(`这条改动已在 ${change.rolledBackAt} 回滚过`);

  const backup = change.backupPath ? path.resolve(change.backupPath) : null;
  if (backup) {
    const rel = path.relative(path.resolve(PRO_BACKUPS_DIR), backup);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('备份路径不合法，拒绝回滚');
    if (!fss.existsSync(backup)) throw new Error('备份文件已不存在，无法回滚');
  }

  if (change.action === 'create') {
    // 原来是新建：回滚 = 删掉这个文件
    if (fss.existsSync(change.filePath)) await fs.unlink(change.filePath);
  } else {
    if (!backup) throw new Error('这条改动没有备份（不是通过工具写入的），无法回滚');
    await fs.mkdir(path.dirname(change.filePath), { recursive: true });
    await fs.copyFile(backup, change.filePath);
  }

  markProChangeRolledBack(changeId);
  return {
    changeId,
    filePath: change.filePath,
    action: change.action,
    message: change.action === 'create' ? '已删除新建的文件' : '已恢复为改动前内容',
  };
}
