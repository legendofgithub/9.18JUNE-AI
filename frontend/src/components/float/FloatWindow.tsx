 import { useState, useRef, useCallback, useEffect } from 'react';
 import { X, Minus, GripHorizontal, Send, Settings, Quote } from 'lucide-react';
 import type { FloatWindow as FloatWindowType } from '../../types';
 import FloatManager from '../../utils/floatManager';
 import useJuneStore from '../../stores/useJuneStore';
 import ErrorBoundary from '../ErrorBoundary';
import MarkdownRenderer from '../ui/MarkdownRenderer';
import type { FollowUpSettings } from '../../types';
import { buildLevelPath } from '../../utils/harnessRestore';
 
 interface FloatWindowProps {
   window: FloatWindowType;
 }
 
 export default function FloatWindow({ window: win }: FloatWindowProps) {
   const [input, setInput] = useState('');
   const [isDragging, setIsDragging] = useState(false);
   const [isResizing, setIsResizing] = useState(false);
   const [showSettings, setShowSettings] = useState(false);
   const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({ startX: 0, startY: 0, origX: 0, origY: 0 });
   const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number }>({ startX: 0, startY: 0, origW: 0, origH: 0 });
   const inputRef = useRef<HTMLInputElement>(null);
   const messagesEndRef = useRef<HTMLDivElement>(null);
   const settingsPanelRef = useRef<HTMLDivElement>(null);
 
   const updateFloatWindowPosition = useJuneStore(s => s.updateFloatWindowPosition);
   const updateFloatWindowSize = useJuneStore(s => s.updateFloatWindowSize);
   const closeFloatWindow = useJuneStore(s => s.closeFloatWindow);
   const minimizeFloatWindow = useJuneStore(s => s.minimizeFloatWindow);
   const restoreFloatWindow = useJuneStore(s => s.restoreFloatWindow);
   const bringToFront = useJuneStore(s => s.bringToFront);
   const sendFollowUp = useJuneStore(s => s.sendFollowUp);
   const showContextMenu = useJuneStore(s => s.showContextMenu);
   const openTextFollowUp = useJuneStore(s => s.openTextFollowUp);
  const updateFloatWindowSettings = useJuneStore(s => s.updateFloatWindowSettings);
  const siblingWindows = useJuneStore(s => s.floatWindows);

  const colors = FloatManager.getLevelColors(win.level);
  const levelPath = buildLevelPath(win.threadId, siblingWindows);
 
   // 点击外部关闭设置面板
   useEffect(() => {
     if (!showSettings) return;
     const handler = (e: MouseEvent) => {
       if (settingsPanelRef.current && !settingsPanelRef.current.contains(e.target as Node)) {
         setShowSettings(false);
       }
     };
     document.addEventListener('mousedown', handler);
     return () => document.removeEventListener('mousedown', handler);
   }, [showSettings]);
 
   // 滚动到底部
   useEffect(() => {
     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [win.messages]);
 
   // 拖拽处理
   const handlePointerDown = useCallback((e: React.PointerEvent) => {
     e.preventDefault();
     bringToFront(win.threadId);
     setIsDragging(true);
     dragRef.current = {
       startX: e.clientX,
       startY: e.clientY,
       origX: win.position.x,
       origY: win.position.y,
     };
     (e.target as HTMLElement).setPointerCapture(e.pointerId);
   }, [win.threadId, win.position, bringToFront]);
 
   const handlePointerMove = useCallback((e: React.PointerEvent) => {
     if (isDragging) {
       const dx = e.clientX - dragRef.current.startX;
       const dy = e.clientY - dragRef.current.startY;
       const newPos = FloatManager.clampToScreen(
         { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
         win.size,
       );
       updateFloatWindowPosition(win.threadId, newPos);
     }
     if (isResizing) {
       const dx = e.clientX - resizeRef.current.startX;
       const dy = e.clientY - resizeRef.current.startY;
       const newSize = {
         width: Math.max(320, resizeRef.current.origW + dx),
         height: Math.max(240, resizeRef.current.origH + dy),
       };
       updateFloatWindowSize(win.threadId, newSize);
     }
   }, [isDragging, isResizing, win.threadId, win.size, updateFloatWindowPosition, updateFloatWindowSize]);
 
   const handlePointerUp = useCallback(() => {
     setIsDragging(false);
     setIsResizing(false);
   }, []);
 
   // 调整大小
   const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
     e.preventDefault();
     e.stopPropagation();
     setIsResizing(true);
     resizeRef.current = {
       startX: e.clientX,
       startY: e.clientY,
       origW: win.size.width,
       origH: win.size.height,
     };
     (e.target as HTMLElement).setPointerCapture(e.pointerId);
   }, [win.size]);
 
   // 发送追问
   const handleSend = useCallback(() => {
     if (!input.trim()) return;
     sendFollowUp(win.threadId, input.trim());
     setInput('');
   }, [input, win.threadId, sendFollowUp]);
 
   // 追问内文本选中
   const handleContextMenu = useCallback((e: React.MouseEvent) => {
     const selection = window.getSelection();
     const selectedText = selection?.toString().trim();
     if (selectedText) {
       e.preventDefault();
       const rect = selection?.getRangeAt(0)?.getBoundingClientRect();
       showContextMenu({
         x: rect ? rect.right + 5 : e.clientX,
         y: rect ? rect.top : e.clientY,
         items: [
           {
             label: '复制',
             icon: 'copy',
             action: () => navigator.clipboard.writeText(selectedText),
           },
           {
             label: '追问 (创建子层)',
             icon: 'followup',
             action: () => {
               const position = FloatManager.getChildPosition(win);
               openTextFollowUp({
                 selectedText,
                 sourceMessageId: win.messages[win.messages.length - 1]?.id ?? 'unknown',
                 parentThreadId: win.threadId,
                 level: win.level + 1,
                 position,
               });
             },
           },
         ],
       });
     }
   }, [win, showContextMenu, openTextFollowUp]);
 
   // 最小化状态
   if (win.isMinimized) {
     return (
       <div
         onClick={() => restoreFloatWindow(win.threadId)}
         className="fixed rounded-full px-3 py-1.5 cursor-pointer z-50 flex items-center gap-2 transition-shadow hover:shadow-lg animate-fade-in"
         style={{
           left: win.position.x,
           top: win.position.y,
           zIndex: win.zIndex,
           backgroundColor: colors.header,
           border: `1px solid ${colors.border}`,
         }}
       >
         <span
           className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white"
           style={{ backgroundColor: colors.border }}
         >
           L{win.level}
         </span>
         <span className="text-xs truncate max-w-[120px]" style={{ color: 'var(--june-text-dim)' }}>
           {win.source.selectedText?.slice(0, 20) ?? '追问'}
         </span>
       </div>
     );
   }
 
   return (
     <div
       data-float-window
       className={`fixed rounded-2xl flex flex-col z-50 overflow-hidden ${
         isDragging ? 'cursor-grabbing' : ''
       } ${isDragging || isResizing ? 'select-none' : ''}`}
       style={{
         left: win.position.x,
         top: win.position.y,
         width: win.size.width,
         height: win.size.height,
         zIndex: win.zIndex,
         backgroundColor: 'var(--june-surface)',
         border: `2px solid ${colors.border}`,
         boxShadow: '0 10px 40px rgba(45, 49, 66, 0.12), 0 4px 12px rgba(45, 49, 66, 0.08)',
       }}
       onClick={() => bringToFront(win.threadId)}
       onPointerMove={handlePointerMove}
       onPointerUp={handlePointerUp}
       onPointerCancel={handlePointerUp}
     >
       {/* 标题栏 */}
       <div
         className="flex items-center gap-2 px-3 py-2 rounded-t-2xl cursor-grab"
         style={{ backgroundColor: colors.header }}
         onPointerDown={handlePointerDown}
       >
         <GripHorizontal size={14} style={{ color: 'var(--june-text-dim)' }} />
 
         {/* 层级标签（药丸样式） */}
         <span
           className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
           style={{ backgroundColor: colors.border }}
        >
          L{win.level}
        </span>

        <span
          className="text-[10px] font-medium whitespace-nowrap px-1.5 py-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.55)', color: 'var(--june-text-dim)' }}
          title={`追问路径：${levelPath}`}
        >
          {levelPath}
        </span>

        {/* 追问源预览 */}
         <span className="text-xs truncate flex-1 flex items-center gap-1" style={{ color: 'var(--june-text-dim)' }}>
           {win.type === 'text' ? (
             <>
               <Quote size={12} style={{ color: colors.border }} />
               <span className="truncate">"{win.source.selectedText?.slice(0, 30)}{(win.source.selectedText?.length ?? 0) > 30 ? '...' : ''}"</span>
             </>
           ) : (
             <>追问</>
           )}
         </span>
 
         {/* 操作按钮 */}
         <div className="relative" ref={settingsPanelRef}>
           <button
             onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
             className="p-1 rounded-lg transition-colors"
             style={{ color: 'var(--june-text-dim)', background: showSettings ? 'var(--june-primary-light)' : 'transparent' }}
             title="追问设置"
           >
             <Settings size={14} />
           </button>
 
           {/* 设置面板 */}
           {showSettings && (
             <div
               className="absolute right-0 top-full mt-1 rounded-xl p-3 w-52 z-[9999] animate-fade-in card-shadow-lg"
               style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
               onClick={e => e.stopPropagation()}
             >
               <SettingsPanel
                 settings={win.settings ?? { verbosity: 'detailed', temperature: 'medium' }}
                 onChange={(s) => updateFloatWindowSettings(win.threadId, s)}
               />
             </div>
           )}
         </div>
         <button
           onClick={() => minimizeFloatWindow(win.threadId)}
           className="p-1 rounded-lg transition-colors"
           style={{ color: 'var(--june-text-dim)' }}
         >
           <Minus size={14} />
         </button>
         <button
           onClick={() => closeFloatWindow(win.threadId, true)}
           className="p-1 rounded-lg transition-colors"
         >
           <X size={14} style={{ color: 'var(--june-text-dim)' }} />
         </button>
       </div>
 
       {/* 追问源引用 */}
       <div className="px-3 py-1.5" style={{ background: 'var(--june-surface-alt)', borderBottom: '1px solid var(--june-border)' }}>
         <div className="text-xs italic" style={{ color: 'var(--june-text-dim)' }}>
           {win.type === 'text'
             ? `引用: "...${win.source.selectedText?.slice(0, 100)}..."`
             : '引用: [截图内容]'}
         </div>
       </div>
 
       {/* 消息区 */}
       <div
         className="flex-1 overflow-y-auto px-3 py-2 text-sm"
         style={{ backgroundColor: 'var(--june-surface)' }}
         onContextMenu={handleContextMenu}
       >
         {win.messages.length === 0 ? (
           <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--june-text-dim)' }}>
             在下方输入框继续追问...
           </div>
         ) : (
           win.messages.map(msg => (
             <div key={msg.id} className={`mb-3 ${msg.role === 'user' ? 'text-right' : ''}`}>
               <div
                 className={`inline-block select-text rounded-xl px-3 py-1.5 text-xs max-w-[90%] ${
                   msg.role === 'user' ? 'text-white' : 'card-shadow'
                 }`}
                 style={
                   msg.role === 'user'
                     ? { background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }
                     : { background: 'var(--june-surface-alt)', border: '1px solid var(--june-border)', color: 'var(--june-text)' }
                 }
               >
                 {msg.content ? (
                   msg.role === 'user' ? (
                     <div className="whitespace-pre-wrap">{msg.content}</div>
                   ) : (
                     <MarkdownRenderer
                       content={msg.content}
                       isStreaming={win.isStreaming && msg === win.messages[win.messages.length - 1]}
                     />
                   )
                 ) : (
                   <span className="flex items-center gap-1 py-0.5">
                     <span className="typing-dot" style={{ width: 4, height: 4 }} />
                     <span className="typing-dot" style={{ width: 4, height: 4 }} />
                     <span className="typing-dot" style={{ width: 4, height: 4 }} />
                   </span>
                 )}
               </div>
             </div>
           ))
         )}
         <div ref={messagesEndRef} />
       </div>
 
       {/* 输入栏 */}
       <div className="px-3 py-2" style={{ borderTop: '1px solid var(--june-border)' }}>
         <div className="flex items-center gap-2">
           <input
             ref={inputRef}
             type="text"
             value={input}
             onChange={e => setInput(e.target.value)}
             onKeyDown={e => {
               if (e.key === 'Enter' && !e.shiftKey) {
                 e.preventDefault();
                 handleSend();
               }
             }}
             placeholder="继续追问..."
             className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none transition-all"
             style={{
               border: '1px solid var(--june-border)',
               background: 'var(--june-surface)',
               color: 'var(--june-text)',
             }}
             onFocus={e => { e.target.style.borderColor = 'var(--june-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
             onBlur={e => { e.target.style.borderColor = 'var(--june-border)'; e.target.style.boxShadow = 'none'; }}
           />
           <button
             onClick={handleSend}
             disabled={!input.trim()}
             className="p-1.5 rounded-lg transition-all"
             style={
               input.trim()
                 ? { background: `linear-gradient(135deg, ${colors.border}, var(--june-accent-2))` }
                 : { background: 'var(--june-surface-alt)' }
             }
           >
             <Send size={14} style={{ color: input.trim() ? '#ffffff' : 'var(--june-text-dim)' }} />
           </button>
         </div>
       </div>
 
       {/* 右下角拖拽调整大小 */}
       <div
         className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
         onPointerDown={handleResizePointerDown}
         style={{
           background: `linear-gradient(135deg, transparent 50%, ${colors.border}40 50%)`,
           borderBottomRightRadius: '1rem',
         }}
       />
     </div>
   );
 }
 
 /** 设置面板内容组件 */
 function SettingsPanel({
   settings,
   onChange,
 }: {
   settings: FollowUpSettings;
   onChange: (s: Partial<FollowUpSettings>) => void;
 }) {
   return (
     <div className="space-y-3 text-xs" style={{ color: 'var(--june-text)' }}>
       {/* 回复长度 */}
       <div>
         <div className="mb-1.5 font-medium" style={{ color: 'var(--june-text)' }}>回复长度</div>
         <div className="flex gap-1">
           {(['detailed', 'concise'] as const).map(v => (
             <button
               key={v}
               onClick={() => onChange({ verbosity: v })}
               className="flex-1 px-2 py-1 rounded-lg text-xs transition-all"
               style={
                 settings.verbosity === v
                   ? { background: 'var(--june-primary)', color: '#fff' }
                   : { background: 'var(--june-surface-alt)', color: 'var(--june-text-dim)' }
               }
             >
               {v === 'detailed' ? '详细' : '简略'}
             </button>
           ))}
         </div>
       </div>
 
       {/* 温度 */}
       <div>
         <div className="mb-1.5 font-medium" style={{ color: 'var(--june-text)' }}>模型温度</div>
         <div className="flex gap-1">
           {([
             { key: 'low' as const, label: '低', desc: '0.2' },
             { key: 'medium' as const, label: '中', desc: '0.7' },
             { key: 'high' as const, label: '高', desc: '1.2' },
           ]).map(t => (
             <button
               key={t.key}
               onClick={() => onChange({ temperature: t.key })}
               className="flex-1 px-2 py-1 rounded-lg text-xs transition-all"
               style={
                 settings.temperature === t.key
                   ? { background: 'var(--june-primary)', color: '#fff' }
                   : { background: 'var(--june-surface-alt)', color: 'var(--june-text-dim)' }
               }
               title={`温度 ${t.desc}`}
             >
               {t.label}
             </button>
           ))}
         </div>
         <div className="mt-1 text-[10px]" style={{ color: 'var(--june-text-dim)' }}>
           低·精确稳定 · 中·均衡 · 高·创意发散
         </div>
       </div>
     </div>
   );
 }
