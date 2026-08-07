import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  /** 是否为流式输出中（缓冲模式，需要处理不完整语法块） */
  isStreaming?: boolean;
}

/**
 * 清理流式输出中的不完整语法块。
 * 处理两种情况：
 * 1. 尾部未闭合的围栏代码块（奇数个 ```）
 * 2. 尾部未闭合的 LaTeX 块级公式（奇数个 $$）
 */
function sanitizeStreamingContent(content: string): string {
  // 检测未闭合的围栏代码块
  const fencePositions: number[] = [];
  const fenceRegex = /(?:^|\n)```/g;
  let match;
  while ((match = fenceRegex.exec(content)) !== null) {
    fencePositions.push(match.index + (match[0].startsWith('\n') ? 1 : 0));
  }

  if (fencePositions.length % 2 === 1) {
    return content.substring(0, fencePositions[fencePositions.length - 1]);
  }

  // 检测未闭合的块级 LaTeX $$
  const dollarPositions: number[] = [];
  const dollarRegex = /\$\$/g;
  while ((match = dollarRegex.exec(content)) !== null) {
    dollarPositions.push(match.index);
  }

  if (dollarPositions.length % 2 === 1) {
    return content.substring(0, dollarPositions[dollarPositions.length - 1]);
  }

  return content;
}

/**
 * 围栏代码块组件（独立组件，正确使用 hooks）。
 */
function FencedCodeBlock({ className, children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match?.[1];
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(codeString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // 降级：静默失败
    });
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-gray-200">
      <div className="flex items-center justify-between bg-gray-100 px-4 py-1.5 border-b border-gray-200">
        <span className="text-xs text-gray-500 font-mono font-medium">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className={`text-xs transition-colors px-2 py-0.5 rounded ${
            copied
              ? 'text-green-600 bg-green-50 opacity-100'
              : 'text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 hover:bg-gray-200'
          }`}
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <pre className="!bg-gray-50 !m-0 overflow-x-auto">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

/**
 * 统一的 Markdown 渲染器。
 *
 * 配置了 GFM（表格/任务列表/删除线）、LaTeX 数学公式（KaTeX）、代码语法高亮。
 * 流式模式下自动移除尾部不完整语法块，避免渲染残缺内容。
 */
export default function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const displayContent = useMemo(() => {
    if (!content) return '';
    if (isStreaming) {
      return sanitizeStreamingContent(content);
    }
    return content;
  }, [content, isStreaming]);

  // useMemo 内部不能使用 hooks，所以组件引用直接内联
  const components = useMemo<Components>(() => ({
    code: ({ className, children, ...props }: any) => {
      const isInline = !className?.includes('language-');
      if (isInline) {
        return (
          <code className="bg-gray-100 text-pink-600 rounded px-1.5 py-0.5 text-xs font-mono break-all" {...props}>
            {children}
          </code>
        );
      }
      return <FencedCodeBlock className={className} {...props}>{children}</FencedCodeBlock>;
    },
    a: ({ href, children, ...props }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 underline"
        {...props}
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-gray-300 text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gray-100">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border border-gray-300 px-3 py-1.5 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-300 px-3 py-1.5">{children}</td>
    ),
    tr: ({ children }) => (
      <tr className="even:bg-gray-50">{children}</tr>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-300 pl-4 my-2 text-gray-600 italic">
        {children}
      </blockquote>
    ),
    img: ({ src, alt }) => (
      <img
        src={src}
        alt={alt}
        className="max-w-full rounded-lg my-2"
        loading="lazy"
      />
    ),
    hr: () => <hr className="my-4 border-gray-200" />,
    // 任务列表
    input: ({ checked, ...props }: any) => (
      <input type="checkbox" checked={checked} readOnly className="mr-2" {...props} />
    ),
  }), []);

  return (
    <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}

export { sanitizeStreamingContent };
