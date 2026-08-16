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
     <div
       className="px-4 py-3"
       style={{
         background: 'rgba(255, 255, 255, 0.72)',
         backdropFilter: 'blur(12px)',
         borderTop: '1px solid var(--june-border)',
       }}
     >
       <div className="max-w-3xl mx-auto">
         <div
           className="flex items-end gap-2 rounded-2xl px-4 py-2 transition-all card-shadow"
           style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
           onFocus={e => { e.currentTarget.style.borderColor = 'var(--june-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
           onBlur={e => { e.currentTarget.style.borderColor = 'var(--june-border)'; e.currentTarget.style.boxShadow = 'none'; }}
           tabIndex={-1}
         >
           {/* 文件上传按钮 */}
           <button
             onClick={() => fileInputRef.current?.click()}
             className="p-2 rounded-lg transition-colors"
             style={{ color: 'var(--june-text-dim)' }}
             onMouseEnter={e => { e.currentTarget.style.color = 'var(--june-primary)'; e.currentTarget.style.background = 'var(--june-primary-light)'; }}
             onMouseLeave={e => { e.currentTarget.style.color = 'var(--june-text-dim)'; e.currentTarget.style.background = 'transparent'; }}
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
             className="flex-1 bg-transparent resize-none outline-none text-sm py-1.5 max-h-[200px]"
             style={{ color: 'var(--june-text)' }}
             disabled={isStreaming}
           />
 
           {/* 发送按钮 */}
           <button
             onClick={handleSend}
             disabled={!input.trim() || isStreaming}
             className="p-2 rounded-xl transition-all disabled:cursor-not-allowed"
             style={
               input.trim() && !isStreaming
                 ? { background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }
                 : { background: 'var(--june-surface-alt)' }
             }
           >
             <Send
               size={18}
               style={{ color: input.trim() && !isStreaming ? '#ffffff' : 'var(--june-text-dim)' }}
             />
           </button>
         </div>
       </div>
     </div>
   );
 }
