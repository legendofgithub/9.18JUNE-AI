 import { useEffect, useRef, useCallback } from 'react';
 import { GraduationCap, MessageSquareQuote, Copy } from 'lucide-react';
 import useJuneStore from '../../stores/useJuneStore';
 import MessageBubble from './MessageBubble';
 
 export default function MessageList() {
   const messages = useJuneStore(s => s.mainMessages);
   const isStreaming = useJuneStore(s => s.isStreaming);
   const showContextMenu = useJuneStore(s => s.showContextMenu);
   const bottomRef = useRef<HTMLDivElement>(null);
 
   // 自动滚动到最新消息
   useEffect(() => {
     bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [messages, isStreaming]);
 
   const handleTextSelect = useCallback((selectedText: string, sourceMessageId: string) => {
     const rect = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect();
     const position = {
       x: rect ? rect.right + 10 : window.innerWidth / 2 - 200,
       y: rect ? rect.top : window.innerHeight / 2 - 200,
     };
 
     showContextMenu({
       x: position.x,
       y: position.y,
       items: [
         {
           label: '复制',
           icon: 'copy',
           action: () => {
             navigator.clipboard.writeText(selectedText);
           },
           shortcut: 'Ctrl+C',
         },
         {
           label: '文本追问',
           icon: 'followup',
           action: () => {
             const store = useJuneStore.getState();
             const existingFloats = store.floatWindows.filter(
               w => w.source.sourceMessageId === sourceMessageId
             );
             const level = existingFloats.length + 1;
 
             store.openTextFollowUp({
               selectedText,
               sourceMessageId,
               parentThreadId: 'main',
               level,
               position: {
                 x: Math.min(position.x, window.innerWidth - 440),
                 y: Math.min(position.y, window.innerHeight - 380),
               },
             });
           },
         },
       ],
     });
   }, [showContextMenu]);
 
   if (messages.length === 0) {
     return (
       <div className="flex-1 flex items-center justify-center px-4">
         <div className="text-center animate-slide-up">
           <div
             className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center card-shadow"
             style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
           >
             <GraduationCap size={32} className="text-white" />
           </div>
           <h2 className="text-xl font-semibold mb-2 gradient-text">June AI 伴学</h2>
           <p className="text-sm" style={{ color: 'var(--june-text-dim)' }}>
             选中任意文本即可右键追问，让学习不停顿
           </p>
           <div className="mt-6 flex gap-2 justify-center text-xs">
             <div
               className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
               style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)', color: 'var(--june-text-dim)' }}
             >
               <MessageSquareQuote size={13} style={{ color: 'var(--june-primary)' }} />
               <span>选中文本 → 右键追问</span>
             </div>
           </div>
         </div>
       </div>
     );
   }
 
   return (
     <div className="flex-1 overflow-y-auto px-4 py-6">
       <div className="max-w-3xl mx-auto">
         {messages.map((msg, idx) => (
           <MessageBubble
             key={msg.id}
             message={msg}
             onTextSelect={handleTextSelect}
             isStreaming={isStreaming && msg.role === 'assistant' && idx === messages.length - 1}
           />
         ))}
         <div ref={bottomRef} />
       </div>
     </div>
   );
 }
