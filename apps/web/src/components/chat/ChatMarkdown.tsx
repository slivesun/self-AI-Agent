import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * 聊天内容渲染（普通版与专业版共用）。
 * 只做展示：markdown → DOM，代码块带复制按钮，链接一律新窗口打开。
 */

function hastText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) return node.children.map(hastText).join('');
  return '';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="md-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* 剪贴板不可用时静默失败 */
        }
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

export default function ChatMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        pre({ node, children }: any) {
          const text = hastText(node);
          return (
            <div className="md-code-block">
              <div className="md-code-bar">
                <span className="md-code-lang">代码</span>
                <CopyButton text={text} />
              </div>
              <pre>{children}</pre>
            </div>
          );
        },
        a({ href, children }: any) {
          return (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          );
        },
        table({ children }: any) {
          return (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
