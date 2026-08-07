import { useState, useCallback } from 'react';

interface CodeBlockProps {
  /** 语言标识符（如 python, javascript, rust） */
  language?: string;
  /** 代码内容 */
  code: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

/**
 * 代码块组件：语法高亮 + 语言标签 + 复制按钮 + 行号。
 *
 * 样式依赖 rehype-highlight 的 highlight.js 主题（在 index.css 中引入）。
 */
export default function CodeBlock({ language, code, showLineNumbers = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 降级：静默失败（某些浏览器不支持 clipboard API）
    }
  }, [code]);

  const lines = code.split('\n');

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-[#1e2d3d] bg-[#0d1520] neon-glow-hover transition-shadow duration-300">
      {/* 标题栏：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between bg-[#111d2b] px-4 py-1.5 border-b border-[#1e2d3d]">
        <span className="text-xs text-[#00e5ff]/70 font-mono font-medium">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className={`text-xs transition-all px-2 py-0.5 rounded ${
            copied
              ? 'text-green-400 bg-green-400/10'
              : 'text-[#6b7c93] hover:text-[#00e5ff] opacity-0 group-hover:opacity-100'
          }`}
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      {/* 代码内容 + 行号 */}
      <pre className="!bg-transparent !m-0 overflow-x-auto">
        <code className="block text-sm leading-relaxed text-[#c8d6e5]">
          {showLineNumbers
            ? lines.map((line, i) => (
                <span key={i} className="block">
                  <span className="inline-block w-10 text-right text-[#1e2d3d] select-none mr-4 text-xs">
                    {i + 1}
                  </span>
                  {line}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}

/**
 * 行内代码组件（用于 `...` 内联代码片段）
 */
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-[#00e5ff]/10 text-[#00e5ff] rounded px-1.5 py-0.5 text-xs font-mono break-all">
      {children}
    </code>
  );
}
