/**
 * electron-builder afterPack 钩子：给应用主程序写入图标与版本信息。
 *
 * 为什么要自己做这一步：
 *   electron-builder 默认走 app-builder 内置的 rcedit，而这个工具包需要从 GitHub
 *   下载 winCodeSign 压缩包，包内含 macOS 符号链接；Windows 普通用户没有创建符号链接的
 *   权限，解压直接失败（Cannot create symbolic link），整个打包中断。
 *   因此配置里关掉 win.signAndEditExecutable，改由这里用 rcedit npm 包（自带 exe）完成，
 *   效果与 electron-builder 默认行为一致：图标、产品名、版本号。
 */

const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { appOutDir, packager } = context;
  const productFilename = packager.appInfo.productFilename;
  const exePath = path.join(appOutDir, `${productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack 找不到主程序：${exePath}`);
  }

  // rcedit 5.x 是纯 ESM，只能动态 import
  const { rcedit } = await import('rcedit');
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const appInfo = packager.appInfo;

  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      CompanyName: appInfo.companyName || 'AI简历助手',
      FileDescription: appInfo.description || appInfo.productName,
      ProductName: appInfo.productName,
      InternalName: productFilename,
      OriginalFilename: `${productFilename}.exe`,
      LegalCopyright: appInfo.copyright || '',
    },
    'file-version': appInfo.shortVersion || appInfo.buildVersion || '0.1.0',
    'product-version': appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
  });

  console.log(`[afterPack] 已写入图标与版本信息：${path.basename(exePath)}`);
};
