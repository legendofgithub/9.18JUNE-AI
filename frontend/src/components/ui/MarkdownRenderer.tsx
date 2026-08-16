import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import { Lightbulb, ChevronDown } from 'lucide-react';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
}

function sanitizeStreamingContent(content: string): string {
  const fencePositions: number[] = [];
  const fenceRegex = /(?:^|\n)```/g;
  let match;
  while ((match = fenceRegex.exec(content)) !== null) {
    fencePositions.push(match.index + (match[0].startsWith('\n') ? 1 : 0));
  }
  if (fencePositions.length % 2 === 1) {
    return content.substring(0, fencePositions[fencePositions.length - 1]);
  }
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

function parseThinkTags(content: string): { thinkContent: string | null; mainContent: string } {
  const openTag = '<think>';
  const closeTag = '</think>';
  const openIdx = content.indexOf(openTag);
  if (openIdx === -1) {
    return { thinkContent: null, mainContent: content };
  }
  const afterOpen = content.substring(openIdx + openTag.length);
  const closeIdx = afterOpen.indexOf(closeTag);
  if (closeIdx === -1) {
    return { thinkContent: afterOpen.trim(), mainContent: '' };
  }
  return {
    thinkContent: afterOpen.substring(0, closeIdx).trim(),
    mainContent: afterOpen.substring(closeIdx + closeTag.length).trim(),
  };
}

function ThinkCard({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="mb-3 rounded-xl overflow-hidden transition-all"
      style={{ background: 'var(--june-surface-alt)', border: '1px solid var(--june-border)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors"
        style={{ color: 'var(--june-text-dim)' }}
      >
        <Lightbulb size={13} style={{ color: 'var(--june-primary)' }} />
        <span>查看 June 的思考过程</span>
        <ChevronDown
          size={13}
          className="ml-auto transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 pt-1 text-xs leading-relaxed"
          style={{ color: 'var(--june-text-dim)', borderTop: '1px solid var(--june-border)' }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="my-1">{children}</p>,
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

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
    }).catch(() => {});
  };
  return (
    <div className="relative group my-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--june-border)' }}>
      <div
        className="flex items-center justify-between px-4 py-1.5"
        style={{ background: 'var(--june-surface-alt)', borderBottom: '1px solid var(--june-border)' }}
      >
        <span className="text-xs font-mono font-medium" style={{ color: 'var(--june-text-dim)' }}>
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs transition-colors px-2 py-0.5 rounded"
          style={{ color: copied ? 'var(--june-success)' : 'var(--june-text-dim)' }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="!m-0 overflow-x-auto" style={{ background: '#1e1e2e' }}>
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const { thinkContent, mainContent } = useMemo(() => parseThinkTags(content), [content]);

  const displayContent = useMemo(() => {
    if (!mainContent) return '';
    if (isStreaming) return sanitizeStreamingContent(mainContent);
    return mainContent;
  }, [mainContent, isStreaming]);

  const components = useMemo<Components>(() => ({
    code: ({ className, children, ...props }: any) => {
      const isInline = !className?.includes('language-');
      if (isInline) {
        return (
          <code
            className="rounded px-1.5 py-0.5 text-xs font-mono break-all"
            style={{ background: 'var(--june-primary-light)', color: 'var(--june-primary)' }}
            {...props}
          >
            {children}
          </code>
        );
      }
      return <FencedCodeBlock className={className} {...props}>{children}</FencedCodeBlock>;
    },
    a: ({ href, children, ...props }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--june-primary)' }} {...props}>
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse text-sm" style={{ borderColor: 'var(--june-border)' }}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead style={{ background: 'var(--june-surface-alt)' }}>{children}</thead>,
    th: ({ children }) => (
      <th className="border px-3 py-1.5 text-left font-semibold" style={{ borderColor: 'var(--june-border)', color: 'var(--june-text-bright)' }}>{children}</th>
    ),
    td: ({ children }) => (
      <td className="border px-3 py-1.5" style={{ borderColor: 'var(--june-border)', color: 'var(--june-text)' }}>{children}</td>
    ),
    blockquote: ({ children }) => (
      <blockquote className="pl-4 my-2 italic" style={{ borderLeft: '3px solid var(--june-primary)', color: 'var(--june-text-dim)' }}>{children}</blockquote>
    ),
    img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full rounded-lg my-2" loading="lazy" />,
    hr: () => <hr className="my-4" style={{ borderColor: 'var(--june-border)' }} />,
    input: ({ checked, ...props }: any) => (
      <input type="checkbox" checked={checked} readOnly className="mr-2 accent-[var(--june-primary)]" {...props} />
    ),
  }), []);

  return (
    <div className="prose prose-sm max-w-none">
      {thinkContent && <ThinkCard content={thinkContent} />}
      {displayContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeHighlight, rehypeKatex]}
          components={components}
        >
          {displayContent}
        </ReactMarkdown>
      )}
    </div>
  );
}

export { sanitizeStreamingContent };
