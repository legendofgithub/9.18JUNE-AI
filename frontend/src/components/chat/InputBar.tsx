import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip } from 'lucide-react';
import useJuneStore from '../../stores/useJuneStore';

export default function InputBar() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = useJuneStore(s => s.sendMessage);
  const isStreaming = useJuneStore(s => s.isStreaming);
  const uploadFile = useJuneStore(s => s.uploadFile);

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
    e.target.value = '';
  }, [uploadFile]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  return (
    <div className="border-t border-[#1e2d3d] bg-[#0d1520]/80 backdrop-blur-md px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 bg-[#111827] rounded-2xl border border-[#1e2d3d] px-4 py-2 focus-within:border-[#00e5ff]/40 focus-within:ring-2 focus-within:ring-[#00e5ff]/10 transition-all">
          {/* 文件上传按钮 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-[#3d4d5d] hover:text-[#00e5ff] hover:bg-[#1a2332] rounded-lg transition-colors"
            title="上传文件"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            className="hidden"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"
          />

          {/* 输入框 */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，或选中任意文本右键追问..."
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-sm py-1.5 max-h-[200px] placeholder:text-[#3d4d5d] text-[#c8d6e5]"
            disabled={isStreaming}
          />

          {/* 发送按钮 */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={`p-2 rounded-lg transition-all ${
              input.trim() && !isStreaming
                ? 'bg-[#00e5ff] text-[#0a0e17] hover:bg-[#00f0ff] shadow-[0_0_12px_rgba(0,229,255,0.3)]'
                : 'text-[#3d4d5d] cursor-not-allowed'
            }`}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
